// Adapted from cubefarm client/src/world/sky/time.ts (MIT): the clock's phase and the night, moved here from the game's
// dayTime.ts so the office (server/db/world.ts) and every tab read the same time of day: the night-only world events
// (the northern lights, fireworks) start only while it's night for everyone.

// The office's time of day as a phase t in [0, 1): 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. Pure. The
// mode is the office's setting (Settings.dayMode): a whole day every 30 minutes, the local clock (the office and its tabs
// share this machine's), or always mid-afternoon.
import type { DayMode } from './types.ts';

export const CYCLE_MS = 30 * 60_000;
/** The phase in 'day' mode: mid-afternoon. */
export const AFTERNOON_T = 0.6;
export const SUNRISE_T = 0.25;
export const SUNSET_T = 0.75;

/**
 * The 30-minute day as [minute, t] knots, linear between them: night races by (about a quarter of the
 * cycle), dawn and blue hour get a minute or two each and golden hour (t 0.70–0.76) exactly two.
 */
const CYCLE_KNOTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [2.75, 0.2], // night, midnight to first light
  [4.75, 0.28], // dawn
  [23.75, 0.7], // day
  [25.75, 0.76], // golden hour
  [27.25, 0.8], // blue hour
  [30, 1], // night, to midnight
];

const frac = (x: number) => x - Math.floor(x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/** Where in the 30-minute day `ms` (0 ≤ ms < CYCLE_MS) falls. */
function cyclePhase(ms: number): number {
  const minute = ms / 60_000;
  for (let i = 1; i < CYCLE_KNOTS.length; i++) {
    const [m1, t1] = CYCLE_KNOTS[i];
    if (minute <= m1) {
      const [m0, t0] = CYCLE_KNOTS[i - 1];
      return t0 + ((minute - m0) / (m1 - m0)) * (t1 - t0);
    }
  }
  return 0;
}

/** The phase of the day at `nowMs` (epoch milliseconds) in [0, 1). */
export function dayPhase(nowMs: number, mode: DayMode): number {
  if (mode === 'day') return AFTERNOON_T;
  if (mode === 'clock') {
    const d = new Date(nowMs);
    const s = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
    return frac(s / 86_400);
  }
  return frac(cyclePhase(((nowMs % CYCLE_MS) + CYCLE_MS) % CYCLE_MS));
}

/** 0 by day, 1 at night, easing through dusk (t 0.74–0.80) and dawn (0.20–0.26). */
export function nightFactor(t: number): number {
  return smoothstep(0.24, 0.3, Math.abs(frac(t) - 0.5));
}

/**
 * Whether it's night at `nowMs` and still will be `seconds` later: a night-only event started now isn't cut short by
 * the dawn (in the 30-minute day the night lasts about five and a half minutes).
 */
export function nightFor(nowMs: number, mode: DayMode, seconds: number): boolean {
  return nightFactor(dayPhase(nowMs, mode)) > 0.95 && nightFactor(dayPhase(nowMs + seconds * 1000, mode)) > 0.6;
}
