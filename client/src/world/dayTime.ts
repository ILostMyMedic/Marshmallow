// Adapted from cubefarm client/src/world/sky/time.ts and sky/useDayTime.ts (MIT): the clock. The sky's colours and the
// sun are in sky/palette.ts, DayClock and the probe in sky/DayClock.tsx; the React hooks are cut.

// The office's time of day: one clock the rituals (ritualSchedule.ts), the sky and the light (sky/) follow. A phase t
// in [0, 1): 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. Pure apart from `dayTime`, the live clock, whose
// mode is the office's setting (Settings.dayMode), the same in every tab. `?daytime=0.73` freezes the phase (QA).
import { DAY_MODES, DEFAULT_SETTINGS, type DayMode } from '../../../shared/types';
import { useStore } from '../store';

export { DAY_MODES, type DayMode };
export const DEFAULT_DAY_MODE: DayMode = DEFAULT_SETTINGS.dayMode;

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

// ---------- overrides and settings ----------

/** `?daytime=0.73` freezes the clock at that phase (for tests and QA); null when absent or not a number in [0, 1]. */
export function parseDaytimeParam(search: string): number | null {
  const raw = new URLSearchParams(search).get('daytime');
  if (raw === null || raw.trim() === '') return null;
  const t = Number(raw);
  if (!Number.isFinite(t) || t < 0 || t > 1) return null;
  return frac(t);
}

/** The office's mode, or the default when it's missing or unknown (an older server). */
export function parseDayMode(raw: unknown): DayMode {
  return DAY_MODES.includes(raw as DayMode) ? (raw as DayMode) : DEFAULT_DAY_MODE;
}

// ---------- the live clock ----------

function urlFrozen(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseDaytimeParam(window.location.search);
  } catch {
    return null;
  }
}

/** The live clock (a mutable ref): `t` is the phase as last sampled, `mode` the office's, `frozen` holds it still when set. */
export const dayTime: { t: number; mode: DayMode; frozen: number | null } = { t: 0, mode: parseDayMode(useStore.getState().settings.dayMode), frozen: urlFrozen() };

/** Moves `dayTime.t` to now (or the frozen phase) and returns it. Call it once a frame, or whenever the time is needed. */
export function sampleDayTime(now = Date.now()): number {
  dayTime.t = dayTime.frozen ?? dayPhase(now, dayTime.mode);
  return dayTime.t;
}
sampleDayTime();

// The manager picks the mode (the debug page, the console's Settings): every tab follows the office's as it changes.
let officeMode = useStore.getState().settings.dayMode;
useStore.subscribe((s) => {
  if (s.settings.dayMode === officeMode) return;
  officeMode = s.settings.dayMode;
  dayTime.mode = parseDayMode(officeMode);
  sampleDayTime();
});
