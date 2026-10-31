import { describe, expect, it } from 'vitest';
import type { Floor, ShippedWork } from '../../../shared/types';
import { byLine, dateLabel, floorTotals, prs, wallRows, whenLabel } from './shipped';
import { GONE_COLOR } from './trophyShelf';

const NOW = new Date(2026, 9, 31, 15, 0).getTime(); // a Saturday
const at = (day: number, h = 10, m = 5, month = 9, year = 2026) => new Date(year, month, day, h, m).getTime();
const floors = [
  { id: 'o/app', fullName: 'o/app', color: '#e63946', floor: 1 },
  { id: 'o/game', fullName: 'o/game', color: '#3a86ff', floor: 2 },
] as Floor[];
const work = (floorId: string, prNumber: number, over: Partial<ShippedWork> = {}): ShippedWork => ({ floorId, prNumber, title: `PR ${prNumber}`, url: '', builtBy: 'Ada', testedBy: 'Grace', mergedAt: at(31), ...over });

describe('when', () => {
  it('says the time today, yesterday, the weekday this week and the date before that', () => {
    expect(whenLabel(at(31, 9, 7), NOW)).toBe('09:07');
    expect(whenLabel(at(30, 23, 59), NOW)).toBe('yesterday');
    expect(whenLabel(at(27), NOW)).toBe('Tue');
    expect(whenLabel(at(20), NOW)).toBe('20 Oct');
    expect(whenLabel(at(20, 10, 5, 11, 2025), NOW)).toBe('20 Dec 2025');
    expect(dateLabel(at(1, 10, 5, 0))).toBe('1 Jan 2026');
  });
});

describe('the shipped wall', () => {
  it('lists the latest merges with their floor, who built and tested them and when', () => {
    const rows = wallRows({ recent: [work('o/game', 7), work('o/app', 3, { builtBy: null, testedBy: null, mergedAt: at(30) }), work('o/app', 2)] }, floors, NOW, 2);
    expect(rows).toEqual([
      { key: 'o/game#7', title: 'PR 7', pr: 7, floor: 'game', color: '#3a86ff', by: 'Ada · tested by Grace', when: '10:05' },
      { key: 'o/app#3', title: 'PR 3', pr: 3, floor: 'app', color: '#e63946', by: 'from outside the office', when: 'yesterday' },
    ]);
  });

  it("totals each floor, most first, keeping a floor that's gone", () => {
    expect(floorTotals({ totals: { 'o/app': 4, 'x/old': 9, 'o/game': 4, 'o/none': 0 } }, floors)).toEqual([
      { key: 'x/old', name: 'old', color: GONE_COLOR, total: 9 },
      { key: 'o/app', name: 'app', color: '#e63946', total: 4 },
      { key: 'o/game', name: 'game', color: '#3a86ff', total: 4 },
    ]);
  });

  it('words who built it and how many', () => {
    expect(byLine({ builtBy: 'Ada', testedBy: null })).toBe('Ada');
    expect(prs(1)).toBe('1 PR');
    expect(prs(12)).toBe('12 PRs');
  });
});
