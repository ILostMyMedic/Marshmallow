import { describe, expect, it } from 'vitest';
import { BRIDGE, bridgeLayout } from './bridgeLayout';
import { BRIDGE_HAZE, CITY_HAZE, EVENT_HAZE, hazeAt } from './haze';

describe('the haze', () => {
  it('leaves the near city clear and thickens with distance, up to its strength', () => {
    expect(hazeAt(CITY_HAZE, 50)).toBe(0);
    expect(hazeAt(CITY_HAZE, CITY_HAZE.near)).toBe(0);
    let last = 0;
    for (let d = 100; d <= 1000; d += 50) {
      const h = hazeAt(CITY_HAZE, d);
      expect(h).toBeGreaterThanOrEqual(last);
      last = h;
    }
    expect(hazeAt(CITY_HAZE, 2000)).toBeCloseTo(CITY_HAZE.strength);
    // downtown's skyline, a couple of hundred metres off, still reads
    expect(hazeAt(CITY_HAZE, 230)).toBeLessThan(0.45);
  });

  it('lets the red bridge show through from out in the bay, and the events more', () => {
    const towers = bridgeLayout().towers.map((z) => Math.hypot(BRIDGE.x, z));
    for (const d of towers) {
      expect(hazeAt(BRIDGE_HAZE, d)).toBeLessThan(0.55);
      expect(hazeAt(BRIDGE_HAZE, d)).toBeLessThan(hazeAt(CITY_HAZE, d));
    }
    expect(hazeAt(EVENT_HAZE, 400)).toBeLessThan(hazeAt(BRIDGE_HAZE, 400));
  });
});
