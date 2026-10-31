// Tidying workers' machines: finished mm/ branches in their clones, and the machines of workers who've left (their
// work on no remote branch is saved as a patch first). Runs at start and every DESK_SWEEP_INTERVAL_MS.
// Adapted from cubefarm server/swarm.ts (MIT): sweepFloor and sweepMachines.
import path from 'node:path';
import { isBusy } from '../../shared/types.ts';
import { machineName } from '../machines/machines.ts';
import { oneLine, type Ctx } from './context.ts';

export async function sweepMachines(ctx: Ctx): Promise<void> {
  const { store } = ctx;
  const workers = store.workerList();
  // Branches still in use: open PRs' heads and every worker's current branch.
  const inUse = workers.flatMap((w) => (w.task?.branch ? [w.task.branch] : []));
  for (const floor of store.floorList()) {
    const keep = [...inUse, ...floor.pulls.filter((p) => p.state === 'OPEN').map((p) => p.headRefName)];
    for (const w of workers.filter((x) => x.floorId === floor.id && !isBusy(x.status))) {
      await ctx.cloud.machinesFor(w).sweep(machineName(w.id), floor.fullName, keep).catch((err) => console.warn(`  couldn't sweep ${w.name}'s machine: ${oneLine(err)}`));
    }
  }
  // Machines of workers who left: folders on this computer, and this office's Boxes.
  for (const host of ['local', 'box'] as const) {
    const machines = ctx.cloud.machinesFor({ host });
    const theirs = new Set(workers.filter((w) => w.host === host).map((w) => machineName(w.id)));
    for (const machine of await machines.list().catch(() => [])) {
      if (theirs.has(machine)) continue;
      const gone = await machines.remove(machine).catch(() => ({ removed: false, patches: [] as string[] }));
      if (gone.patches.length) store.say(`🧳 A former worker left work that was on no GitHub branch: saved in ${path.dirname(gone.patches[0])}.`);
    }
  }
}
