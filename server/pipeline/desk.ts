// A worker's desk for a task: whatever their last task left running stopped, their worktree on the task's branch, and
// the dependencies installed. A failed install never fails the task: the worker is told to install them.
// Adapted from cubefarm server/swarm.ts (MIT): prepare and installDeps.
import type { Floor } from '../../shared/types.ts';
import { setUpDesk } from '../machines/deskSetup.ts';
import { devPort, machineName, type DepsOutcome } from '../machines/machines.ts';
import { stillPreparing, type Ctx } from './context.ts';

export interface Desk {
  cwd: string;
  deps: DepsOutcome;
}

/** Sets the worker's desk up for a task; null when they were stopped meanwhile. Throws when the desk can't be set up. */
export async function prepareDesk(ctx: Ctx, workerId: string, floor: Floor, base: { pr?: number }, branch: string): Promise<Desk | null> {
  const { store } = ctx;
  const { machines } = ctx.backend;
  const machine = machineName(workerId);
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
  return stillPreparing(ctx, workerId) ? { cwd, deps } : null;
}
