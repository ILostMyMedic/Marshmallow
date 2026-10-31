// Closing an issue or PR stops whoever works on it (rules/closeCleanup.ts). The office learns what closed from its
// syncs, from GitHub's answers about what it holds that the sync doesn't list, and from finding it closed itself; the
// work on it ends at once, the PR leaves QA, and an unmerged PR's issues wait for the manager.
// Adapted from cubefarm server/swarm.ts (MIT): floorState, askGitHub, settleLearned, cleanUpClosed, applyClosure,
// learnIssueClosed, learnPull, holdIssues, workOf.
import { BUSY_STATUSES, type Worker } from '../../shared/types.ts';
import { workState, type WorkState } from '../recovery/reconcile.ts';
import { giveUp, type Ctx } from './context.ts';
import {
  afterClose,
  ASK_AGAIN_MS,
  closedWhy,
  closuresHeld,
  forgettable,
  issueOpen,
  pullNow,
  stoppedMessage,
  toAsk,
  toHold,
  type Closure,
  type FloorState,
  type Holder,
  type KnownPull,
  type LearnedPull,
} from './rules/closeCleanup.ts';

/** What the office learned about a floor since its last sync, in memory. */
interface Learned {
  closedIssues: Map<number, number>; // issue -> when the office learned it is closed
  closedPulls: Map<number, LearnedPull>;
  openAt: Map<string, number>; // `issue#<n>` / `pr#<n>` -> when GitHub last said it is open
}

const holder = (w: Worker): Holder => ({
  id: w.id,
  role: w.role,
  status: w.status,
  task: w.task?.kind ?? null,
  issueNumber: w.task?.issueNumber ?? null,
  prNumber: w.task?.prNumber ?? null,
  branch: w.task?.branch ?? null,
});

export class Closures {
  private learned = new Map<string, Learned>();

  constructor(private readonly ctx: Ctx) {}

  /** The floor's issues and PRs as the office knows them now. */
  state(floorId: string): FloorState {
    const f = this.ctx.store.floor(floorId);
    const l = this.of(floorId);
    return { fetchedAt: f.lastSync ?? 0, openIssues: f.issues.map((i) => i.number), pulls: f.pulls, closedIssues: l.closedIssues, closedPulls: l.closedPulls };
  }

  /** The worker's task as the office knows it now. */
  workOf(w: Worker): WorkState {
    if (!w.task || !this.ctx.store.hasFloor(w.floorId)) return 'unknown';
    const f = this.state(w.floorId);
    const issue = w.task.kind === 'issue' && w.task.issueNumber != null ? issueOpen(w.task.issueNumber, f) : null;
    return workState(issue === null ? null : issue ? 'OPEN' : 'CLOSED', w.task.prNumber != null ? (pullNow(w.task.prNumber, f)?.state ?? null) : null);
  }

  /** After a sync: GitHub is asked about what's held but not listed, closures it shows reopened are forgotten, and the work on closed ones ends. */
  async synced(floorId: string) {
    await this.ask(floorId);
    if (!this.ctx.store.hasFloor(floorId)) return; // disconnected meanwhile
    this.settleLearned(floorId);
    this.cleanUp(floorId);
  }

  /** The office found an issue closed (a task about to start on it, the CEO closing it): its work ends now. Returns who it stopped. */
  issueClosed(floorId: string, n: number): string[] {
    if (!this.ctx.store.hasFloor(floorId)) return [];
    this.learn(floorId, { issue: n });
    return this.cleanUp(floorId);
  }

  /** The office found a PR closed or merged: its work ends now, not at the next sync. Returns who it stopped. */
  pullClosed(floorId: string, pr: KnownPull): string[] {
    if (!this.ctx.store.hasFloor(floorId) || pr.state === 'OPEN') return [];
    this.learn(floorId, { pull: pr });
    return this.cleanUp(floorId);
  }

  /** Notes that an issue or PR is closed, without acting on it yet (the restart does once it has marked who was cut off). */
  learn(floorId: string, what: { issue?: number; pull?: KnownPull }) {
    const { store } = this.ctx;
    const l = this.of(floorId);
    const floor = store.floor(floorId);
    if (what.issue != null) {
      l.closedIssues.set(what.issue, Date.now());
      if (floor.issues.some((i) => i.number === what.issue)) store.patchFloor(floorId, { issues: floor.issues.filter((i) => i.number !== what.issue) });
    }
    const pr = what.pull;
    if (pr && pr.state !== 'OPEN') {
      l.closedPulls.set(pr.number, { ...pr, at: Date.now() });
      this.hold(floorId, pr);
      const now = store.floor(floorId);
      if (pr.state === 'CLOSED' && now.pulls.some((p) => p.number === pr.number && p.state === 'OPEN')) {
        store.patchFloor(floorId, { pulls: now.pulls.map((p) => (p.number === pr.number ? { ...p, state: 'CLOSED' as const } : p)) });
      }
    }
  }

  /** The manager sends a held issue back in line. */
  release(floorId: string, n: number) {
    const floor = this.ctx.store.floor(floorId);
    this.ctx.store.patchFloor(floorId, { held: floor.held.filter((h) => h.issue !== n) });
    this.ctx.soon(200);
  }

