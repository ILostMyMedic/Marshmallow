import { describe, expect, it } from 'vitest';
import type { DeskMessage, DeskView, Floor, Moment, OfficeMessage, Question, Worker } from '../../../shared/types';
import { deskLines, deskToast, errorToast, floorName, messageToast, momentToast, questionToast, toastMs } from './officeToasts';

const floor = { id: 'demo-co/pixel-todo', fullName: 'demo-co/pixel-todo' } as Floor;
const ada = { id: 'w1', name: 'Ada', role: 'worker', floorId: floor.id } as Worker;
const workers = { w1: ada };

describe('momentToast', () => {
  it('says what happened, with the floor and the people', () => {
    expect(momentToast({ type: 'merged', at: 1, floorId: floor.id, prNumber: 12, devWorkerId: 'w1' }, [floor], workers)).toEqual({ level: 'good', text: "🎉 Ada's PR #12 merged on pixel-todo" });
    expect(momentToast({ type: 'merged', at: 1, floorId: floor.id, prNumber: 12, devWorkerId: null }, [floor], workers)?.text).toBe('🎉 PR #12 merged on pixel-todo');
    expect(momentToast({ type: 'prOpened', at: 1, floorId: floor.id, prNumber: 12, workerId: 'w1', issueNumber: 7 }, [floor], workers)?.text).toBe('📬 Ada opened PR #12 for issue #7');
    expect(momentToast({ type: 'qaFailed', at: 1, floorId: floor.id, prNumber: 12, qaWorkerId: null, round: 1 }, [floor], workers)?.text).toBe('🔁 PR #12 failed QA: back for a fix');
    expect(momentToast({ type: 'issuesFiled', at: 1, floorId: floor.id, numbers: [3, 4] }, [floor], workers)?.text).toBe('📋 2 new issues on pixel-todo');
    expect(momentToast({ type: 'issuesFiled', at: 1, floorId: floor.id, numbers: [3] }, [floor], workers)?.text).toBe('📋 Issue #3 filed on pixel-todo');
    expect(momentToast({ type: 'hired', at: 1, worker: ada }, [floor], workers)?.text).toBe('👋 Ada joined pixel-todo');
    expect(momentToast({ type: 'left', at: 1, worker: { ...ada, role: 'ceo', name: 'Mallow' } }, [floor], workers)?.text).toBe('👔 Mallow left the company');
  });

  it("counts a floor's coins in, with why", () => {
    const earned = { type: 'earned' as const, at: 1, floorId: floor.id, amount: 15, prNumber: 12, workerId: 'w1' };
    expect(momentToast({ ...earned, reasons: ['PR #12 merged', 'clean QA pass'] }, [floor], workers)).toEqual({ level: 'good', text: '🪙 +15 for pixel-todo: PR #12 merged, clean QA pass' });
    expect(momentToast({ ...earned, reasons: ['merge', 'clean-qa'] }, [floor], workers)?.text).toBe('🪙 +15 for pixel-todo: PR #12 merged, clean QA pass');
    expect(momentToast({ ...earned, amount: 25, reasons: [], prNumber: null }, [floor], workers)?.text).toBe('🪙 +25 for pixel-todo');
  });

  it('announces an award with what it paid: a floor its own, the company every floor', () => {
    const t = { icon: '🎩', title: 'pixel-todo: hat trick', detail: '', earnedAt: 1 };
    const won = (trophy: Moment & { type: 'trophy' }) => momentToast(trophy, [floor], workers);
    expect(won({ type: 'trophy', at: 1, trophy: { ...t, id: `floor:${floor.id}:hat-trick:1`, floorId: floor.id, reward: 30 } })).toEqual({ level: 'good', text: '🏆 Hat trick (pixel-todo) · +30 🪙' });
    expect(won({ type: 'trophy', at: 1, trophy: { ...t, icon: '🏢', title: 'Second floor', id: 'company:floors:2', floorId: null, reward: 30 } })?.text).toBe('🏆 Second floor · +30 🪙 to every floor');
    expect(won({ type: 'trophy', at: 1, trophy: { ...t, icon: '🎉', title: "pixel-todo's first merge", id: `floor:${floor.id}:1`, floorId: floor.id, reward: 0 } })?.text).toBe('🏆 First merge (pixel-todo)');
    expect(won({ type: 'trophy', at: 1, trophy: { ...t, title: 'Something else', id: 'odd', floorId: null, reward: 0 } })?.text).toBe('🏆 Something else');
  });

  it("leaves an award's coins to its trophy's toast", () => {
    expect(momentToast({ type: 'earned', at: 1, floorId: floor.id, amount: 30, reasons: ['pixel-todo: hat trick'], prNumber: null, workerId: null, award: true }, [floor], workers)).toBeNull();
  });

  it('falls back to the floor id when the floor is gone', () => {
    expect(floorName([], 'acme/app')).toBe('acme/app');
  });
});

