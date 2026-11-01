// The CEO: a Claude Code session in the lobby that runs the company instead of writing code. Its jobs (onboard a new
// floor, plan the manager's brief, answer the manager in a chat or a discussion) queue up and run one at a time,
// chats and discussions first; everything it changes goes through the office tools. Each chat and discussion resumes
// its own CEO session (kept on the desk, server/db/desk.ts), so ideas don't mix; onboarding and planning start afresh.
// A thread's job ends with the CEO's reply in that thread; onboarding and planning report to the manager's notices.
// Adapted from cubefarm server/swarm.ts (MIT): the CEO section (enqueueCeo, startCeoWork, runCeoJob, onCeoFinished,
// messageCeo, planFloor).
import fs from 'node:fs';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { effectiveModel } from '../../../shared/models.ts';
import { isBusy, type CeoJobKind, type ChatView, type DeskMessage, type DiscussionView, type Worker } from '../../../shared/types.ts';
import { HOME_DIR } from '../../config.ts';
import { titleFrom, type Desk, type ThreadKind } from '../../db/desk.ts';
import { HttpError } from '../../httpError.ts';
import type { Ctx } from '../../pipeline/context.ts';
import type { SessionEnd } from '../../pipeline/sessions.ts';
import { IssueCap } from './issueRules.ts';
import { officeHandlers, type JobMade } from './office.ts';
import { ceoJobPrompt, ceoSystemPrompt, jobLabel, type CeoJob, type JobThread } from './prompts.ts';
import { createOfficeTools } from './tools.ts';

/** The CEO's name until the setup wizard (BUILD-PLAN's game phases) lets the manager pick one. */
export const CEO_NAME = 'Mallow';
/** Issues the CEO may file in one job. */
const ISSUES_PER_JOB = 12;
/** The most of a thread a job starting a new session carries. */
const THREAD_LINES = 30;
const MAX_MESSAGE = 10_000;

/** What a chat's reply says when the CEO only put a card in it. */
const CARD_TEXT = "Here's the plan on a card: approve it when you're ready, or tell me what to change.";

/** A chat or discussion job's thread, as it started. */
interface JobOnThread {
  kind: ThreadKind;
  id: number;
  key: string; // `${kind}:${id}`, for `seen` and `posting`
  seenBefore: number | undefined; // put back if the job fails, so the next one carries the same messages again
  sessionId: string | null; // the thread's session, which the job resumes
  floorId: string | null; // a discussion's floor
  replies: number; // the CEO's messages in it so far
  view: JobThread;
}

const keyOf = (kind: ThreadKind, id: number) => `${kind}:${id}`;
const threadOf = (job: CeoJob): { kind: ThreadKind; id: number } | null =>
  job.kind === 'chat' && job.chatId !== null ? { kind: 'chat', id: job.chatId } : job.kind === 'discussion' && job.discussionId !== null ? { kind: 'discussion', id: job.discussionId } : null;
// Chats and discussions go first: the manager waits on them.
const answersFirst = (a: CeoJob, b: CeoJob) => Number(!threadOf(a)) - Number(!threadOf(b)) || a.at - b.at;

export class Ceo {
  private queue: CeoJob[] = [];
  private running: CeoJob | null = null;
  /** Each thread's last message the CEO has been given, so a job in a resumed session carries only what's new. */
  private seen = new Map<string, number>();
  /** Threads whose job ended and whose reply is being written: still "replying" until it's there. */
  private posting = new Set<string>();

  constructor(private readonly ctx: Ctx) {}

  /** The CEO's worker record; null while the office has no CEO. */
  get worker(): Worker | null {
    return this.ctx.store.workerList().find((w) => w.role === 'ceo') ?? null;
  }

  /** Jobs waiting, oldest first (the one running isn't among them). */
  waiting(): readonly CeoJob[] {
    return this.queue;
  }

