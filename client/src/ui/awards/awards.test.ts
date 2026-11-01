import { describe, expect, it } from 'vitest';
import { AWARDS, SHOP_SPOT_COUNT, tierCount } from '../../../../shared/awards';
import type { Floor, Trophy } from '../../../../shared/types';
import { awardsView, isCompanyMilestone, nearestNext, rowView, tierName, tierOf, unitOf, wallTrophies, wonOf } from './awards';

const trophy = (id: string, floorId: string | null, reward = 10, earnedAt = 1): Trophy => ({ id, floorId, icon: '🏆', title: id, detail: '', earnedAt, reward });
const floors = [
  { id: 'o/game', fullName: 'o/game', color: '#3a86ff', floor: 2 },
  { id: 'o/app', fullName: 'o/app', color: '#e63946', floor: 1 },
] as Floor[];
const family = (scope: 'company' | 'floor', id: string) => AWARDS.find((f) => f.scope === scope && f.id === id)!;

describe('a trophy as an award', () => {
  it('finds its family and tier from its id, the merge milestones by their old ids', () => {
    expect(tierOf(trophy('company:10', null))).toMatchObject({ family: { id: 'merges', scope: 'company' }, index: 1 });
    expect(tierOf(trophy('company:busy-day:15', null))).toMatchObject({ family: { id: 'busy-day' }, index: 1, tier: { target: 15 } });
    expect(tierOf(trophy('floor:o/app:1', 'o/app'))).toMatchObject({ family: { id: 'merges', scope: 'floor' }, index: 0 });
    expect(tierOf(trophy('floor:o/app:hat-trick:10', 'o/app'))).toMatchObject({ family: { id: 'hat-trick' }, index: 1 });
    expect(tierOf(trophy(`floor:o/app:furnished:${SHOP_SPOT_COUNT}`, 'o/app'))).toMatchObject({ family: { id: 'furnished' }, index: 1 });
  });

  it("isn't one when its id or its scope doesn't fit", () => {
    expect(tierOf(trophy('company:7', null))).toBeNull();
    expect(tierOf(trophy('floor:o/app:1', null))).toBeNull();
    expect(tierOf(trophy('company:hat-trick:1', null))).toBeNull();
  });

  it('agrees its units with the count', () => {
    expect(rowView(family('company', 'night-owl'), 0, null, new Map()).progress).toBe('0 / 1 night merge · next pays +20 🪙');
    expect(unitOf('purchases', 1)).toBe('thing bought');
    expect(unitOf('purchases', 5)).toBe('things bought');
  });

  it('names a tier without its floor', () => {
    expect(tierName({ title: '{floor}: hat trick' })).toBe('Hat trick');
    expect(tierName({ title: "{floor}'s first merge" })).toBe('First merge');
    expect(tierName({ title: '{floor}: 10 merged' })).toBe('10 merged');
    expect(tierName({ title: 'Second floor' })).toBe('Second floor');
    for (const f of AWARDS) for (const t of f.tiers) expect(tierName(t), t.title).not.toContain('{floor}');
  });

  it("tells the company's merge milestones from the rest", () => {
    expect(isCompanyMilestone(trophy('company:25', null))).toBe(true);
    expect(isCompanyMilestone(trophy('company:floors:2', null))).toBe(false);
    expect(isCompanyMilestone(trophy('floor:o/app:10', 'o/app'))).toBe(false);
  });
});

