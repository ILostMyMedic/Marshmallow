// The scheduler: on a timer and whenever something changes, it hands work to free workers. Finishing beats starting
// (QA and fixes on every floor before any new issue), floors take turns, and the session limit and Claude's usage
// pacing hold new work back.
// Adapted from cubefarm server/swarm.ts (MIT): schedule, isFree, available, readyIssues, startPipelineWork, startIssueWork.
import { blockers, holdUps } from '../../shared/issues.ts';
import { isBusy, type Floor, type IssueInfo, type Worker } from '../../shared/types.ts';
import type { Ctx } from './context.ts';
import { fixGoesTo, pickTester, prepHeld } from './rules/handOut.ts';
import { issueTaken } from './rules/issueClaims.ts';

/** A worker whose task failed sits out this long before the next one. */
export const ERROR_COOLDOWN_MS = 2 * 60_000;

/** Issues with one of these labels are never picked up; mm:needs-answer waits for the manager's reply (questions.ts). */
const SKIP_LABELS = /^(skip|mm:skip|wontfix|question|mm:needs-answer)$/i;

/**
 * Free for a task: idle or done, or errored a while ago. Stopped workers wait for the manager; leavers, and Box workers
 * whose Claude Code needs signing in, get nothing new.
 */
export function isFree(w: Worker, now: number): boolean {
  if (w.role !== 'worker' || w.leaving || w.needsSignIn) return false;
  return w.status === 'idle' || w.status === 'done' || (w.status === 'error' && now - (w.endedAt ?? 0) >= ERROR_COOLDOWN_MS);
}

/**
 * The floor's issues a free worker may start, best first: not skipped, taken, waiting on another open issue or failed
 * too often; then those holding up the longest chain of other issues, the most issues, and the oldest.
 */
export function readyIssues(floor: Floor, workers: Worker[], failedTooOften: (n: number) => boolean, now: number): IssueInfo[] {
  const open = new Set(floor.issues.map((i) => i.number));
  const claims = workers.filter((w) => w.floorId === floor.id).map((w) => ({ role: w.role, task: w.task?.kind ?? null, issueNumber: w.task?.issueNumber ?? null, status: w.status }));
  const holds = holdUps(floor.issues);
  return floor.issues
    .filter((i) => !i.labels.some((l) => SKIP_LABELS.test(l)) && !issueTaken(i.number, claims, floor.pulls, now) && blockers(i.body, open).length === 0 && !failedTooOften(i.number))
    .sort((a, b) => {
      const x = holds.get(a.number)!;
      const y = holds.get(b.number)!;
      return y.chain - x.chain || y.waiting - x.waiting || a.number - b.number;
    });
}

export class Scheduler {
  private offset = 0;
  private timer: NodeJS.Timeout | null = null;
  private soonTimer: NodeJS.Timeout | null = null;

  constructor(private readonly ctx: Ctx) {}

  start(intervalMs: number) {
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref();
    this.soon(1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.soonTimer) clearTimeout(this.soonTimer);
    this.timer = this.soonTimer = null;
  }

  /** A pass shortly: changes come in bursts, and one pass handles them all. */
  soon(ms = 200) {
    if (this.soonTimer) return;
    this.soonTimer = setTimeout(() => {
      this.soonTimer = null;
      this.tick();
    }, ms);
    this.soonTimer.unref();
  }

  tick() {
    const { store, usage, team } = this.ctx;
    usage.tick();
    // Before handing out work, so workers on their way out get none.
    team.applyLeaving();
    this.ctx.cloud.pauseIdle();
    if (usage.paused()) return;
    team.autoscale();
    // The CEO's jobs count toward the session limit like anyone's.
    if (!this.slotsFull()) this.ctx.ceo.tick();
    const floors = store.floorList().filter((f) => f.lastSync !== null && f.cloneStatus !== 'error');
    if (!floors.length) return;
    this.offset = (this.offset + 1) % floors.length;
    const order = [...floors.slice(this.offset), ...floors.slice(0, this.offset)].map((f) => f.id);
    // Every start makes its worker busy at once, so each round finds fewer free workers; the guard is a backstop.
    for (const start of [(f: Floor) => this.pipelineWork(f), (f: Floor) => this.issueWork(f)]) {
      for (let progress = true, rounds = 0; progress && rounds < 100; rounds++) {
        progress = false;
        for (const id of order) {
          if (this.slotsFull()) return;
          if (store.hasFloor(id) && start(store.floor(id))) progress = true;
        }
      }
    }
  }

