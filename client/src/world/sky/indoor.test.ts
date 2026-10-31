// Adapted from cubefarm client/src/world/sky/indoor.test.ts (MIT): the weather's cut; the roof, the city's dimming and
// the wider shadow box are new.
import { describe, expect, it } from 'vitest';
import { BALCONY_OUT, HALF_D, WALL_H } from '../layout';
import { ROOF_HUT } from '../roof/roofLayout';
import { indoorLight, MIN_ELEVATION, newIndoorLight, outdoorTint, ROOF_LAMPS, shadowBox, type IndoorLight } from './indoor';
import { skyAt, sunDirection } from './palette';

const rgb = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
/** Roughly how much fill light reaches a character's face (hemisphere + ambient, through the exposure). */
const fill = (l: IndoorLight) => {
  const [r, g, b] = rgb(l.hemiSky);
  return ((l.hemiIntensity * (r + g + b)) / 765 + l.ambient) * l.exposure;
};
const sample = (n: number) => Array.from({ length: n }, (_, i) => i / n);

describe('indoorLight', () => {
  it('lights noon from high above with the neutral sun and the lamps off', () => {
    const l = indoorLight(0.5);
    expect(l.dir[1]).toBeGreaterThan(0.8);
    expect(l.keyIntensity).toBeCloseTo(skyAt(0.5).sunIntensity, 5);
    expect(l.keyColor).toBe(0xffffff);
    expect(l.lamps).toBe(0);
    expect(l.exposure).toBe(1);
  });

  it('keeps the afternoon as the office looked before the clock', () => {
    const l = indoorLight(0.6);
    expect(l.keyIntensity).toBeCloseTo(1.55, 5);
    expect(l.hemiSky).toBe(0xfffaf0);
    expect(l.hemiGround).toBe(0xa48a6a);
    expect(l.hemiIntensity).toBe(0.95);
    expect(l.ambient).toBeCloseTo(0.18, 5);
  });

  it('casts long, warm shadows from the west at golden hour', () => {
    const l = indoorLight(0.73);
    expect(l.dir[0]).toBeLessThan(-0.9); // the sun sets in the west (−x)
    expect(l.dir[1]).toBe(MIN_ELEVATION);
    const [r, , b] = rgb(l.keyColor);
    expect(r - b).toBeGreaterThan(80);
    expect(l.keyIntensity).toBeGreaterThan(0.8);
    expect(l.lamps).toBeLessThan(0.05);
  });

  it('swaps in a faint, cool moon at night, with the lamps on and a warm fill', () => {
    for (const t of [0.85, 0.95, 0.05]) {
      const l = indoorLight(t);
      expect(sunDirection(t)[1]).toBeLessThan(0);
      expect(l.dir[1]).toBeGreaterThanOrEqual(MIN_ELEVATION);
      expect(l.keyIntensity).toBeLessThan(0.4);
      const [kr, , kb] = rgb(l.keyColor);
      expect(kb).toBeGreaterThan(kr);
      expect(l.lamps).toBe(1);
      const [hr, , hb] = rgb(l.hemiSky);
      expect(hr).toBeGreaterThan(hb);
      expect(l.ambient).toBeGreaterThan(indoorLight(0.5).ambient);
    }
  });

  it('switches the lamps on through dusk and off through dawn', () => {
    let prev = 0;
    for (let t = 0.7; t <= 0.85; t += 0.001) {
      const l = indoorLight(t).lamps;
      expect(l).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = l;
    }
    expect(indoorLight(0.76).lamps).toBeGreaterThan(0.2);
    expect(indoorLight(0.3).lamps).toBe(0);
  });

  it('is never too dark to play', () => {
    const noon = fill(indoorLight(0.5));
    for (const t of sample(400)) expect(fill(indoorLight(t))).toBeGreaterThan(noon * 0.75);
  });

  it('keeps the key a unit vector at least MIN_ELEVATION up', () => {
    for (const t of sample(400)) {
      const [x, y, z] = indoorLight(t).dir;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
      expect(y).toBeGreaterThanOrEqual(MIN_ELEVATION - 1e-12);
    }
  });

  it('changes smoothly, and the sun hands over to the moon only while the key is dark', () => {
    const step = 1e-4;
    let prev = indoorLight(0);
    for (let i = 1; i <= 1 / step; i++) {
      const l = indoorLight(i * step);
      for (const k of ['keyIntensity', 'hemiIntensity', 'ambient', 'exposure', 'lamps'] as const) expect(Math.abs(l[k] - prev[k])).toBeLessThan(0.02);
      for (const k of ['keyColor', 'hemiSky', 'hemiGround', 'ambientColor'] as const) {
        const a = rgb(l[k]);
        const b = rgb(prev[k]);
        for (let c = 0; c < 3; c++) expect(Math.abs(a[c] - b[c])).toBeLessThanOrEqual(3);
      }
      const jump = Math.hypot(l.dir[0] - prev.dir[0], l.dir[1] - prev.dir[1], l.dir[2] - prev.dir[2]);
      if (jump > 0.01) expect(Math.max(l.keyIntensity, prev.keyIntensity)).toBeLessThan(0.01);
      prev = l;
    }
  });

  it('warms the roof at night less than indoors, with the lamps just as on', () => {
    const inside = indoorLight(0.95);
    const roof = indoorLight(0.95, newIndoorLight(), ROOF_LAMPS);
    expect(roof.lamps).toBe(inside.lamps);
    expect(roof.ambient).toBeLessThan(inside.ambient);
    expect(rgb(roof.hemiSky)[0]).toBeLessThan(rgb(inside.hemiSky)[0]);
    expect(indoorLight(0.5, newIndoorLight(), ROOF_LAMPS)).toEqual(indoorLight(0.5));
  });

  it('fills the given object instead of allocating', () => {
    const out = newIndoorLight();
    expect(indoorLight(0.4, out)).toBe(out);
  });
});

