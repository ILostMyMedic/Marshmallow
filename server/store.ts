// The office's state: kept in memory, saved to state.json (a temp file, then a rename), and every change sent to every
// tab. It knows nothing about the pipeline: the modules that do change it through these methods.
// Adapted from cubefarm server/swarm.ts (MIT): its persisted shape, persistence and clients sections.
import fs from 'node:fs/promises';
import type { WebSocket } from 'ws';
import { cloudSettings, DEFAULT_CLOUD, EMPTY_CLOUD } from '../shared/cloud.ts';
import type { BoxCliRecord } from './sessions/boxCli.ts';
import {
  type CloudView,
  DEFAULT_SETTINGS,
  isBusy,
  type Floor,
  type LogEntry,
  type LogLine,
  type Moment,
  type OfficeMessage,
  type PullInfo,
  type QaRecord,
  type Question,
  type ServerEvent,
  type Settings,
  type Snapshot,
  type UsageView,
  type Worker,
} from '../shared/types.ts';
import { LOG_BUFFER } from './config.ts';
import { replaceFile, writeJsonAtomic } from './files.ts';
import { HttpError } from './httpError.ts';

/** GitHub's side of a floor: refreshed by every sync, so never saved. */
const LIVE_FLOOR_FIELDS: readonly string[] = ['cloneStatus', 'cloneError', 'issues', 'pulls', 'lastSync', 'syncError'] satisfies (keyof Floor)[];
type SavedFloor = Omit<Floor, 'cloneStatus' | 'cloneError' | 'issues' | 'pulls' | 'lastSync' | 'syncError'>;

/** A PR's trip through QA as the server keeps it: the tabs' QaRecord plus what the pipeline's rules need. */
export interface QaState extends QaRecord {
  issueNumber: number | null;
  devSessionId: string | null; // the developer's session, resumed to fix what QA found
  fixInstructions: string | null;
  sessionFailures: number; // QA or fix sessions in a row that failed
  testedSha: string | null; // the head commit QA is testing, or last tested
  passedSha: string | null; // the head commit QA signed off on: auto-merge merges exactly that
  fixReason: 'qa' | 'checks' | 'conflict' | null; // why it last went back to a developer
  retests: number; // QA rounds the office added (after merge fixes, new commits), not counted against QA's budget
  mergeFixes: number; // times it went back for failing checks or conflicts
  preQa: { sha: string; fixReason: QaState['fixReason'] } | null; // a conflict found before QA tested the head
  noChangeSha: string | null; // the head a developer last said needed no change (one free re-test per commit)
  qaChecks: PullInfo['checks'] | null; // GitHub's checks when QA last failed it: a re-run since can be the fix
  stuckWhy: string | null; // why it last needed the manager
  pendingSince: number | null; // when auto-merge started waiting on its checks
  mergeRetryAt: number | null; // GitHub refused the merge: try again after this
  alerted: boolean; // the manager has been told its checks or merge are stuck
  rerunSha: string | null; // the head commit whose failed checks the office re-ran (once per commit)
  rerunAt: number | null;
}

/** What state.json holds. */
export interface SavedState {
  settings: Settings;
  floors: SavedFloor[];
  workers: Worker[];
  qa: QaState[];
  logs: Record<string, LogLine[]>;
  messages: OfficeMessage[];
  questions: Question[];
  officeId?: string; // this office's id on a shared Upstash account (Box names and labels)
  boxClis?: Record<string, BoxCliRecord>; // Box workers' live CLIs, by worker: picked up again after a restart
}

/** Log lines per worker in state.json, and in a tab's snapshot (memory keeps LOG_BUFFER). */
const LOG_SAVED = 200;
const LOG_SNAPSHOT = 50;
/** Office messages kept, and sent in a snapshot. */
const MESSAGES_KEPT = 100;
// Changes come in bursts (a session's tool calls): one write covers each burst.
const SAVE_DELAY_MS = 1500;

export const qaKey = (floorId: string, prNumber: number) => `${floorId}#${prNumber}`;

