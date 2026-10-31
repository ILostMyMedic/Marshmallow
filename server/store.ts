// The office's state: kept in memory, saved to state.json (a temp file, then a rename), and every change sent to every
// tab. It knows nothing about the pipeline: the modules that do change it through these methods.
// Adapted from cubefarm server/swarm.ts (MIT): its persisted shape, persistence and clients sections.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { DEFAULT_SETTINGS, isBusy, type Floor, type LogKind, type LogLine, type Moment, type QaRecord, type ServerEvent, type Settings, type Snapshot, type Worker } from '../shared/types.ts';
import { LOG_BUFFER } from './config.ts';
import { HttpError } from './httpError.ts';

/** GitHub's side of a floor: refreshed by every sync, so never saved. */
const LIVE_FLOOR_FIELDS: readonly string[] = ['cloneStatus', 'cloneError', 'issues', 'pulls', 'lastSync', 'syncError'] satisfies (keyof Floor)[];
type SavedFloor = Omit<Floor, 'cloneStatus' | 'cloneError' | 'issues' | 'pulls' | 'lastSync' | 'syncError'>;

/** What state.json holds. */
export interface SavedState {
  settings: Settings;
  floors: SavedFloor[];
  workers: Worker[];
  qa: QaRecord[];
  logs: Record<string, LogLine[]>;
}

/** Log lines per worker in state.json, and in a tab's snapshot (memory keeps LOG_BUFFER). */
const LOG_SAVED = 200;
const LOG_SNAPSHOT = 50;
// Changes come in bursts (a session's tool calls): one write covers each burst.
const SAVE_DELAY_MS = 1500;

export interface LogEntry {
  kind: LogKind;
  text: string;
  tool?: string;
}

export const qaKey = (floorId: string, prNumber: number) => `${floorId}#${prNumber}`;

/** A worker's idleSince after a change: cleared while they're busy, set when they stop being busy. */
export function nextIdleSince(prev: Worker, next: Worker, now: number): number | null {
  if (isBusy(next.status)) return null;
  return isBusy(prev.status) || prev.idleSince === null ? now : prev.idleSince;
}

/** Windows briefly locks a file another program (an antivirus, the indexer) has just opened, so a rename gets retries. */
async function replaceFile(from: string, to: string, tries = 5): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      return await fs.rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= tries || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw err;
      await new Promise((r) => setTimeout(r, 50 * i));
    }
  }
}

export class Store {
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private floors = new Map<string, Floor>();
  private workers = new Map<string, Worker>();
  private qa = new Map<string, QaRecord>();
  private logs = new Map<string, LogLine[]>();
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
    this.settings = { ...DEFAULT_SETTINGS, ...saved.settings };
    for (const f of saved.floors ?? []) this.floors.set(f.id, { ...f, cloneStatus: 'pending', cloneError: null, issues: [], pulls: [], lastSync: null, syncError: null });
    for (const w of saved.workers ?? []) this.workers.set(w.id, { ...w, activity: null });
    for (const q of saved.qa ?? []) this.qa.set(qaKey(q.floorId, q.prNumber), q);
    for (const [id, lines] of Object.entries(saved.logs ?? {})) {
      if (!this.workers.has(id)) continue;
      this.logs.set(id, lines);
      for (const l of lines) this.logSeq = Math.max(this.logSeq, l.id + 1);
    }
  }

  snapshot(): Snapshot {
    const logs: Record<string, LogLine[]> = {};
    for (const [id, lines] of this.logs) logs[id] = lines.slice(-LOG_SNAPSHOT);
    return { ...this.about, settings: this.settings, floors: this.floorList(), workers: this.workerList(), qa: this.qaList(), logs };
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

  qaList(): QaRecord[] {
    return [...this.qa.values()];
  }

  floor(id: string): Floor {
    const f = this.floors.get(id);
    if (!f) throw new HttpError(404, `No floor ${id}`);
    return f;
  }

  worker(id: string): Worker {
    const w = this.workers.get(id);
    if (!w) throw new HttpError(404, `No worker ${id}`);
    return w;
  }

  qaRecord(floorId: string, prNumber: number): QaRecord {
    const q = this.qa.get(qaKey(floorId, prNumber));
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

  putQa(rec: QaRecord) {
    this.qa.set(qaKey(rec.floorId, rec.prNumber), rec);
    this.emit({ type: 'qa', qa: rec });
  }

  removeQa(floorId: string, prNumber: number) {
    if (this.qa.delete(qaKey(floorId, prNumber))) this.emit({ type: 'qaRemoved', floorId, prNumber });
  }

  /** Tells every tab something happened (the game's moments). Nothing changes, so nothing is saved. */
  moment(m: Moment) {
    this.broadcast(m);
  }

  /** Empties the office but keeps its settings, and sends every tab the new snapshot (the demo's reset). */
  reset() {
    for (const map of [this.floors, this.workers, this.qa, this.logs]) map.clear();
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
    const state: SavedState = { settings: this.settings, floors, workers: this.workerList(), qa: this.qaList(), logs };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2));
    await replaceFile(tmp, this.file);
  }
}
