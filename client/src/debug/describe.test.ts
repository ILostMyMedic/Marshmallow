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
    expect(momentText({ type: 'qaFailed', at: 0, floorId: 'demo/app', prNumber: 4, qaWorkerId: 'gone' }, name)).toBe('PR #4 on demo/app failed QA (tested by someone)');
  });

  it('counts the issues filed', () => {
    expect(momentText({ type: 'issuesFiled', at: 0, floorId: 'demo/app', numbers: [5] }, name)).toBe('An issue filed on demo/app: #5');
    expect(momentText({ type: 'issuesFiled', at: 0, floorId: 'demo/app', numbers: [1, 2] }, name)).toBe('2 issues filed on demo/app: #1, #2');
  });
});
