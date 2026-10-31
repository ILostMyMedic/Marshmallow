// Adapted from cubefarm server/ceo.test.ts (MIT): scalePlan and floorCapacity.
import { describe, expect, it } from 'vitest';
import type { QaStatus } from '../../shared/types.ts';
import { floorCapacity, plannedSize, rulesSize, scalePlan, type FloorLoad, type TeamNow } from './autoscale.ts';

describe('scalePlan', () => {
  // Desks 0-3: Ada and Linus are free, Grace and Alan busy.
  const team = (leaving: string[] = []): TeamNow => ({
    workers: [
      { id: 'ada', desk: 0, free: true },
      { id: 'grace', desk: 1, free: false },
      { id: 'linus', desk: 2, free: true },
      { id: 'alan', desk: 3, free: false },
    ].map((w) => ({ ...w, leaving: leaving.includes(w.id) })),
  });

  it('counts workers on their way out as gone', () => {
    expect(plannedSize(team())).toBe(4);
    expect(plannedSize(team(['alan']))).toBe(3);
  });

  it('grows by the difference', () => {
    expect(scalePlan(team(), 6, 10)).toEqual({ size: 6, hire: 2, stay: [], letGo: [] });
  });

  it('asks a leaver to stay before hiring anyone', () => {
    expect(scalePlan(team(['alan']), 5, 10)).toEqual({ size: 5, hire: 1, stay: ['alan'], letGo: [] });
  });

  it('lets free workers go first, from the highest desk', () => {
    expect(scalePlan(team(), 3, 10).letGo).toEqual(['linus']);
    expect(scalePlan(team(), 1, 10).letGo).toEqual(['linus', 'ada', 'alan']);
  });

  it('skips workers already leaving', () => {
    expect(scalePlan(team(['linus']), 2, 10).letGo).toEqual(['ada']);
  });

  it("keeps at least one worker, and no more than the floor's max", () => {
    expect(scalePlan(team(), 0, 10).size).toBe(1);
    expect(scalePlan(team(), 40, 10)).toMatchObject({ size: 10, hire: 6 });
    expect(scalePlan(team(), 4, 10)).toEqual({ size: 4, hire: 0, stay: [], letGo: [] });
  });
});

describe('rulesSize', () => {
  const floor = (over: Partial<FloorLoad>): FloorLoad => ({ size: 1, max: 10, busy: 0, ready: 0, waiting: 0, idleLong: 0, ...over });

  it('grows a floor with a backlog of 8 issues from 1 worker to 3', () => {
    expect(rulesSize(floor({ ready: 8 }))).toEqual({ size: 3, reason: '8 issues ready and 0 PRs waiting for 1 free worker.' });
  });

  it('counts tasks under way and waiting PRs as work too', () => {
    expect(rulesSize(floor({ size: 3, busy: 3, ready: 5 }))).toBeNull();
    expect(rulesSize(floor({ size: 2, busy: 2, ready: 3, waiting: 2 }))?.size).toBe(3);
  });

  it('stays within the max, and gives an empty floor one worker', () => {
    expect(rulesSize(floor({ ready: 60, max: 4 }))?.size).toBe(4);
    expect(rulesSize(floor({ size: 0 }))).toEqual({ size: 1, reason: 'A floor needs at least one worker.' });
    expect(rulesSize(floor({ size: 0, ready: 7 }))).toEqual({ size: 3, reason: '7 issues ready and 0 PRs waiting for 0 free workers.' });
  });

  it('shrinks only by workers who sat idle a while, down to what the work needs', () => {
    expect(rulesSize(floor({ size: 3, idleLong: 0 }))).toBeNull();
    expect(rulesSize(floor({ size: 3, idleLong: 1 }))).toEqual({ size: 2, reason: '1 worker sat idle with little left to do.' });
    expect(rulesSize(floor({ size: 3, idleLong: 3 }))?.size).toBe(1);
    expect(rulesSize(floor({ size: 3, busy: 2, ready: 3, idleLong: 1 }))).toBeNull();
  });
});

describe('floorCapacity', () => {
  // #1 ← #2 ← #3, and #5 waits for #4. #2 is already in progress.
  const issues = [
    { number: 1, body: 'Skeleton' },
    { number: 2, body: 'Depends on #1' },
    { number: 3, body: 'Depends on #2' },
    { number: 4, body: 'Free' },
    { number: 5, body: 'Depends on #4' },
  ];
  const qa: { prNumber: number; status: QaStatus }[] = [
    { prNumber: 10, status: 'queued' },
    { prNumber: 11, status: 'testing' },
    { prNumber: 12, status: 'fixing' },
    { prNumber: 13, status: 'passed' },
    { prNumber: 14, status: 'failed' },
    { prNumber: 15, status: 'needs-human' },
    { prNumber: 16, status: 'queued' }, // a re-test round
    { prNumber: 20, status: 'queued' }, // closed since
  ];
  const cap = floorCapacity({ issues, inProgress: (n) => n === 2, openPrs: [10, 11, 12, 13, 14, 15, 16], qa });

  it('counts only issues not yet in progress as waiting on others', () => {
    expect(cap.issuesWaitingOnOthers).toBe(2); // #3 and #5; #2 is in progress
    expect(floorCapacity({ issues, inProgress: () => false, openPrs: [], qa: [] }).issuesWaitingOnOthers).toBe(3);
  });

  it('keeps the longest dependency chain', () => {
    expect(cap.longestDependencyChain).toBe(2);
    expect(floorCapacity({ issues: [], inProgress: () => false, openPrs: [], qa: [] }).longestDependencyChain).toBe(0);
  });

  it('counts open PRs queued for or in QA, and those back for fixes', () => {
    expect(cap.prsAwaitingQa).toBe(3); // #10, #11, #16
    expect(cap.prsBeingFixed).toBe(2); // #12, #14
  });
});