  /** The office gets a CEO, who onboards every floor it doesn't know yet; on `model` from the start, or the office default. */
  hire(model = ''): Worker {
    const { store } = this.ctx;
    if (this.worker) throw new HttpError(409, 'The office has a CEO already');
    const now = Date.now();
    const ceo: Worker = {
      id: randomUUID(),
      name: CEO_NAME,
      floorId: '',
      role: 'ceo',
      seed: randomInt(2 ** 31),
      desk: 0,
      model,
      effort: '',
      host: 'local',
      status: 'idle',
      task: null,
      activity: null,
      idleSince: now,
      startedAt: null,
      endedAt: null,
      costUsd: 0,
      turns: 0,
      lastError: null,
      sessionId: null,
      leaving: false,
    };
    store.putWorker(ceo);
    store.appendLog(ceo.id, [{ kind: 'system', text: 'Joined as CEO' }], now);
    store.moment({ type: 'hired', at: now, worker: ceo });
    this.onboardUnknown();
    this.answerUnanswered();
    return ceo;
  }

  /**
   * The office started: a CEO saved mid-job is free again (restart recovery leaves the CEO alone, and its queue isn't
   * saved), and floors it doesn't know and threads waiting on its reply get their jobs again.
   */
  afterRestart() {
    const ceo = this.worker;
    if (ceo && isBusy(ceo.status) && !this.ctx.sessions.isRunning(ceo.id)) this.ctx.store.patchWorker(ceo.id, { status: 'idle', activity: null });
    this.onboardUnknown();
    this.answerUnanswered();
  }

  /** Floors the CEO has no profile of get onboarded: at hiring, and at start. */
  onboardUnknown() {
    if (this.worker) for (const f of this.ctx.store.floorList()) if (!f.summary) this.enqueue('onboard', f.id);
  }

  /** Chats and open discussions whose last word is the manager's get the CEO's reply: at hiring, and at start. */
  answerUnanswered() {
    const desk = this.ctx.desk;
    if (!this.worker || !desk) return;
    const { chats, discussions } = desk.get();
    for (const c of chats) if (c.messages.at(-1)?.from === 'manager') this.enqueue('chat', null, { chatId: c.id });
    for (const d of discussions) if (d.status === 'open' && d.messages.at(-1)?.from === 'manager') this.enqueue('discussion', null, { discussionId: d.id });
  }

  /** The CEO leaves: their session stops, and their jobs go with them. */
  letGo() {
    const { store, sessions } = this.ctx;
    const ceo = this.worker;
    if (!ceo) throw new HttpError(404, 'The office has no CEO');
    this.queue = [];
    this.syncReplying();
    sessions.stop(ceo.id);
    store.removeWorker(ceo.id);
    sessions.forget(ceo.id);
    store.moment({ type: 'left', at: Date.now(), worker: ceo });
  }

  /** A floor connected: the CEO studies it, and plans its brief if it came with one. Nothing without a CEO. */
  joined(floorId: string) {
    if (!this.worker) return;
    this.enqueue('onboard', floorId);
    if (this.ctx.store.floor(floorId).mission) this.enqueue('plan', floorId);
  }

  /**
   * A floor started from a project card the manager approved: the CEO studies it and keeps the team size they agreed,
   * and plans nothing, since the card's tasks are filed as its issues. Nothing without a CEO.
   */
  onboardProject(floorId: string, teamSize: number) {
    if (this.worker) this.enqueue('onboard', floorId, { project: { teamSize } });
  }

  /** The manager's brief for a floor, planned into issues. */
  plan(floorId: string, mission?: string) {
    const { store } = this.ctx;
    if (!this.worker) throw new HttpError(409, 'Hire a CEO first');
    if (mission !== undefined) store.patchFloor(floorId, { mission: mission.trim() });
    if (!store.floor(floorId).mission) throw new HttpError(400, 'The floor has no brief to plan');
    this.enqueue('plan', floorId);
  }

  // ---------- the desktop's threads ----------

  /** A new chat with the CEO, about one idea; the manager's first message, if any, names it and goes to the CEO. */
  async newChat(text = ''): Promise<ChatView> {
    const body = text.trim();
    if (body) this.checkMessage(body);
    const chat = await this.desk().createChat(titleFrom(body));
    return body ? this.postToChat(chat.id, body) : chat;
  }

