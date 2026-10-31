// Adapted from cubefarm server/watchdog.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import { ago, diagnose, forget, NUDGE_WAIT_MS, nudgeText, ORPHAN_GRACE_MS, PREPARING_MS, QUIET_MS, REMEDY_EVERY_MS, triage, type WatchMemory, type WatchQa, type WatchWorker } from './watchdog.ts';

const NOW = 10_000_000_000;
const MIN = 60_000;

const worker = (over: Partial<WatchWorker> = {}): WatchWorker => ({
  id: 'a1',
  floorId: 'r1',
  role: 'worker',
  status: 'working',
  task: 'issue',
  issueNumber: 207,
  prNumber: null,
  startedAt: NOW - 60 * MIN,
  activeAt: NOW - MIN,
  work: 'open',
  ...over,
});

const rec = (over: Partial<WatchQa> = {}): WatchQa => ({ floorId: 'r1', prNumber: 181, status: 'testing', qaWorkerId: 'q1', devWorkerId: 'a1', updatedAt: NOW - 10 * MIN, ...over });
const memory = (): WatchMemory => ({ remedied: new Map(), nudged: new Map() });

describe('diagnose', () => {
  it('finds a session with no output or tool activity for 20 minutes', () => {
    expect(diagnose([worker({ activeAt: NOW - QUIET_MS + 1 })], [], NOW)).toEqual([]);
    expect(diagnose([worker({ activeAt: NOW - QUIET_MS })], [], NOW)).toMatchObject([{ kind: 'quiet', workerId: 'a1', issueNumber: 207 }]);
  });

  it('finds a desk being set up for more than 10 minutes', () => {
    expect(diagnose([worker({ status: 'preparing', startedAt: NOW - PREPARING_MS + MIN })], [], NOW)).toEqual([]);
    expect(diagnose([worker({ status: 'preparing', startedAt: NOW - PREPARING_MS })], [], NOW)).toMatchObject([{ kind: 'preparing' }]);
  });

  it('finds a failed or stopped worker still holding finished work', () => {
    expect(diagnose([worker({ status: 'error', work: 'merged' })], [], NOW)).toMatchObject([{ kind: 'stale' }]);
    expect(diagnose([worker({ status: 'stopped', work: 'closed' })], [], NOW)).toMatchObject([{ kind: 'stale' }]);
    expect(diagnose([worker({ status: 'error', work: 'open' }), worker({ status: 'done', work: 'merged' })], [], NOW)).toEqual([]);
  });

  it('never flags the CEO or someone without a task', () => {
    expect(diagnose([worker({ role: 'ceo', activeAt: 0 }), worker({ task: null, activeAt: 0 })], [], NOW)).toEqual([]);
  });

  it('finds a PR in "testing" whose tester is idle, after a grace for the report to post', () => {
    const tester = (status: string) => worker({ id: 'q1', task: 'qa', prNumber: 181, status });
    expect(diagnose([tester('working')], [rec()], NOW)).toEqual([]);
    expect(diagnose([tester('idle')], [rec()], NOW)).toMatchObject([{ kind: 'qa-orphan', prNumber: 181, workerId: 'q1' }]);
    expect(diagnose([tester('idle')], [rec({ updatedAt: NOW - ORPHAN_GRACE_MS + 1 })], NOW)).toEqual([]);
  });

  it('finds a PR in "fixing" whose fixer is on something else', () => {
    const fixing = rec({ status: 'fixing' });
    expect(diagnose([worker({ task: 'fix', prNumber: 181 })], [fixing], NOW)).toEqual([]);
    expect(diagnose([worker({ task: 'issue', issueNumber: 300 })], [fixing], NOW)).toMatchObject([{ kind: 'fix-orphan', workerId: 'a1' }]);
  });
});

describe('triage', () => {
  it('nudges a quiet session once, then requeues its work if it stays (or goes) quiet again', () => {
    const m = memory();
    const [p] = diagnose([worker({ activeAt: NOW - QUIET_MS })], [], NOW);
    expect(triage([p], m, NOW)).toEqual([{ problem: p, remedy: 'nudge' }]);
    m.nudged.set(p.key, NOW);
    expect(triage([p], m, NOW + NUDGE_WAIT_MS - 1)).toEqual([]);
    expect(triage([p], m, NOW + NUDGE_WAIT_MS)).toEqual([{ problem: p, remedy: 'requeue' }]);
  });

  it('heals the rest on its own', () => {
    const problems = diagnose(
      [worker({ status: 'preparing', startedAt: 0 }), worker({ id: 'a2', status: 'error', work: 'merged' }), worker({ id: 'q1', status: 'idle', task: null })],
      [rec(), rec({ prNumber: 182, status: 'fixing' })],
      NOW,
    );
    expect(triage(problems, memory(), NOW).map((x) => x.remedy)).toEqual(['requeue', 'clear', 'retry-qa', 'refix']);
  });

  it('remedies an item at most once an hour', () => {
    const m = memory();
    const [p] = diagnose([worker({ status: 'preparing', startedAt: 0 })], [], NOW);
    m.remedied.set(p.key, NOW - REMEDY_EVERY_MS + 1);
    expect(triage([p], m, NOW)).toEqual([]);
    expect(triage([p], m, NOW + 1)).toHaveLength(1);
  });
});

describe('forget', () => {
  it('forgets nudges and remedies older than an hour', () => {
    const m = memory();
    m.nudged.set('old', NOW - REMEDY_EVERY_MS);
    m.nudged.set('new', NOW - MIN);
    m.remedied.set('old', NOW - REMEDY_EVERY_MS);
    m.remedied.set('new', NOW - MIN);
    forget(m, NOW);
    expect([...m.nudged.keys()]).toEqual(['new']);
    expect([...m.remedied.keys()]).toEqual(['new']);
  });
});

describe('what the session hears', () => {
  it('says how long it has been quiet', () => {
    expect(ago(30_000)).toBe('1 minute');
    expect(ago(45 * MIN)).toBe('45 minutes');
    expect(ago(150 * MIN)).toBe('3 hours');
    expect(nudgeText(21 * MIN)).toMatch(/^The office hasn't seen any output from you for 21 minutes\./);
  });
});
