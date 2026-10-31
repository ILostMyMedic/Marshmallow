// After a restart, before anything is scheduled: every worker who held a task is checked against GitHub and their desk
// (recovery/reconcile.ts). Work that closed or merged while the office was down is cleared, Box workers' CLIs that kept
// working on their task are followed again, and everyone else who was busy resumes their session, told what they were
// doing, or their work goes back in line without a strike. A PR left "testing" with nobody on it is tested again.
// Adapted from cubefarm server/swarm.ts (MIT): init's restart steps, reconcileRestart, finishRestart, recover.
import { BUSY_STATUSES, isBusy, type Worker } from '../../shared/types.ts';
import { devPort, machineName } from '../machines/machines.ts';
import { orphanedQa } from '../recovery/qaOrphans.ts';
import { reconcileStep, restartMessage, workState, type ReconcileStep, type RestartCounts } from '../recovery/reconcile.ts';
import { followKeptCli, resumeNote, resumesAfterRestart, type RestartWorker } from '../recovery/restartRecovery.ts';
import type { ReconnectedCli } from '../sessions/cliRunner.ts';
import { clearTask, handBack, type Ctx } from './context.ts';

const restartWorker = (w: Worker): RestartWorker => ({
  status: w.status,
  task: w.task?.kind ?? null,
  sessionId: w.sessionId,
  branch: w.task?.branch ?? null,
  issueNumber: w.task?.issueNumber ?? null,
  issueTitle: w.task?.title ?? null,
  prNumber: w.task?.prNumber ?? null,
});

/**
 * Picks up where the office left off. `back`: Box workers' CLIs that kept running (cloud.reconnect); `reattach` puts
 * the ones still on their task back on its session. `demo`: the demo's sessions start over rather than resume.
 */
export async function recoverRestart(ctx: Ctx, back: ReconnectedCli[], reattach: (kept: ReconnectedCli[]) => number, o: { demo: boolean }): Promise<RestartCounts> {
  const { store, backend } = ctx;
  const kept = (w: Worker) => back.find((c) => c.workerId === w.id);
  const alive = (w: Worker) => followKeptCli(restartWorker(w), kept(w));

  // What became of each worker's task while the office was down, and whether their desk is still there.
  const plan = new Map<string, ReconcileStep>();
  await Promise.all(
    store.workerList().map(async (w) => {
      const t = w.task;
      if (w.role !== 'worker' || !t || !store.hasFloor(w.floorId)) return;
      const floor = store.floor(w.floorId);
      const [issue, pr, deskExists] = await Promise.all([
        t.kind === 'issue' && t.issueNumber != null ? backend.github.issueState(floor.fullName, t.issueNumber).catch(() => null) : null,
        t.prNumber != null ? backend.github.prDetails(floor.fullName, t.prNumber).catch(() => null) : null,
        // A Box worker's desk is in their Box: taken to be there (Upstash may be unreachable, and looking wakes it).
        w.host === 'box' ? true : ctx.cloud.machinesFor(w).exists(machineName(w.id), floor.fullName).catch(() => false),
      ]);
      if (!store.hasFloor(floor.id) || !store.hasWorker(w.id)) return;
      if (issue === 'CLOSED' && t.issueNumber != null) ctx.closures.learn(floor.id, { issue: t.issueNumber });
      if (pr && pr.state !== 'OPEN') ctx.closures.learn(floor.id, { pull: pr });
      const now = store.worker(w.id);
      plan.set(
        w.id,
        reconcileStep({ role: now.role, status: now.status, task: t.kind, work: workState(issue, pr?.state ?? null), deskExists, cliAlive: alive(now), resumable: resumesAfterRestart(restartWorker(now), now.status === 'preparing', o.demo) }),
      );
    }),
  );

  // Whoever was busy and isn't carrying on in their Box was cut off: stopped for now, to resume or start over below.
  const counts: RestartCounts = { cleared: 0, reattached: 0, resumed: 0, requeued: 0 };
  const carryOn: ReconnectedCli[] = [];
  const interrupted: string[] = [];
  const preparing = new Set<string>();
  const requeue = new Set<string>();
  for (const w of store.workerList()) {
    if (w.role !== 'worker') continue;
    const step = plan.get(w.id);
    if (step === 'requeue') requeue.add(w.id);
    if (!isBusy(w.status)) continue;
    const cli = kept(w);
    if (cli && (step === 'reattach' || (step === undefined && alive(w)))) {
      carryOn.push(cli);
      continue;
    }
    if (!w.task) {
      clearTask(ctx, w.id);
      continue;
    }
    if (w.status === 'preparing') preparing.add(w.id);
    store.patchWorker(w.id, { status: 'stopped', activity: null, lastError: 'The office restarted while they were working.' });
    interrupted.push(w.id);
  }

  // Finished work is cleared now, as its closing would have; then Box CLIs the office won't follow are let go.
  for (const f of store.floorList()) ctx.closures.cleanUp(f.id);
  for (const [id, step] of plan) if (step === 'clear' && store.hasWorker(id) && !store.worker(id).task) counts.cleared++;
  for (const c of back) if (c.busy && !carryOn.includes(c)) void ctx.sessions.terminalOf(c.workerId)?.releaseIdle?.();
  counts.reattached = reattach(carryOn);

  // Whatever an interrupted session left running at its desk (a dev server) stops before anything starts there again.
  await Promise.all(
    interrupted.map((id) => {
      const w = store.worker(id);
      return store.hasFloor(w.floorId) ? ctx.cloud.machinesFor(w).release(machineName(id), store.floor(w.floorId).fullName, devPort(id)).catch(() => undefined) : undefined;
    }),
  );

  // Interrupted sessions resume, as many as the session limit allows; the rest start over from the queue.
  const limit = store.getSettings().sessionLimit;
  let running = counts.reattached;
  for (const id of [...interrupted, ...[...requeue].filter((r) => !interrupted.includes(r))]) {
    if (!store.hasWorker(id)) continue;
    const w = store.worker(id);
    if (!w.task) continue; // its issue or PR closed while the office was down
    const fix = w.task.kind === 'fix' ? store.qaList(w.floorId).find((q) => q.devWorkerId === id && q.status === 'fixing') : undefined;
    const resumes = !requeue.has(id) && !(limit > 0 && running >= limit) && resumesAfterRestart(restartWorker(w), preparing.has(id), o.demo);
    const note = resumeNote(restartWorker(w), fix && { round: fix.round, fixReason: fix.fixReason });
    if (resumes && (await (w.task.kind === 'fix' ? ctx.fix.resume(id, note) : ctx.build.resume(id, note)))) {
      running++;
      counts.resumed++;
      continue;
    }
    store.appendLog(id, [{ kind: 'system', text: '↺ The office restarted. Starting over from the queue.' }]);
    handBack(ctx, id);
    clearTask(ctx, id);
    counts.requeued++;
  }

  // A PR the restart left in "testing" with nobody on it is tested again (its result, if any, was lost).
  const workers = store.workerList().map((w) => ({ id: w.id, floorId: w.floorId, status: w.status, task: w.task?.kind ?? null, prNumber: w.task?.prNumber ?? null }));
  for (const rec of orphanedQa(store.qaList(), workers, BUSY_STATUSES)) store.patchQa(rec.floorId, rec.prNumber, { status: 'queued', qaWorkerId: null });
  const text = restartMessage(counts);
  if (text) store.say(text);
  ctx.soon(200);
  return counts;
}
