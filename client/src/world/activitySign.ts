// Where the activity sign over someone's head floats (ActivityIcon.tsx): over the head while they sit, over the name
// tag Character.tsx lifts above them when they stand, and stacked above a speech bubble (SpeechBubble.tsx) rather
// than covering it. Adapted from cubefarm client/src/world/activitySign.ts (MIT).

/** The sign's size in metres. */
export const SIGN_SIZE = { w: 1.1, h: 0.206 };
/** The sign's middle above the floor, seated and standing (the tallest people's name tag included). */
export const SIGN_HEIGHT = { seated: 1.78, standing: 2.2 };
/** Where a speech bubble starts (its tail's tip, tallest people) and the sign's middle once it's clear of the bubble's top. */
export const BUBBLE = { from: 2.0, clear: 2.6 };

/** How much taller than the old figure's a body style's heads are, standing and sat (bodyStyle.ts headLift). */
export interface Lift {
  standing: number;
  seated: number;
}
const NO_LIFT: Lift = { standing: 0, seated: 0 };

/**
 * The sign's height: `sit` is 1 seated and 0 standing (eased in between); `talking` while a bubble shows; `lift` moves
 * it with the body style's heads.
 */
export function signHeight(sit: number, talking: boolean, lift: Lift = NO_LIFT): number {
  const base = (SIGN_HEIGHT.seated + lift.seated) * sit + (SIGN_HEIGHT.standing + lift.standing) * (1 - sit);
  return talking && base + SIGN_SIZE.h / 2 > BUBBLE.from + lift.standing ? BUBBLE.clear + lift.standing : base;
}