  /** The manager writes in a chat; the CEO answers there, in the chat's own session (messages to one chat share a job). */
  async postToChat(chatId: number, text: string): Promise<ChatView> {
    const body = this.checkMessage(text);
    const desk = this.desk();
    await desk.post('chat', chatId, 'manager', body);
    this.enqueue('chat', null, { chatId });
    return desk.chat(chatId);
  }

  /** The manager writes to the CEO without picking a chat (POST /api/ceo/message, a worker panel): the latest chat, or a new one. */
  async message(text: string): Promise<ChatView> {
    const body = this.checkMessage(text);
    const latest = this.desk().get().chats[0];
    return latest ? this.postToChat(latest.id, body) : this.newChat(body);
  }

  /** The manager writes in a discussion (one settled opens again); the CEO answers there. */
  async postToDiscussion(id: number, text: string): Promise<DiscussionView> {
    const body = this.checkMessage(text);
    const desk = this.desk();
    await desk.reopenDiscussion(id);
    await desk.post('discussion', id, 'manager', body);
    this.enqueue('discussion', null, { discussionId: id });
    return desk.discussion(id);
  }

  /**
   * The manager settles a discussion. An outcome they write goes into the thread and to the CEO, who carries on with
   * the work it was holding up; without one it just closes.
   */
  async resolveDiscussion(id: number, outcome = ''): Promise<DiscussionView> {
    const desk = this.desk();
    const text = outcome.trim();
    const before = await desk.discussion(id);
    if (text && this.worker) {
      await desk.post('discussion', id, 'manager', `Settled: ${text}`);
      this.enqueue('discussion', null, { discussionId: id });
    }
    return desk.resolveDiscussion(id, text || before.outcome);
  }

  /** The manager declined a proposal: it comes back to its chat as their note, and a note goes to the CEO to rework the plan. */
  async declined(chatId: number, note = '') {
    const body = note.trim();
    await this.desk().post('chat', chatId, 'manager', body ? `Declined the project: ${body}` : 'Declined the project.');
    if (body && this.worker) this.enqueue('chat', null, { chatId });
  }

  private desk(): Desk {
    if (!this.ctx.desk) throw new HttpError(503, "The office database isn't open");
    return this.ctx.desk;
  }

  private checkMessage(text: string): string {
    if (!this.worker) throw new HttpError(409, 'Hire a CEO first');
    const body = text.trim();
    if (!body) throw new HttpError(400, 'The message is empty');
    if (body.length > MAX_MESSAGE) throw new HttpError(400, 'Keep a message under 10,000 characters');
    return body;
  }

  // ---------- the queue ----------

  /** One job per kind and floor, chat or discussion: a thread's new messages wait for the job it already has. */
  private enqueue(kind: CeoJobKind, floorId: string | null, o: { chatId?: number; discussionId?: number; project?: CeoJob['project'] } = {}) {
    const chatId = o.chatId ?? null;
    const discussionId = o.discussionId ?? null;
    const same = this.queue.find((j) => j.kind === kind && j.floorId === floorId && j.chatId === chatId && j.discussionId === discussionId);
    if (same) same.project = o.project ?? same.project;
    else this.queue.push({ kind, floorId, chatId, discussionId, text: '', at: Date.now(), ...(o.project && { project: o.project }) });
    this.syncReplying();
    this.ctx.soon(200);
  }

