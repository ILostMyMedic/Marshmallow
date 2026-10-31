// Adapted from cubefarm client/src/world/sky/time.test.ts (MIT): the clock's cases.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { useStore } from '../store';
import { AFTERNOON_T, CYCLE_MS, dayPhase, nightFactor, parseDaytimeParam, parseDayMode, sampleDayTime, dayTime, SUNRISE_T, SUNSET_T } from './dayTime';

const MIN = 60_000;
/** Real minutes of the 30-minute cycle spent with t inside [from, to). */
function cycleMinutes(pred: (t: number) => boolean): number {
  let n = 0;
  const steps = 18_000; // one sample every 0.1 s
  for (let i = 0; i < steps; i++) if (pred(dayPhase((i / steps) * CYCLE_MS, 'cycle'))) n++;
  return (n / steps) * 30;
}

describe('dayPhase', () => {
  it("runs a whole day every 30 minutes in 'cycle' mode, always forward", () => {
    expect(dayPhase(0, 'cycle')).toBe(0);
    expect(dayPhase(CYCLE_MS, 'cycle')).toBe(0);
    expect(dayPhase(5 * CYCLE_MS + 10 * MIN, 'cycle')).toBeCloseTo(dayPhase(10 * MIN, 'cycle'), 9);
    let prev = -1;
    for (let ms = 0; ms < CYCLE_MS; ms += 1000) {
      const t = dayPhase(ms, 'cycle');
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(1);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });

  it('keeps night to about a quarter of the cycle and golden hour to about 2 minutes', () => {
    expect(cycleMinutes((t) => nightFactor(t) >= 0.5)).toBeLessThanOrEqual(7.5);
    expect(cycleMinutes((t) => t >= 0.7 && t < 0.76)).toBeCloseTo(2, 1);
  });

  it("follows the viewer's local time in 'clock' mode", () => {
    expect(dayPhase(new Date(2026, 5, 10, 0, 0, 0).getTime(), 'clock')).toBe(0);
    expect(dayPhase(new Date(2026, 5, 10, 6, 0, 0).getTime(), 'clock')).toBeCloseTo(SUNRISE_T, 9);
    expect(dayPhase(new Date(2026, 5, 10, 12, 0, 0).getTime(), 'clock')).toBeCloseTo(0.5, 9);
    expect(dayPhase(new Date(2026, 5, 10, 18, 0, 0).getTime(), 'clock')).toBeCloseTo(SUNSET_T, 9);
    expect(dayPhase(new Date(2026, 5, 10, 23, 59, 59).getTime(), 'clock')).toBeLessThan(1);
  });

  it("is always mid-afternoon in 'day' mode", () => {
    for (const now of [0, 123_456, Date.now()]) expect(dayPhase(now, 'day')).toBe(AFTERNOON_T);
  });
});

describe('nightFactor', () => {
  it('is 0 by day and 1 at night', () => {
    for (const t of [0.3, 0.5, AFTERNOON_T, 0.72]) expect(nightFactor(t)).toBe(0);
    for (const t of [0, 0.1, 0.19, 0.81, 0.95]) expect(nightFactor(t)).toBe(1);
  });

  it('rises steadily through dusk and falls steadily through dawn', () => {
    let prev = nightFactor(0.7);
    for (let t = 0.7; t <= 0.85; t += 0.001) {
      const n = nightFactor(t);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    expect(prev).toBe(1);
    for (let t = 0.15; t <= 0.3; t += 0.001) {
      const n = nightFactor(t);
      expect(n).toBeLessThanOrEqual(prev);
      prev = n;
    }
    expect(prev).toBe(0);
  });
});

describe('the live clock', () => {
  it("starts in the office's default, the 30-minute day, and follows it, unless frozen", () => {
    expect(dayTime.mode).toBe('cycle');
    expect(sampleDayTime(10 * MIN)).toBe(dayPhase(10 * MIN, 'cycle'));
    dayTime.frozen = 0.3;
    expect(sampleDayTime(10 * MIN)).toBe(0.3);
    dayTime.frozen = null;
  });

  it("follows the office's mode as the manager changes it", () => {
    useStore.getState().apply({ type: 'settings', settings: { ...DEFAULT_SETTINGS, dayMode: 'day' } });
    expect(dayTime.mode).toBe('day');
    expect(sampleDayTime(10 * MIN)).toBe(AFTERNOON_T);
    useStore.getState().apply({ type: 'settings', settings: DEFAULT_SETTINGS });
    expect(dayTime.mode).toBe('cycle');
  });
});

describe('parseDaytimeParam', () => {
  it('reads ?daytime as a frozen phase', () => {
    expect(parseDaytimeParam('?daytime=0.73')).toBe(0.73);
    expect(parseDaytimeParam('?floor=2&daytime=0')).toBe(0);
    expect(parseDaytimeParam('daytime=.5')).toBe(0.5);
    expect(parseDaytimeParam('?daytime=1')).toBe(0);
  });

  it('ignores a missing, empty or nonsense value', () => {
    for (const s of ['', '?', '?floor=2', '?daytime=', '?daytime=noon', '?daytime=-0.1', '?daytime=1.5', '?daytime=NaN', '?daytime=Infinity'])
      expect(parseDaytimeParam(s), s).toBeNull();
  });
});

describe('parseDayMode', () => {
  it('keeps a known mode and falls back to the 30-minute day', () => {
    expect(parseDayMode('clock')).toBe('clock');
    expect(parseDayMode('day')).toBe('day');
    expect(parseDayMode('cycle')).toBe('cycle');
    for (const raw of [null, undefined, '', 'night', 3]) expect(parseDayMode(raw)).toBe('cycle');
  });
});
