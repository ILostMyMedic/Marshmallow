// Adapted from cubefarm client/src/world/sky/time.test.ts (MIT): the sun and the palette.
import { describe, expect, it } from 'vitest';
import { AFTERNOON_T, SUNRISE_T, SUNSET_T } from '../dayTime';
import { skyAt, sunDirection, type SkyPalette } from './palette';

describe('sunDirection', () => {
  const len = ([x, y, z]: number[]) => Math.hypot(x, y, z);

  it('is a unit vector', () => {
    for (let t = 0; t < 1; t += 0.05) expect(len(sunDirection(t))).toBeCloseTo(1, 9);
  });

  it('rises in the east at sunrise, is high and to the south at noon and sets in the west at sunset', () => {
    const [rx, ry] = sunDirection(SUNRISE_T);
    expect(rx).toBeCloseTo(1, 9);
    expect(ry).toBeCloseTo(0, 9);
    const [nx, ny, nz] = sunDirection(0.5);
    expect(nx).toBeCloseTo(0, 9);
    expect(ny).toBeGreaterThan(0.8);
    expect(nz).toBeGreaterThan(0);
    const [sx, sy] = sunDirection(SUNSET_T);
    expect(sx).toBeCloseTo(-1, 9);
    expect(sy).toBeCloseTo(0, 9);
  });

  it('is above the horizon by day and below it at night', () => {
    for (const t of [0.3, 0.5, AFTERNOON_T, 0.7]) expect(sunDirection(t)[1]).toBeGreaterThan(0);
    for (const t of [0, 0.1, 0.2, 0.8, 0.9, 0.99]) expect(sunDirection(t)[1]).toBeLessThan(0);
  });
});

describe('skyAt', () => {
  const channels = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
  const COLORS = ['zenith', 'horizon', 'fog', 'sunColor', 'hemiSky', 'hemiGround'] as const;
  const NUMBERS = ['sunIntensity', 'ambient', 'exposure', 'starsOpacity', 'cityLights'] as const;

  /** The biggest change of any colour channel (0-255) or number between two palettes. */
  function jump(a: SkyPalette, b: SkyPalette): { color: number; value: number } {
    let color = 0;
    let value = 0;
    for (const k of COLORS) {
      const [x, y] = [channels(a[k]), channels(b[k])];
      for (let i = 0; i < 3; i++) color = Math.max(color, Math.abs(x[i] - y[i]));
    }
    for (const k of NUMBERS) value = Math.max(value, Math.abs(a[k] - b[k]));
    return { color, value };
  }

  it('changes smoothly through the whole day, midnight included (no jumps between key moments)', () => {
    const step = 0.0001;
    for (let t = 0; t < 1; t += step) {
      const j = jump(skyAt(t), skyAt(t + step));
      expect(j.color, `colour jump at t=${t}`).toBeLessThanOrEqual(3);
      expect(j.value, `value jump at t=${t}`).toBeLessThan(0.02);
    }
  });

  it('matches the office as it looked before the clock in the afternoon', () => {
    const p = skyAt(AFTERNOON_T);
    expect(p.horizon).toBe(0xbfe3ff);
    expect(p.fog).toBe(0xe4eef4);
    expect(p.hemiSky).toBe(0xfffaf0);
    expect(p.sunIntensity).toBe(1.55);
    expect(p.exposure).toBe(1);
  });

  it('lights the city and the stars at night, never pitch black', () => {
    const night = skyAt(0);
    expect(night.starsOpacity).toBe(1);
    expect(night.cityLights).toBe(1);
    expect(Math.max(...channels(night.zenith))).toBeGreaterThan(0x20);
    expect(night.ambient).toBeGreaterThan(0.1);
    const noon = skyAt(0.5);
    expect(noon.starsOpacity).toBe(0);
    expect(noon.cityLights).toBe(0);
  });

  it('glows warm at golden hour', () => {
    const [r, , b] = channels(skyAt(0.73).horizon);
    expect(r).toBeGreaterThan(b + 60);
  });

  it('keeps every number in range', () => {
    for (let t = 0; t < 1; t += 0.01) {
      const p = skyAt(t);
      for (const k of ['starsOpacity', 'cityLights'] as const) {
        expect(p[k]).toBeGreaterThanOrEqual(0);
        expect(p[k]).toBeLessThanOrEqual(1);
      }
      expect(p.sunIntensity).toBeGreaterThan(0);
      expect(p.exposure).toBeGreaterThan(0);
    }
  });

  it('fills the given object instead of allocating', () => {
    const out = {} as SkyPalette;
    expect(skyAt(0.4, out)).toBe(out);
  });
});
