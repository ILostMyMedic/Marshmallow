// Adapted from cubefarm client/src/world/chatterEvents.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import type { Floor, LogLine, PullInfo, QaRecord, Task, Worker } from '../../../shared/types';
import { authorOf, currentWork, greeting, lastFile, logNews, momentNews, SHIPPED_MS, slowChecks, storeNews, type OfficeSlice } from './chatterEvents';

const T = 1_000_000;

const task = (over: Partial<Task>): Task => ({ kind: 'issue', issueNumber: null, title: '', branch: null, prNumber: null, prUrl: null, ...over });
const worker = (id: string, over: Partial<Worker> = {}): Worker => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  floorId: 'o/r',
  role: 'worker',
  seed: 1,
  desk: 0,
  model: '',
  effort: '',
  host: 'local',
  status: 'idle',
  task: null,
  activity: null,
  idleSince: null,
  startedAt: null,
  endedAt: null,
  costUsd: 0,
  turns: 0,
  lastError: null,
  sessionId: null,
  leaving: false,
  ...over,
});
const pull = (number: number, over: Partial<PullInfo> = {}): PullInfo => ({
  number,
  title: '',
  url: '',
  headRefName: `mm/issue-${number}`,
  baseRefName: 'main',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  reviewDecision: null,
  closesIssues: [],
  createdAt: '',
  mergedAt: null,
  additions: 0,
  deletions: 0,
  checks: 'pending',
  headSha: '',
  mergeState: 'CLEAN',
  failedChecks: [],
  pendingChecks: [],
  ...over,
});
const floor = (pulls: PullInfo[]) => ({ id: 'o/r', pulls }) as unknown as Floor;
const qa = (over: Partial<QaRecord>) => ({ floorId: 'o/r', prNumber: 5, status: 'queued', round: 1, devWorkerId: null, qaWorkerId: null, ...over }) as QaRecord;
const office = (workers: Worker[], qas: QaRecord[] = [], pulls: PullInfo[] = []): OfficeSlice => ({
  workers: Object.fromEntries(workers.map((w) => [w.id, w])),
  qa: Object.fromEntries(qas.map((q) => [`${q.floorId}#${q.prNumber}`, q])),
  floors: [floor(pulls)],
});
const line = (over: Partial<LogLine>): LogLine => ({ id: 1, t: T, kind: 'text', text: '', ...over });

describe('momentNews', () => {
  it('has the author say their PR is up, the tester give the verdict, and a merge cheered by a teammate', () => {
    const ws = office([worker('ada'), worker('grace')]).workers;
    expect(momentNews({ type: 'prOpened', at: T, floorId: 'o/r', prNumber: 5, workerId: 'ada', issueNumber: 1 }, ws)).toEqual([{ who: 'ada', event: { kind: 'prOpened', pr: 5 }, delay: 0, priority: 'event' }]);
    expect(momentNews({ type: 'qaFailed', at: T, floorId: 'o/r', prNumber: 5, qaWorkerId: 'grace', round: 1 }, ws)[0]).toMatchObject({ who: 'grace', event: { kind: 'qaFailed', pr: 5 } });
    expect(momentNews({ type: 'qaPassed', at: T, floorId: 'o/r', prNumber: 5, qaWorkerId: null, round: 1 }, ws)).toEqual([]);
    const merged = momentNews({ type: 'merged', at: T, floorId: 'o/r', prNumber: 5, devWorkerId: 'ada' }, ws);
    expect(merged.map((s) => s.event.kind)).toEqual(['merged', 'congrats']);
    expect(merged[1]).toMatchObject({ who: 'ada', near: true, event: { to: 'Ada' } });
    expect(momentNews({ type: 'merged', at: T, floorId: 'o/r', prNumber: 5, devWorkerId: null }, ws)).toEqual([]);
  });
});

describe('storeNews', () => {
  it('announces starting an issue or a fix, and a session failing', () => {
    const before = office([worker('ada'), worker('grace'), worker('linus', { status: 'working' })]);
    const after = office([
      worker('ada', { status: 'working', task: task({ issueNumber: 7 }) }),
      worker('grace', { status: 'preparing', task: task({ kind: 'fix', prNumber: 5 }) }),
      worker('linus', { status: 'error' }),
    ]);
    expect(storeNews(before, after).map((s) => [s.who, s.event])).toEqual([
      ['ada', { kind: 'start', issue: 7 }],
      ['grace', { kind: 'fixing', pr: 5 }],
      ['linus', { kind: 'error' }],
    ]);
  });

  it('has the author ask the tester to look, and the tester answer; testing their own PR, they just start', () => {
    const ws = [worker('ada'), worker('grace')];
    const asked = storeNews(office(ws, [qa({ devWorkerId: 'ada' })]), office(ws, [qa({ status: 'testing', devWorkerId: 'ada', qaWorkerId: 'grace' })]));
    expect(asked.map((s) => [s.who, s.event.kind, s.delay])).toEqual([
      ['ada', 'askQa', 0],
      ['grace', 'qaStart', 2.6],
    ]);
    const own = storeNews(office(ws, [qa({ devWorkerId: 'ada' })]), office(ws, [qa({ status: 'testing', devWorkerId: 'ada', qaWorkerId: 'ada' })]));
    expect(own.map((s) => [s.who, s.event.kind])).toEqual([['ada', 'qaStart']]);
  });

  it('has the author grumble about a conflict (naming the file) or red CI on their open PR', () => {
    const ws = [worker('ada', { task: task({ prNumber: 5 }) })];
    const news = storeNews(office(ws, [], [pull(5)]), office(ws, [], [pull(5, { mergeable: 'CONFLICTING', checks: 'failing' })]), () => 'store.ts');
    expect(news.map((s) => s.event)).toEqual([
      { kind: 'conflict', pr: 5, file: 'store.ts' },
      { kind: 'ciRed', pr: 5 },
    ]);
  });
});