  /**
   * Starts the next job if the CEO is free: chats and discussions first, then the oldest. A floor's job waits for its
   * clone and first sync, and is dropped if the floor went or its clone failed; a thread's is dropped if the thread
   * went. Called by the scheduler; true when one started.
   */
  tick(): boolean {
    const { store } = this.ctx;
    const ceo = this.worker;
    if (!ceo || this.running || isBusy(ceo.status) || ceo.status === 'stopped' || this.ctx.sessions.isRunning(ceo.id)) return false;
    for (const job of [...this.queue].sort(answersFirst)) {
      if (job.floorId !== null) {
        const floor = store.hasFloor(job.floorId) ? store.floor(job.floorId) : null;
        if (!floor || floor.cloneStatus === 'error') {
          this.drop(job);
          if (floor) store.say(`⚠ ${CEO_NAME} skipped "${jobLabel(job, floor)}": the repository couldn't be cloned.`, floor.id);
          continue;
        }
        if (floor.cloneStatus !== 'ready' || floor.lastSync === null) continue;
      }
      const t = threadOf(job);
      if (t && !this.ctx.desk?.thread(t.kind, t.id)) {
        this.drop(job);
        continue;
      }
      this.queue = this.queue.filter((j) => j !== job);
      this.start(ceo, job);
      return true;
    }
    return false;
  }

  private drop(job: CeoJob) {
    this.queue = this.queue.filter((j) => j !== job);
    this.syncReplying();
  }

  /**
   * What a thread's job carries: in the thread's own session, the manager's and the office's messages since the CEO
   * was last given the thread; in a new one (its first job, or a lost session), the thread so far.
   */
  private onThread(job: CeoJob): JobOnThread | null {
    const t = threadOf(job);
    const thread = t && this.ctx.desk?.thread(t.kind, t.id);
    if (!t || !thread) return null;
    const key = keyOf(t.kind, t.id);
    const seenBefore = this.seen.get(key);
    const seen = seenBefore ?? thread.messages.findLast((m) => m.from === 'ceo')?.id ?? 0;
    const resumed = !!thread.sessionId;
    let picked: readonly DeskMessage[] = resumed ? thread.messages.filter((m) => m.id > seen && m.from !== 'ceo') : thread.messages.slice(-THREAD_LINES);
    if (!picked.length) picked = thread.messages.filter((m) => m.from === 'manager').slice(-1);
    this.seen.set(key, thread.messages.at(-1)?.id ?? seen);
    return {
      kind: t.kind,
      id: t.id,
      key,
      seenBefore,
      sessionId: thread.sessionId,
      floorId: thread.floorId,
      replies: thread.messages.filter((m) => m.from === 'ceo').length,
      view: { title: thread.title, context: thread.context, resumed, messages: picked.map((m) => ({ from: m.from, text: m.text })) },
    };
  }

  private start(ceo: Worker, job: CeoJob) {
    const { store, backend, sessions } = this.ctx;
    const settings = store.getSettings();
    const floor = job.floorId ? store.floor(job.floorId) : null;
    const label = jobLabel(job, floor);
    const cap = new IssueCap(ISSUES_PER_JOB);
    const made: JobMade = { proposalId: null, discussions: 0 };
    const thread = this.onThread(job);
    if (thread) job.text = thread.view.messages.flatMap((m) => (m.from === 'manager' ? [m.text] : [])).join('\n');
    const cwd = path.join(HOME_DIR, 'ceo');
    if (!backend.demo) fs.mkdirSync(cwd, { recursive: true });
    this.running = job;
    store.appendLog(ceo.id, [{ kind: 'system', text: `▶ ${label}` }]);
    sessions.start(
      ceo.id,
      {
        cwd,
        prompt: ceoJobPrompt(job, floor && { floor: floor.floor, fullName: floor.fullName, clone: backend.mainDir(floor.fullName), mission: floor.mission, backlog: floor.issues.length }, thread?.view ?? null),
        systemAppend: ceoSystemPrompt({ name: ceo.name, company: settings.companyName, manager: settings.managerName, sessionLimit: settings.sessionLimit, maxWorkers: settings.maxWorkers }),
        model: effectiveModel(ceo.model, settings.defaultModel),
        effort: ceo.effort || settings.defaultEffort,
        browserTesting: false,
        role: 'ceo',
        task: null,
        subject: { issueNumber: null, prNumber: null, title: label },
        // A chat or discussion carries on its own session (never the CEO's latest, which every job overwrites); the
        // rest start afresh. The cwd stays the same, as Claude Code finds a session to resume by its folder.
        resumeSessionId: thread?.sessionId ?? undefined,
        label: `${ceo.name} · ${label}`,
        office: createOfficeTools(officeHandlers(this.ctx, job, cap, ceo.name, made)),
        addDirs: store.floorList().flatMap((f) => (f.cloneStatus === 'ready' ? [backend.mainDir(f.fullName)] : [])),
        ceoJob: {
          kind: job.kind,
          floorId: job.floorId ?? thread?.floorId ?? null,
          text: job.text,
          ...(thread && { thread: { id: thread.id, title: thread.view.title, replies: thread.replies } }),
          ...(job.project && { agreedTeam: job.project.teamSize }),
        },
      },
      (end) => this.finished(job, label, cap, made, thread, end),
    );
    this.syncReplying();
  }