  private running(): number {
    return this.ctx.store.workerList().filter((w) => isBusy(w.status)).length;
  }

  private slotsFull(): boolean {
    const limit = this.ctx.store.getSettings().sessionLimit;
    return limit > 0 && this.running() >= limit;
  }

  /** The floor's free workers, by desk. */
  private available(floor: Floor): Worker[] {
    const now = Date.now();
    return this.ctx.store
      .workerList()
      .filter((w) => w.floorId === floor.id && isFree(w, now) && !this.ctx.sessions.isRunning(w.id))
      .sort((a, b) => a.desk - b.desk);
  }

  /** One QA run or fix on the floor, if any waits and someone suits it. */
  private pipelineWork(floor: Floor): boolean {
    const { store } = this.ctx;
    const free = this.available(floor);
    if (!free.length) return false;
    const now = Date.now();
    // A PR the sync hasn't listed yet counts as open; one it lists as closed or merged doesn't.
    const open = (n: number) => (floor.pulls.find((p) => p.number === n)?.state ?? 'OPEN') === 'OPEN';
    const waiting = (status: 'queued' | 'failed', task: 'qa' | 'fix') =>
      store
        .qaList(floor.id)
        .filter((q) => q.status === status && open(q.prNumber) && !prepHeld(this.ctx.prepStrikes.get(`${floor.id}#${q.prNumber}:${task}`), now))
        .sort((a, b) => a.updatedAt - b.updatedAt);
    const fixes = waiting('failed', 'fix');
    // Developers whose failed PRs wait for them test last, staying free for their own fixes.
    const owed = new Set(fixes.flatMap((q) => (q.devWorkerId ? [q.devWorkerId] : [])));
    const team = store.workerList().filter((w) => w.floorId === floor.id && w.role === 'worker');
    for (const rec of waiting('queued', 'qa')) {
      const othersCan = team.some((w) => w.id !== rec.devWorkerId && w.status !== 'stopped');
      const tester = pickTester(free, rec.devWorkerId, owed, othersCan, now - rec.updatedAt);
      if (!tester) continue;
      this.ctx.qa.run(tester.id, floor.id, rec.prNumber);
      return true;
    }
    for (const rec of fixes) {
      const author = rec.devWorkerId && store.hasWorker(rec.devWorkerId) ? store.worker(rec.devWorkerId) : null;
      const headRef = floor.pulls.find((p) => p.number === rec.prNumber)?.headRefName ?? null;
      const authorFree = !!author && free.some((w) => w.id === author.id);
      const goes = fixGoesTo(author && { status: author.status, branch: author.task?.branch ?? null, prNumber: author.task?.prNumber ?? null }, authorFree, rec.prNumber, headRef);
      if (goes === 'wait') continue;
      const fixer = goes === 'author' && author ? author : (free.find((w) => !owed.has(w.id)) ?? free[0]);
      this.ctx.fix.run(fixer.id, floor.id, rec.prNumber);
      return true;
    }
    return false;
  }

  /** One new issue on an auto-assign floor, if pacing allows it. */
  private issueWork(floor: Floor): boolean {
    const { store, usage, build } = this.ctx;
    if (!floor.autoAssign || !usage.mayStart('issue', this.running())) return false;
    const worker = this.available(floor)[0];
    if (!worker) return false;
    const issue = readyIssues(floor, store.workerList(), (n) => build.failedTooOften(floor.id, n), Date.now())[0];
    if (!issue) return false;
    build.assign(worker.id, floor.id, issue);
    return true;
  }
}
