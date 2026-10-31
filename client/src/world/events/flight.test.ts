import { describe, expect, it } from 'vitest';
import { theCity, type CityLayout } from '../cityLayout';
import { along, ceilingWithin, clearStretch, flightProfile } from './flight';

const tower = { x: 0, z: 0, y: 0, w: 20, h: 100, d: 20, color: 0, lit: 0, pattern: 0 };
const one: CityLayout = { buildings: [tower], boxes: [], cylinders: [], cones: [], streetsX: [], streetsZ: [], parks: [], extentX: 0, extentZ: 0 };
const path = { x0: 0, z0: -300, x1: 0, z1: 300 };

describe('flying over the city', () => {
  it('keeps to the height it wants over open ground', () => {
    const p = flightProfile(one, { x0: 200, z0: -300, x1: 200, z1: 300 }, { base: 40, margin: 10, pad: 10 });
    expect([...p].every((y) => y === 40)).toBe(true);
  });

  it('clears a tower in the way by its margin, climbing to it and easing down after', () => {
    const p = flightProfile(one, path, { base: 40, margin: 10, pad: 10, samples: 61, slope: 0.3 });
    expect(along(p, 0.5)).toBeGreaterThanOrEqual(110);
    expect(p[0]).toBe(40);
    expect(p[60]).toBe(40);
    const step = (0.3 * 600) / 60;
    for (let i = 1; i < p.length; i++) expect(Math.abs(p[i] - p[i - 1])).toBeLessThanOrEqual(step + 1e-4);
    // already up to it before it gets there
    const before = Math.round((300 - 10 - 10) / 10); // the sample just short of the tower's reach
    expect(p[before]).toBeGreaterThan(100);
  });

  it('reads between samples', () => {
    const p = new Float32Array([0, 10, 30]);
    expect(along(p, 0)).toBe(0);
    expect(along(p, 0.25)).toBeCloseTo(5);
    expect(along(p, 1)).toBe(30);
    expect(along(p, 2)).toBe(30);
  });

  it('finds the tallest roof round a circle', () => {
    expect(ceilingWithin(one, 25, 0, 20)).toBe(100);
    expect(ceilingWithin(one, 60, 0, 20)).toBe(0);
  });

  it('finds the stretch of a crossing in front of the towers, or the whole of it when there is none worth having', () => {
    const north = { ...one, buildings: [{ ...tower, z: -150 }] };
    const [a, b] = clearStretch(north, 0, 200, 50, 10);
    expect(a).toBeGreaterThan(-150 + 10);
    expect(b).toBe(200);
    // one in the middle: the longer side of it
    const [c, d] = clearStretch(one, 0, 200, 50, 10);
    expect(d - c).toBeGreaterThanOrEqual(170);
    expect(c >= 20 || d <= -20).toBe(true);
    // towers all along leave no stretch worth having: the whole crossing (the profile climbs over them)
    const row = { ...one, buildings: [-100, 0, 100].map((z) => ({ ...tower, z })) };
    expect(clearStretch(row, 0, 200, 50, 10)).toEqual([-200, 200]);
    expect(clearStretch(one, 100, 200, 50, 10)).toEqual([-200, 200]); // nothing in the way
  });

  it("flies the slow ones low past the east windows, in front of downtown's towers rather than over them", () => {
    const city = theCity();
    for (const x of [95, 115, 130, 145]) {
      const base = 20;
      const [a, b] = clearStretch(city, x, 200, base + 15, 16);
      expect(b - a).toBeGreaterThan(120);
      const p = flightProfile(city, { x0: x, z0: a, x1: x, z1: b }, { base, margin: 14, pad: 16 });
      expect(Math.max(...p)).toBeLessThan(base + 50);
    }
  });

  it('keeps every path an event flies over the real city clear of its roofs', () => {
    const city = theCity();
    const solids = [...city.buildings, ...city.boxes, ...city.cylinders, ...city.cones];
    for (const x of [-140, -105, 105, 140, 170, 300]) {
      const p = flightProfile(city, { x0: x, z0: -240, x1: x, z1: 240 }, { base: 20, margin: 12, pad: 14 });
      for (let i = 0; i < p.length; i++) {
        const z = -240 + (480 * i) / (p.length - 1);
        for (const c of solids) if (Math.abs(x - c.x) <= c.w / 2 && Math.abs(z - c.z) <= c.d / 2) expect(p[i]).toBeGreaterThan(c.y + c.h);
      }
    }
  });
});
