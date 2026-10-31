// Demo-only routes for the debug page: Claude's usage warning or limit on demand, and a reset.
import express from 'express';
import type { DemoBackend } from './backend/demo.ts';
import { HttpError } from './httpError.ts';
import type { Pipeline } from './pipeline/pipeline.ts';
import { route } from './route.ts';
import type { Store } from './store.ts';

export function demoRoutes(store: Store, backend: DemoBackend, pipeline: Pipeline) {
  const r = express.Router();

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
