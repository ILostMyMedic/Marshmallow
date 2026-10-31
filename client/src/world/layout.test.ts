// Adapted from cubefarm client/src/world/layout.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import { BALCONY, DESK, DESK_ROWS, deskPosition, deskRotation, EAST_DESKS, EAST_ROTATION, FLOOR_HEIGHT, floorElevation, isEastDesk, MAX_DESKS, SEATS, SIDE_DOOR, SIDE_OPENINGS, SIDES, WALL_H, WINDOW } from './layout';

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
