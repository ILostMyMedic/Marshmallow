import { describe, expect, it } from 'vitest';
import type { ChatView, DeskMessage, DiscussionView, OfficeMessage, ProjectProposal, Question } from '../../../../shared/types';
import {
  approveBody,
  chatLaunched,
  chatUnread,
  deskNews,
  discussionWaiting,
  droppedDependencies,
  editProblems,
  issueLines,
  issueThreads,
  lastLine,
  newestNotice,
  newsLine,
  noticeFeed,
  proposalEdit,
  proposalOf,
  repoFullName,
  sortChats,
  threadSections,
  unreadChats,
  unreadNotices,
  waitingCount,
} from './desk';

const q = (id: number, floorId: string, issueNumber: number, askedAt: number, answer: string | null = null, answeredAt: number | null = null): Question => ({
  id,
  floorId,
  issueNumber,
  from: 'Ada',
  text: `question ${id}`,
  askedAt,
  url: null,
  answer,
  answeredAt,
});
const dm = (id: number, from: DeskMessage['from'], at: number, text = `m${id}`, proposalId: number | null = null): DeskMessage => ({ id, at, from, text, proposalId });
const disc = (id: number, status: DiscussionView['status'], messages: DeskMessage[]): DiscussionView => ({
  id,
  title: `d${id}`,
  floorId: null,
  openedAt: messages[0].at,
  updatedAt: messages.at(-1)!.at,
  status,
  outcome: status === 'resolved' ? 'settled' : null,
  replying: false,
  messages,
});
const chat = (id: number, messages: DeskMessage[], updatedAt = messages.at(-1)?.at ?? 0): ChatView => ({ id, title: `c${id}`, createdAt: 0, updatedAt, replying: false, messages });
const om = (id: number, from: OfficeMessage['from'], at: number, floorId: string | null = from === 'ceo' ? 'demo/a' : null): OfficeMessage => ({ id, at, from, text: `n${id}`, floorId });

const proposal = (over: Partial<ProjectProposal> = {}): ProjectProposal => ({
  id: 1,
  chatId: 1,
  at: 1,
  status: 'pending',
  repo: { kind: 'new', owner: 'me', name: 'recipe-box', description: 'Recipes', private: true },
  brief: 'A recipe app',
  teamSize: 3,
  tasks: [
    { title: 'Scaffold', body: '', dependsOn: [] },
    { title: 'Recipes', body: '', dependsOn: [0] },
    { title: 'Shopping list', body: '', dependsOn: [1] },
    { title: 'Search', body: '', dependsOn: [0, 1] },
  ],
  step: null,
  floorId: null,
  issueNumbers: [],
  error: null,
  decidedAt: null,
  ...over,
});

describe('issue threads', () => {
  const qs = [q(1, 'a/x', 7, 100, 'blue', 150), q(2, 'b/y', 3, 120), q(3, 'a/x', 7, 200), q(4, 'a/x', 8, 50, 'yes', 60)];

  it('makes one thread per floor and issue, the most recently active first', () => {
    const t = issueThreads(qs);
    expect(t.map((x) => x.key)).toEqual(['q:a/x#7', 'q:b/y#3', 'q:a/x#8']);
    expect(t[0].questions.map((x) => x.id)).toEqual([1, 3]);
    expect(t[0].updatedAt).toBe(200);
    expect(t[2].updatedAt).toBe(60);
  });

  it('points at the question still waiting, if any', () => {
    const [x7, y3, x8] = issueThreads(qs);
    expect(x7.pending?.id).toBe(3);
    expect(y3.pending?.id).toBe(2);
    expect(x8.pending).toBeNull();
  });

  it("reads each question then its answer, in time order", () => {
    const lines = issueLines(issueThreads(qs)[0]);
    expect(lines.map((l) => [l.from, l.text])).toEqual([
      ['asker', 'question 1'],
      ['manager', 'blue'],
      ['asker', 'question 3'],
    ]);
    expect(lines[0].who).toBe('Ada');
  });

  it("keeps the latest question's GitHub link", () => {
    const t = issueThreads([{ ...q(1, 'a/x', 7, 1, 'ok', 2), url: 'https://x/1' }, { ...q(2, 'a/x', 7, 3), url: 'https://x/2' }]);
    expect(t[0].url).toBe('https://x/2');
  });
});

