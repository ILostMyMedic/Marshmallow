// Adapted from cubefarm client/src/store.test.ts (kanbanFor) and qaCard.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import type { Floor, IssueInfo, PullInfo, QaRecord, QaStatus, Worker } from '../../shared/types';
import { kanbanFor, qaCardNote } from './kanban';
import { qaKey } from './store';

const FLOOR = 'acme/app';
const pr = (number: number, state: PullInfo['state'], o: Partial<PullInfo> = {}) => ({ number, state, title: `PR ${number}`, url: '', headRefName: `mm/issue-${number}-x`, isDraft: false, mergeable: 'MERGEABLE', checks: 'passing', closesIssues: [], mergedAt: null, ...o }) as PullInfo;
const issue = (number: number, body = '', labels: string[] = []) => ({ number, title: `#${number}`, body, url: '', labels, createdAt: '' }) as IssueInfo;
const floor = (o: Partial<Floor> = {}) => ({ id: FLOOR, issues: [issue(192)], pulls: [], held: [], autoAssign: false, ...o }) as Floor;
const barbara = (status: Worker['status'], task: Partial<NonNullable<Worker['task']>> | null = {}) =>
  ({ id: 'b', name: 'Barbara', role: 'worker', floorId: FLOOR, status, task: task && { kind: 'issue', issueNumber: 192, title: 'Cancelled', prNumber: null, branch: 'mm/issue-192-barbara', prUrl: null, ...task } }) as Worker;
const rec = (n: number, status: QaStatus, o: Partial<QaRecord> = {}) => ({ [qaKey(FLOOR, n)]: { floorId: FLOOR, prNumber: n, status, round: 1, devWorkerId: null, qaWorkerId: null, mergeNote: null, ...o } as QaRecord });

describe('qaCardNote', () => {
  const p: Pick<PullInfo, 'isDraft' | 'mergeable' | 'checks'> = { isDraft: false, mergeable: 'MERGEABLE', checks: 'passing' };
  const r = (status: QaStatus, mergeNote: string | null = null) => ({ status, round: 2, mergeNote });

  it.each([
    ['queued', 'waiting for QA · round 2', undefined],
    ['testing', '🔍 testing · round 2', undefined],
    ['failed', '🔧 back to the developer', 'warn'],
    ['fixing', '🔧 fixing · round 2', 'warn'],
    ['needs-human', '⚠️ needs you', 'bad'],
    ['passed', '✅ QA passed', 'good'],
  ] as const)('%s', (status, note, tone) => {
    expect(qaCardNote(r(status), p)).toEqual({ note, tone });
  });

  it('shows a merge note only where it matters, and says why a passed PR waits', () => {
    expect(qaCardNote(r('testing', 'stale'), p).note).toBe('🔍 testing · round 2');
    expect(qaCardNote(r('needs-human', 'stale'), p).note).toBe('⚠️ needs you · stale');
    expect(qaCardNote(r('passed'), { ...p, checks: 'pending' })).toEqual({ note: 'QA ✓ · waiting for checks', tone: 'good' });
    expect(qaCardNote(r('passed'), { ...p, mergeable: 'CONFLICTING' })).toEqual({ note: 'QA ✓ · conflicts', tone: 'warn' });
    expect(qaCardNote(null, { ...p, isDraft: true })).toEqual({ note: 'draft', tone: 'warn' });
  });
});

describe('kanbanFor', () => {
  it('shows a worker building an issue, and one who finished without a PR, but no card once their PR exists', () => {
    expect(kanbanFor(floor(), [barbara('working')], {}).progress.map((c) => c.note)).toEqual(['working']);
    expect(kanbanFor(floor(), [barbara('done')], {}).progress.map((c) => c.note)).toEqual(['finished · no PR']);
    expect(kanbanFor(floor({ pulls: [pr(198, 'OPEN')] }), [barbara('done', { prNumber: 198 })], {}).progress).toEqual([]);
    expect(kanbanFor(floor(), [barbara('idle', null)], {}).progress).toEqual([]);
  });

  it('puts open PRs in QA or ready to merge, with whoever is on them, never the tester as the author', () => {
    const author = barbara('done', { prNumber: 198, branch: 'mm/issue-198-x' });
    const tester = { ...barbara('working', { kind: 'qa', prNumber: 198, issueNumber: null, branch: 'mm/qa-198-t' }), id: 't' } as Worker;
    const cols = kanbanFor(floor({ pulls: [pr(198, 'OPEN'), pr(199, 'OPEN')] }), [tester, author], { ...rec(199, 'passed') });
    expect(cols.qa.map((c) => [c.number, c.worker?.id])).toEqual([[198, 'b']]);
    expect(cols.ready.map((c) => c.number)).toEqual([199]);
    const testing = kanbanFor(floor({ pulls: [pr(198, 'OPEN')] }), [tester, author], rec(198, 'testing', { qaWorkerId: 't', devWorkerId: 'b' }));
    expect(testing.qa[0]).toMatchObject({ worker: { id: 't' }, note: '🔍 testing · round 1' });
  });

  it('keeps claimed issues out of the backlog, and notes what an issue waits for', () => {
    const f = floor({ issues: [issue(1), issue(2, 'Depends on #1'), issue(3, '', ['bug']), issue(4)], pulls: [pr(10, 'OPEN', { closesIssues: [4] })] });
    expect(kanbanFor(f, [], {}).backlog.map((c) => [c.number, c.note])).toEqual([
      [1, undefined],
      [2, '⏳ after #1'],
      [3, 'bug'],
    ]);
  });

  it('marks backlog issues auto-assign would start as paced while Claude usage holds them back', () => {
    const f = floor({ issues: [issue(1), issue(3, '', ['bug'])], autoAssign: true });
    expect(kanbanFor(f, [], {}, { state: 'pacing' }).backlog.map((c) => c.note)).toEqual(['⏸ paced', '⏸ paced · bug']);
    expect(kanbanFor(f, [], {}, { state: 'paused' }).backlog.map((c) => c.note)).toEqual(['⏸ paused', '⏸ paused · bug']);
    expect(kanbanFor({ ...f, autoAssign: false }, [], {}, { state: 'pacing' }).backlog.map((c) => c.note)).toEqual([undefined, 'bug']);
  });

  it('marks an issue whose PR was closed as waiting for the manager', () => {
    expect(kanbanFor(floor({ held: [{ issue: 192, pr: 198 }] }), [], {}).backlog).toMatchObject([{ number: 192, note: '⏸ PR #198 closed · waits for you', tone: 'warn' }]);
  });

  it('lists merged PRs newest first, with their authors', () => {
    const f = floor({ pulls: [pr(5, 'MERGED', { mergedAt: '2026-10-01T10:00:00Z' }), pr(6, 'MERGED', { mergedAt: '2026-10-02T10:00:00Z', headRefName: 'mm/issue-192-barbara' })] });
    const merged = kanbanFor(f, [barbara('idle', { prNumber: null })], {}).merged;
    expect(merged.map((c) => c.number)).toEqual([6, 5]);
    expect(merged[0].worker?.id).toBe('b');
  });
});
