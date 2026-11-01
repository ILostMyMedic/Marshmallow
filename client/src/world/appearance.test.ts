// Adapted from cubefarm client/src/world/appearance.test.ts (MIT): the seeded look from a worker's seed, and the
// character parts.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HAIR_STYLES, OUTFITS } from './looks';
import { ACCENTS, BUILD_SHAPE, TALL_HAIR, seededAppearance, type Appearance } from './appearance';
import { hairUnder, HATS, PARTS } from './characterParts';
import { EYES, MORPHS, MORPH_AT, MOUTH } from './face';

const seeds = Array.from({ length: 800 }, (_, i) => (i * 2654435761) % 2 ** 31);
const all = (role: 'worker' | 'ceo' = 'worker') => seeds.map((seed) => seededAppearance({ seed, role }));
const of = (look: Appearance['look']) => all().filter((a) => a.look === look);

describe('seededAppearance', () => {
  it('is the same for the same seed', () => {
    expect(seededAppearance({ seed: 123456, role: 'worker' })).toEqual(seededAppearance({ seed: 123456, role: 'worker' }));
  });

  it('keeps the body within ±10% height and ±5% shoulders, over three builds', () => {
    const builds = new Set<string>();
    for (const a of all()) {
      expect(a.height).toBeGreaterThanOrEqual(0.9);
      expect(a.height).toBeLessThanOrEqual(1.1);
      expect(a.shoulders).toBeGreaterThanOrEqual(0.95);
      expect(a.shoulders).toBeLessThanOrEqual(1.05);
      expect(a.accent).toBeGreaterThanOrEqual(0);
      expect(a.accent).toBeLessThan(ACCENTS.length);
      builds.add(a.build);
    }
    expect([...builds].sort()).toEqual(['average', 'broad', 'slim']);
    expect(BUILD_SHAPE.slim.width).toBeLessThan(BUILD_SHAPE.average.width);
    expect(BUILD_SHAPE.broad.width).toBeGreaterThan(BUILD_SHAPE.average.width);
  });

  it('uses both looks, every hairstyle, facial hair, glasses, hat, outfit and colour', () => {
    const m = of('masculine');
    const f = of('feminine');
    expect(m.length).toBeGreaterThan(seeds.length * 0.4);
    expect(f.length).toBeGreaterThan(seeds.length * 0.4);
    const seen = (key: keyof Appearance, list: Appearance[]) => new Set(list.map((a) => String(a[key])));
    expect(seen('hair', m).size).toBe(HAIR_STYLES.length);
    expect([...seen('hair', f)].sort()).toEqual(['afro', 'bob', 'bun', 'buzz', 'curls', 'locs', 'long', 'mohawk', 'ponytail', 'sidePart']);
    expect(seen('facialHair', m)).toEqual(new Set(['none', 'stubble', 'beard', 'moustache']));
    expect(seen('glasses', m)).toEqual(new Set(['none', 'round', 'square']));
    expect(seen('headwear', m)).toEqual(new Set(['none', 'beanie', 'cap']));
    expect(seen('outfit', f)).toEqual(new Set(OUTFITS));
    expect(seen('headphones', f)).toEqual(new Set(['true', 'false']));
    expect(seen('shirt', all()).size).toBeGreaterThan(8);
    expect(seen('skin', all()).size).toBeGreaterThan(6);
    expect(seen('hairColor', all()).size).toBeGreaterThan(8);
  });

  it('makes neighbours look different', () => {
    const key = (a: Appearance) => [a.look, a.hair, a.facialHair, a.glasses, a.headphones, a.headwear, a.outfit, a.shirt].join();
    const looks = all().map(key);
    expect(new Set(looks).size).toBeGreaterThan(looks.length / 2);
    const same = looks.filter((k, i) => i > 0 && k === looks[i - 1]).length;
    expect(same).toBeLessThan(looks.length * 0.05);
  });

  it('never stacks things on the head that would clip', () => {
    for (const a of all()) {
      if (a.headphones) expect(a.headwear).toBe('none');
      if (a.headphones) expect(['afro', 'mohawk']).not.toContain(a.hair);
      if (a.headwear !== 'none') expect(TALL_HAIR).not.toContain(a.hair);
    }
  });

  it('gives feminine looks no facial hair', () => {
    for (const a of of('feminine')) expect(a.facialHair).toBe('none');
  });

  it('keeps the CEO in their suit, bare-headed; glasses are for anyone', () => {
    const ceo = all('ceo');
    for (const a of ceo) expect(a).toMatchObject({ headphones: false, headwear: 'none', outfit: 'tee' });
    expect(new Set(ceo.map((a) => a.glasses))).toEqual(new Set(['none', 'round', 'square']));
  });
});

