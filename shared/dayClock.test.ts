import { describe, expect, it } from 'vitest';
import { CYCLE_MS, dayPhase, nightFactor, nightFor } from './dayClock.ts';

const MIN = 60_000;

describe('the night, for the night-only events', () => {
  it("is night in the 30-minute day's first two minutes and its last two, with time to spare", () => {
    // midnight is minute 0; first light about 2.75 minutes in; night again from about 27.25
    expect(nightFor(0, 'cycle', 60)).toBe(true);
    expect(nightFor(28.5 * MIN, 'cycle', 60)).toBe(true);
    expect(nightFor(CYCLE_MS * 7 + 29 * MIN, 'cycle', 120)).toBe(true);
    expect(nightFor(12 * MIN, 'cycle', 60)).toBe(false);
    // not when the dawn would cut it short
    expect(nightFor(2.5 * MIN, 'cycle', 120)).toBe(false);
    // the dusk isn't night yet
    expect(nightFor(26.5 * MIN, 'cycle', 60)).toBe(false);
  });

  it("is never night in 'day' mode, and follows the local clock in 'clock' mode", () => {
    for (let m = 0; m < 30; m++) expect(nightFor(m * MIN, 'day', 30)).toBe(false);
    expect(nightFor(new Date(2026, 11, 1, 23, 0).getTime(), 'clock', 600)).toBe(true);
    expect(nightFor(new Date(2026, 11, 1, 14, 0).getTime(), 'clock', 600)).toBe(false);
  });

  it('agrees with the phase and the night factor', () => {
    for (let m = 0; m < 30; m += 0.25) {
      const night = nightFactor(dayPhase(m * MIN, 'cycle'));
      if (nightFor(m * MIN, 'cycle', 0)) expect(night).toBeGreaterThan(0.95);
    }
  });
});
