// A marshmallow on a stick at the roof's fire, as pure rules: where its tip is held, how hot it is there (full heat
// over the flames, none a stride back), how it toasts (white, golden, toasty brown, burnt, and if you keep at it, a
// little flame and then charcoal), its colour on the way, and what you say eating it. Toast is counted in seconds at
// full heat. toasting.ts runs them for what you hold; RoofPeople.tsx's toasters use them too. Pure, so it's tested.
// New in Marshmallow.
import { FIRE } from './roofLayout';

type Pt = { x: number; z: number };

/** Seconds at full heat to each stage: golden, toasty brown, burnt, and catching fire (then `flame` seconds alight). */
export const TOAST = { golden: 4, brown: 9, burnt: 14, fire: 18, flame: 2.5 };
/**
 * How far from the fire's middle the marshmallow toasts: at full heat within `full`, none past `none`. `reach` is how
 * far out in front of you it is on its stick (your hand and the stick), so from the benches round the fire it's over
 * the stones' edge.
 */
export const HEAT = { full: 0.9, none: 1.9, reach: 1.7 };

export type ToastStage = 'raw' | 'golden' | 'brown' | 'burnt' | 'charcoal';

/** Where the marshmallow is, held by someone at (x, z) facing `yaw` (body.ts's heading: 0 faces -Z). */
export const stickTip = (x: number, z: number, yaw: number, reach = HEAT.reach): Pt => ({ x: x - Math.sin(yaw) * reach, z: z - Math.cos(yaw) * reach });

/** How hot it is at `tip`: 1 over the flames, 0 out of reach of them. */
export function heatAt(tip: Pt, fire: Pt = FIRE): number {
  const d = Math.hypot(tip.x - fire.x, tip.z - fire.z);
  return Math.max(0, Math.min(1, (HEAT.none - d) / (HEAT.none - HEAT.full)));
}

export interface Toasting {
  /** Seconds at full heat so far. */
  toast: number;
  /** Seconds it's still alight (0: it isn't). */
  flame: number;
}

/**
 * `dt` seconds at `heat` (0-1): it toasts, and the moment it passes TOAST.fire it catches (`caught`), burning out
 * TOAST.flame later wherever it is by then, charcoal. A flame burning keeps toasting it whatever the heat.
 */
export function toastStep(s: Toasting, heat: number, dt: number): Toasting & { caught: boolean } {
  const burning = s.flame > 0;
  const toast = s.toast + dt * (burning ? 1 : heat);
  const caught = !burning && s.toast < TOAST.fire && toast >= TOAST.fire;
  return { toast, flame: caught ? TOAST.flame : Math.max(0, s.flame - dt), caught };
}

/** How done it is. */
export function stageOf(toast: number): ToastStage {
  if (toast < TOAST.golden) return 'raw';
  if (toast < TOAST.brown) return 'golden';
  if (toast < TOAST.burnt) return 'brown';
  if (toast < TOAST.fire) return 'burnt';
  return 'charcoal';
}

/** Its colour at each stage's start; it shades from one to the next as it toasts. */
export const TOAST_COLOURS = { raw: '#fbf6ec', golden: '#f2bf57', brown: '#a8652d', burnt: '#4a2c1c', charcoal: '#1d1613' };

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const lerpHex = (a: string, b: string, t: number) =>
  `#${hex(a)
    .map((v, i) => Math.round(v + (hex(b)[i] - v) * Math.max(0, Math.min(1, t))))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;

/** The marshmallow's colour after `toast` seconds at full heat: white, golden, toasty brown, burnt, black. */
export function toastColour(toast: number): string {
  const C = TOAST_COLOURS;
  if (toast < TOAST.golden) return lerpHex(C.raw, C.golden, toast / TOAST.golden);
  if (toast < TOAST.brown) return lerpHex(C.golden, C.brown, (toast - TOAST.golden) / (TOAST.brown - TOAST.golden));
  if (toast < TOAST.burnt) return lerpHex(C.brown, C.burnt, (toast - TOAST.brown) / (TOAST.burnt - TOAST.brown));
  return lerpHex(C.burnt, C.charcoal, (toast - TOAST.burnt) / (TOAST.fire - TOAST.burnt));
}

/** A word for how it's doing (the hint while you hold it). */
export function toastWord(toast: number, flame = 0): string {
  if (flame > 0) return 'on fire!';
  return { raw: toast < 0.5 ? 'raw' : 'warming up', golden: 'golden', brown: 'toasty', burnt: 'burnt', charcoal: 'charcoal' }[stageOf(toast)];
}

/**
 * A worker's marshmallow at the fire (`rand` in [0, 1)): how long they toast it (seconds at full heat) and the emoji
 * they eat it with. Mostly golden to toasty; now and then burnt, or forgotten till it caught fire and went out.
 */
export function workerToast(rand: number): { stop: number; say: string } {
  if (rand < 0.08) return { stop: TOAST.fire + TOAST.flame + 0.5, say: '😬' };
  if (rand < 0.2) return { stop: TOAST.burnt + 1.5, say: '😅' };
  const stop = TOAST.golden + 0.5 + ((rand - 0.2) / 0.8) * (TOAST.burnt - TOAST.golden - 1.5);
  return { stop, say: stop < TOAST.brown ? '😋' : '🤤' };
}

/** What you say eating it. */
export function eatLine(toast: number, flame = 0): string {
  if (flame > 0) return '🔥 You blow it out and eat it anyway… charcoal 😬';
  switch (stageOf(toast)) {
    case 'raw':
      return toast < 0.5 ? 'Straight from the bag: squishy 🤍' : 'Barely warm… could do with longer 🙂';
    case 'golden':
      return 'Perfectly golden 😋';
    case 'brown':
      return 'Toasty brown and gooey inside 🤤';
    case 'burnt':
      return 'A bit burnt… still good 😅';
    default:
      return 'Charcoal… 😬';
  }
}