describe('a family row', () => {
  it('shows the tiers won, and the bar from the last one to the next with what it pays', () => {
    const won = new Map([['company:1', trophy('company:1', null, 25)], ['company:10', trophy('company:10', null, 40)]]);
    const r = rowView(family('company', 'merges'), 17, null, won);
    expect(r.chips.map((c) => !!c.trophy)).toEqual([true, true, false, false, false, false, false, false]);
    expect(r.won).toBe(2);
    expect(r.next?.target).toBe(25);
    expect(r.fraction).toBeCloseTo((17 - 10) / (25 - 10));
    expect(r.progress).toBe('17 / 25 PRs merged · next pays +60 🪙');
    expect(r.icon).toBe('🥉');
  });

  it("goes by the trophies, not the count: a team that shrank keeps what it won, a tier in flight isn't won yet", () => {
    const won = new Map([['floor:o/app:team:3', trophy('floor:o/app:team:3', 'o/app')]]);
    const shrank = rowView(family('floor', 'team'), 1, 'o/app', won);
    expect(shrank.won).toBe(1);
    expect(shrank.next?.target).toBe(6);
    expect(shrank.fraction).toBe(0);
    const early = rowView(family('floor', 'team'), 3, 'o/app', new Map());
    expect(early.won).toBe(0);
    expect(early.fraction).toBe(1);
    expect(early.icon).toBe('👥');
  });

  it('says so once every tier is won', () => {
    const f = family('floor', 'upgrades');
    const r = rowView(f, 2, 'o/app', new Map([['floor:o/app:upgrades:2', trophy('floor:o/app:upgrades:2', 'o/app')]]));
    expect(r.next).toBeNull();
    expect(r.fraction).toBe(1);
    expect(r.progress).toBe('Won · 2 upgrades');
    const all = rowView(family('company', 'night-owl'), 30, null, new Map(['company:night-owl:1', 'company:night-owl:25'].map((id) => [id, trophy(id, null)])));
    expect(all.progress).toBe('All 2 won · 30 night merges');
  });
});

describe('the whole view', () => {
  const stats = { company: { merges: 12, floors: 2 }, floors: { 'o/app': { merges: 11, cleanQa: 4 }, 'o/game': { merges: 1 } } };
  const trophies = [
    trophy('company:1', null, 25),
    trophy('company:10', null, 40),
    trophy('company:floors:2', null, 30),
    trophy('floor:o/app:1', 'o/app', 0), // found in its history
    trophy('floor:o/app:10', 'o/app', 40),
    trophy('floor:o/app:clean:1', 'o/app', 10),
    trophy('floor:o/game:1', 'o/game', 15),
    trophy('floor:x/gone:1', 'x/gone', 15),
  ];

  it("counts what's won of what there is, for the company and the floors there now", () => {
    const v = awardsView(stats, trophies, floors);
    expect(v.total).toBe(tierCount('company') + 2 * tierCount('floor'));
    expect(v.won).toBe(3 + 3 + 1);
    expect(v.company).toMatchObject({ key: 'company', won: 3, paid: 95, floor: null });
    expect(v.floors.map((g) => [g.key, g.name, g.floor, g.won, g.paid])).toEqual([
      ['o/app', 'app', 1, 3, 50],
      ['o/game', 'game', 2, 1, 15],
    ]);
  });

  it("adds up the coins paid: the floors' own (a floor gone included), and the company's to every floor", () => {
    expect(awardsView(stats, trophies, floors).paid).toEqual({ floors: 40 + 10 + 15 + 15, everyFloor: 95 });
  });

  it("drives each row's bar from the store's counts, a count left out being 0", () => {
    const v = awardsView(stats, trophies, floors);
    const clean = v.floors[0].rows.find((r) => r.family.id === 'clean')!;
    expect(clean.count).toBe(4);
    expect(clean.progress).toBe('4 / 10 clean passes · next pays +40 🪙');
    expect(v.floors[1].rows.find((r) => r.family.id === 'hat-trick')!.count).toBe(0);
  });

  it("finds a floor's nearest next award", () => {
    const v = awardsView(stats, trophies, floors);
    expect(nearestNext(v.floors[0])?.family.id).toBe('clean'); // 4 of 10, from 1: a third of the way
    expect(nearestNext({ rows: [] })).toBeNull();
  });
});

describe('the wall and the totals', () => {
  it("stands up the newest awards, not the company's merge milestones, oldest first", () => {
    const t = [trophy('company:1', null, 25, 1), trophy('floor:o/app:1', 'o/app', 15, 2), trophy('company:floors:2', null, 30, 5), trophy('floor:o/app:clean:1', 'o/app', 10, 4), trophy('odd', null, 0, 9)];
    expect(wallTrophies(t, 2).map((x) => x.id)).toEqual(['floor:o/app:clean:1', 'company:floors:2']);
    expect(wallTrophies(t, 10).map((x) => x.id)).toEqual(['floor:o/app:1', 'floor:o/app:clean:1', 'company:floors:2']);
  });

  it("counts the won of the company's and the floors' there now", () => {
    const t = [trophy('company:1', null), trophy('floor:o/app:1', 'o/app'), trophy('floor:x/gone:1', 'x/gone')];
    expect(wonOf(t, ['o/app'])).toEqual({ won: 2, total: tierCount('company') + tierCount('floor') });
  });
});
