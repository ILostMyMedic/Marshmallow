import { describe, expect, it } from 'vitest';
import { seasonOf } from '../../../../shared/seasons';
import { collide, HALF_D, lobbyColliders, PLAYER_RADIUS, RECEPTION_CHAIR, SPAWN, type Rect } from '../layout';
import { segmentClear, type Pt } from '../nav';
import { CALL_SPOTS, findRoofPath, LIFT, LOOKOUTS, lookoutStand, ROOF_SEATS, roofColliders } from '../roof/roofLayout';
import { findPath, walkways, WALK_R } from '../walkways';
import { balconyLights, balconySnow, DOOR_PUMPKINS, foliageColor, parapetLights, POOL, roofSnow, seasonColliders, SNOWMAN, UMBRELLA, XMAS_TREE } from './seasonLayout';

const ALL = { christmas: true, pumpkins: true, snowCover: 1, summer: true };
const NONE = { christmas: false, pumpkins: false, snowCover: 0, summer: false };
const overlap = (a: Rect, b: Rect) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const near = (p: Pt, rects: Rect[], r: number) => rects.some((b) => p.x > b.minX - r && p.x < b.maxX + r && p.z > b.minZ - r && p.z < b.maxZ + r);
/** Whether a walk (waypoints after `from`) keeps a person clear of `rects`. */
const walkClear = (from: Pt, path: Pt[], rects: Rect[]) => [from, ...path].every((p, i, all) => i === 0 || segmentClear(rects, all[i - 1], p, WALK_R));

describe('what the seasons put in the way', () => {
  it('adds nothing out of season, and only what the season brings', () => {
    expect(seasonColliders('lobby', NONE)).toEqual([]);
    expect(seasonColliders('roof', NONE)).toEqual([]);
    expect(seasonColliders('office', ALL)).toEqual([]);
    expect(seasonColliders('lobby', seasonOf({ year: 2026, month: 12, day: 24 })).length).toBe(1);
    expect(seasonColliders('lobby', seasonOf({ year: 2026, month: 10, day: 31 })).length).toBe(DOOR_PUMPKINS.length);
    expect(seasonColliders('roof', seasonOf({ year: 2026, month: 1, day: 15 })).length).toBe(1);
    expect(seasonColliders('roof', seasonOf({ year: 2026, month: 7, day: 15 })).length).toBe(2);
  });

  it("keeps the lobby's tree and pumpkins off its furniture, its spawn, the guide's walks and the windows", () => {
    const mine = seasonColliders('lobby', ALL);
    const solid = lobbyColliders();
    for (const r of mine) for (const b of solid) expect(overlap(r, b), JSON.stringify([r, b])).toBe(false);
    expect(near(SPAWN, mine, PLAYER_RADIUS)).toBe(false);
    expect(collide(SPAWN.x, SPAWN.z, [...solid, ...mine])).toEqual({ x: SPAWN.x, z: SPAWN.z });
    const w = walkways('lobby');
    for (const s of w.spots) expect(near(s, mine, WALK_R), s.id).toBe(false);
    // Mia's walks: from her chair to the elevator and back, and to the spot she presents from
    const chair = { x: RECEPTION_CHAIR.x + 1.2, z: RECEPTION_CHAIR.z };
    for (const to of [{ x: 0.9, z: HALF_D - 1.2 }, { x: 1.7, z: HALF_D - 3.4 }, { x: 0, z: HALF_D - 2.2 }, ...w.spots]) {
      const path = findPath(w, chair, to);
      expect(path, `to ${JSON.stringify(to)}`).not.toBeNull();
      expect(walkClear(chair, path!, mine), `to ${JSON.stringify(to)}`).toBe(true);
    }
    // the tree stands back from the west window, so it's seen through it
    expect(XMAS_TREE.x).toBeGreaterThan(-14);
  });

  it("keeps the roof's snowman, pool and pumpkins off its furniture, seats, walks and the elevator's door", () => {
    const mine = seasonColliders('roof', ALL);
    const solid = roofColliders(true);
    for (const r of mine) for (const b of solid) expect(overlap(r, b), JSON.stringify([r, b])).toBe(false);
    for (const p of [LIFT, ...CALL_SPOTS, ...ROOF_SEATS.flatMap((s) => [s, s.front]), ...LOOKOUTS.map(lookoutStand)]) expect(near(p, mine, WALK_R), JSON.stringify(p)).toBe(false);
    for (const to of [...ROOF_SEATS.map((s) => s.front), ...CALL_SPOTS]) {
      const path = findRoofPath(LIFT, to);
      expect(path, JSON.stringify(to)).not.toBeNull();
      expect(walkClear(LIFT, path!, mine), JSON.stringify(to)).toBe(true);
    }
    // the west half north of the fire is left free (for a court)
    const court: Rect = { minX: -15, maxX: -5, minZ: -9.5, maxZ: -1.5 };
    for (const r of mine) expect(overlap(r, court)).toBe(false);
    // and the snowman, the pool and the umbrella stay in the south-west corner
    for (const p of [SNOWMAN, POOL, UMBRELLA]) {
      expect(p.x).toBeLessThan(-10);
      expect(p.z).toBeGreaterThan(7);
    }
  });
});

describe('snow and lights', () => {
  it('lies along the ledges and rails, and lights every balcony up to yours', () => {
    expect(roofSnow().length).toBeGreaterThan(10);
    for (const s of roofSnow()) for (const v of s.size) expect(v).toBeGreaterThan(0);
    // every floor's rails from the first up (the lobby's patio has none above it), and your planters
    expect(balconySnow('office', 3).length).toBe(3 * 2 + 4);
    expect(balconySnow('lobby', 0).length).toBe(4);
    expect(balconyLights(2).length).toBe(3 * balconyLights(0).length);
    expect(parapetLights().length).toBeGreaterThan(150);
  });
});

describe('the trees through the year', () => {
  it('blossoms in spring, turns in autumn and keeps the summer as it was', () => {
    const green = 0x5fa84f;
    const crowns = Array.from({ length: 40 }, (_, i) => i);
    expect(crowns.every((i) => foliageColor(green, 'green', i) === green)).toBe(true);
    expect(crowns.filter((i) => foliageColor(green, 'blossom', i) !== green).length).toBeGreaterThan(25);
    const autumn = new Set(crowns.map((i) => foliageColor(green, 'autumn', i)));
    expect(autumn.size).toBeGreaterThan(3);
    expect(autumn.has(green)).toBe(false);
  });
});
