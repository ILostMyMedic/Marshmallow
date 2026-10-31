// The pipeline assembled: issue → build → PR → QA → fix → merge, run by the scheduler. After every floor sync it
// queues QA for the office's PRs that have no record yet, advances the merges and ends the work on what closed; the
// manager can stop or reset a worker. After a restart it picks up where the office left off, and a watchdog heals
// stuck work.
// Adapted from cubefarm server/swarm.ts (MIT): reconcilePulls, stopAgent, resetAgent.
import type { Backend } from '../backend/backend.ts';
import type { Floors } from '../floors.ts';
import type { ReconnectedCli } from '../sessions/cliRunner.ts';
import type { RestartCounts } from '../recovery/reconcile.ts';
import type { Terminals } from '../sessions/terminals.ts';
import type { Store } from '../store.ts';
import { Ceo } from '../team/ceo/jobs.ts';
import { CloudOffice } from '../team/cloud.ts';
import { Team, type TeamTiming } from '../team/workers.ts';
import { Build } from './build.ts';
import { Closures } from './closures.ts';
import { giveUp, handBack, type Ctx } from './context.ts';
import { Fix } from './fix.ts';
import { Merge } from './merge.ts';
import { Qa } from './qa.ts';
import { Questions } from './questions.ts';
import { recoverRestart } from './restart.ts';
import { branchIssue } from './rules/issueClaims.ts';
import { Scheduler } from './scheduler.ts';
import { Sessions } from './sessions.ts';
import { sweepMachines } from './sweeps.ts';
import { Usage } from './usage.ts';
import { Watchdog } from './watch.ts';

export interface Pipeline {
  ctx: Ctx;
  scheduler: Scheduler;
  /** Looks for stuck work every minute (the server's timer calls tick). */
  watchdog: Watchdog;
  /** The manager stops a worker: their session ends, and they wait for the manager. */
  stopWorker(workerId: string): void;
  /** The manager resets a worker: stopped if busy, then idle and holding nothing. */
  resetWorker(workerId: string): void;
  /** Stops every session (the demo's reset, shutdown). */
  stopAll(): void;
  /** Tidies workers' machines: finished branches, and the machines of workers who left. */
  sweep(): Promise<void>;
  /**
   * After a restart, before the scheduler starts: finished work is cleared, Box workers whose CLIs carried on are back
   * on their tasks' sessions, and interrupted sessions resume or go back in line. `back`: cloud.reconnect()'s CLIs.
   */
  restart(back: ReconnectedCli[]): Promise<RestartCounts>;
  /** The office is closing: nothing new starts, and sessions ending with it change nothing, for the restart to pick up. */
  close(): void;
}

/** `terminals`: each worker's terminal, which their sessions run in (null in tests that don't watch them). */
export function createPipeline(store: Store, backend: Backend, floors: Floors, terminals: Terminals | null = null, o: { teamTiming?: TeamTiming; cloud?: ConstructorParameters<typeof CloudOffice>[1] } = {}): Pipeline {
  const usage = new Usage(store);
  const sessions = new Sessions(store, backend, { limited: (at) => usage.limited(at), usageWarning: (info) => usage.warned(info) }, terminals);
  const ctx = { store, backend, sessions, floors, usage, prepStrikes: new Map(), preparing: new Set(), dropping: new Map(), soon: (ms?: number) => scheduler.soon(ms) } as Ctx;
  ctx.build = new Build(ctx);
  ctx.qa = new Qa(ctx);
  ctx.fix = new Fix(ctx);
  ctx.merge = new Merge(ctx);
  ctx.questions = new Questions(ctx);
  ctx.team = new Team(ctx, (id) => stopWorker(id), o.teamTiming);
  ctx.ceo = new Ceo(ctx);
  ctx.cloud = new CloudOffice(ctx, o.cloud);
  ctx.closures = new Closures(ctx);
  sessions.onSignedOut = (id) => ctx.cloud.needSignIn(id);
  const scheduler = new Scheduler(ctx);
  ctx.ceo.onboardUnknown();

  floors.onSynced = (floorId) => {
    reconcile(ctx, floorId);
    void ctx.merge.advance(floorId);
    void ctx.questions.check(floorId);
    void ctx.closures.synced(floorId).catch((err) => console.warn(`  the closed issues and PRs of ${floorId} couldn't be checked: ${(err as Error).message}`));
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
    watchdog: new Watchdog(ctx),
    resetWorker: (workerId) => {
      // Their QA run or fix goes back in its queue; a session or desk set-up still running stops, and they're cleared
      // once it has, so it can't run on into their next task.
      handBack(ctx, workerId);
      giveUp(ctx, workerId, 'reset by the manager', { kind: 'manager', text: '↺ Reset by the manager.' });
    },
    stopAll: () => sessions.stopAll(),
    sweep: () => sweepMachines(ctx),
    restart: (back) => recoverRestart(ctx, back, (kept) => kept.filter((r) => reattach(r)).length, { demo: backend.demo }),
    close: () => {
      scheduler.stop();
      sessions.close();
    },
  };

  /** A Box worker's CLI that kept working on their task is back on that task's session. */
  function reattach(r: ReconnectedCli): boolean {
    if (!store.hasWorker(r.workerId)) return false;
    const kind = store.worker(r.workerId).task?.kind;
    const ok = kind === 'issue' ? ctx.build.reattach(r.workerId) : kind === 'qa' ? ctx.qa.reattach(r.workerId) : kind === 'fix' ? ctx.fix.reattach(r.workerId) : false;
    if (!ok) store.appendLog(r.workerId, [{ kind: 'system', text: 'My cloud machine kept working while the office was closed; its task is over, so the terminal waits.' }]);
    return ok;
  }
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
