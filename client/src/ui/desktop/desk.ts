// The desktop's rules, pure so the tests check them: the workers' questions grouped into one thread per issue, what's
// waiting on you, the Discussions list's sections, what's unread, and the checks on a project card the manager edits
// before approving it. New in Marshmallow (cubefarm has no desktop).
import type { ChatView, DeskMessage, DiscussionView, OfficeMessage, ProjectProposal, ProposalRepo, Question } from '../../../../shared/types';

// ---------- the workers' questions, as threads ----------

/** The questions asked about one issue: each question then its answer, the way the issue's comments read. */
export interface IssueThread {
  key: string; // `q:<floorId>#<issue>`
  floorId: string;
  issueNumber: number;
  questions: Question[]; // oldest first
  pending: Question | null; // the one waiting for an answer (the office allows one per issue at a time)
  startedAt: number;
  updatedAt: number; // the latest question or answer
  url: string | null; // the latest question's comment on GitHub
}

export const issueKey = (floorId: string, issueNumber: number) => `q:${floorId}#${issueNumber}`;
export const discussionKey = (id: number) => `d:${id}`;

/** One thread per issue asked about, the most recently active first. */
export function issueThreads(questions: readonly Question[]): IssueThread[] {
  const byIssue = new Map<string, Question[]>();
  for (const q of questions) {
    const k = issueKey(q.floorId, q.issueNumber);
    byIssue.set(k, [...(byIssue.get(k) ?? []), q]);
  }
  const threads = [...byIssue].map(([key, qs]): IssueThread => {
    const sorted = [...qs].sort((a, b) => a.askedAt - b.askedAt || a.id - b.id);
    const pending = [...sorted].reverse().find((q) => q.answer === null) ?? null;
    const times = sorted.flatMap((q) => [q.askedAt, q.answeredAt ?? 0]);
    return {
      key,
      floorId: sorted[0].floorId,
      issueNumber: sorted[0].issueNumber,
      questions: sorted,
      pending,
      startedAt: sorted[0].askedAt,
      updatedAt: Math.max(...times),
      url: [...sorted].reverse().find((q) => q.url)?.url ?? null,
    };
  });
  return threads.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A line in an issue thread: a question (from whoever asked) or the manager's answer. */
export interface ThreadLine {
  key: string;
  from: 'asker' | 'manager';
  who: string;
  text: string;
  at: number;
}

/** An issue thread's lines in time order: each question, then its answer once there is one. */
export function issueLines(t: IssueThread): ThreadLine[] {
  const lines = t.questions.flatMap((q): ThreadLine[] => [
    { key: `${q.id}q`, from: 'asker', who: q.from, text: q.text, at: q.askedAt },
    ...(q.answer !== null ? [{ key: `${q.id}a`, from: 'manager' as const, who: 'You', text: q.answer, at: q.answeredAt ?? q.askedAt }] : []),
  ]);
  return lines.sort((a, b) => a.at - b.at);
}

// ---------- what's waiting on you ----------

/** An open thread the CEO opened, whose last word is the CEO's: they wait for your reply. */
export const discussionWaiting = (d: DiscussionView) => d.status === 'open' && d.messages.at(-1)?.from === 'ceo';

export type ThreadItem = { kind: 'discussion'; key: string; at: number; discussion: DiscussionView } | { kind: 'issue'; key: string; at: number; thread: IssueThread };

export const itemWaiting = (i: ThreadItem) => (i.kind === 'discussion' ? discussionWaiting(i.discussion) : i.thread.pending !== null);
const itemOpen = (i: ThreadItem) => (i.kind === 'discussion' ? i.discussion.status === 'open' : i.thread.pending !== null);

export interface ThreadSections {
  waiting: ThreadItem[];
  open: ThreadItem[];
  resolved: ThreadItem[];
}

/**
 * The Discussions list: waiting on you (an open office thread whose last word is the CEO's, or an issue thread with an
 * unanswered question), open (the CEO's turn), and resolved (settled threads, and issue threads all answered); each the
 * most recently active first.
 */
export function threadSections(discussions: readonly DiscussionView[], threads: readonly IssueThread[]): ThreadSections {
  const items: ThreadItem[] = [
    ...discussions.map((d): ThreadItem => ({ kind: 'discussion', key: discussionKey(d.id), at: d.updatedAt, discussion: d })),
    ...threads.map((t): ThreadItem => ({ kind: 'issue', key: t.key, at: t.updatedAt, thread: t })),
  ].sort((a, b) => b.at - a.at);
  return {
    waiting: items.filter(itemWaiting),
    open: items.filter((i) => !itemWaiting(i) && itemOpen(i)),
    resolved: items.filter((i) => !itemOpen(i)),
  };
}

/** How many threads wait on you. */
export const waitingCount = (discussions: readonly DiscussionView[], questions: readonly Question[]) =>
  discussions.filter(discussionWaiting).length + issueThreads(questions).filter((t) => t.pending).length;

// ---------- chats ----------

/** The chats, the most recently active first. */
export const sortChats = (chats: readonly ChatView[]) => [...chats].sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id);

