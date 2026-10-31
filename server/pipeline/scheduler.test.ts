import { describe, expect, it } from 'vitest';
import type { Floor, IssueInfo, PullInfo, Worker } from '../../shared/types.ts';
import { ERROR_COOLDOWN_MS, isFree, readyIssues } from './scheduler.ts';

const NOW = 1_000_000_000;
const issue = (number: number, o: Partial<IssueInfo> = {}): IssueInfo => ({ number, title: `#${number}`, body: '', url: '', labels: [], createdAt: '', ...o });
const floor = (issues: IssueInfo[], pulls: Partial<PullInfo>[] = []): Floor =>
  ({ id: 'o/r', issues, pulls: pulls.map((p) => ({ state: 'OPEN', headRefName: 'x', closesIssues: [], mergedAt: null, ...p })) }) as Floor;
const worker = (o: Partial<Worker> = {}): Worker => ({ id: 'w', floorId: 'o/r', role: 'worker', status: 'idle', task: null, endedAt: null, ...o }) as Worker;

describe('readyIssues', () => {
  it('leaves out skipped, taken and blocked issues, and ones that failed too often', () => {
    const f = floor(
      [issue(1, { labels: ['wontfix'] }), issue(2), issue(3, { body: 'Depends on #2' }), issue(4), issue(5), issue(6)],
      [{ closesIssues: [4] }],
    );
    const building = worker({ status: 'working', task: { kind: 'issue', issueNumber: 5, title: '', branch: null, prNumber: null, prUrl: null } });
    expect(readyIssues(f, [building], (n) => n === 6, NOW).map((i) => i.number)).toEqual([2]);
  });

  it('starts what holds up the most work first, then the oldest', () => {
    const f = floor([issue(1), issue(2), issue(3, { body: 'Depends on #2' }), issue(4, { body: 'Blocked by #3' }), issue(5, { body: 'Depends on #1' })]);
    expect(readyIssues(f, [], () => false, NOW).map((i) => i.number)).toEqual([2, 1]);
  });

  it("frees an issue whose worker gave up or reset, but not one a teammate's other floor holds", () => {
    const f = floor([issue(1)]);
    const gaveUp = worker({ status: 'error', task: { kind: 'issue', issueNumber: 1, title: '', branch: null, prNumber: null, prUrl: null } });
    expect(readyIssues(f, [gaveUp], () => false, NOW).map((i) => i.number)).toEqual([1]);
    const elsewhere = worker({ floorId: 'o/other', status: 'working', task: { kind: 'issue', issueNumber: 1, title: '', branch: null, prNumber: null, prUrl: null } });
    expect(readyIssues(f, [elsewhere], () => false, NOW).map((i) => i.number)).toEqual([1]);
  });
});

describe('isFree', () => {
  it('is idle or done, or errored a while ago; never stopped, busy or the CEO', () => {
    expect(isFree(worker(), NOW)).toBe(true);
    expect(isFree(worker({ status: 'done' }), NOW)).toBe(true);
    expect(isFree(worker({ status: 'error', endedAt: NOW - ERROR_COOLDOWN_MS }), NOW)).toBe(true);
    expect(isFree(worker({ status: 'error', endedAt: NOW - 1000 }), NOW)).toBe(false);
    for (const status of ['stopped', 'preparing', 'working'] as const) expect(isFree(worker({ status }), NOW)).toBe(false);
    expect(isFree(worker({ role: 'ceo' }), NOW)).toBe(false);
  });
});
