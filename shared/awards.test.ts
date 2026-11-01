import { describe, expect, it } from 'vitest';
import { AWARDS, awardId, awardText, familyProgress, reachedAwards, SHOP_SPOT_COUNT, tierCount } from './awards.ts';

const family = (id: string, scope: 'company' | 'floor') => AWARDS.find((f) => f.id === id && f.scope === scope)!;

describe('the awards', () => {
  it('has unique families per scope and tiers in rising order, each paying something', () => {
    const keys = AWARDS.map((f) => `${f.scope}:${f.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of AWARDS) {
      expect(f.tiers.length).toBeGreaterThan(0);
      f.tiers.forEach((t, i) => {
        expect(t.reward).toBeGreaterThan(0);
        if (i > 0) expect(t.target).toBeGreaterThan(f.tiers[i - 1].target);
      });
    }
  });

  it('keeps the trophy ids the merge milestones always had', () => {
    expect(awardId(family('merges', 'company'), 1, null)).toBe('company:1');
    expect(awardId(family('merges', 'floor'), 10, 'acme/app')).toBe('floor:acme/app:10');
    expect(awardId(family('clean', 'floor'), 10, 'acme/app')).toBe('floor:acme/app:clean:10');
    expect(awardId(family('busy-day', 'company'), 5, null)).toBe('company:busy-day:5');
  });

  it('gives every tier an id that ends in its target, unique across a floor and the company', () => {
    const ids = AWARDS.flatMap((f) => f.tiers.map((t) => awardId(f, t.target, f.scope === 'floor' ? 'acme/app' : null)));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(Number(id.slice(id.lastIndexOf(':') + 1))).toBeGreaterThan(0);
  });

  it('puts the floor in the text', () => {
    expect(awardText("{floor}'s first merge", 'app')).toBe("app's first merge");
  });

  it('finds the tiers the counts have reached', () => {
    const got = reachedAwards({ company: { merges: 12, floors: 1 }, floors: { 'acme/app': { merges: 12, cleanQa: 1, furnished: SHOP_SPOT_COUNT } } }).map((r) => r.id);
    expect(got).toEqual(
      expect.arrayContaining(['company:1', 'company:10', 'floor:acme/app:1', 'floor:acme/app:10', 'floor:acme/app:clean:1', `floor:acme/app:furnished:${SHOP_SPOT_COUNT}`]),
    );
    expect(got).not.toContain('company:25');
    expect(got).not.toContain('company:floors:2');
  });

  it('measures progress from the last tier won to the next', () => {
    const p = familyProgress(family('merges', 'company'), 17);
    expect(p.won).toBe(2);
    expect(p.next?.target).toBe(25);
    expect(p.fraction).toBeCloseTo((17 - 10) / (25 - 10));
    expect(familyProgress(family('upgrades', 'floor'), 2)).toMatchObject({ won: 1, next: null, fraction: 1 });
    expect(familyProgress(family('upgrades', 'floor'), 0).fraction).toBe(0);
  });

  it('counts the tiers in each scope', () => {
    expect(tierCount('company')).toBe(AWARDS.filter((f) => f.scope === 'company').reduce((n, f) => n + f.tiers.length, 0));
    expect(tierCount('floor')).toBeGreaterThan(10);
  });
});
