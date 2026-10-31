// The merge gong's live state, shared by gongRunner.ts (a merge on this floor), Gong.tsx (drawing the swing),
// Character.tsx (cheering) and MergeConfetti.tsx (the burst over it). No three.js here.
// Adapted from cubefarm client/src/world/gongState.ts (MIT): the time-lapse's quieter boom is cut.
import { gong as boom } from '../ui/sfx';
import { celebrating, createGong, strike, type Strike } from './gongRules';

export const gongState = createGong();

/** Gong.tsx says which floor's gong is on screen (null when it goes). */
export function setGongHere(floorId: string | null) {
  gongState.here = floorId;
}

const partyListeners = new Set<(floorId: string) => void>();

/** Called with the floor whenever a strike starts a celebration there (MergeConfetti.tsx bursts over the gong). */
export function onGongParty(fn: (floorId: string) => void) {
  partyListeners.add(fn);
  return () => void partyListeners.delete(fn);
}

/**
 * Strike the gong on `floorId`'s floor (default: the one on screen): it booms, swings and, with `celebrate`, everyone
 * on the floor cheers and confetti bursts over it. 'absent' when that floor's gong isn't on screen.
 */
export function hitGong(opts: { floorId?: string | null; celebrate?: boolean } = {}): Strike {
  const result = strike(gongState, performance.now(), opts);
  if (result === 'boom') boom();
  if (result !== 'absent' && opts.celebrate && gongState.celebrateFloor) for (const fn of partyListeners) fn(gongState.celebrateFloor);
  return result;
}

/** Whether the workers of `floorId` are celebrating a merge (`now` is performance.now()). */
export const isCelebrating = (floorId: string, now: number) => celebrating(gongState, floorId, now);

// For QA: __mmGong.hit({ celebrate: true }) strikes the gong on screen, __mmGong.hits() counts the strikes.
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__mmGong = {
    hit: (opts?: { celebrate?: boolean }) => void hitGong({ celebrate: opts?.celebrate === true }),
    hits: () => gongState.hits,
  };
}
