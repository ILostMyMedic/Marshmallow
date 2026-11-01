// Adapted from cubefarm client/src/world/layout.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import { BALCONY, BALCONY_OUT, ceoColliders, collide, DESK, DESK_ROWS, deskPosition, deskRotation, EAST_DESKS, EAST_ROTATION, ELEVATOR, EXEC_AWARD_SHELF, EXEC_AWARDS, EXEC_PLANTS, FLOOR_HEIGHT, floorElevation, HALF_D, HALF_W, isEastDesk, lobbyColliders, MAX_DESKS, officeColliders, outsideAt, outsideColliders, PLAYER_RADIUS, rect, SEATS, shellColliders, SIDE_DOOR, SIDE_OPENINGS, sideDoorway, sideSign, SIDES, SPAWN, WALL_H, WALL_T, WINDOW, type Rect } from './layout';

describe('the desks', () => {
  it('numbers the grid first, then the east wall: a desk for every seat on a floor', () => {
    expect(SEATS).toBe(15);
    expect(SEATS).toBe(MAX_DESKS + EAST_DESKS.z.length);
    const at = Array.from({ length: SEATS }, (_, s) => deskPosition(s));
    expect(new Set(at.map((p) => `${p.x},${p.z}`)).size).toBe(SEATS);
    for (let s = 0; s < SEATS; s++) {
      expect(isEastDesk(s), `desk ${s}`).toBe(s >= MAX_DESKS);
      expect(deskRotation(s), `desk ${s}`).toBe(s >= MAX_DESKS ? EAST_ROTATION : 0);
    }
    expect(deskPosition(MAX_DESKS + 1)).toEqual({ x: EAST_DESKS.x, z: EAST_DESKS.z[1] });
    // the grid fills from the row nearest the elevator
    expect(deskPosition(0).z).toBe(Math.max(...DESK_ROWS));
  });

  it("keeps the east wall's desks clear of the grid's and of each other", () => {
    for (let s = MAX_DESKS; s < SEATS; s++) {
      const { x, z } = deskPosition(s);
      for (let o = 0; o < SEATS; o++) {
        if (o === s) continue;
        const p = deskPosition(o);
        expect(Math.hypot(p.x - x, p.z - z), `desks ${s} and ${o}`).toBeGreaterThan(DESK.w + 0.5);
      }
    }
  });
});

describe('outside: side doors, windows and balconies', () => {
  it('puts the lobby on the ground and each floor FLOOR_HEIGHT above the last, room and slab included', () => {
    expect(floorElevation(0)).toBe(0);
    expect(floorElevation(1)).toBeCloseTo(FLOOR_HEIGHT);
    expect(floorElevation(5)).toBeCloseTo(5 * FLOOR_HEIGHT);
    expect(FLOOR_HEIGHT).toBeGreaterThan(WALL_H + BALCONY.slab);
  });

  it.each(['office', 'lobby'] as const)("spaces the %s side walls' door and windows apart, inside the wall and along the balcony", (kind) => {
    for (const side of SIDES) {
      const { door, windows } = SIDE_OPENINGS[kind][side];
      const spans = [[door - SIDE_DOOR.half, door + SIDE_DOOR.half], ...windows.map((z) => [z - WINDOW.w / 2, z + WINDOW.w / 2])].sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < spans.length; i++) expect(spans[i][0] - spans[i - 1][1], `${kind} ${side}`).toBeGreaterThanOrEqual(0.3);
      expect(spans[0][0]).toBeGreaterThan(BALCONY.minZ);
      expect(spans[spans.length - 1][1]).toBeLessThan(BALCONY.maxZ);
    }
    expect(WINDOW.y + WINDOW.h / 2).toBeLessThan(WALL_H - 0.3);
  });
});

// ---------- the player's colliders (adapted from cubefarm's layout.test.ts) ----------

const R = 0.3;
const box: Rect = { minX: 0, maxX: 2, minZ: 0, maxZ: 2 };
/** True when a circle of radius r at (x, z) overlaps any rect (touching doesn't count). */
const overlaps = (p: { x: number; z: number }, rects: Rect[], r = R) => rects.some((b) => p.x > b.minX - r && p.x < b.maxX + r && p.z > b.minZ - r && p.z < b.maxZ + r);
const touches = (b: Rect, c: Rect) => b.minX < c.maxX && b.maxX > c.minX && b.minZ < c.maxZ && b.maxZ > c.minZ;
const all = (kind: 'office' | 'lobby') => (kind === 'office' ? officeColliders() : lobbyColliders());
/** Walks towards `b` in steps of at most 0.1 m (a frame's worth, as Player.tsx does) from `a`; returns where it ends up. */
const walk = (a: { x: number; z: number }, b: { x: number; z: number }, rects: Rect[]) => {
  let p = a;
  for (let i = 0; i < 1000; i++) {
    const d = Math.hypot(b.x - p.x, b.z - p.z);
    if (d < 1e-9) break;
    const k = Math.min(1, 0.1 / d);
    p = collide(p.x + (b.x - p.x) * k, p.z + (b.z - p.z) * k, rects);
  }
  return p;
};

