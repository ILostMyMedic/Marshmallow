// Watches the store for the moments people react to at their desk (reactions.ts) and queues a fidget for each person,
// which Character.tsx picks up on its next frame. Adapted from cubefarm client/src/world/reactionFeed.ts (MIT): from the
// server's moments.
import type { Moment } from '../../../shared/types';
import { useStore } from '../store';
import { liveBodies } from './people';
import { momentsSince, newlyErrored, reactionsTo } from './reactions';

export interface Queued {
  fidget: 'fistPump' | 'wave' | 'facepalm';
  /** For a wave: where (world x/z) the one they wave to sits. */
  x: number;
  z: number;
  /** When it was queued (ms); people who aren't drawn (another floor) never take it, so it goes stale. */
  at: number;
}

const STALE_MS = 3000;
const queue = new Map<string, Queued>();

/** The fidget queued for this person, if any and still fresh; taking it clears it. */
export function takeReaction(id: string, now = Date.now()) {
  const q = queue.get(id);
  if (!q) return undefined;
  queue.delete(id);
  return now - q.at < STALE_MS ? q : undefined;
}

export function queueFidget(id: string, fidget: Queued['fidget'], x = 0, z = 0) {
  queue.set(id, { fidget, x, z, at: Date.now() });
}

let last: Moment | null = null;

if (typeof window !== 'undefined') {
  // for checks: play a fidget at someone's desk (window.__mmFidget(id, 'facepalm'))
  (window as unknown as Record<string, unknown>).__mmFidget = queueFidget;
  useStore.subscribe((state, prev) => {
    if (!prev.loaded) {
      last = state.moments.at(-1) ?? null; // the first snapshot: nothing just happened
      return;
    }
    if (state.moments !== prev.moments) {
      const seats = new Map([...liveBodies()].map(([id, b]) => [id, { seatX: b.seatX, seatZ: b.seatZ }]));
      for (const m of momentsSince(state.moments, last)) {
        for (const r of reactionsTo(m, state.qa, seats)) {
          const to = r.fidget === 'wave' ? seats.get(r.toward) : undefined;
          queueFidget(r.id, r.fidget, to?.seatX ?? 0, to?.seatZ ?? 0);
        }
      }
      last = state.moments.at(-1) ?? null;
    }
    if (state.workers !== prev.workers) for (const id of newlyErrored(prev.workers, state.workers)) queueFidget(id, 'facepalm');
  });
}
