// Demo-only routes for the debug page: hire and let go of pretend workers, Claude's usage warning or limit on demand,
// and a reset. Hiring moves to the team module in BUILD-PLAN phase 6.
import { randomInt, randomUUID } from 'node:crypto';
import express from 'express';
import type { Worker } from '../shared/types.ts';
import type { DemoBackend } from './backend/demo.ts';
import { HttpError } from './httpError.ts';
import { machineName } from './machines/machines.ts';
import type { Pipeline } from './pipeline/pipeline.ts';
import { route } from './route.ts';
import type { Store } from './store.ts';

const NAMES = ['Ada', 'Grace', 'Linus', 'Ken', 'Barbara', 'Dennis', 'Margaret', 'Alan', 'Radia', 'Guido', 'Hedy', 'Edsger'];

export function demoRoutes(store: Store, backend: DemoBackend, pipeline: Pipeline) {
  const r = express.Router();

  r.post(
    '/floors/:floor/workers',
    route((req) => {
      const floor = store.floor(String(req.params.floor));
      const everyone = store.workerList();
      const team = everyone.filter((w) => w.floorId === floor.id);
      if (team.length >= store.getSettings().maxWorkers) throw new HttpError(409, `${floor.fullName} is full`);
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
      return { id: worker.id };
    }),
  );

  r.delete(
    '/workers/:id',
    route((req) => {
      const w = store.worker(String(req.params.id));
      pipeline.stopWorker(w.id);
      store.removeWorker(w.id);
      void backend.machines.remove(machineName(w.id));
      store.moment({ type: 'left', at: Date.now(), worker: w });
    }),
  );

  // What a session reports about Claude's usage, on demand: a warning paces new issues, the limit pauses everything.
  r.post(
    '/usage',
    route((req) => {
      const kind = req.body?.kind;
      if (kind === 'warning') pipeline.ctx.usage.warned({ resetsAt: Date.now() + 10 * 60_000, rateLimitType: 'five_hour', utilization: 0.91 });
      else if (kind === 'limit') pipeline.ctx.usage.limited(Date.now() + 2 * 60_000);
      else throw new HttpError(400, 'kind must be warning or limit');
    }),
  );

  // Back to a first start: no floors or workers, and the fake GitHub as it was seeded
  r.post(
    '/reset',
    route(() => {
      pipeline.stopAll();
      backend.reset();
      store.reset();
    }),
  );

  return r;
}
