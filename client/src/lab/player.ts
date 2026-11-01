// The lab's animation player: which animation plays, since when on the lab's clock, how long a switch blends for, and
// what comes next when they play in turn. Pure.
import { ANIM_NAMES, SEATED, smooth, type AnimName } from './poses';

/** Seconds a switch blends over; getting up or sitting down takes longer. */
export const BLEND_S = 0.45;
export const SEAT_BLEND_S = 0.9;
/** Each animation's turn when they play in turn. */
export const TURN_S = 5;

export interface Player {
  anim: AnimName;
  /** When it started (lab clock). */
  at: number;
}

/** How long a switch from `a` to `b` blends for. */
export const blendSeconds = (a: AnimName, b: AnimName) => (SEATED.has(a) !== SEATED.has(b) ? SEAT_BLEND_S : BLEND_S);

/** How far a blend that began at `from` has come by `now` (0 to 1, eased). */
export const blendWeight = (now: number, from: number, seconds: number) => smooth((now - from) / seconds);

/** The animation after `a`, round the list. */
export const nextAnim = (a: AnimName) => ANIM_NAMES[(ANIM_NAMES.indexOf(a) + 1) % ANIM_NAMES.length];

/** Playing in turn: the animation due at `now`, given the current one (unchanged until its turn is up). */
export function inTurn(p: Player, now: number): Player {
  return now - p.at >= TURN_S ? { anim: nextAnim(p.anim), at: now } : p;
}
