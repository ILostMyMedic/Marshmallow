import { describe, expect, it } from 'vitest';
import { builderFromBranch, milestones } from './trophies.ts';

const name = (id: string) => id.split('/')[1];

describe('milestones', () => {
  it('awards nothing before the first merge', () => {
    expect(milestones(0, {}, name)).toEqual([]);
  });

  it("reaches the company's and each floor's milestones by count", () => {
    const ids = milestones(12, { 'acme/app': 11, 'acme/api': 1 }, name).map((m) => m.id);
    expect(ids).toEqual(['company:1', 'company:10', 'floor:acme/app:1', 'floor:acme/app:10', 'floor:acme/api:1']);
  });

  it('names the floor and keeps the count that earned each one', () => {
    const m = milestones(1, { 'acme/app': 1 }, name);
    expect(m[0]).toMatchObject({ title: 'First ship', floorId: null, count: 1 });
    expect(m[1]).toMatchObject({ title: "app's first merge", floorId: 'acme/app', count: 1, icon: '🎉' });
    expect(milestones(100, { 'acme/app': 100 }, name).find((x) => x.id === 'company:100')).toMatchObject({ title: '100 PRs shipped', icon: '🏆' });
  });
});

describe('builderFromBranch', () => {
  it("reads the worker's name back from the office's branch", () => {
    expect(builderFromBranch('mm/issue-7-ada')).toBe('Ada');
    expect(builderFromBranch('mm/issue-12-mary-jane')).toBe('Mary Jane');
  });

  it("gives nothing for anyone else's branch", () => {
    expect(builderFromBranch('feature/login')).toBeNull();
    expect(builderFromBranch('mm/qa-3')).toBeNull();
    expect(builderFromBranch(null)).toBeNull();
  });
});