describe('character parts', () => {
  it('builds every shared geometry with finite positions', () => {
    const isGeo = (v: unknown): v is THREE.BufferGeometry => v instanceof THREE.BufferGeometry;
    const geos = [
      ...Object.values(PARTS).filter(isGeo),
      ...Object.values(PARTS.hair),
      ...Object.values(PARTS.facialHair),
      ...Object.values(PARTS.glasses),
      ...Object.values(PARTS.headwear),
      ...Object.values(PARTS.outfit).flatMap((o) => [o.main, o.trim]),
      ...Object.values(PARTS.blazer),
      ...Object.values(PARTS.lanyard),
      PARTS.headphones.shell,
      PARTS.headphones.covers,
    ].filter((g) => g !== null);
    expect(geos.length).toBeGreaterThan(50);
    for (const g of geos) {
      const pos = g.attributes.position;
      expect(pos.count).toBeGreaterThan(0);
      expect(g.attributes.normal.count).toBe(pos.count);
      for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
    }
  });

  it('gives the face one morph target per face.ts slot, each moving only its own part', () => {
    for (const g of [PARTS.face, PARTS.faceLashes]) {
      const base = g.attributes.position;
      const targets = g.morphAttributes.position ?? [];
      expect(targets).toHaveLength(MORPHS);
      const moved = targets.map((t) => {
        expect(t.count).toBe(base.count);
        const which: number[] = [];
        for (let i = 0; i < t.count; i++) {
          expect(Number.isFinite(t.getX(i) + t.getY(i) + t.getZ(i))).toBe(true);
          if (Math.hypot(t.getX(i) - base.getX(i), t.getY(i) - base.getY(i), t.getZ(i) - base.getZ(i)) > 1e-6) which.push(i);
        }
        return which;
      });
      // every target moves something, and the eyes', brows' and mouth's targets move different vertices
      for (const w of moved) expect(w.length).toBeGreaterThan(0);
      const range = (from: number, to: number) => new Set(moved.slice(from, to).flat());
      const eyes = range(MORPH_AT.eyes, MORPH_AT.brows);
      const brows = range(MORPH_AT.brows, MORPH_AT.mouth);
      const mouth = range(MORPH_AT.mouth, MORPHS);
      for (const v of eyes) expect(brows.has(v) || mouth.has(v)).toBe(false);
      for (const v of brows) expect(mouth.has(v)).toBe(false);
    }
  });

  it('closes the eyes to a thin line and keeps the mouth on the face', () => {
    const g = PARTS.face;
    const base = g.attributes.position;
    const closed = g.morphAttributes.position![MORPH_AT.eyes + EYES.closed];
    const eyeHeight = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < a.count; i++) {
        if (Math.abs(base.getY(i) - 0.02) > 0.035 || base.getZ(i) > -0.14) continue; // the eyes, at rest
        lo = Math.min(lo, a.getY(i));
        hi = Math.max(hi, a.getY(i));
      }
      return hi - lo;
    };
    expect(eyeHeight(closed)).toBeLessThan(eyeHeight(base) * 0.6);
    const open = g.morphAttributes.position![MORPH_AT.mouth + MOUTH.open];
    let mouthVerts = 0;
    for (let i = 0; i < base.count; i++) {
      if (base.getY(i) > -0.06) continue; // only the mouth sits this low
      mouthVerts++;
      for (const a of [base, open]) {
        expect(Math.hypot(a.getX(i), a.getY(i), a.getZ(i))).toBeCloseTo(0.2045, 3); // on the head, just proud of it
        expect(a.getZ(i)).toBeLessThan(-0.15); // on the front
      }
    }
    expect(mouthVerts).toBe(30);
  });

  it('tucks the hair under a hat instead of through it', () => {
    const v = new THREE.Vector3();
    /** How many of g's vertices sit under the hat's crown but stand out through it (closer than `gap` to it, or past it). */
    const through = (g: THREE.BufferGeometry, hat: keyof typeof HATS, gap: number) => {
      const { r, t, at, tip } = HATS[hat];
      const toHat = new THREE.Matrix4().makeRotationX(-tip).multiply(new THREE.Matrix4().makeTranslation(-at[0], -at[1], -at[2]));
      const p = g.attributes.position;
      let n = 0;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(toHat);
        if (Math.acos(v.y / v.length()) < t && v.length() > r - gap) n++;
      }
      return n;
    };
    // the side part's swoop stood out through a cap before it was tucked
    expect(through(PARTS.hair.sidePart!, 'cap', 0)).toBeGreaterThan(0);
    for (const hat of ['beanie', 'cap'] as const) {
      for (const style of HAIR_STYLES.filter((s) => !TALL_HAIR.includes(s))) {
        const g = hairUnder(hat, style);
        expect(hairUnder(hat, style)).toBe(g); // made once and shared
        if (g) expect(through(g, hat, 0.01)).toBe(0);
      }
    }
    for (const style of HAIR_STYLES) expect(hairUnder('none', style)).toBe(PARTS.hair[style]);
  });

  it('leaves the mouth uncovered by beards and stubble', () => {
    // mouth centre (happy or sad) sits at about (0, -0.09, -0.19) in head space
    for (const g of [PARTS.facialHair.beard, PARTS.facialHair.stubble]) {
      const p = g!.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const near = Math.abs(p.getX(i)) < 0.03 && Math.abs(p.getY(i) + 0.09) < 0.02 && p.getZ(i) < -0.15;
        expect(near).toBe(false);
      }
    }
  });
});