  /** Stops and clears the work on the floor's closed issues and PRs. Returns the names of those it stopped. */
  cleanUp(floorId: string): string[] {
    const { store } = this.ctx;
    if (!store.hasFloor(floorId)) return [];
    const f = this.state(floorId);
    const floor = store.floor(floorId);
    const held = floor.held.filter((h) => issueOpen(h.issue, f) !== false);
    if (held.length !== floor.held.length) store.patchFloor(floorId, { held });
    return closuresHeld(this.holders(floorId), store.qaList(floorId), f).flatMap((c) => this.apply(floorId, c));
  }

  private of(floorId: string): Learned {
    let l = this.learned.get(floorId);
    if (!l) this.learned.set(floorId, (l = { closedIssues: new Map(), closedPulls: new Map(), openAt: new Map() }));
    return l;
  }

  /** The floor's workers whose work a closure can end. One whose stopped session is still ending is left to finish. */
  private holders(floorId: string): Holder[] {
    return this.ctx.store
      .workerList()
      .filter((w) => w.floorId === floorId && !this.ctx.dropping.has(w.id))
      .map(holder);
  }

  /** Asks GitHub about the issues and PRs that workers, QA records or holds hold and the last sync doesn't list. */
  private async ask(floorId: string) {
    const { store, backend } = this.ctx;
    const floor = store.floor(floorId);
    const l = this.of(floorId);
    const ask = toAsk(this.holders(floorId), store.qaList(floorId), floor.held.map((h) => h.issue), this.state(floorId), l.openAt, Date.now());
    await Promise.all([
      ...ask.issues.map(async (n) => {
        const state = await backend.github.issueState(floor.fullName, n).catch(() => null);
        if (state === 'CLOSED') l.closedIssues.set(n, Date.now());
        else if (state === 'OPEN') l.openAt.set(`issue#${n}`, Date.now());
      }),
      ...ask.pulls.map(async (n) => {
        const pr = await backend.github.prDetails(floor.fullName, n).catch(() => null);
        if (pr?.state === 'OPEN') l.openAt.set(`pr#${n}`, Date.now());
        else if (pr && store.hasFloor(floorId)) {
          l.closedPulls.set(n, { number: n, state: pr.state, headRefName: pr.headRefName, closesIssues: pr.closesIssues, at: Date.now() });
          this.hold(floorId, pr);
        }
      }),
    ]);
  }

  /** Forgets closures a newer sync shows reopened (or a day old), and keeps the floor's lists in step with closures learned since it started. */
  private settleLearned(floorId: string) {
    const { store } = this.ctx;
    const l = this.of(floorId);
    const now = Date.now();
    const gone = forgettable(this.state(floorId), now);
    for (const n of gone.issues) l.closedIssues.delete(n);
    for (const n of gone.pulls) l.closedPulls.delete(n);
    for (const [key, at] of l.openAt) if (now - at > ASK_AGAIN_MS) l.openAt.delete(key);
    const f = this.state(floorId);
    const floor = store.floor(floorId);
    const issues = floor.issues.filter((i) => issueOpen(i.number, f) !== false);
    const closing = floor.pulls.filter((p) => p.state === 'OPEN' && pullNow(p.number, f)?.state === 'CLOSED').map((p) => p.number);
    if (issues.length !== floor.issues.length || closing.length) {
      store.patchFloor(floorId, { issues, pulls: floor.pulls.map((p) => (closing.includes(p.number) ? { ...p, state: 'CLOSED' as const } : p)) });
    }
  }

  /** A closed PR's open issues wait for the manager instead of going back to auto-assign (toHold). */
  private hold(floorId: string, pr: KnownPull) {
    const { store } = this.ctx;
    const floor = store.floor(floorId);
    const add = toHold(pr, this.state(floorId)).filter((n) => !floor.held.some((h) => h.issue === n));
    if (add.length) store.patchFloor(floorId, { held: [...floor.held, ...add.map((issue) => ({ issue, pr: pr.number }))] });
  }

  private apply(floorId: string, c: Closure): string[] {
    const { store } = this.ctx;
    const plan = afterClose(c, this.holders(floorId), store.qaList(floorId), BUSY_STATUSES);
    const why = closedWhy(c);
    const merged = c.kind === 'pr' && c.merged;
    const stopped = plan.stop.map((id) => store.worker(id).name);
    for (const id of plan.stop) giveUp(this.ctx, id, why);
    for (const id of plan.clear) {
      if (store.worker(id).task?.kind === 'qa') giveUp(this.ctx, id, null, null); // they only tested it
      else if (merged) giveUp(this.ctx, id, null, { kind: 'done', text: `🎉 PR #${c.number} was merged. Ready for the next issue.` });
      else giveUp(this.ctx, id, why);
    }
    if (plan.dropQa) {
      store.removeQa(floorId, c.number);
      for (const task of ['qa', 'fix']) this.ctx.prepStrikes.delete(`${floorId}#${c.number}:${task}`);
    }
    if (stopped.length) store.say(stoppedMessage(stopped, c, store.floor(floorId).fullName), floorId);
    if (stopped.length || plan.clear.length || plan.dropQa) this.ctx.soon(200);
    return stopped;
  }
}