describe('outdoorTint', () => {
  it('leaves the city as it is by day', () => {
    for (const t of [0.35, 0.5, 0.6, 0.7]) for (const c of outdoorTint(skyAt(t), indoorLight(t))) expect(c).toBeCloseTo(1, 9);
  });

  it('dims it to a cool night outside while the lamps warm the office', () => {
    const [r, g, b] = outdoorTint(skyAt(0.95), indoorLight(0.95));
    expect(r).toBeLessThan(0.5);
    expect(g).toBeLessThan(0.7);
    expect(b).toBeGreaterThan(r);
    expect(Math.min(r, g, b)).toBeGreaterThan(0);
  });

  it('never brightens anything, at any time of day', () => {
    for (const t of sample(200)) for (const c of outdoorTint(skyAt(t), indoorLight(t))) expect(c).toBeLessThanOrEqual(1);
  });
});

describe('shadowBox', () => {
  const DIST = 40;
  /** A point's coordinates in the light camera's space (three's lookAt from dir * DIST to the origin, +y up). */
  function toLight(dir: readonly number[], p: number[]) {
    const [zx, zy, zz] = dir;
    const l = Math.hypot(zz, zx);
    const x = [zz / l, 0, -zx / l];
    const y = [zy * x[2], zz * x[0] - zx * x[2], -zy * x[0]];
    const dot = (a: number[]) => a[0] * p[0] + a[1] * p[1] + a[2] * p[2];
    return [dot(x), dot(y), DIST - dot(dir as number[])];
  }

  it('covers the floor, its balconies and the roof hut, up to the ceiling, at any time of day', () => {
    for (const t of sample(97)) {
      const { dir } = indoorLight(t);
      const b = shadowBox(dir, DIST);
      expect(b.near).toBeGreaterThan(0);
      for (const x of [-BALCONY_OUT, BALCONY_OUT])
        for (const y of [0, WALL_H])
          for (const z of [-HALF_D, ROOF_HUT.maxZ]) {
            const q = toLight(dir, [x, y, z]);
            expect(q[0]).toBeGreaterThanOrEqual(b.left);
            expect(q[0]).toBeLessThanOrEqual(b.right);
            expect(q[1]).toBeGreaterThanOrEqual(b.bottom);
            expect(q[1]).toBeLessThanOrEqual(b.top);
            expect(q[2]).toBeGreaterThanOrEqual(b.near);
            expect(q[2]).toBeLessThanOrEqual(b.far);
          }
      // tight enough to keep the shadow map sharp: never much wider than the floor and its balconies across
      expect(b.right - b.left).toBeLessThan(2 * Math.hypot(BALCONY_OUT + 0.5, HALF_D + 4) + 1);
    }
  });
});
