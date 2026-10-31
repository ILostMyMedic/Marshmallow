import { describe, expect, it } from 'vitest';
import type { Floor, Trophy } from '../../../shared/types';
import { floorName, GONE_COLOR, milestoneOf, plaqueLines, shelfLayout, trophyGroups, trophyLook } from './trophyShelf';

const company = (n: number, icon = '🏆', at = n): Trophy => ({ id: `company:${n}`, floorId: null, icon, title: `${n} PRs shipped`, detail: '', earnedAt: at });
const floorT = (floorId: string, n: number, at = n): Trophy => ({ id: `floor:${floorId}:${n}`, floorId, icon: '⭐', title: `${n} merged`, detail: '', earnedAt: at });
const floors = [
  { id: 'o/app', fullName: 'o/app', color: '#e63946', floor: 1 },
  { id: 'o/game', fullName: 'o/game', color: '#3a86ff', floor: 2 },
] as Floor[];

describe('a trophy', () => {
  it("reads its milestone from its id, a floor's id with a slash included", () => {
    expect(milestoneOf(company(250))).toBe(250);
    expect(milestoneOf(floorT('o/app', 10))).toBe(10);
    expect(milestoneOf({ id: 'something-new' })).toBe(1);
  });

  it('takes its shape and metal from its icon, and grows with its milestone', () => {
    expect(trophyLook(company(1, '🚀'))).toEqual({ shape: 'rocket', metal: 'silver', scale: 1 });
    expect(trophyLook(company(10, '🥉'))).toMatchObject({ shape: 'cup', metal: 'bronze' });
    expect(trophyLook(company(1000, '🏛️'))).toEqual({ shape: 'gem', metal: 'crystal', scale: 1.5 });
    expect(trophyLook(company(100)).scale).toBeGreaterThan(trophyLook(company(10)).scale);
  });

  it("gets a cup of the milestone's metal for an icon it doesn't know", () => {
    expect(trophyLook(company(5, '🦄'))).toMatchObject({ shape: 'cup', metal: 'bronze' });
    expect(trophyLook(company(20, '🦄')).metal).toBe('silver');
    expect(trophyLook(company(75, '🦄')).metal).toBe('gold');
  });

  it("says whose it is and what for on its plaque, a floor's by its short name", () => {
    const name = (id: string) => floorName(floors, id);
    expect(plaqueLines(company(1), name)).toEqual(['Company', 'First ship']);
    expect(plaqueLines(company(50), name)).toEqual(['Company', '50 shipped']);
    expect(plaqueLines(floorT('o/game', 10), name)).toEqual(['game', '10 merged']);
    expect(plaqueLines(floorT('x/gone', 1), name)).toEqual(['gone', 'First merge']);
  });
});

describe('the cabinet', () => {
  const where = (spots: ReturnType<typeof shelfLayout>['spots']) => spots.map((s) => `${s.trophy.id}@${s.shelf}.${s.slot}/${s.of}`);

  it('is empty with no trophies', () => {
    expect(shelfLayout([], [], 10)).toEqual({ spots: [], hidden: 0 });
  });

  it("puts the company's on the top shelf, smallest first, and the floors' below in floor order", () => {
    const t = [floorT('o/game', 1), company(10), floorT('o/app', 10), company(1), floorT('o/app', 1)];
    expect(where(shelfLayout(t, ['o/app', 'o/game'], 10).spots)).toEqual(['company:1@0.0/2', 'company:10@0.1/2', 'floor:o/app:1@1.0/3', 'floor:o/app:10@1.1/3', 'floor:o/game:1@1.2/3']);
  });

  it('moves a floor down a shelf rather than split it, while the rest still fit', () => {
    const t = [...[1, 10, 50].map((n) => floorT('o/app', n)), ...[1, 10].map((n) => floorT('o/game', n))];
    expect(where(shelfLayout(t, ['o/app', 'o/game'], 4).spots).slice(3)).toEqual(['floor:o/game:1@2.0/2', 'floor:o/game:10@2.1/2']);
  });

  it('splits a floor when moving it down would leave no room for the rest', () => {
    const t = ['a', 'b', 'c'].flatMap((f) => [1, 10, 50].map((n) => floorT(`o/${f}`, n)));
    const { spots, hidden } = shelfLayout(t, ['o/a', 'o/b', 'o/c'], 5);
    expect(hidden).toBe(0);
    expect(spots.filter((s) => s.shelf === 1)).toHaveLength(5);
    expect(spots.filter((s) => s.shelf === 2)).toHaveLength(4);
    expect(spots.every((s) => s.shelf < 3)).toBe(true);
  });

  it('lets the smallest milestones give way when the shelves are full, and counts them', () => {
    const t = [...[1, 10, 25, 50].map((n) => company(n)), ...[1, 10, 50].flatMap((n) => [floorT('o/app', n), floorT('o/game', n)])];
    const { spots, hidden } = shelfLayout(t, ['o/app', 'o/game'], 2);
    expect(hidden).toBe(2 + 2);
    expect(spots.filter((s) => s.shelf === 0).map((s) => s.trophy.id)).toEqual(['company:25', 'company:50']);
    expect(spots.filter((s) => s.shelf > 0).map((s) => s.trophy.id)).toEqual(['floor:o/app:10', 'floor:o/app:50', 'floor:o/game:10', 'floor:o/game:50']);
  });

  it("puts the floors' first even when the company has none", () => {
    expect(where(shelfLayout([floorT('o/app', 1)], ['o/app'], 10).spots)).toEqual(['floor:o/app:1@1.0/1']);
  });
});

describe('the panel', () => {
  it("lists the company's first, then each floor's in floor order, newest first, a floor that's gone last and grey", () => {
    const t = [floorT('x/gone', 1, 5), floorT('o/game', 1, 2), company(1, '🚀', 1), floorT('o/app', 1, 3), floorT('o/app', 10, 9), company(10, '🥉', 8)];
    const groups = trophyGroups({ trophies: t, totals: { 'o/app': 12, 'o/game': 3, 'x/gone': 2 }, total: 17 }, floors);
    expect(groups.map((g) => [g.name, g.total, g.trophies.map((x) => x.id)])).toEqual([
      ['The company', 17, ['company:10', 'company:1']],
      ['app', 12, ['floor:o/app:10', 'floor:o/app:1']],
      ['game', 3, ['floor:o/game:1']],
      ['gone', 2, ['floor:x/gone:1']],
    ]);
    expect(groups[3].color).toBe(GONE_COLOR);
  });
});
