import { describe, expect, it } from 'vitest';
import { RECENT_MERGE_MS } from './issueClaims.ts';
import { offWorkBranch, unclosedByMerge, type ShippedPull } from './workBranch.ts';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const pull = (number: number, o: Partial<ShippedPull> = {}): ShippedPull => ({ number, state: 'MERGED', headRefName: `mm/issue-${number - 100}-ada`, baseRefName: 'dev', mergedAt: ago(60_000), closesIssues: [], ...o });

describe('offWorkBranch', () => {
  const onDev = { workBranch: 'dev', defaultBranch: 'main' };
  it("is an open office PR aimed at another branch than the floor's work branch", () => {
    expect(offWorkBranch(onDev, { state: 'OPEN', headRefName: 'mm/issue-3-ada', baseRefName: 'main' })).toBe(true);
    expect(offWorkBranch({ workBranch: null, defaultBranch: 'main' }, { state: 'OPEN', headRefName: 'mm/issue-3-ada', baseRefName: 'dev' })).toBe(true);
  });

  it('leaves PRs on the work branch, closed ones, and people’s own PRs alone', () => {
    expect(offWorkBranch(onDev, { state: 'OPEN', headRefName: 'mm/issue-3-ada', baseRefName: 'dev' })).toBe(false);
    expect(offWorkBranch({ workBranch: null, defaultBranch: 'main' }, { state: 'OPEN', headRefName: 'mm/issue-3-ada', baseRefName: 'main' })).toBe(false);
    expect(offWorkBranch(onDev, { state: 'MERGED', headRefName: 'mm/issue-3-ada', baseRefName: 'main' })).toBe(false);
    expect(offWorkBranch(onDev, { state: 'OPEN', headRefName: 'leon/fix', baseRefName: 'main' })).toBe(false);
    expect(offWorkBranch(onDev, { state: 'OPEN', headRefName: 'mm/issue-3-ada', baseRefName: '' })).toBe(false);
  });
});

describe('unclosedByMerge', () => {
  const floor = (pulls: ShippedPull[], open = [1, 2, 3, 4]) => ({ defaultBranch: 'main', issues: open.map((number) => ({ number })), pulls });

  it("finds the open issues of PRs merged lately into a branch GitHub doesn't close them from", () => {
    expect(unclosedByMerge(floor([pull(101), pull(102, { closesIssues: [3] })]), new Set(), NOW)).toEqual([
      { pr: 101, base: 'dev', issues: [1] },
      { pr: 102, base: 'dev', issues: [3, 2] },
    ]);
  });

  it('leaves merges into the default branch to GitHub, and skips open PRs, closed issues and PRs already seen to', () => {
    expect(unclosedByMerge(floor([pull(101, { baseRefName: 'main' })]), new Set(), NOW)).toEqual([]);
    expect(unclosedByMerge(floor([pull(101, { state: 'OPEN', mergedAt: null })]), new Set(), NOW)).toEqual([]);
    expect(unclosedByMerge(floor([pull(101)], [2, 3]), new Set(), NOW)).toEqual([]);
    expect(unclosedByMerge(floor([pull(101)]), new Set([101]), NOW)).toEqual([]);
  });

  it('forgets merges older than the claim window, so an issue reopened since stays open', () => {
    expect(unclosedByMerge(floor([pull(101, { mergedAt: ago(RECENT_MERGE_MS + 1) })]), new Set(), NOW)).toEqual([]);
  });
});
