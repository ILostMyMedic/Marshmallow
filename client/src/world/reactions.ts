// What people do at their desk when something happens on the floor: a fist pump when QA passes your PR, a wave from
// the desks around someone whose PR merged, a facepalm when your session fails. Pure: which moments and changes
// call for which reaction. reactionFeed.ts queues them; Character.tsx plays them as fidgets (fidgets.ts).
// Adapted from cubefarm client/src/world/reactions.ts (MIT), from the server's moments instead of diffing.

import type { Moment, QaRecord, Worker, WorkerStatus } from '../../../shared/types';

/** How far away (metres, seat to seat) a neighbour may sit and still wave: the desks around yours. */
export const NEIGHBOUR_RADIUS = 7.6;

/** Everyone seated within NEIGHBOUR_RADIUS of `id`'s seat, nearest first, at most `max`. */
export function neighboursOf(id: string, seats: ReadonlyMap<string, { seatX: number; seatZ: number }>, max = 4) {
  const me = seats.get(id);
  if (!me) return [];
  const near: { id: string; d: number }[] = [];
  for (const [other, s] of seats) {
    if (other === id) continue;
    const d = Math.hypot(s.seatX - me.seatX, s.seatZ - me.seatZ);
    if (d <= NEIGHBOUR_RADIUS) near.push({ id: other, d });
  }
  return near
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((n) => n.id);
}

/** Workers whose session just failed. */
export function newlyErrored(prev: Record<string, { status: WorkerStatus }>, next: Record<string, { status: WorkerStatus }>) {
  return Object.keys(next).filter((id) => next[id].status === 'error' && prev[id] && prev[id].status !== 'error');
}

/** The moments after `last` in `moments` (all of them when `last` isn't there any more). */
export function momentsSince(moments: readonly Moment[], last: Moment | null): readonly Moment[] {
  if (!last) return moments;
  const i = moments.lastIndexOf(last);
  return i < 0 ? moments : moments.slice(i + 1);
}

export type Reaction = { id: string; fidget: 'fistPump' } | { id: string; fidget: 'wave'; toward: string };

/** What a moment sets people off doing: the PR's author pumps a fist at a QA pass, their neighbours wave at a merge. */
export function reactionsTo(m: Moment, qa: Record<string, Pick<QaRecord, 'devWorkerId'>>, seats: ReadonlyMap<string, { seatX: number; seatZ: number }>): Reaction[] {
  if (m.type === 'qaPassed') {
    const dev = qa[`${m.floorId}#${m.prNumber}`]?.devWorkerId;
    return dev ? [{ id: dev, fidget: 'fistPump' }] : [];
  }
  if (m.type === 'merged' && m.devWorkerId) return neighboursOf(m.devWorkerId, seats).map((id) => ({ id, fidget: 'wave', toward: m.devWorkerId! }));
  return [];
}

/** Workers by id, for newlyErrored. */
export type WorkerMap = Record<string, Pick<Worker, 'status'>>;
