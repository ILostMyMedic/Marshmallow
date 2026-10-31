// The pipeline assembled: issue → build → PR → QA → fix → merge, run by the scheduler. After every floor sync it
// queues QA for the office's PRs that have no record yet and advances the merges; the manager can stop or reset a
// worker.
// Adapted from cubefarm server/swarm.ts (MIT): reconcilePulls, stopAgent, resetAgent.
import type { Backend } from '../backend/backend.ts';
import type { Floors } from '../floors.ts';
import type { Terminals } from '../sessions/terminals.ts';
import type { Store } from '../store.ts';
import { Ceo } from '../team/ceo/jobs.ts';
import { Team, type TeamTiming } from '../team/workers.ts';
import { Build } from './build.ts';
import { clearTask, type Ctx } from './context.ts';
import { Fix } from './fix.ts';
import { Merge } from './merge.ts';
import { Qa } from './qa.ts';
import { Questions } from './questions.ts';
import { branchIssue } from './rules/issueClaims.ts';
import { Scheduler } from './scheduler.ts';
import { Sessions } from './sessions.ts';
import { sweepMachines } from './sweeps.ts';
import { Usage } from './usage.ts';

export interface Pipeline {
  ctx: Ctx;
  scheduler: Scheduler;
  /** The manager stops a worker: their session ends, and they wait for the manager. */
  stopWorker(workerId: string): void;
  /** The manager resets a worker: stopped if busy, then idle and holding nothing. */
  resetWorker(workerId: string): void;
  /** Stops every session (the demo's reset, shutdown). */
  stopAll(): void;
  /** Tidies workers' machines: finished branches, and the machines of workers who left. */
  sweep(): Promise<void>;
}

/** `terminals`: each worker's terminal, which their sessions run in (null in tests that don't watch them). */
export function createPipeline(store: Store, backend: Backend, floors: Floors, terminals: Terminals | null = null, o: { teamTiming?: TeamTiming } = {}): Pipeline {
  const usage = new Usage(store);
  const sessions = new Sessions(store, backend, { limited: (at) => usage.limited(at), usageWarning: (info) => usage.warned(info) }, terminals);
  const ctx = { store, backend, sessions, floors, usage, prepStrikes: new Map(), soon: (ms?: number) => scheduler.soon(ms) } as Ctx;
  ctx.build = new Build(ctx);
  ctx.qa = new Qa(ctx);
  ctx.fix = new Fix(ctx);
  ctx.merge = new Merge(ctx);
  ctx.questions = new Questions(ctx);
  ctx.team = new Team(ctx, (id) => stopWorker(id), o.teamTiming);
  ctx.ceo = new Ceo(ctx);
  const scheduler = new Scheduler(ctx);
  ctx.ceo.onboardUnknown();

  floors.onSynced = (floorId) => {
    reconcile(ctx, floorId);
    void ctx.merge.advance(floorId);
    void ctx.questions.check(floorId);
    ctx.soon(200);
  };

  const stopWorker = (workerId: string) => {
    const w = store.worker(workerId);
    if (w.status === 'stopped') return;
    // Stopped first, so the session's ending (and a desk still being prepared) sees it and gives the work back.
    store.patchWorker(workerId, { status: 'stopped', activity: null, endedAt: Date.now() });
    store.appendLog(workerId, [{ kind: 'manager', text: '■ Stopped by the manager.' }]);
    sessions.stop(workerId);
  };

  return {
    ctx,
    scheduler,
    stopWorker,
    resetWorker: (workerId) => {
      const w = store.worker(workerId);
      if (w.status === 'preparing' || w.status === 'working') stopWorker(workerId);
      clearTask(ctx, workerId);
      store.appendLog(workerId, [{ kind: 'manager', text: '↺ Reset by the manager.' }]);
      ctx.soon(200);
    },
    stopAll: () => sessions.stopAll(),
    sweep: () => sweepMachines(ctx),
  };
}

/** The office's open PRs without a QA record (a build that ended oddly, a restart) go to QA. Drafts wait. */
function reconcile(ctx: Ctx, floorId: string) {
  const { store } = ctx;
  if (!store.hasFloor(floorId)) return;
  for (const pr of store.floor(floorId).pulls) {
    const issue = branchIssue(pr.headRefName);
    if (pr.state !== 'OPEN' || pr.isDraft || issue == null || store.findQa(floorId, pr.number)) continue;
    const dev = store.workerList().find((w) => w.floorId === floorId && (w.task?.prNumber === pr.number || w.task?.branch === pr.headRefName));
    ctx.qa.queue(floorId, pr.number, dev?.id ?? null, issue);
  }
}
