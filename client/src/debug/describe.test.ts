import { describe, expect, it } from 'vitest';
import { momentText, taskText } from './describe';

describe('taskText', () => {
  it('says what the worker is on', () => {
    expect(taskText(null)).toBe('');
    expect(taskText({ kind: 'issue', issueNumber: 3, title: 'Dark mode', branch: null, prNumber: null, prUrl: null })).toBe('Building #3: Dark mode');
    expect(taskText({ kind: 'qa', issueNumber: 3, title: 'Dark mode', branch: null, prNumber: 7, prUrl: null })).toBe('Testing PR #7: Dark mode');
    expect(taskText({ kind: 'fix', issueNumber: 3, title: 'Dark mode', branch: null, prNumber: 7, prUrl: null })).toBe('Fixing PR #7: Dark mode');
  });
});

describe('momentText', () => {
  const name = (id: string | null) => (id === 'w1' ? 'Ada' : 'someone');

  it('names the workers involved, including ones who left', () => {
    expect(momentText({ type: 'prOpened', at: 0, floorId: 'demo/app', prNumber: 4, workerId: 'w1', issueNumber: 2 }, name)).toBe('Ada opened PR #4 for #2 on demo/app');
    expect(momentText({ type: 'qaFailed', at: 0, floorId: 'demo/app', prNumber: 4, qaWorkerId: 'gone', round: 1 }, name)).toBe('PR #4 on demo/app failed QA (tested by someone)');
  });

  it('says what a floor earned, why, and who built it', () => {
    expect(momentText({ type: 'earned', at: 0, floorId: 'demo/app', amount: 15, reasons: ['PR #4 merged', 'clean QA pass'], prNumber: 4, workerId: 'w1' }, name)).toBe('demo/app earned 15 coins (PR #4 merged, clean QA pass), built by Ada');
    expect(momentText({ type: 'earned', at: 0, floorId: 'demo/app', amount: 1, reasons: [], prNumber: null, workerId: null }, name)).toBe('demo/app earned 1 coin');
  });

  it("says an award's coins are an award's, and what an award pays", () => {
    expect(momentText({ type: 'earned', at: 0, floorId: 'demo/app', amount: 30, reasons: ['Second floor'], prNumber: null, workerId: null, award: true }, name)).toBe('demo/app earned 30 coins for an award: Second floor');
    const trophy = { id: 'company:floors:2', floorId: null, icon: '🏢', title: 'Second floor', detail: '', earnedAt: 0, reward: 30 };
    expect(momentText({ type: 'trophy', at: 0, trophy }, name)).toBe('Trophy: 🏢 Second floor (pays 30 coins to every floor)');
    expect(momentText({ type: 'trophy', at: 0, trophy: { ...trophy, id: 'floor:demo/app:1', floorId: 'demo/app', title: "app's first merge", reward: 0 } }, name)).toBe("Trophy: 🏢 app's first merge");
  });

  it('counts the issues filed', () => {
    expect(momentText({ type: 'issuesFiled', at: 0, floorId: 'demo/app', numbers: [5] }, name)).toBe('An issue filed on demo/app: #5');
    expect(momentText({ type: 'issuesFiled', at: 0, floorId: 'demo/app', numbers: [1, 2] }, name)).toBe('2 issues filed on demo/app: #1, #2');
  });
});
