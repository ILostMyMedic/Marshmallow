// The office's two body styles (Settings.bodyStyle): the character lab's chibi and stylized human (lab/designs.ts).
// What the rest of the game needs to know about them without building one: how tall they stand and sit, where the
// head is, where your eyes are when you walk the floor in that style. Pure; bodyStyle.test.ts checks the numbers
// against the designs' own proportions.
import { BODY_STYLES, DEFAULT_SETTINGS, type BodyStyle } from '../../../shared/types';

export { BODY_STYLES, type BodyStyle };
export const DEFAULT_BODY_STYLE: BodyStyle = DEFAULT_SETTINGS.bodyStyle;

/**
 * A style's build at look height 1 (metres): the pelvis joint standing, the pelvis joint to the middle of the head (it
 * scales with the look's height), the head's radius (scales too) and the pelvis joint above a seat when sat down.
 */
export interface StyleBuild {
  hips: number;
  upper: number;
  headR: number;
  seat: number;
  /** The game's head is drawn this much bigger than a radius-0.2 head (scales with height). */
  headScale: number;
}

export const STYLE_BUILD: Record<BodyStyle, StyleBuild> = {
  human: { hips: 0.955, upper: 0.76, headR: 0.176, seat: 0.08, headScale: 0.88 },
  chibi: { hips: 0.42, upper: 0.55, headR: 0.32, seat: 0.06, headScale: 1.6 },
};

/** What the setup, the console and the debug page call each style. */
export const STYLE_NAMES: Record<BodyStyle, string> = { chibi: 'Chibi', human: 'Stylized human' };
export const STYLE_BLURBS: Record<BodyStyle, string> = {
  chibi: 'A big head on a small round body, with short stubby limbs.',
  human: 'Slim and tall, with a sculpted torso, hands and trainers.',
};

/** The seat of a desk chair (Desk.tsx), the height everyone sits at unless told otherwise. */
export const DESK_SEAT = 0.48;

export const parseBodyStyle = (raw: unknown): BodyStyle => (BODY_STYLES.includes(raw as BodyStyle) ? (raw as BodyStyle) : DEFAULT_BODY_STYLE);

/** The middle of the head for a look `height` tall: standing, or sat on a seat `seatY` high. */
export function headMiddle(style: BodyStyle, height: number, seatY?: number) {
  const b = STYLE_BUILD[style];
  return (seatY === undefined ? b.hips : seatY + b.seat) + b.upper * height;
}

/** The top of the head (hair aside), standing or sat. */
export const headTop = (style: BodyStyle, height: number, seatY?: number) => headMiddle(style, height, seatY) + STYLE_BUILD[style].headR * height;

/** The tallest look (appearance.ts heights run 0.9 to 1.1). */
export const TALLEST = 1.1;

/** The old figure's tallest head top standing and sat (the heights its signs and bubbles were placed for). */
const OLD_TOP = { standing: 1.761, seated: 1.446 };

/**
 * How much higher than the old figure's this style's tallest head is, standing and sat: the activity sign and speech
 * bubbles over heads (activitySign.ts) move by as much.
 */
export function headLift(style: BodyStyle) {
  return { standing: headTop(style, TALLEST) - OLD_TOP.standing, seated: headTop(style, TALLEST, DESK_SEAT) - OLD_TOP.seated };
}

/** headLift for each style, worked out once. */
export const HEAD_LIFT: Record<BodyStyle, { standing: number; seated: number }> = { human: headLift('human'), chibi: headLift('chibi') };

/** The eyes sit this far above the head's middle, as a share of its radius (characterParts.ts EYE.y over 0.2). */
const EYES_UP = 0.1;

/** Where your eyes are walking the floor in this style (the first-person camera): the old height for the human. */
export const EYE_HEIGHTS: Record<BodyStyle, number> = { human: 1.65, chibi: 1.05 };

/** Following behind you (third person), the camera looks past this high (just over your head). */
export const BEHIND_HEAD: Record<BodyStyle, number> = { human: 1.55, chibi: 1.15 };

/** How much bigger than life your own figure is drawn, so its eyes are where the camera is. */
export function playerScale(style: BodyStyle, height: number) {
  const b = STYLE_BUILD[style];
  return EYE_HEIGHTS[style] / (headMiddle(style, height) + b.headR * height * EYES_UP);
}

/** Your eyes over the seat sitting up (seats.ts seatedEye), your figure drawn at its playerScale. */
export const SEATED_EYES: Record<BodyStyle, number> = Object.fromEntries(
  BODY_STYLES.map((s) => {
    const b = STYLE_BUILD[s];
    return [s, +((b.seat + b.upper + b.headR * EYES_UP) * playerScale(s, 1)).toFixed(3)];
  }),
) as Record<BodyStyle, number>;

/** About where someone's head is, sat (`sit` 1) or standing (0), for their voice and for aiming at them. */
export const headY = (style: BodyStyle, sit: number) => headMiddle(style, 1, DESK_SEAT) * sit + headMiddle(style, 1) * (1 - sit);
