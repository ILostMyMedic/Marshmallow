// Adapted from cubefarm client/src/world/roof/roofWalks.test.ts (MIT): without the helipad, the grill, the telescope and
// the footsteps; with the fireplace, the lookouts and the seats.
import { describe, expect, it } from 'vitest';
import { collide, elevatorDoorway, ELEVATOR, HALF_D, HALF_W, PLAYER_RADIUS, shellColliders, SPAWN, type Rect } from '../layout';
import {
  CALL_SPOTS,
  FIRE,
  FIRE_BENCHES,
  facing,
  findRoofPath,
  LIFT,
  LOOKOUTS,
  lookoutSeat,
  lookoutStand,
  ROOF_EDGE,
  ROOF_SEATS,
  roofColliders,
  seatById,
} from './roofLayout';

const rects = roofColliders();
const overlaps = (p: { x: number; z: number }, r = PLAYER_RADIUS, among: Rect[] = rects) => among.some((b) => p.x > b.minX - r && p.x < b.maxX + r && p.z > b.minZ - r && p.z < b.maxZ + r);

describe('the roof terrace', () => {
  it('has a railing all round: walking any way from the middle, you never get past it', () => {
    const { x: X, z: Z, t: T } = ROOF_EDGE;
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      let p = { x: 0, z: 0 };
      for (let i = 0; i < 400; i++) p = collide(p.x + Math.cos(a) * 0.1, p.z + Math.sin(a) * 0.1, rects);
      const inCabin = Math.abs(p.x) < ELEVATOR.cabinHalf && p.z > HALF_D;
      expect(Math.abs(p.x)).toBeLessThanOrEqual(X - T - PLAYER_RADIUS + 1e-6);
      if (!inCabin) expect(Math.abs(p.z)).toBeLessThanOrEqual(Z - T - PLAYER_RADIUS + 1e-6);
      else expect(p.z).toBeLessThan(HALF_D + ELEVATOR.depth);
    }
  });

  it('opens the elevator onto it through the same doorway and cabin as every floor', () => {
    const cabin = (r: Rect[]) => r.filter((b) => b.minZ >= HALF_D && b.maxZ > HALF_D + 1);
    expect(cabin(rects)).toEqual(cabin(shellColliders('office')));
    expect(overlaps({ x: 0, z: HALF_D + 1.3 })).toBe(false); // where a ride leaves you, in the cabin
    expect(overlaps(SPAWN)).toBe(false); // and out of it onto the roof
    // the doorway is left to the elevator's doors, unless asked for
    expect(rects).not.toContainEqual(elevatorDoorway());
    expect(roofColliders(true)).toContainEqual(elevatorDoorway());
  });

  it('gives every seat a unique id, and room in front of it to stand', () => {
    expect(new Set(ROOF_SEATS.map((s) => s.id)).size).toBe(ROOF_SEATS.length);
    expect(ROOF_SEATS.filter((s) => s.kind === 'chair')).toHaveLength(4);
    expect(ROOF_SEATS.filter((s) => s.kind === 'fire')).toHaveLength(FIRE_BENCHES.length * 2);
    expect(ROOF_SEATS.filter((s) => s.kind === 'lookout')).toHaveLength(LOOKOUTS.length);
    for (const s of ROOF_SEATS) {
      expect(overlaps(s.front, PLAYER_RADIUS - 0.05), s.id).toBe(false);
      expect(Math.hypot(s.front.x - s.x, s.front.z - s.z), s.id).toBeLessThan(1.5);
    }
  });

  it('turns everyone by the fire to face it, from a seat on a bench', () => {
    for (const s of ROOF_SEATS.filter((x) => x.kind === 'fire')) {
      const f = facing(s.heading);
      const toFire = { x: FIRE.x - s.x, z: FIRE.z - s.z };
      const d = Math.hypot(toFire.x, toFire.z);
      expect((f.x * toFire.x + f.z * toFire.z) / d, s.id).toBeGreaterThan(0.9);
      expect(FIRE_BENCHES.some((b) => s.x >= b.rect.minX && s.x <= b.rect.maxX && s.z >= b.rect.minZ && s.z <= b.rect.maxZ), s.id).toBe(true);
    }
  });

  it('stands a lookout at the railing on every side, looking out over it', () => {
    const sides = LOOKOUTS.map((l) => {
      const f = facing(l.heading);
      // out is towards the nearer parapet
      if (Math.abs(f.x) > 0.5) expect(Math.sign(f.x)).toBe(Math.sign(l.x));
      else expect(Math.sign(f.z)).toBe(Math.sign(l.z));
      expect(Math.min(HALF_W - Math.abs(l.x), HALF_D - Math.abs(l.z))).toBeLessThan(0.8);
      expect(overlaps(lookoutStand(l))).toBe(false);
      expect(seatById(lookoutSeat(l.id))?.front).toEqual(lookoutStand(l));
      return `${Math.round(f.x)},${Math.round(f.z)}`;
    });
    expect(new Set(sides).size).toBe(4);
  });

  it('lets visitors walk from the elevator to every seat, and the CEO to the railing', () => {
    expect(overlaps(LIFT)).toBe(false);
    for (const s of ROOF_SEATS) expect(findRoofPath(LIFT, s.front), s.id).not.toBeNull();
    for (const s of CALL_SPOTS) {
      expect(overlaps(s)).toBe(false);
      expect(findRoofPath(LIFT, s)).not.toBeNull();
    }
    // between the call spots it's a straight walk
    expect(findRoofPath(CALL_SPOTS[0], CALL_SPOTS[1])).toHaveLength(1);
  });
});