  private finished(job: CeoJob, label: string, cap: IssueCap, made: JobMade, thread: JobOnThread | null, end: SessionEnd) {
    const { store, floors } = this.ctx;
    this.running = null;
    for (const floorId of cap.floors) if (store.hasFloor(floorId)) void floors.sync(floorId).catch(() => undefined);
    const ceo = this.worker;
    const { ok, text, errors } = end.result;
    // The thread's session is the one this job ended in (null when it was lost: the next job starts a new one).
    if (thread) void this.ctx.desk?.setSession(thread.kind, thread.id, end.sessionId).catch(() => undefined);
    if (thread && (!ok || ceo?.status === 'stopped')) {
      // It didn't reply: the next job carries the same messages again.
      if (thread.seenBefore === undefined) this.seen.delete(thread.key);
      else this.seen.set(thread.key, thread.seenBefore);
    }
    if (ceo && ceo.status !== 'stopped') {
      if (ok) {
        store.patchWorker(ceo.id, { status: 'idle', lastError: null });
        const reply = text.trim();
        if (thread && (reply || made.proposalId !== null)) this.reply(thread, 'ceo', reply || CARD_TEXT, made.proposalId);
        else if (thread) this.reply(thread, 'office', `${ceo.name} finished without replying.`, null);
        else if (reply) store.say(reply, job.floorId, 'ceo');
      } else {
        const why = errors[0] ?? 'the session failed';
        store.patchWorker(ceo.id, { status: 'error', lastError: why });
        if (thread) this.reply(thread, 'office', `⚠ ${ceo.name} couldn't reply: ${why}`, made.proposalId);
        else store.say(`⚠ ${ceo.name} couldn't finish "${label}": ${why}`, job.floorId);
      }
    } else if (ceo && thread) this.reply(thread, 'office', `■ ${ceo.name} was stopped before replying.`, made.proposalId);
    this.syncReplying();
    this.ctx.soon(200);
  }

  /** The job's last word in its thread (a proposal it made goes with it); the thread shows "replying" until it's there. */
  private reply(thread: JobOnThread, from: DeskMessage['from'], text: string, proposalId: number | null) {
    const desk = this.ctx.desk;
    if (!desk) return;
    this.posting.add(thread.key);
    void desk
      .post(thread.kind, thread.id, from, text, thread.kind === 'chat' ? proposalId : null)
      .catch(() => undefined) // the thread was deleted meanwhile
      .finally(() => {
        this.posting.delete(thread.key);
        this.syncReplying();
      });
  }

  /** The desk's "replying" marks: the threads with a job waiting or running, or a reply being written. */
  private syncReplying() {
    const desk = this.ctx.desk;
    if (!desk) return;
    const chats = new Set<number>();
    const discussions = new Set<number>();
    for (const j of [...this.queue, ...(this.running ? [this.running] : [])]) {
      const t = threadOf(j);
      if (t) (t.kind === 'chat' ? chats : discussions).add(t.id);
    }
    for (const key of this.posting) {
      const [kind, id] = key.split(':');
      (kind === 'chat' ? chats : discussions).add(Number(id));
    }
    desk.setReplying(chats, discussions);
  }
}