describe('authorOf', () => {
  it("goes by QA's record, then the PR number or branch of someone not testing it", () => {
    const ws = office([worker('ada', { task: task({ branch: 'mm/issue-5' }) }), worker('grace', { task: task({ kind: 'qa', prNumber: 5 }) })]).workers;
    expect(authorOf(ws, 'o/r', pull(5))?.id).toBe('ada');
    expect(authorOf(ws, 'o/r', pull(5), { devWorkerId: 'grace' })?.id).toBe('grace');
    expect(authorOf(ws, 'other/floor', pull(5))).toBeUndefined();
  });
});

describe('slowChecks', () => {
  it('grumbles once per wait, after the checks have been pending a while', () => {
    const ws = office([worker('ada', { task: task({ prNumber: 5 }) })]).workers;
    const since = new Map<string, number>();
    const done = new Set<string>();
    const floors = [floor([pull(5)])];
    expect(slowChecks(floors, ws, since, done, T, 10)).toEqual([]);
    expect(slowChecks(floors, ws, since, done, T + 10_000, 10).map((s) => s.event)).toEqual([{ kind: 'ciSlow', pr: 5 }]);
    expect(slowChecks(floors, ws, since, done, T + 20_000, 10)).toEqual([]);
    slowChecks([floor([pull(5, { checks: 'passing' })])], ws, since, done, T + 30_000, 10);
    expect(since.size).toBe(0);
  });
});

describe('the log', () => {
  it('reports the last fresh news: tests, a fix pushed, a conflict', () => {
    const fixing = worker('ada', { task: task({ kind: 'fix', prNumber: 5 }) });
    expect(logNews(fixing, [line({ kind: 'result', text: 'Tests  12 passed' })], T)[0].event).toEqual({ kind: 'testsGreen' });
    expect(logNews(fixing, [line({ kind: 'result', text: 'Tests  12 passed' }), line({ kind: 'tool', tool: 'Bash', text: 'git push origin HEAD' })], T)[0].event).toEqual({ kind: 'fixPushed', pr: 5 });
    expect(logNews(fixing, [line({ kind: 'result', text: '2 failed', t: T - 60_000 })], T)).toEqual([]);
  });

  it('knows the file last edited and what someone is doing now', () => {
    const lines = [line({ kind: 'tool', tool: 'Edit', text: 'client/src/store.ts', t: T - 1000 }), line({ kind: 'thinking', text: '…', t: T })];
    expect(lastFile(lines)).toBe('store.ts');
    expect(currentWork(lines, T)).toEqual({ work: 'think', detail: null });
    expect(currentWork(lines, T + 60_000)).toBeNull();
  });
});

describe('greeting', () => {
  it('answers with their work: shipped, fixing, in QA, testing, working, or free', () => {
    const merged = pull(5, { state: 'MERGED', mergedAt: new Date(T - 60_000).toISOString() });
    const mood = (w: Worker, pulls: PullInfo[] = [], qas: QaRecord[] = []) => greeting(w, office([], qas, pulls), 'Sam', T).mood;
    expect(mood(worker('ada', { task: task({ prNumber: 5 }) }), [merged])).toBe('shipped');
    expect(greeting(worker('ada', { task: task({ prNumber: 5 }) }), office([], [], [merged]), 'Sam', T + SHIPPED_MS).mood).toBe('free');
    expect(mood(worker('ada', { status: 'working', task: task({ kind: 'fix', prNumber: 5 }) }))).toBe('fixing');
    expect(mood(worker('ada', { task: task({ prNumber: 5 }) }), [pull(5)], [qa({ status: 'testing' })])).toBe('inQa');
    expect(mood(worker('ada', { status: 'working', task: task({ kind: 'qa', prNumber: 5 }) }))).toBe('testing');
    expect(mood(worker('ada', { status: 'working', task: task({ issueNumber: 3 }) }))).toBe('working');
    expect(mood(worker('ada'))).toBe('free');
    expect(mood(worker('boss', { role: 'ceo' }))).toBe('ceo');
    expect(greeting(worker('ada'), office([]), 'Sam', T)).toMatchObject({ kind: 'greet', manager: 'Sam' });
  });
});
