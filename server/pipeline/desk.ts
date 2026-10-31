// A worker's desk for a task: whatever their last task left running stopped, their worktree on the task's branch, and
// the dependencies installed. A failed install never fails the task: the worker is told to install them. A Box worker's
// Box is woken and checked first (signed in, credentials there), before any cloning.
// Adapted from cubefarm server/swarm.ts (MIT): prepare and installDeps.
import type { Floor } from '../../shared/types.ts';
import { setUpDesk } from '../machines/deskSetup.ts';
import { devPort, machineName, type DepsOutcome } from '../machines/machines.ts';
import type { BoxTarget } from '../sessions/boxCli.ts';
import { SignInNeeded } from '../team/cloud.ts';
import { clearTask, stillPreparing, type Ctx } from './context.ts';

export interface Desk {
  cwd: string;
  deps: DepsOutcome;
  /** A Box worker's Box: where their session runs. */
  box?: BoxTarget;
}

/**
 * Sets the worker's desk up for a task; null when they were stopped meanwhile, or their Box's Claude Code needs signing
 * in (the work goes back, and they wait for the manager). Throws when the desk can't be set up.
 */
export async function prepareDesk(ctx: Ctx, workerId: string, floor: Floor, base: { pr?: number }, branch: string): Promise<Desk | null> {
  const { store } = ctx;
  const w = store.worker(workerId);
  const machines = ctx.cloud.machinesFor(w);
  const machine = machineName(workerId);
  let box: BoxTarget | undefined;
  try {
    box = w.host === 'box' ? await ctx.cloud.target(w, floor) : undefined;
  } catch (err) {
    if (!(err instanceof SignInNeeded)) throw err;
    if (stillPreparing(ctx, workerId)) clearTask(ctx, workerId);
    return null;
  }
  if (!stillPreparing(ctx, workerId)) return null;
  const log = (lines: string[]) => store.hasWorker(workerId) && store.appendLog(workerId, lines.map((text) => ({ kind: text.startsWith('⚠') ? ('error' as const) : ('system' as const), text })));
  if (floor.cloneStatus !== 'ready') await ctx.backend.ensureClone(floor.fullName);
  const cwd = await setUpDesk(ctx.sessions.terminalOf(workerId), {
    release: () => machines.release(machine, floor.fullName, devPort(workerId)),
    prepare: () => machines.prepareDesk(machine, floor.fullName, { defaultBranch: floor.defaultBranch, ...base }, branch, (text) => log([text])),
  });
  if (!stillPreparing(ctx, workerId)) return null;
  const deps = await machines.installDeps(machine, floor.fullName, {
    log,
    installing: () => stillPreparing(ctx, workerId) && store.patchWorker(workerId, { activity: { kind: 'build', detail: 'installing deps' } }),
  });
  return stillPreparing(ctx, workerId) ? { cwd, deps, ...(box && { box }) } : null;
}