describe('collide', () => {
  it('leaves a player who is clear of every rect alone, and lets them touch one', () => {
    expect(collide(5, 5, [box], R)).toEqual({ x: 5, z: 5 });
    expect(collide(-R, 1, [box], R)).toEqual({ x: -R, z: 1 });
  });

  it('pushes out through the nearest side, from a deep overlap too', () => {
    expect(collide(-0.1, 1, [box], R).x).toBeCloseTo(-R);
    expect(collide(2.1, 1, [box], R).x).toBeCloseTo(2 + R);
    expect(collide(1, -0.2, [box], R).z).toBeCloseTo(-R);
    expect(collide(1, 1.9, [box], R).z).toBeCloseTo(2 + R);
    expect(collide(0.4, 1, [box], R).x).toBeCloseTo(-R);
  });

  it('pushes a corner overlap along the shallower axis only', () => {
    const p = collide(-0.2, -0.1, [box], R);
    expect(p.x).toBeCloseTo(-R);
    expect(p.z).toBe(-0.1);
  });

  it('gets the player out of an inside corner, with a second pass when one push lands in another rect', () => {
    const westWall: Rect = { minX: -1, maxX: 0, minZ: -5, maxZ: 5 };
    const northWall: Rect = { minX: -5, maxX: 5, minZ: -1, maxZ: 0 };
    expect(overlaps(collide(0.1, 0.2, [westWall, northWall], R), [westWall, northWall])).toBe(false);
    const desk: Rect = { minX: 0, maxX: 1, minZ: 0, maxZ: 0.5 };
    expect(overlaps(collide(0.25, 0.25, [desk, westWall], R), [desk, westWall])).toBe(false);
    expect(collide(-0.1, 1, [box]).x).toBeCloseTo(-PLAYER_RADIUS);
  });

  it('builds rects around their centre', () => {
    expect(rect(1, 2, 4, 6)).toEqual({ minX: -1, maxX: 3, minZ: -1, maxZ: 5 });
  });

  it('spawns the player somewhere free on every floor', () => {
    expect(collide(SPAWN.x, SPAWN.z, officeColliders())).toEqual({ x: SPAWN.x, z: SPAWN.z });
    expect(collide(SPAWN.x, SPAWN.z, lobbyColliders())).toEqual({ x: SPAWN.x, z: SPAWN.z });
  });

  it("keeps the elevator's shut doors shut", () => {
    expect(walk({ x: 0, z: SPAWN.z }, { x: 0, z: HALF_D + 2 }, officeColliders()).z).toBeLessThan(HALF_D);
  });

  it("gives the east wall's desks and their chairs solids, turned to face the wall", () => {
    const office = officeColliders();
    for (let s = MAX_DESKS; s < SEATS; s++) {
      const { x, z } = deskPosition(s);
      expect(office.some((b) => b.minX === x - (DESK.d + 0.1) / 2 && b.minZ === z - (DESK.w + 0.1) / 2), `desk ${s}`).toBe(true);
    }
  });
});