describe('waiting on you', () => {
  it("is an open thread whose last word is the CEO's", () => {
    expect(discussionWaiting(disc(1, 'open', [dm(1, 'ceo', 1)]))).toBe(true);
    expect(discussionWaiting(disc(1, 'open', [dm(1, 'ceo', 1), dm(2, 'manager', 2)]))).toBe(false);
    expect(discussionWaiting(disc(1, 'open', [dm(1, 'ceo', 1), dm(2, 'office', 2)]))).toBe(false);
    expect(discussionWaiting(disc(1, 'resolved', [dm(1, 'manager', 1), dm(2, 'ceo', 2)]))).toBe(false);
  });

  it('sorts the threads into waiting, open and resolved, the latest first in each', () => {
    const ds = [disc(1, 'open', [dm(1, 'ceo', 10)]), disc(2, 'open', [dm(1, 'ceo', 5), dm(2, 'manager', 30)]), disc(3, 'resolved', [dm(1, 'ceo', 40)])];
    const ts = issueThreads([q(1, 'a/x', 7, 20), q(2, 'a/x', 8, 1, 'done', 2)]);
    const s = threadSections(ds, ts);
    expect(s.waiting.map((i) => i.key)).toEqual(['q:a/x#7', 'd:1']);
    expect(s.open.map((i) => i.key)).toEqual(['d:2']);
    expect(s.resolved.map((i) => i.key)).toEqual(['d:3', 'q:a/x#8']);
  });

  it('counts the threads that wait, an issue once however many questions it has', () => {
    const ds = [disc(1, 'open', [dm(1, 'ceo', 1)]), disc(2, 'resolved', [dm(1, 'ceo', 1)])];
    expect(waitingCount(ds, [q(1, 'a/x', 7, 1, 'a', 2), q(2, 'a/x', 7, 3), q(3, 'a/x', 9, 1)])).toBe(3);
    expect(waitingCount([], [])).toBe(0);
  });
});

describe('chats', () => {
  it('sorts the most recently active first', () => {
    expect(sortChats([chat(1, [], 5), chat(2, [], 9), chat(3, [], 5)]).map((c) => c.id)).toEqual([2, 3, 1]);
  });

  it("counts a chat unread when the CEO wrote after what you've read", () => {
    const c = chat(1, [dm(1, 'manager', 10), dm(2, 'ceo', 20), dm(3, 'manager', 30)]);
    expect(chatUnread(c, undefined)).toBe(true);
    expect(chatUnread(c, 19)).toBe(true);
    expect(chatUnread(c, 20)).toBe(false);
    expect(chatUnread(chat(2, [dm(1, 'manager', 10), dm(2, 'office', 40)]), 0)).toBe(false);
    expect(unreadChats([c, chat(2, [dm(1, 'ceo', 5)])], { 1: 20 })).toBe(1);
  });

  it('shows the last line on one line, yours marked', () => {
    expect(lastLine(chat(1, [dm(1, 'manager', 1, 'hello\n  there')]))).toBe('You: hello there');
    expect(lastLine(chat(1, [dm(1, 'ceo', 1, 'x'.repeat(200))]), 20)).toHaveLength(20);
    expect(lastLine(chat(1, [dm(1, 'ceo', 1, '', 4)]))).toBe('A project proposal');
    expect(lastLine(chat(1, []))).toBe('No messages yet');
  });

  it('marks a chat that started a floor', () => {
    const c = chat(1, []);
    expect(chatLaunched(c, [proposal({ status: 'started' })])).toBe(true);
    expect(chatLaunched(c, [proposal({ status: 'failed' }), proposal({ chatId: 2, status: 'started' })])).toBe(false);
  });

  it("finds a message's proposal", () => {
    const p = proposal({ id: 4 });
    expect(proposalOf(dm(1, 'ceo', 1, '', 4), [p])).toBe(p);
    expect(proposalOf(dm(1, 'ceo', 1), [p])).toBeNull();
    expect(proposalOf(dm(1, 'ceo', 1, '', 5), [p])).toBeNull();
  });
});

describe('notices', () => {
  const ms = [om(1, 'office', 10), om(2, 'manager', 20), om(3, 'ceo', 30), om(4, 'office', 40)];

  it("feeds the office's and the CEO's, newest first, not yours", () => {
    expect(noticeFeed(ms).map((m) => m.id)).toEqual([4, 3, 1]);
    expect(newestNotice(ms)).toBe(40);
    expect(newestNotice([om(1, 'manager', 9)])).toBe(0);
  });

  it("leaves out the old phone chat's replies, which have no floor", () => {
    expect(noticeFeed([om(1, 'ceo', 10, null), om(2, 'ceo', 20)]).map((m) => m.id)).toEqual([2]);
  });

  it("counts what's newer than the last one read", () => {
    expect(unreadNotices(ms, 0)).toBe(3);
    expect(unreadNotices(ms, 30)).toBe(1);
    expect(unreadNotices(ms, 40)).toBe(0);
  });
});

