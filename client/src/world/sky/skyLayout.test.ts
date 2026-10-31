// Adapted from cubefarm client/src/world/sky/skyLayout.test.ts (MIT): the stars.
import { describe, expect, it } from 'vitest';
import { starField } from './skyLayout';

describe('starField', () => {
  it('puts unit-length stars all round the sky, with sizes and phases', () => {
    const { positions, sizes, phases } = starField(500);
    expect(positions).toHaveLength(1500);
    let up = 0;
    for (let i = 0; i < 500; i++) {
      expect(Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])).toBeCloseTo(1, 5);
      if (positions[i * 3 + 1] > 0) up++;
      expect(sizes[i]).toBeGreaterThan(0);
      expect(phases[i]).toBeGreaterThanOrEqual(0);
    }
    expect(up).toBeGreaterThan(200);
    expect(up).toBeLessThan(300);
    expect(starField(500).positions).toEqual(positions);
  });
});
