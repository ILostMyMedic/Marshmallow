// When the player's feet make a sound, kept free of WebAudio so it can be tested: a step each half head-bob
// cycle while moving (so the rate follows the bob and quickens when running), feet taking turns, and one scuff
// when you stop after walking. Standing still is silent. And what's underfoot, for how a step sounds.
// Adapted from cubefarm client/src/ui/footstepRules.ts (MIT), with layout.ts's surfaceAt moved in for the CEO's floor.

import type { FloorKindOf } from '../world/floors';
import { DESK_RUGS, ELEVATOR, EXEC_GREEN, EXEC_RUGS, HALF_D, HALF_W, LOBBY_RUG, rect, type Rect } from '../world/layout';
import { DECKING } from '../world/roof/roofLayout';

export interface StepTracker {
  /** Half bob cycles counted so far. */
  half: number;
  /** Steps since the player last stood still. */
  walked: number;
  wasMoving: boolean;
  /** 0 = left, 1 = right: the foot of the last step. */
  foot: 0 | 1;
}

export const createStepTracker = (): StepTracker => ({ half: 0, walked: 0, wasMoving: false, foot: 1 });

/** Advance the tracker by one frame. Returns what to play, if anything. Never allocates. */
export function trackSteps(t: StepTracker, bobPhase: number, moving: boolean): 'step' | 'scuff' | null {
  const half = Math.floor(bobPhase / Math.PI);
  let out: 'step' | 'scuff' | null = null;
  if (moving && half !== t.half) {
    out = 'step';
    t.walked++;
    t.foot = t.foot === 0 ? 1 : 0;
  } else if (!moving && t.wasMoving && t.walked > 0) {
    out = 'scuff';
  }
  if (!moving) t.walked = 0;
  t.half = half;
  t.wasMoving = moving;
  return out;
}

/** A multiplier within ±10% of 1, from a random number in [0, 1). */
export const vary = (r: number) => 0.9 + r * 0.2;

// ---------- underfoot ----------

export type Surface = 'wood' | 'rug' | 'lobby' | 'cabin';

/** The CEO's rugs, where CeoFloor.tsx lays them, and the putting green. */
const CEO_RUGS: Rect[] = [...EXEC_RUGS, rect(EXEC_GREEN.x, EXEC_GREEN.z, EXEC_GREEN.w, EXEC_GREEN.d)];

/**
 * The floor under (x, z), for footsteps. A rug's edge counts as rug; past the doorway is the elevator cabin, and outside,
 * a balcony's (or the patio's) paving sounds like the lobby's tiles. On the roof, the decking is wood and the rest is paving.
 */
export function surfaceAt(kind: FloorKindOf, x: number, z: number): Surface {
  if (z > HALF_D && Math.abs(x) <= ELEVATOR.cabinHalf) return 'cabin';
  if (kind === 'roof') return x >= DECKING.minX && x <= DECKING.maxX && z >= DECKING.minZ && z <= DECKING.maxZ ? 'wood' : 'lobby';
  if (Math.abs(x) > HALF_W) return 'lobby';
  for (const r of kind === 'lobby' ? [LOBBY_RUG] : kind === 'ceo' ? CEO_RUGS : DESK_RUGS) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return 'rug';
  }
  return kind === 'lobby' ? 'lobby' : 'wood';
}
