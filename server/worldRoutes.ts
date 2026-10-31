// The world events on demand, for QA and the demo (`?event=`, window.__mmEvents in the game): start one for every tab,
// end one, have the director pick the next one soon, and read what ran. Real mode keeps them too: they change nothing
// but the sky.
import express from 'express';
import { parseEventId, type EventId } from '../shared/worldEvents.ts';
import type { World } from './db/world.ts';
import { HttpError } from './httpError.ts';
import { route } from './route.ts';

const eventOf = (raw: unknown): EventId => {
  const id = parseEventId(raw);
  if (!id) throw new HttpError(400, `No world event called ${String(raw)}`);
  return id;
};

export function worldRoutes(world: World) {
  const r = express.Router();

  // { event: 'blimp', side?: 'west' | 'east' }: a big one ends any other big one
  r.post(
    '/trigger',
    route((req) => {
      const side = req.body?.side;
      if (side !== undefined && side !== null && side !== 'west' && side !== 'east') throw new HttpError(400, 'side must be west or east');
      return world.trigger(eventOf(req.body?.event), side ?? undefined);
    }),
  );
  // { event?: 'blimp' }: that one, or everything on
  r.post(
    '/end',
    route((req) => world.end(req.body?.event === undefined || req.body?.event === null ? undefined : eventOf(req.body.event))),
  );
  // { seconds?: 1 }
  r.post(
    '/soon',
    route((req) => {
      const seconds = Number(req.body?.seconds ?? 1);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) throw new HttpError(400, 'seconds must be from 0 to 3600');
      return world.soon(seconds);
    }),
  );
  r.get('/log', route(() => world.log()));

  return r;
}
