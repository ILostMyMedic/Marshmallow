// Adapted from cubefarm client/src/world/typing.ts (MIT): the CEO types at their own floor's desk.

// The rhythm of a seated worker's hands (Character.tsx), and when it makes a sound (TypingSounds in Sounds.tsx): each
// keystroke where a hand comes down, the mouse's clicks and the wheel, where the keyboard is and who's heard. Pure: no
// three, no audio.

import type { ActivityKind, WorkerStatus } from '../../../shared/types';
import { deskPosition, deskRotation, EXEC_DESK } from './layout';

const TAU = Math.PI * 2;

export type PoseName = 'typing' | 'browsing' | 'thinking' | 'relaxed' | 'cheer' | 'slump';

/** A stable 32-bit hash of a string (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A well-mixed 0..1 value from an integer, for per-keystroke variation. */
export function hash01(n: number): number {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Each person's time offset (seconds) into the shared rhythm, so neighbours type out of step. */
export const typingSeed = (workerId: string) => (hashString(workerId) % 100000) / 1000;

/** No new log line for this long while working, and they sit back to think. */
export const THINK_AFTER_MS = 2500;

/** What a seated person is doing with their hands. `sinceLogMs`: how long ago their session last logged anything. */
export function poseFor(status: WorkerStatus, activity: ActivityKind | null, sinceLogMs: number, cheering: boolean): PoseName {
  if (status === 'preparing') return 'typing';
  if (status === 'working') {
    if (activity === 'browse') return 'browsing';
    return sinceLogMs > THINK_AFTER_MS ? 'thinking' : 'typing';
  }
  return status === 'error' ? 'slump' : cheering ? 'cheer' : 'relaxed';
}

/** Typing comes in bursts of fast taps, then a short pause to read. True during a burst. */
export const inBurst = (t: number) => Math.sin(t * 0.8) + Math.sin(t * 2.1) * 0.6 > -0.35;

/** How hard the hands tap: full in a burst, barely in a reading pause. */
export const burstLevel = (t: number) => (inBurst(t) ? 1 : 0.15);

/** Taps per radian-second: setting up (preparing) is slower. */
export const tapSpeed = (status: WorkerStatus) => (status === 'preparing' ? 10 : 19);

/** Each hand's phase in the tap cycle. */
export const TAP_PHASE = { l: 0, r: 2.4 } as const;

/** How far a hand lifts at time t (0 while resting on the keys). */
export const handLift = (t: number, speed: number, phase: number) => Math.max(0, Math.sin(t * speed + phase));

const MOUSE_RATE = 5.3;
const MOUSE_THRESHOLD = 0.93;

/** The mouse hand's little dip while it clicks. */
export const mouseDip = (t: number) => (Math.sin(t * MOUSE_RATE) > MOUSE_THRESHOLD ? 0.04 : 0);

// ---------- when it sounds ----------

/** The first time after `after` where `t * rate + phase` reaches `target` (mod 2π). */
export function nextPhase(after: number, rate: number, phase: number, target: number): number {
  const k = Math.floor((after * rate + phase - target) / TAU) + 1;
  let t = (target + k * TAU - phase) / rate;
  if (t <= after) t += TAU / rate;
  return t;
}

/** When a hand next comes down on a key: the end of its lift (sin crosses 0 going down). */
export const nextKeyDown = (after: number, speed: number, phase: number) => nextPhase(after, speed, phase, Math.PI);

/** When the mouse hand next clicks: the start of its dip. */
export const nextMouseClick = (after: number) => nextPhase(after, MOUSE_RATE, 0, Math.asin(MOUSE_THRESHOLD));

const SCROLL_RATE = 80;

/** When the mouse wheel next ticks: a quick run of notches now and then, while reading. */
export function nextScrollTick(after: number, before: number): number {
  for (let t = nextPhase(after, SCROLL_RATE, 0, 0); t <= before; t += TAU / SCROLL_RATE) {
    if (!inBurst(t) && Math.sin(t * 1.7 + 0.5) > 0.85) return t;
  }
  return Infinity;
}

export type Stroke = 'key' | 'space' | 'enter';

/** Which key a tap hits: the right hand's last tap of a burst is enter, and now and then one is the space bar. */
export function strokeAt(t: number, speed: number, hand: 0 | 1): Stroke {
  if (hand === 1 && !inBurst(t + TAU / speed)) return 'enter';
  return hash01(Math.round((t * speed) / TAU) * 2 + hand) < 0.14 ? 'space' : 'key';
}

/** A stable per-keystroke 0..1 value, for varying each key's pitch and loudness. */
export const strokeVariation = (t: number, speed: number, hand: 0 | 1) => hash01(Math.round((t * speed) / TAU) * 2 + hand + 7919);

// ---------- where the keyboard is ----------

/** The keyboard and mouse relative to a desk's origin (Keyboard in Desk.tsx). */
export const KEYBOARD_OFFSET = { x: 0, y: 0.8, z: 0.27 };
export const MOUSE_OFFSET = { x: 0.46, y: 0.8, z: 0.29 };

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Where someone's keyboard (or mouse) is on their desk: a floor's desk `slot` (the east wall's are turned to face it),
 * or the CEO's desk on their floor (turned to face the room). Writes into `out` so callers don't allocate.
 */
export function keyboardSpot(role: 'worker' | 'ceo', slot: number, mouse: boolean, out: Vec3): Vec3 {
  const ceo = role === 'ceo';
  const desk = ceo ? EXEC_DESK : deskPosition(slot);
  const rot = ceo ? Math.PI : deskRotation(slot);
  const o = mouse ? MOUSE_OFFSET : KEYBOARD_OFFSET;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // Same as three.js rotating the desk group about Y.
  out.x = desk.x + o.x * c + o.z * s;
  out.y = o.y;
  out.z = desk.z - o.x * s + o.z * c;
  return out;
}

// ---------- who gets heard ----------

/**
 * The `k` smallest of `dist[0..count)`, nearest first, as indices into `out` (no allocation).
 * Returns how many were picked.
 */
export function nearestK(dist: ArrayLike<number>, count: number, k: number, out: Int32Array): number {
  let n = 0;
  for (let i = 0; i < count; i++) {
    const d = dist[i];
    if (n < k) n++;
    else if (d >= dist[out[n - 1]]) continue;
    let j = n - 1;
    while (j > 0 && dist[out[j - 1]] > d) {
      out[j] = out[j - 1];
      j--;
    }
    out[j] = i;
  }
  return n;
}

/**
 * Seat the chosen ids in a fixed set of slots, keeping anyone already seated where they are (so their
 * sound doesn't jump to another channel), and clearing slots whose person wasn't chosen.
 */
export function assignSlots(slots: (string | null)[], chosen: readonly string[], count: number) {
  for (let s = 0; s < slots.length; s++) {
    const id = slots[s];
    if (id === null) continue;
    let keep = false;
    for (let i = 0; i < count; i++) if (chosen[i] === id) keep = true;
    if (!keep) slots[s] = null;
  }
  for (let i = 0; i < count; i++) {
    if (slots.includes(chosen[i])) continue;
    const free = slots.indexOf(null);
    if (free >= 0) slots[free] = chosen[i];
  }
}