describe("what's new, all told", () => {
  it('adds threads waiting, unread chats and notices', () => {
    const n = deskNews(
      { chats: [chat(1, [dm(1, 'ceo', 5)]), chat(2, [dm(1, 'ceo', 5)])], discussions: [disc(1, 'open', [dm(1, 'ceo', 1)])], questions: [q(1, 'a/x', 7, 1)], messages: [om(1, 'office', 10), om(2, 'ceo', 20)] },
      { chats: { 2: 5 }, notices: 10 },
    );
    expect(n).toEqual({ discussions: 2, chats: 1, notices: 1, total: 4 });
  });

  it('says it in words for the tooltip', () => {
    expect(newsLine({ discussions: 0, chats: 0, notices: 0, total: 0 })).toBe('Your desktop (P)');
    expect(newsLine({ discussions: 1, chats: 2, notices: 1, total: 4 })).toBe('Your desktop (P): 1 thread waits on you, 2 chats with new replies, 1 notice');
  });
});

describe('a project card, edited', () => {
  it('starts from the proposal with every task in', () => {
    expect(proposalEdit(proposal())).toEqual({ repo: proposal().repo, teamSize: 3, keep: [true, true, true, true] });
  });

  it('checks the repository, the team size and the tasks', () => {
    const e = proposalEdit(proposal());
    expect(editProblems(e, 10)).toEqual({});
    const named = (name: string) => editProblems({ ...e, repo: { kind: 'new', owner: 'me', name, description: '', private: true } }, 10).name;
    expect(named('ok.name_2-x')).toBeUndefined();
    expect(named('has space')).toBeTruthy();
    expect(named('')).toBe('Give it a name');
    expect(named('x'.repeat(101))).toBeTruthy();
    expect(named('..')).toBeTruthy();
    expect(named('ünï')).toBeTruthy();
    expect(editProblems({ ...e, repo: { kind: 'new', owner: ' ', name: 'x', description: '', private: false } }, 10).owner).toBeTruthy();
    expect(editProblems({ ...e, repo: { kind: 'existing', fullName: 'acme/app' } }, 10)).toEqual({});
    expect(editProblems({ ...e, repo: { kind: 'existing', fullName: 'acme' } }, 10).fullName).toBeTruthy();
    expect(editProblems({ ...e, teamSize: 0 }, 10).teamSize).toBe('1 to 10');
    expect(editProblems({ ...e, teamSize: 11 }, 10).teamSize).toBeTruthy();
    expect(editProblems({ ...e, teamSize: 2.5 }, 10).teamSize).toBeTruthy();
    expect(editProblems({ ...e, teamSize: NaN }, 10).teamSize).toBeTruthy();
    expect(editProblems({ ...e, keep: [false, false, false, false] }, 10).tasks).toBeTruthy();
  });

  it('flags kept tasks that wait on one left out', () => {
    expect(droppedDependencies(proposal(), [true, true, true, true])).toEqual([]);
    expect(droppedDependencies(proposal(), [true, false, true, true])).toEqual([
      [2, 1],
      [3, 1],
    ]);
    expect(droppedDependencies(proposal(), [true, false, false, true])).toEqual([[3, 1]]);
  });

  it('sends only what changed, the tasks as the indices kept', () => {
    const p = proposal();
    expect(approveBody(p, proposalEdit(p))).toEqual({});
    const repo = { kind: 'new' as const, owner: 'acme', name: ' recipes ', description: 'Recipes', private: false };
    expect(approveBody(p, { repo, teamSize: 5, keep: [true, false, true, true] })).toEqual({
      repo: { kind: 'new', owner: 'acme', name: 'recipes', description: 'Recipes', private: false },
      teamSize: 5,
      tasks: [0, 2, 3],
    });
    expect(approveBody(p, { ...proposalEdit(p), repo: { ...p.repo, name: ' recipe-box ' } as ProjectProposal['repo'] })).toEqual({});
  });

  it("names the repository owner/name", () => {
    expect(repoFullName(proposal().repo)).toBe('me/recipe-box');
    expect(repoFullName({ kind: 'existing', fullName: 'acme/app' })).toBe('acme/app');
  });
});
