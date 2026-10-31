// Adapted from cubefarm client/src/world/typing.ts (MIT): the hands' rhythm; the typing sounds' helpers come with the
// sounds.

// The rhythm of a seated worker's hands (Character.tsx). Pure: no three, no audio.

import type { ActivityKind, WorkerStatus } from '../../../shared/types';

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

/** The mouse hand's little dip while it clicks. */
export const mouseDip = (t: number) => (Math.sin(t * 5.3) > 0.93 ? 0.04 : 0);
