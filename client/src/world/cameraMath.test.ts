// Adapted from cubefarm client/src/world/camera/cameraMath.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import { allInView, angleDelta, dampOrbit, fitDistance, nearestQuad, nearSides, newOrbit, newPose, orbitPose, OVERVIEW, overviewOrbit, panOrbit, quadYaw } from './cameraMath';
import { HALF_D, HALF_W, WALL_H } from './layout';

const forward = (p: { yaw: number; pitch: number }) => [-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch)];

describe('orbitPose', () => {
  it('puts the camera dist from the focus, looking straight at it', () => {
    const o = { ...newOrbit(), fx: 2, fy: 1, fz: -3, yaw: 0.7, el: 0.9, dist: 20, fov: 40 };
    const p = orbitPose(o, newPose());
    const d = [o.fx - p.x, o.fy - p.y, o.fz - p.z];
    expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(20);
    const f = forward(p);
    for (let i = 0; i < 3; i++) expect(f[i]).toBeCloseTo(d[i] / 20);
  });

  it('bearing 0 is due south of the focus, looking north', () => {
    const p = orbitPose({ ...newOrbit(), yaw: 0, el: 0, dist: 5 }, newPose());
    expect(p.z).toBeCloseTo(5);
    expect(p.x).toBeCloseTo(0);
    expect(p.yaw).toBe(0);
  });
});

describe('the overview', () => {
  it('fits the whole floor, walls and all, and no closer', () => {
    for (const aspect of [16 / 9, 4 / 3, 0.6]) {
      const o = overviewOrbit(0, aspect, newOrbit());
      const box = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [0, WALL_H].flatMap((y) => [sx * HALF_W, y, sz * HALF_D])));
      expect(allInView(orbitPose(o, newPose()), aspect, box, 0)).toBe(true);
      expect(allInView(orbitPose({ ...o, dist: o.dist * 0.9 }, newPose()), aspect, box, OVERVIEW.margin)).toBe(false);
    }
  });

  it('narrow windows pull back further', () => {
    expect(fitDistance(overviewOrbit(0, 0.6, newOrbit()), 0.6)).toBeGreaterThan(fitDistance(overviewOrbit(0, 16 / 9, newOrbit()), 16 / 9));
  });

  it('picks the corner view nearest the way you face', () => {
    expect(quadYaw(nearestQuad(0))).toBeCloseTo(Math.PI / 4); // facing north: from the south-east
    expect(quadYaw(nearestQuad(Math.PI))).toBeCloseTo((5 * Math.PI) / 4); // facing south: from the north-west
    expect(quadYaw(nearestQuad(Math.PI / 2))).toBeCloseTo((3 * Math.PI) / 4); // facing west: from the north-east
  });

  it("cuts away the walls on the camera's side", () => {
    expect(nearSides(quadYaw(0), { x: 0, z: 0 })).toEqual({ x: 1, z: 1 }); // south-east: east and south walls
    expect(nearSides(quadYaw(2), { x: 0, z: 0 })).toEqual({ x: -1, z: -1 });
    expect(nearSides(0, { x: 0, z: 0 })).toEqual({ x: 0, z: 1 });
  });

  it('pans the focus as the camera sees the ground, and keeps it over the floor', () => {
    const o = { ...newOrbit(), yaw: 0 };
    panOrbit(o, 2, 3); // camera south looking north: right is east, forward is north
    expect(o.fx).toBeCloseTo(2);
    expect(o.fz).toBeCloseTo(-3);
    panOrbit(o, 100, -100);
    expect(o.fx).toBe(HALF_W);
    expect(o.fz).toBe(HALF_D);
  });
});

describe('poses in motion', () => {
  it('turns the short way round', () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
  });

  it('damps an orbit toward its goal', () => {
    const cur = { ...newOrbit(), yaw: 0, dist: 10 };
    const goal = { ...newOrbit(), yaw: Math.PI / 2, dist: 20 };
    dampOrbit(cur, goal, 0.1, 6);
    expect(cur.dist).toBeGreaterThan(10);
    expect(cur.dist).toBeLessThan(20);
    for (let i = 0; i < 200; i++) dampOrbit(cur, goal, 0.05, 6);
    expect(cur.yaw).toBeCloseTo(Math.PI / 2);
  });
});
