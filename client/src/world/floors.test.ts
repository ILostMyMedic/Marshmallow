import { describe, expect, it } from 'vitest';
import { CEO_FLOOR, elevationOf, floorLabel, isFloor, kindOf, LOBBY, ROOF, stops, storeyOf } from './floors';
import { FLOOR_HEIGHT } from './layout';

const floors = [
  { floor: 1, fullName: 'demo-co/pixel-todo' },
  { floor: 2, fullName: 'demo-co/shop' },
];

describe('the floors', () => {
  it('stacks the CEO floor and the roof above the highest repo floor', () => {
    expect(storeyOf(LOBBY, 2)).toBe(0);
    expect(storeyOf(2, 2)).toBe(2);
    expect(storeyOf(CEO_FLOOR, 2)).toBe(3);
    expect(storeyOf(ROOF, 2)).toBe(4);
    expect(elevationOf(ROOF, 2)).toBe(4 * FLOOR_HEIGHT);
    expect(storeyOf(ROOF, 0)).toBe(2); // no repo floors yet: the CEO's floor is right over the lobby
  });

  it('knows what each floor is', () => {
    expect([LOBBY, 1, CEO_FLOOR, ROOF].map(kindOf)).toEqual(['lobby', 'office', 'ceo', 'roof']);
    expect(isFloor(2, floors)).toBe(true);
    expect(isFloor(3, floors)).toBe(false);
    expect(isFloor(ROOF, [])).toBe(true);
  });

  it("lists the elevator's stops top first, and labels them", () => {
    expect(stops(floors).map((s) => s.key)).toEqual(['R', 'C', '2', '1', 'L']);
    expect(floorLabel(1, floors)).toBe('1 · pixel-todo');
    expect(floorLabel(ROOF, floors)).toBe('R · Roof terrace');
    expect(floorLabel(LOBBY, floors)).toBe('L · Lobby');
    expect(floorLabel(9, floors)).toBe('');
  });
});
