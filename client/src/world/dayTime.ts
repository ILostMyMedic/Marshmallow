// Adapted from cubefarm client/src/world/sky/time.ts and sky/useDayTime.ts (MIT): the clock. The sky's colours and the
// sun are in sky/palette.ts, DayClock and the probe in sky/DayClock.tsx; the React hooks are cut.

// The office's time of day: one clock the rituals (ritualSchedule.ts), the sky and the light (sky/) follow. A phase t
// in [0, 1): 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. The pure clock is shared/dayClock.ts's (the office
// reads it too, for the night-only world events); here is `dayTime`, the live clock, whose mode is the office's setting
// (Settings.dayMode), the same in every tab. `?daytime=0.73` freezes the phase (QA).
import { dayPhase } from '../../../shared/dayClock';
import { DAY_MODES, DEFAULT_SETTINGS, type DayMode } from '../../../shared/types';
import { useStore } from '../store';

export { AFTERNOON_T, CYCLE_MS, dayPhase, nightFactor, SUNRISE_T, SUNSET_T } from '../../../shared/dayClock';
export { DAY_MODES, type DayMode };
export const DEFAULT_DAY_MODE: DayMode = DEFAULT_SETTINGS.dayMode;

const frac = (x: number) => x - Math.floor(x);

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
