// Workers' running sessions as the office sees them: log lines, the tool in use and the sign over their head go to
// the store as they happen, and whoever started a session hears how it ended.
// Adapted from cubefarm server/swarm.ts (MIT): launchSession and its callbacks.
import { lineActivity, sameActivity, workerActivity, type SeenActivity } from '../../shared/activity.ts';
import type { Activity, Worker } from '../../shared/types.ts';
import type { Backend } from '../backend/backend.ts';
import { HttpError } from '../httpError.ts';
import type { SessionCallbacks, SessionHandle, SessionOptions, SessionResult } from '../sessions/session.ts';
import type { Terminals } from '../sessions/terminals.ts';
import type { Store } from '../store.ts';

/** A screenshot a session took. */
export interface Shot {
  data: Buffer;
  mime: string;
  at: number;
}

/** How a session ended, with what the pipeline needs next. */
export interface SessionEnd {
  result: SessionResult;
  /** The session to resume for a follow-up (a fix after QA); null when there's none. */
  sessionId: string | null;
  /** Its screenshots, oldest first: QA's evidence. */
  shots: Shot[];
}

interface Running {
  handle: SessionHandle | null;
  currentTool: string | null;
  seen: SeenActivity | null;
  sessionId: string | null;
  shots: Shot[];
}

export class Sessions {
  private running = new Map<string, Running>();

  constructor(
    private readonly store: Store,
    private readonly backend: Backend,
    /** What Claude says about the subscription's usage during any session (the pacing listens). */
    private readonly usage: Pick<SessionCallbacks, 'limited' | 'usageWarning'> = {},
    /** Each worker's terminal, which their sessions run (or print) in; none in tests that don't need one. */
    private readonly terminals: Terminals | null = null,
  ) {}

  isRunning(workerId: string): boolean {
    return this.running.has(workerId);
  }

  /** Heard when a Box's Claude Code turned out not to be signed in (the worker then waits for the manager). */
  onSignedOut: ((workerId: string) => void) | null = null;

  /** The worker's terminal, made when first needed (null in tests without terminals). */
  terminal(workerId: string) {
    return this.terminals?.for(workerId) ?? null;
  }

  /** The worker left: their terminal goes, with its saved screen. */
  forget(workerId: string) {
    this.terminals?.remove(workerId);
  }

  /** The worker's terminal, if they have one (a CLI may be waiting at its prompt in it). */
  terminalOf(workerId: string) {
    return this.terminals?.existing(workerId) ?? null;
  }

  /**
   * Starts a session for the worker, who becomes 'working'. When it ends their cost and turns are added up and their
   * sign cleared, then `onEnd` hears how it went (and sets their status).
   */
  start(workerId: string, opts: SessionOptions, onEnd: (end: SessionEnd) => void): void {
    if (this.running.has(workerId)) throw new HttpError(409, 'They already have a session running');
    const rt: Running = { handle: null, currentTool: null, seen: null, sessionId: opts.resumeSessionId ?? null, shots: [] };
    this.running.set(workerId, rt);
    const working = { ...this.store.worker(workerId), status: 'working' as const };
    this.store.patchWorker(workerId, { status: 'working', activity: this.signOf(working, rt) });
    try {
      rt.handle = this.backend.startSession(
        { ...opts, workerId, terminal: this.terminals?.for(workerId) },
        {
          log: (entries) => {
            if (this.running.get(workerId) !== rt || !this.store.hasWorker(workerId)) return;
            const now = Date.now();
            for (const e of entries) {
              const a = lineActivity(e);
              if (a) rt.seen = { ...a, at: now };
            }
            this.store.appendLog(workerId, entries, now);
            this.refreshSign(workerId);
          },
          tool: (name) => {
            rt.currentTool = name;
            if (this.running.get(workerId) === rt) this.refreshSign(workerId);
          },
          sessionId: (id) => {
            rt.sessionId = id;
            if (this.store.hasWorker(workerId)) this.store.patchWorker(workerId, { sessionId: id });
          },
          browserUrl: () => undefined,
          screenshot: (data, mime) => {
            rt.shots.push({ data, mime, at: Date.now() });
          },
          limited: (resetsAt) => this.usage.limited?.(resetsAt),
          usageWarning: (info) => this.usage.usageWarning?.(info),
          finished: (result) => {
            if (this.running.get(workerId) !== rt) return; // it ended already
            this.running.delete(workerId);
            if (this.store.hasWorker(workerId)) {
              const w = this.store.worker(workerId);
              this.store.patchWorker(workerId, { costUsd: w.costUsd + result.costUsd, turns: w.turns + result.turns, activity: null, endedAt: Date.now() });
            }
            if (result.signedOut) this.onSignedOut?.(workerId);
            onEnd({ result, sessionId: rt.sessionId, shots: rt.shots });
          },
        },
      );
    } catch (err) {
      this.running.delete(workerId);
      throw err;
    }
  }

  /** Stops the worker's session (its `onEnd` still runs); false when they have none. */
  stop(workerId: string): boolean {
    const rt = this.running.get(workerId);
    if (!rt?.handle) return false;
    rt.handle.stop();
    return true;
  }

  stopAll() {
    for (const id of [...this.running.keys()]) this.stop(id);
  }

  /** Passes the manager's message to the worker's running session; false when they have none. */
  send(workerId: string, text: string): boolean {
    const rt = this.running.get(workerId);
    if (!rt?.handle) return false;
    this.store.appendLog(workerId, [{ kind: 'manager', text: `▶ Manager: ${text}` }]);
    rt.seen = { kind: 'talk', detail: 'your message', at: Date.now() };
    this.refreshSign(workerId);
    rt.handle.send(text);
    return true;
  }

  /** The sign over a worker's head, from their status, task and latest action. */
  private signOf(w: Worker, rt: Running | undefined): Activity | null {
    const task = w.task;
    return workerActivity(
      { status: w.status, task: task?.kind ?? null, currentTool: rt?.currentTool ?? null, issueNumber: task?.issueNumber ?? null, prNumber: task?.prNumber ?? null, startedAt: w.startedAt },
      rt?.seen ?? null,
    );
  }

  private refreshSign(workerId: string) {
    if (!this.store.hasWorker(workerId)) return;
    const w = this.store.worker(workerId);
    const activity = this.signOf(w, this.running.get(workerId));
    if (!sameActivity(activity, w.activity)) this.store.patchWorker(workerId, { activity });
  }
}