describe('the other toasts', () => {
  it('flags trouble and questions for longer', () => {
    expect(errorToast(ada)).toEqual({ level: 'error', text: '⚠️ Ada needs help: their session failed' });
    const q = { id: 1, floorId: floor.id, issueNumber: 7, from: 'Ada', text: 'Should the  button\nbe blue?', askedAt: 1, url: null, answer: null, answeredAt: null } as Question;
    expect(questionToast(q)).toEqual({ level: 'warn', text: '❓ Ada asks about #7: “Should the button be blue?” (P to answer)' });
    expect(toastMs('error')).toBeGreaterThan(toastMs('info'));
  });

  it("passes on the CEO and the office, not what you sent", () => {
    const m = (from: OfficeMessage['from'], text: string): OfficeMessage => ({ id: 1, at: 1, text, floorId: null, from });
    expect(messageToast(m('ceo', 'On it.'), 'Mallow')?.text).toBe('🧑‍💼 Mallow: On it.');
    expect(messageToast(m('office', 'GitHub refused the merge of PR #3'), null)?.text).toBe('📣 GitHub refused the merge of PR #3');
    expect(messageToast(m('manager', 'hello'), 'Mallow')).toBeNull();
    expect(messageToast(m('ceo', 'x'.repeat(200)), null)?.text.length).toBeLessThan(120);
  });
});

describe('the desk toasts', () => {
  const dm = (id: number, from: DeskMessage['from'], text: string, proposalId: number | null = null): DeskMessage => ({ id, at: id, from, text, proposalId });
  const desk: DeskView = {
    chats: [{ id: 1, title: 'Recipe box', createdAt: 1, updatedAt: 3, replying: false, messages: [dm(1, 'manager', 'An idea'), dm(2, 'ceo', 'Tell me more'), dm(3, 'ceo', '', 9)] }],
    proposals: [],
    discussions: [{ id: 1, title: 'Which library?', floorId: null, openedAt: 1, updatedAt: 1, status: 'open', outcome: null, replying: false, messages: [dm(1, 'ceo', 'Chart.js or Recharts?')] }],
    owners: [],
  };

  it('keys every message apart, chats and discussions with the same ids included', () => {
    const keys = deskLines(desk).map((l) => l.key);
    expect(keys).toEqual(['c1:1', 'c1:2', 'c1:3', 'd1:1']);
  });

  it("passes on the CEO's replies, projects and threads, not yours", () => {
    const [mine, reply, project, thread] = deskLines(desk).map((l) => deskToast(l, 'Mallow'));
    expect(mine).toBeNull();
    expect(reply).toEqual({ level: 'info', text: '💬 Mallow in “Recipe box”: Tell me more' });
    expect(project?.text).toBe('🚀 Mallow proposes a project in “Recipe box” (P to review it)');
    expect(thread).toEqual({ level: 'warn', text: '🗣 Mallow on “Which library?”: Chart.js or Recharts? (P to reply)' });
  });
});