/** The part of a QA record the tabs see. */
export function qaView(q: QaState): QaRecord {
  const { floorId, prNumber, status, round, devWorkerId, qaWorkerId, summary, checks, commentUrl, mergeNote, updatedAt } = q;
  return { floorId, prNumber, status, round, devWorkerId, qaWorkerId, summary, checks, commentUrl, mergeNote, updatedAt };
}

/** A worker's idleSince after a change: cleared while they're busy, set when they stop being busy. */
export function nextIdleSince(prev: Worker, next: Worker, now: number): number | null {
  if (isBusy(next.status)) return null;
  return isBusy(prev.status) || prev.idleSince === null ? now : prev.idleSince;
}

export class Store {
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private floors = new Map<string, Floor>();
  private workers = new Map<string, Worker>();
  private qa = new Map<string, QaState>();
  private logs = new Map<string, LogLine[]>();
  private messages: OfficeMessage[] = [];
  private questions = new Map<number, Question>();
  private usage: UsageView = { state: 'normal', until: null, warning: null };
  private cloud: CloudView = EMPTY_CLOUD;
  private office = '';
  private boxClis = new Map<string, BoxCliRecord>();
  private clients = new Set<WebSocket>();
  private logSeq = 0;
  private saveTimer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly about: { version: string; demo: boolean },
  ) {}

  /** Reads state.json. No file is a new office; one that isn't JSON is kept aside, and the office starts afresh. */
  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    let saved: Partial<SavedState>;
    try {
      saved = JSON.parse(raw) as Partial<SavedState>;
    } catch {
      const aside = `${this.file}.unreadable-${Date.now()}`;
      await replaceFile(this.file, aside);
      console.warn(`  ${this.file} isn't valid JSON: kept as ${aside}, starting afresh`);
      return;
    }
    this.settings = { ...DEFAULT_SETTINGS, ...saved.settings, cloud: cloudSettings(DEFAULT_CLOUD, saved.settings?.cloud) };
    this.office = saved.officeId ?? '';
    for (const f of saved.floors ?? []) this.floors.set(f.id, { ...f, teamSize: f.teamSize ?? null, cloneStatus: 'pending', cloneError: null, issues: [], pulls: [], lastSync: null, syncError: null });
    for (const w of saved.workers ?? []) this.workers.set(w.id, { ...w, activity: null, sessionId: w.sessionId ?? null, leaving: w.leaving ?? false });
    for (const q of saved.qa ?? []) this.qa.set(qaKey(q.floorId, q.prNumber), q);
    for (const [id, lines] of Object.entries(saved.logs ?? {})) {
      if (!this.workers.has(id)) continue;
      this.logs.set(id, lines);
      for (const l of lines) this.logSeq = Math.max(this.logSeq, l.id + 1);
    }
    this.messages = (saved.messages ?? []).map((m) => ({ ...m, from: m.from ?? 'office' }));
    for (const [id, rec] of Object.entries(saved.boxClis ?? {})) if (this.workers.has(id)) this.boxClis.set(id, rec);
    for (const q of saved.questions ?? []) this.questions.set(q.id, q);
  }

  snapshot(): Snapshot {
    const logs: Record<string, LogLine[]> = {};
    for (const [id, lines] of this.logs) logs[id] = lines.slice(-LOG_SNAPSHOT);
    return {
      ...this.about,
      settings: this.settings,
      floors: this.floorList(),
      workers: this.workerList(),
      qa: this.qaList().map(qaView),
      logs,
      messages: this.messages,
      questions: this.questionList(),
      usage: this.usage,
      cloud: this.cloud,
    };
  }

  /** A tab connected: it gets the snapshot now and every change from here on. */
  addClient(ws: WebSocket) {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    this.send(ws, { type: 'snapshot', data: this.snapshot() });
  }

  // ---------- reading ----------

  getSettings(): Settings {
    return this.settings;
  }

  floorList(): Floor[] {
    return [...this.floors.values()].sort((a, b) => a.floor - b.floor);
  }

  workerList(): Worker[] {
    return [...this.workers.values()];
  }

  /** QA records, all or one floor's. */
  qaList(floorId?: string): QaState[] {
    const all = [...this.qa.values()];
    return floorId === undefined ? all : all.filter((q) => q.floorId === floorId);
  }

  hasFloor(id: string): boolean {
    return this.floors.has(id);
  }

  floor(id: string): Floor {
    const f = this.floors.get(id);
    if (!f) throw new HttpError(404, `No floor ${id}`);
    return f;
  }

  hasWorker(id: string): boolean {
    return this.workers.has(id);
  }

  worker(id: string): Worker {
    const w = this.workers.get(id);
    if (!w) throw new HttpError(404, `No worker ${id}`);
    return w;
  }

  /** Questions to the manager, all or one floor's, oldest first. */
  questionList(floorId?: string): Question[] {
    return [...this.questions.values()].filter((q) => floorId === undefined || q.floorId === floorId).sort((a, b) => a.id - b.id);
  }

  question(id: number): Question {
    const q = this.questions.get(id);
    if (!q) throw new HttpError(404, `No question ${id}`);
    return q;
  }

  findQa(floorId: string, prNumber: number): QaState | null {
    return this.qa.get(qaKey(floorId, prNumber)) ?? null;
  }

  qaRecord(floorId: string, prNumber: number): QaState {
    const q = this.findQa(floorId, prNumber);
    if (!q) throw new HttpError(404, `PR #${prNumber} on ${floorId} isn't in QA`);
    return q;
  }

  // ---------- changing ----------

  updateSettings(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...patch };
    this.emit({ type: 'settings', settings: this.settings });
    return this.settings;
  }

  putFloor(floor: Floor) {
    this.floors.set(floor.id, floor);
    this.emit({ type: 'floor', floor });
  }

  patchFloor(id: string, patch: Partial<Floor>): Floor {
    const floor = { ...this.floor(id), ...patch, id };
    this.floors.set(id, floor);
    this.emit({ type: 'floor', floor }, Object.keys(patch).some((k) => !LIVE_FLOOR_FIELDS.includes(k)));
    return floor;
  }

  removeFloor(id: string) {
    if (this.floors.delete(id)) this.emit({ type: 'floorRemoved', floorId: id });
  }

  putWorker(worker: Worker) {
    this.workers.set(worker.id, worker);
    this.emit({ type: 'worker', worker });
  }

  patchWorker(id: string, patch: Partial<Worker>, now = Date.now()): Worker {
    const prev = this.worker(id);
    const next = { ...prev, ...patch, id };
    next.idleSince = nextIdleSince(prev, next, now);
    this.workers.set(id, next);
    this.emit({ type: 'worker', worker: next });
    return next;
  }

  removeWorker(id: string) {
    this.boxClis.delete(id);
    if (!this.workers.delete(id)) return;
    this.logs.delete(id);
    this.emit({ type: 'workerRemoved', workerId: id });
  }

  appendLog(workerId: string, entries: LogEntry[], now = Date.now()): LogLine[] {
    this.worker(workerId);
    const lines = entries.map((e): LogLine => ({ id: this.logSeq++, t: now, kind: e.kind, text: e.text, ...(e.tool ? { tool: e.tool } : {}) }));
    const log = (this.logs.get(workerId) ?? []).concat(lines);
    this.logs.set(workerId, log.length > LOG_BUFFER ? log.slice(-LOG_BUFFER) : log);
    this.emit({ type: 'log', workerId, lines });
    return lines;
  }

  putQa(rec: QaState) {
    this.qa.set(qaKey(rec.floorId, rec.prNumber), rec);
    this.emit({ type: 'qa', qa: qaView(rec) });
  }

  /**
   * Changes a QA record. `touch` (the default) stamps updatedAt: a real change, which the merge gate waits out a sync
   * for. Bookkeeping (merge notes, the gate's own fields) leaves it alone.
   */
  patchQa(floorId: string, prNumber: number, patch: Partial<QaState>, touch = true): QaState {
    const next = { ...this.qaRecord(floorId, prNumber), ...patch, floorId, prNumber, ...(touch ? { updatedAt: Date.now() } : {}) };
    this.putQa(next);
    return next;
  }

  removeQa(floorId: string, prNumber: number) {
    if (this.qa.delete(qaKey(floorId, prNumber))) this.emit({ type: 'qaRemoved', floorId, prNumber });
  }

  /** Tells every tab something happened (the game's moments). Nothing changes, so nothing is saved. */
  moment(m: Moment) {
    this.broadcast(m);
  }

  /** A message from the office to the manager's phone. */
  say(text: string, floorId: string | null = null, from: OfficeMessage['from'] = 'office'): OfficeMessage {
    const message: OfficeMessage = { id: (this.messages.at(-1)?.id ?? 0) + 1, at: Date.now(), text, floorId, from };
    this.messages = [...this.messages, message].slice(-MESSAGES_KEPT);
    this.emit({ type: 'message', message });
    return message;
  }

  /** A new question (id 0 takes the next id), or a change to one. */
  putQuestion(q: Question): Question {
    const question = q.id ? q : { ...q, id: Math.max(0, ...this.questions.keys()) + 1 };
    this.questions.set(question.id, question);
    this.emit({ type: 'question', question });
    return question;
  }

  removeQuestion(id: number) {
    if (this.questions.delete(id)) this.emit({ type: 'questionRemoved', id });
  }

  /** Claude's usage as the pacing sees it; tabs hear only of changes. It lives in memory. */
  /** The cloud account's view (keys never in it): sent to the tabs, not saved. */
  setCloud(cloud: CloudView) {
    if (JSON.stringify(cloud) === JSON.stringify(this.cloud)) return;
    this.cloud = cloud;
    this.broadcast({ type: 'cloud', cloud });
  }

  /** A Box worker's live CLI record (null: it's gone). Saved, never sent to the tabs. */
  setBoxCli(workerId: string, rec: BoxCliRecord | null) {
    if (rec) this.boxClis.set(workerId, rec);
    else if (!this.boxClis.delete(workerId)) return;
    this.save();
  }

  boxCli(workerId: string): BoxCliRecord | null {
    return this.boxClis.get(workerId) ?? null;
  }

  boxCliList(): [string, BoxCliRecord][] {
    return [...this.boxClis];
  }

  /** This office's id on the Upstash account, made the first time it's needed. */
  officeId(make: () => string): string {
    if (!this.office) {
      this.office = make();
      this.save();
    }
    return this.office;
  }

  setUsage(usage: UsageView) {
    if (JSON.stringify(usage) === JSON.stringify(this.usage)) return;
    this.usage = usage;
    this.broadcast({ type: 'usage', usage });
  }

  /** Empties the office but keeps its settings, and sends every tab the new snapshot (the demo's reset). */
  reset() {
    for (const map of [this.floors, this.workers, this.qa, this.logs, this.questions]) map.clear();
    this.messages = [];
    this.emit({ type: 'snapshot', data: this.snapshot() });
  }

  /** Writes state.json now (before the server stops), after any write in progress. */
  flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const next = this.writing.then(() => this.write());
    this.writing = next.catch(() => undefined);
    return next;
  }

  // ---------- tabs and the file ----------

  private emit(ev: ServerEvent, save = true) {
    this.broadcast(ev);
    if (save) this.save();
  }

  private broadcast(ev: ServerEvent) {
    const text = JSON.stringify(ev);
    for (const ws of this.clients) if (ws.readyState === ws.OPEN) ws.send(text);
  }

  private send(ws: WebSocket, ev: ServerEvent) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ev));
  }

  private save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => void this.flush().catch((err) => console.warn('  could not save the state:', err)), SAVE_DELAY_MS);
  }

  private async write() {
    const logs: Record<string, LogLine[]> = {};
    for (const [id, lines] of this.logs) logs[id] = lines.slice(-LOG_SAVED);
    const floors = this.floorList().map(({ cloneStatus: _s, cloneError: _e, issues: _i, pulls: _p, lastSync: _l, syncError: _y, ...saved }) => saved);
    const state: SavedState = { settings: this.settings, floors, workers: this.workerList(), qa: this.qaList(), logs, messages: this.messages, questions: this.questionList(), ...(this.office && { officeId: this.office }), ...(this.boxClis.size && { boxClis: Object.fromEntries(this.boxClis) }) };
    await writeJsonAtomic(this.file, state);
  }
}
