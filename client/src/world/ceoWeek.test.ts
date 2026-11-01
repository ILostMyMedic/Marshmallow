import { describe, expect, it } from 'vitest';
import type { IssueInfo, PullInfo } from '../../../shared/types';
import { companyWeek } from './ceoWeek';

// A Wednesday afternoon, local time.
const NOW = new Date(2026, 9, 28, 15, 0).getTime();
const at = (daysAgo: number, hour = 10) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
};
const iso = (t: number) => new Date(t).toISOString();
const pull = (number: number, opened: number, merged: number | null): PullInfo => ({ number, createdAt: iso(opened), mergedAt: merged === null ? null : iso(merged), state: merged === null ? 'OPEN' : 'MERGED' }) as PullInfo;
const issue = (created: number) => ({ createdAt: iso(created) }) as IssueInfo;
const floor = (id: string, pulls: PullInfo[], issues: IssueInfo[] = []) => ({ id, fullName: id, pulls, issues });

describe("the company's week", () => {
  it('lays out the last seven days, oldest first, ending today', () => {
    const w = companyWeek([], [], NOW);
    expect(w.days.map((d) => d.label)).toEqual(['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']);
    expect(w.days.map((d) => d.today)).toEqual([false, false, false, false, false, false, true]);
    expect(w).toMatchObject({ merged: 0, opened: 0, filed: 0, best: null });
  });

  it('counts merges by day, once each whether the database or the floor has them, and leaves out older ones', () => {
    const floors = [floor('o/app', [pull(1, at(3), at(2)), pull(2, at(1), at(0, 9)), pull(3, at(0), null), pull(4, at(9), at(8))], [issue(at(0)), issue(at(10))]), floor('o/site', [pull(7, at(5), at(4))])];
    const recent = [
      { floorId: 'o/app', prNumber: 2, mergedAt: at(0, 9) },
      { floorId: 'o/app', prNumber: 5, mergedAt: at(0, 11) },
      { floorId: 'o/site', prNumber: 6, mergedAt: at(6, 1) },
      { floorId: 'o/site', prNumber: 1, mergedAt: at(7) },
    ];
    const w = companyWeek(floors, recent, NOW);
    expect(w.days.map((d) => d.merged)).toEqual([1, 0, 1, 0, 1, 0, 2]);
    expect(w.merged).toBe(5);
    // opened this week: #1, #2, #3 and #7; filed: one of the two issues
    expect(w.opened).toBe(4);
    expect(w.filed).toBe(1);
    expect(w.best).toEqual({ name: 'app', merged: 3 });
  });
});