describe("the CEO's awards wall", () => {
  it('hangs on the south wall west of the elevator, clear of the corner plant, under the ceiling', () => {
    const left = EXEC_AWARDS.x - EXEC_AWARDS.w / 2;
    const right = EXEC_AWARDS.x + EXEC_AWARDS.w / 2;
    expect(right).toBeLessThan(-ELEVATOR.doorHalf - 1);
    for (const [px, pz, s] of EXEC_PLANTS) if (pz > 0) expect(left > px + 0.6 * s || right < px - 0.6 * s, `plant at ${px}`).toBe(true);
    expect(EXEC_AWARDS.z).toBeGreaterThan(HALF_D - 0.15); // on the wall, so it goes with it in the cutaway
    expect(EXEC_AWARDS.y + EXEC_AWARDS.h).toBeLessThan(WALL_H - 0.2);
    expect(EXEC_AWARD_SHELF.h).toBeLessThan(EXEC_AWARDS.y);
  });

  it('stands its shelf in the way, against the wall, without touching anything else on the floor', () => {
    const shelf = rect(EXEC_AWARD_SHELF.x, EXEC_AWARD_SHELF.z, EXEC_AWARD_SHELF.w, EXEC_AWARD_SHELF.d);
    const rects = ceoColliders();
    expect(rects).toContainEqual(shelf);
    expect(shelf.maxZ).toBeLessThanOrEqual(HALF_D);
    // the walls (which reach z = HALF_D) aside
    const others = rects.filter((b) => !(b.minX === shelf.minX && b.maxX === shelf.maxX && b.minZ === shelf.minZ) && b.maxZ < HALF_D - 0.01);
    expect(others.filter((b) => touches(b, shelf))).toEqual([]);
    expect(walk({ x: EXEC_AWARD_SHELF.x, z: EXEC_AWARD_SHELF.z - 2 }, { x: EXEC_AWARD_SHELF.x, z: HALF_D }, rects).z).toBeCloseTo(shelf.minZ - PLAYER_RADIUS);
    expect(collide(SPAWN.x, SPAWN.z, rects)).toEqual({ x: SPAWN.x, z: SPAWN.z });
  });
});

describe('walking outside', () => {
  it.each(['office', 'lobby'] as const)('leaves a gap in each %s side wall for its door, and keeps the rest of the wall solid', (kind) => {
    const shell = shellColliders(kind);
    for (const side of SIDES) {
      const s = sideSign(side);
      const d = sideDoorway(kind, side);
      expect(d.maxZ - d.minZ).toBeCloseTo(SIDE_DOOR.half * 2);
      expect(shell.filter((b) => touches(b, d))).toEqual([]);
      const wall = shell.filter((b) => b.minX === d.minX && b.maxX === d.maxX);
      expect(wall.map((b) => [b.minZ, b.maxZ])).toEqual([
        [-HALF_D, d.minZ],
        [d.maxZ, HALF_D],
      ]);
      // no walking out through a window
      for (const z of SIDE_OPENINGS[kind][side].windows) expect(Math.abs(walk({ x: s * (HALF_W - 1), z }, { x: s * (HALF_W + 1.5), z }, all(kind)).x)).toBeLessThan(HALF_W);
    }
  });

  it.each(['office', 'lobby'] as const)('lets you walk from the %s floor straight out of each door to the railing, and back', (kind) => {
    const rects = all(kind);
    for (const side of SIDES) {
      const s = sideSign(side);
      const z = SIDE_OPENINGS[kind][side].door;
      const inside = { x: s * (HALF_W - 2), z };
      expect(collide(inside.x, inside.z, rects), `${kind} ${side} inside`).toEqual(inside);
      const railing = { x: s * (BALCONY_OUT - BALCONY.railT - PLAYER_RADIUS - 0.01), z };
      expect(walk(inside, railing, rects), `${kind} ${side} out`).toEqual(railing);
      expect(walk(railing, inside, rects), `${kind} ${side} back`).toEqual(inside);
      expect(s * walk(railing, { x: s * (BALCONY_OUT + 2), z }, rects).x).toBeCloseTo(BALCONY_OUT - BALCONY.railT - PLAYER_RADIUS);
    }
  });

  it.each(['office', 'lobby'] as const)("keeps the room's furniture out of the way of the %s doors", (kind) => {
    const shell = shellColliders(kind);
    const outside = outsideColliders(kind);
    const same = (b: Rect, c: Rect) => b.minX === c.minX && b.maxX === c.maxX && b.minZ === c.minZ && b.maxZ === c.maxZ;
    const furniture = all(kind).filter((b) => !shell.some((w) => same(w, b)) && !outside.some((o) => same(o, b)));
    for (const side of SIDES) {
      const s = sideSign(side);
      const z = SIDE_OPENINGS[kind][side].door;
      const front: Rect = { minX: s < 0 ? -HALF_W : HALF_W - 2, maxX: s < 0 ? -HALF_W + 2 : HALF_W, minZ: z - SIDE_DOOR.half - 0.3, maxZ: z + SIDE_DOOR.half + 0.3 };
      expect(furniture.filter((b) => touches(b, front)), `${kind} ${side}`).toEqual([]);
    }
  });

  it('knows when the player is out', () => {
    expect(outsideAt(0)).toBeNull();
    expect(outsideAt(HALF_W)).toBeNull();
    expect(outsideAt(-HALF_W - WALL_T)).toBe('west');
    expect(outsideAt(HALF_W + 1)).toBe('east');
  });
});
