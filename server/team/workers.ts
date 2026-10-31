// Hiring and letting go of workers, by hand for now: autospawning and the CEO come in BUILD-PLAN phase 6.
// Adapted from cubefarm server/swarm.ts (MIT): hireAgent, fireAgent, freeName.
import { randomInt, randomUUID } from 'node:crypto';
import type { Worker } from '../../shared/types.ts';
import { HttpError } from '../httpError.ts';
import { machineName } from '../machines/machines.ts';
import type { Pipeline } from '../pipeline/pipeline.ts';
import type { Store } from '../store.ts';

const NAMES = ['Ada', 'Grace', 'Linus', 'Ken', 'Barbara', 'Dennis', 'Margaret', 'Alan', 'Radia', 'Guido', 'Hedy', 'Edsger', 'Frances', 'Donald', 'Katherine', 'Niklaus'];

/** A new worker on the floor, at its first free desk, idle and ready for work. */
export function hireWorker(store: Store, pipeline: Pipeline, floorId: string): Worker {
  const floor = store.floor(floorId);
  const everyone = store.workerList();
  const team = everyone.filter((w) => w.floorId === floor.id);
  if (team.length >= store.getSettings().maxWorkers) throw new HttpError(409, `${floor.fullName} is full (${team.length} workers)`);
  const name = NAMES.find((x) => !everyone.some((w) => w.name === x)) ?? `Worker ${everyone.length + 1}`;
  let desk = 0;
  while (team.some((w) => w.desk === desk)) desk++;
  const now = Date.now();
  const worker: Worker = {
    id: randomUUID(),
    name,
    floorId: floor.id,
    role: 'worker',
    seed: randomInt(2 ** 31),
    desk,
    model: '',
    effort: '',
    host: 'local',
    status: 'idle',
    task: null,
    activity: null,
    idleSince: now,
    startedAt: null,
    endedAt: null,
    costUsd: 0,
    turns: 0,
    lastError: null,
    sessionId: null,
  };
  store.putWorker(worker);
  store.appendLog(worker.id, [{ kind: 'system', text: `Joined ${floor.fullName}` }], now);
  store.moment({ type: 'hired', at: now, worker });
  pipeline.ctx.soon(200);
  return worker;
}

/** The worker leaves: their session stops, and their machine goes (work on no remote branch is saved first). */
export function letGo(store: Store, pipeline: Pipeline, workerId: string) {
  const w = store.worker(workerId);
  pipeline.stopWorker(w.id);
  store.removeWorker(w.id);
  store.moment({ type: 'left', at: Date.now(), worker: w });
  void pipeline.ctx.backend.machines.remove(machineName(w.id)).then(
    (r) => r.patches.length && store.say(`🧳 ${w.name} left work that was on no GitHub branch: saved as ${r.patches.join(', ')}.`),
    () => undefined,
  );
}
