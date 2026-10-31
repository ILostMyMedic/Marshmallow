// The watchdog (recovery/watchdog.ts), every minute: a quiet session is nudged, then its work goes back in line; a desk
// stuck being set up is released and its work requeued; finished work left on a failed or stopped worker is cleared;
// a PR left "testing" or "fixing" with nobody on it goes back in its queue. The office hears what it did.
// Adapted from cubefarm server/swarm.ts (MIT): watchdogTick, remedy, requeue.
import type { Worker } from '../../shared/types.ts';
import { diagnose, forget, nudgeText, triage, type Problem, type Remedy, type WatchMemory, type WatchWorker } from '../recovery/watchdog.ts';
import { giveUp, handBack, releaseDesk, type Ctx } from './context.ts';
import { nameList } from './rules/closeCleanup.ts';

/** A Box worker whose Box is being set up, that the office can't reach right now or that waits to be signed in isn't stuck. */
const away = (w: Worker) => w.host === 'box' && (!!w.needsSignIn || w.cloud === 'creating' || w.cloud === 'setting-up' || w.cloud === 'disconnected');

export class Watchdog {
  private memory: WatchMemory = { remedied: new Map(), nudged: new Map() };

  constructor(private readonly ctx: Ctx) {}

  /** Finds what's stuck and heals it. */
  tick(now = Date.now()) {
    const { store, sessions, closures } = this.ctx;
    forget(this.memory, now);
    const workers: WatchWorker[] = store
      .workerList()
      .filter((w) => w.role === 'worker' && store.hasFloor(w.floorId) && !away(w))
      .map((w) => ({
        id: w.id,
        floorId: w.floorId,
        role: w.role,
        status: w.status,
        task: w.task?.kind ?? null,
        issueNumber: w.task?.issueNumber ?? null,
        prNumber: w.task?.prNumber ?? null,
        startedAt: w.startedAt,
        activeAt: sessions.activeAt(w.id) ?? w.startedAt ?? now,
        work: closures.workOf(w),
      }));
    const done = triage(diagnose(workers, store.qaList(), now), this.memory, now)
      .map(({ problem, remedy }) => this.remedy(problem, remedy, now))
      .filter((t): t is string => !!t);
    if (done.length) {
      store.say(`🩺 The watchdog ${nameList(done)}.`);
      this.ctx.soon(200);
    }
  }

  /** Applies a remedy. Returns what to tell the manager, or null. */
  private remedy(p: Problem, remedy: Remedy, now: number): string | null {
    const { store, sessions, closures } = this.ctx;
    const w = p.workerId && store.hasWorker(p.workerId) ? store.worker(p.workerId) : null;
    const rec = p.prNumber != null ? store.findQa(p.floorId, p.prNumber) : null;
    const what = p.prNumber != null ? `PR #${p.prNumber}` : `#${p.issueNumber}`;
    const mins = Math.max(1, Math.round((now - p.since) / 60_000));
    if (remedy === 'nudge' && w && sessions.isRunning(w.id)) {
      this.memory.nudged.set(p.key, now);
      store.appendLog(w.id, [{ kind: 'system', text: `🩺 No sign of life for ${mins} minutes: the office nudged them.` }]);
      sessions.send(w.id, nudgeText(now - p.since), 'Office');
      return null;
    }
    this.memory.remedied.set(p.key, now);
    // A quiet worker with no session to nudge goes straight back in line.
    if ((remedy === 'requeue' || remedy === 'nudge') && w) {
      const nudged = remedy === 'requeue' && p.kind === 'quiet';
      this.requeue(w, `the watchdog put ${what} back in line after ${mins} ${p.kind === 'preparing' ? 'minutes setting up a desk' : nudged ? 'quiet minutes and a nudge' : 'quiet minutes'}`);
      return `put ${w.name}'s ${what} back in line (${p.kind === 'preparing' ? `stuck setting up a desk for ${mins} minutes` : `quiet for ${mins} minutes${nudged ? ', even after a nudge' : ''}`})`;
    }
    if (remedy === 'clear' && w) {
      this.requeue(w, `${what} is already ${closures.workOf(w) === 'merged' ? 'merged' : 'closed'}`);
      return `cleared ${w.name}'s desk (${what} was finished)`;
    }
    if (remedy === 'retry-qa' && rec) {
      store.patchQa(rec.floorId, rec.prNumber, { status: 'queued', qaWorkerId: null });
      return `sent PR #${rec.prNumber} back to QA (nobody was testing it)`;
    }
    if (remedy === 'refix' && rec) {
      store.patchQa(rec.floorId, rec.prNumber, { status: 'failed' });
      return `put PR #${rec.prNumber}'s fix back in line (nobody was on it)`;
    }
    return null;
  }

  /** Stops the worker if they're busy and puts their work back in line, without a strike: an issue back on the board, a QA run or fix back in its PR's queue. */
  private requeue(w: Worker, why: string) {
    handBack(this.ctx, w.id);
    // A desk stuck being set up: whatever hangs in it is stopped, so the set-up gives up.
    if (w.status === 'preparing') releaseDesk(this.ctx, w.id, w.floorId);
    giveUp(this.ctx, w.id, why);
  }
}