/** When the CEO last wrote in a chat (0: never). */
export const lastCeoAt = (c: ChatView) => c.messages.reduce((t, m) => (m.from === 'ceo' && m.at > t ? m.at : t), 0);

/** Whether a chat has a word from the CEO newer than what you've read (`seenAt`). */
export const chatUnread = (c: ChatView, seenAt: number | undefined) => lastCeoAt(c) > (seenAt ?? 0);

/** How many chats have CEO replies you haven't read; `seen` holds, per chat id, the newest one you have. */
export const unreadChats = (chats: readonly ChatView[], seen: Readonly<Record<string, number>>) => chats.filter((c) => chatUnread(c, seen[c.id])).length;

/** A chat's last line for the list: one line, "You: " before yours. */
export function lastLine(c: ChatView, max = 80): string {
  const m = c.messages.at(-1);
  if (!m) return 'No messages yet';
  const one = m.text.replace(/\s+/g, ' ').trim() || (m.proposalId !== null ? 'A project proposal' : '');
  const line = m.from === 'manager' ? `You: ${one}` : one;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Whether a chat started a floor: one of its proposals went through. */
export const chatLaunched = (c: ChatView, proposals: readonly ProjectProposal[]) => proposals.some((p) => p.chatId === c.id && p.status === 'started');

// ---------- notices ----------

/**
 * The office's notices and the CEO's job reports: the Notices feed. Left out: what you told the CEO, and the old phone
 * chat's replies (the CEO's without a floor), which live on in the "Earlier messages" chat; a report is always a floor's.
 */
export const isNotice = (m: OfficeMessage) => m.from === 'office' || (m.from === 'ceo' && m.floorId !== null);

/** The feed, newest first. */
export const noticeFeed = (messages: readonly OfficeMessage[]) => messages.filter(isNotice).reverse();

/** Notices newer than `since` (the newest you've read). */
export const unreadNotices = (messages: readonly OfficeMessage[], since: number) => messages.filter((m) => isNotice(m) && m.at > since).length;

/** The newest notice's time (0: none). */
export const newestNotice = (messages: readonly OfficeMessage[]) => messages.reduce((t, m) => (isNotice(m) && m.at > t ? m.at : t), 0);

// ---------- what's new, all told ----------

export interface DeskSeen {
  chats: Record<string, number>; // per chat id, the newest CEO message read
  notices: number; // the newest notice read
}

export interface DeskNews {
  discussions: number; // threads waiting on you
  chats: number; // chats with replies you haven't read
  notices: number;
  total: number;
}

export function deskNews(o: { chats: readonly ChatView[]; discussions: readonly DiscussionView[]; questions: readonly Question[]; messages: readonly OfficeMessage[] }, seen: DeskSeen): DeskNews {
  const discussions = waitingCount(o.discussions, o.questions);
  const chats = unreadChats(o.chats, seen.chats);
  const notices = unreadNotices(o.messages, seen.notices);
  return { discussions, chats, notices, total: discussions + chats + notices };
}

/** What's new, in words, for the HUD button's tooltip. */
export function newsLine(n: DeskNews): string {
  const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts = [
    n.discussions && plural(n.discussions, 'thread waits on you', 'threads wait on you'),
    n.chats && plural(n.chats, 'chat with a new reply', 'chats with new replies'),
    n.notices && plural(n.notices, 'notice', 'notices'),
  ].filter(Boolean);
  return parts.length ? `Your desktop (P): ${parts.join(', ')}` : 'Your desktop (P)';
}

// ---------- a project card, as the manager edits it ----------

/** What GitHub takes as a repository's name. */
export const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const FULL_NAME = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

export interface ProposalEdit {
  repo: ProposalRepo;
  teamSize: number;
  keep: boolean[]; // per task: still in
}

export const proposalEdit = (p: ProjectProposal): ProposalEdit => ({ repo: p.repo, teamSize: p.teamSize, keep: p.tasks.map(() => true) });

/** What's wrong with the edited card, field by field; empty when it can be approved. */
export function editProblems(e: ProposalEdit, maxWorkers: number): Partial<Record<'owner' | 'name' | 'fullName' | 'teamSize' | 'tasks', string>> {
  const out: Partial<Record<'owner' | 'name' | 'fullName' | 'teamSize' | 'tasks', string>> = {};
  if (e.repo.kind === 'new') {
    if (!e.repo.owner.trim()) out.owner = 'Pick where the repository goes';
    const name = e.repo.name.trim();
    if (!REPO_NAME.test(name)) out.name = name ? 'Letters, digits, dots, dashes and underscores only (100 at most)' : 'Give it a name';
    else if (name === '.' || name === '..') out.name = "That name isn't allowed";
  } else if (!FULL_NAME.test(e.repo.fullName.trim())) out.fullName = 'owner/name';
  if (!Number.isInteger(e.teamSize) || e.teamSize < 1 || e.teamSize > maxWorkers) out.teamSize = `1 to ${maxWorkers}`;
  if (e.keep.length > 0 && !e.keep.some(Boolean)) out.tasks = 'Keep at least one task';
  return out;
}

/** Kept tasks that wait on one left out, as [task, dependency] indices: they'd start without it. */
export function droppedDependencies(p: Pick<ProjectProposal, 'tasks'>, keep: readonly boolean[]): [number, number][] {
  return p.tasks.flatMap((t, i) => (keep[i] === false ? [] : t.dependsOn.filter((d) => keep[d] === false).map((d): [number, number] => [i, d])));
}

const sameRepo = (a: ProposalRepo, b: ProposalRepo) =>
  a.kind === 'new' && b.kind === 'new'
    ? a.owner === b.owner && a.name === b.name && a.description === b.description && a.private === b.private
    : a.kind === 'existing' && b.kind === 'existing' && a.fullName === b.fullName;

/** The approve command's body: only what the manager changed (tasks: the indices kept). */
export function approveBody(p: ProjectProposal, e: ProposalEdit): { repo?: ProposalRepo; teamSize?: number; tasks?: number[] } {
  const repo: ProposalRepo = e.repo.kind === 'new' ? { ...e.repo, owner: e.repo.owner.trim(), name: e.repo.name.trim(), description: e.repo.description.trim() } : { kind: 'existing', fullName: e.repo.fullName.trim() };
  const body: { repo?: ProposalRepo; teamSize?: number; tasks?: number[] } = {};
  if (!sameRepo(repo, p.repo)) body.repo = repo;
  if (e.teamSize !== p.teamSize) body.teamSize = e.teamSize;
  if (e.keep.some((k) => !k)) body.tasks = e.keep.flatMap((k, i) => (k ? [i] : []));
  return body;
}

/** "owner/name" of the card's repository. */
export const repoFullName = (r: ProposalRepo) => (r.kind === 'new' ? `${r.owner}/${r.name}` : r.fullName);

/** A message's proposal, if it carries one. */
export const proposalOf = (m: DeskMessage, proposals: readonly ProjectProposal[]) => (m.proposalId === null ? null : (proposals.find((p) => p.id === m.proposalId) ?? null));
