// The desktop's chats with the CEO, its project proposals and its discussions, kept in the office database. The latest
// stay in memory as the tabs' DeskView; every change is written through first, then the whole desk goes to every tab.
// Each chat and discussion keeps the CEO session its jobs resume (server/team/ceo/jobs.ts), so ideas don't mix.
import { EMPTY_DESK, type ChatView, type DeskMessage, type DeskView, type DiscussionView, type OfficeMessage, type ProjectProposal } from '../../shared/types.ts';
import { HttpError } from '../httpError.ts';
import type { Store } from '../store.ts';
import type { Db } from './db.ts';

/** How much of the desk memory (and so the snapshot) holds: chats, the latest messages of each, discussions. */
export interface DeskLimits {
  chats: number;
  messages: number;
  discussions: number;
}
export const DESK_LIMITS: DeskLimits = { chats: 50, messages: 200, discussions: 50 };

/** The two kinds of thread the CEO answers in. */
export type ThreadKind = 'chat' | 'discussion';

/** A thread as the CEO's jobs see it. */
export interface DeskThread {
  title: string;
  context: string; // a discussion: where it was opened ('' for a chat)
  floorId: string | null; // a discussion: the floor it's about, if one
  sessionId: string | null; // the CEO session its jobs resume
  messages: readonly DeskMessage[]; // oldest first
}

/** What the CEO proposes; the rest of a ProjectProposal is the office's. */
export type ProposalDraft = Pick<ProjectProposal, 'repo' | 'brief' | 'teamSize' | 'tasks'>;
/** What starting a project changes on its proposal. */
export type ProposalPatch = Partial<Pick<ProjectProposal, 'status' | 'repo' | 'teamSize' | 'tasks' | 'step' | 'floorId' | 'issueNumbers' | 'error' | 'decidedAt'>>;

interface Chat {
  id: number;
  title: string;
  sessionId: string | null;
  createdAt: number;
  updatedAt: number;
  messages: DeskMessage[];
}

interface Discussion {
  id: number;
  title: string;
  floorId: string | null;
  status: 'open' | 'resolved';
  outcome: string | null;
  context: string;
  sessionId: string | null;
  openedAt: number;
  updatedAt: number;
  messages: DeskMessage[];
}

interface ChatRow {
  id: number;
  title: string;
  session_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface MessageRow {
  id: number;
  at: Date;
  sender: string;
  text: string;
  proposal_id?: number | null;
}

interface ProposalRow {
  id: number;
  chat_id: number;
  at: Date;
  status: ProjectProposal['status'];
  repo: ProjectProposal['repo'];
  brief: string;
  team_size: number;
  tasks: ProjectProposal['tasks'];
  step: string | null;
  floor_id: string | null;
  issue_numbers: number[];
  error: string | null;
  decided_at: Date | null;
}

interface DiscussionRow {
  id: number;
  title: string;
  floor_id: string | null;
  status: string;
  outcome: string | null;
  context: string;
  session_id: string | null;
  opened_at: Date;
  updated_at: Date;
}

/** A chat's title from the manager's first message: its first line, at most 60 characters. */
export function titleFrom(text: string): string {
  const line = text.trim().split(/\r?\n/)[0].trim();
  if (!line) return 'New chat';
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}

const senderOf = (s: string): DeskMessage['from'] => (s === 'manager' || s === 'ceo' ? s : 'office');
const messageOf = (r: MessageRow): DeskMessage => ({ id: r.id, at: r.at.getTime(), from: senderOf(r.sender), text: r.text, proposalId: r.proposal_id ?? null });
const proposalOf = (r: ProposalRow): ProjectProposal => ({
  id: r.id,
  chatId: r.chat_id,
  at: r.at.getTime(),
  status: r.status,
  repo: r.repo,
  brief: r.brief,
  teamSize: r.team_size,
  tasks: r.tasks,
  step: r.step,
  floorId: r.floor_id,
  issueNumbers: r.issue_numbers ?? [],
  error: r.error,
  decidedAt: r.decided_at?.getTime() ?? null,
});
const recent = (a: { updatedAt: number; id: number }, b: { updatedAt: number; id: number }) => b.updatedAt - a.updatedAt || b.id - a.id;
// Open discussions first, then the most recently active.
const relevant = (a: Discussion, b: Discussion) => Number(b.status === 'open') - Number(a.status === 'open') || recent(a, b);
const sameSet = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every((x) => b.has(x));

export class Desk {
  private chats = new Map<number, Chat>();
  private discussions = new Map<number, Discussion>();
  private proposals = new Map<number, ProjectProposal>(); // the chats' in memory
  private owners: string[] = [];
  private replying = { chats: new Set<number>(), discussions: new Set<number>() };
  private view: DeskView = EMPTY_DESK;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly limits: DeskLimits = DESK_LIMITS,
    private readonly now: () => number = Date.now,
  ) {}

  get(): DeskView {
    return this.view;
  }

  async load() {
    // The office stopped while starting a project: approving it again picks up where it got to (server/desk/projects.ts).
    await this.db.query("update proposals set status = 'failed', step = null, error = 'The office stopped while it was starting this project.' where status = 'starting'");
    await this.loadChats();
    await this.loadDiscussions();
    this.view = this.build();
  }

  /**
   * The phone's chat from before the desktop (state.json's messages between the manager and the CEO), copied once into
   * a chat of its own, "Earlier messages", if no chat was ever made. Its CEO session isn't carried over: the chat's next
   * job carries the thread instead. True when it copied something.
   */
  importPhone(messages: readonly OfficeMessage[]): Promise<boolean> {
    return this.serial(async () => {
      const old = messages.filter((m) => m.from === 'manager' || (m.from === 'ceo' && m.floorId === null));
      if (!old.length) return false;
      // A sequence that was never used: no chat was ever made, not even one deleted since.
      const used = (await this.db.query<{ is_called: boolean }>('select is_called from chats_id_seq')).rows[0]?.is_called;
      if (used) return false;
      const id = await this.db.transaction(async (tx) => {
        const chat = (await tx.query<{ id: number }>('insert into chats (title, created_at, updated_at) values ($1, $2, $3) returning id', ['Earlier messages', new Date(old[0].at), new Date(old.at(-1)!.at)])).rows[0];
        for (const m of old) await tx.query('insert into chat_messages (chat_id, at, sender, text) values ($1, $2, $3, $4)', [chat.id, new Date(m.at), m.from, m.text]);
        return chat.id;
      });
      await this.chatById(id);
      this.changed();
      return true;
    });
  }

  /** Where a new repository can go: the gh login, then its organisations (fetched at startup). */
  setOwners(owners: readonly string[]) {
    if (owners.join('\n') === this.owners.join('\n')) return;
    this.owners = [...owners];
    this.changed(false);
  }

  /** Which chats and discussions the CEO has a job for, waiting or running. */
  setReplying(chats: Iterable<number>, discussions: Iterable<number>) {
    const next = { chats: new Set(chats), discussions: new Set(discussions) };
    if (sameSet(next.chats, this.replying.chats) && sameSet(next.discussions, this.replying.discussions)) return;
    this.replying = next;
    this.changed(false);
  }

  /** A thread in memory (where every thread with a job is), for the CEO's job; null when it's gone. */
  thread(kind: ThreadKind, id: number): DeskThread | null {
    if (kind === 'chat') {
      const c = this.chats.get(id);
      return c ? { title: c.title, context: '', floorId: null, sessionId: c.sessionId, messages: c.messages } : null;
    }
    const d = this.discussions.get(id);
    return d ? { title: d.title, context: d.context, floorId: d.floorId, sessionId: d.sessionId, messages: d.messages } : null;
  }

  // ---------- chats ----------

  createChat(title: string): Promise<ChatView> {
    return this.serial(async () => {
      const at = new Date(this.now());
      const row = (await this.db.query<ChatRow>('insert into chats (title, created_at, updated_at) values ($1, $2, $2) returning *', [title, at])).rows[0];
      const chat = this.chatOf(row, []);
      this.chats.set(chat.id, chat);
      this.changed();
      return this.chatView(chat);
    });
  }

  /** A chat as the tabs see it; 404 when there's none. */
  chat(id: number): Promise<ChatView> {
    return this.serial(async () => this.chatView(await this.chatById(id)));
  }

  renameChat(id: number, title: string): Promise<ChatView> {
    return this.serial(async () => {
      await this.chatById(id);
      await this.db.query('update chats set title = $2 where id = $1', [id, title]);
      const next = this.patchChat(id, { title });
      this.changed();
      return this.chatView(next);
    });
  }

  /** Deletes a chat, its messages and its proposals; refused while its project is starting. */
  deleteChat(id: number): Promise<void> {
    return this.serial(async () => {
      await this.chatById(id);
      const starting = (await this.db.query('select 1 from proposals where chat_id = $1 and status = $2', [id, 'starting'])).rows.length;
      if (starting) throw new HttpError(409, "Its project is starting: wait until it's done");
      await this.db.query('delete from chats where id = $1', [id]);
      await this.loadChats(); // an older chat may come into view
      this.changed();
    });
  }

  // ---------- messages ----------

  /** A message in a thread; 404 when the thread is gone. */
  post(kind: ThreadKind, id: number, from: DeskMessage['from'], text: string, proposalId: number | null = null): Promise<DeskMessage> {
    return this.serial(async () => {
      const at = this.now();
      if (kind === 'chat') {
        const chat = await this.chatById(id);
        const row = await this.db.transaction(async (tx) => {
          await tx.query('update chats set updated_at = $2 where id = $1', [id, new Date(at)]);
          return (await tx.query<{ id: number }>('insert into chat_messages (chat_id, at, sender, text, proposal_id) values ($1, $2, $3, $4, $5) returning id', [id, new Date(at), from, text, proposalId])).rows[0];
        });
        const m: DeskMessage = { id: row.id, at, from, text, proposalId };
        this.patchChat(id, { updatedAt: at, messages: [...chat.messages, m].slice(-this.limits.messages) });
        this.changed();
        return m;
      }
      const d = await this.discussionById(id);
      const row = await this.db.transaction(async (tx) => {
        await tx.query('update discussions set updated_at = $2 where id = $1', [id, new Date(at)]);
        return (await tx.query<{ id: number }>('insert into discussion_messages (discussion_id, at, sender, text) values ($1, $2, $3, $4) returning id', [id, new Date(at), from, text])).rows[0];
      });
      const m: DeskMessage = { id: row.id, at, from, text, proposalId: null };
      this.patchDiscussion(id, { updatedAt: at, messages: [...d.messages, m].slice(-this.limits.messages) });
      this.changed();
      return m;
    });
  }

  /**
   * The CEO session a thread's next job resumes (null: the next one starts afresh). Memory has it at once, so a job
   * queued behind the one that just ended resumes it; it isn't in the view.
   */
  setSession(kind: ThreadKind, id: number, sessionId: string | null): Promise<void> {
    if (kind === 'chat') this.patchChat(id, { sessionId });
    else this.patchDiscussion(id, { sessionId });
    return this.serial(async () => {
      await this.db.query(`update ${kind === 'chat' ? 'chats' : 'discussions'} set session_id = $2 where id = $1`, [id, sessionId]);
    });
  }

  // ---------- discussions ----------

  /** The CEO opens a discussion with its first message. */
  openDiscussion(o: { title: string; floorId: string | null; context: string; message: string }): Promise<DiscussionView> {
    return this.serial(async () => {
      const at = new Date(this.now());
      const d = await this.db.transaction(async (tx) => {
        const row = (await tx.query<DiscussionRow>('insert into discussions (title, floor_id, status, context, opened_at, updated_at) values ($1, $2, $3, $4, $5, $5) returning *', [o.title, o.floorId, 'open', o.context, at])).rows[0];
        const m = (await tx.query<MessageRow>('insert into discussion_messages (discussion_id, at, sender, text) values ($1, $2, $3, $4) returning *', [row.id, at, 'ceo', o.message])).rows[0];
        return this.discussionOf(row, [messageOf(m)]);
      });
      this.discussions.set(d.id, d);
      this.changed();
      return this.discussionView(d);
    });
  }

  /** A discussion as the tabs see it; 404 when there's none. */
  discussion(id: number): Promise<DiscussionView> {
    return this.serial(async () => this.discussionView(await this.discussionById(id)));
  }

  /** Settled, by the CEO or the manager; the outcome says how. */
  resolveDiscussion(id: number, outcome: string | null): Promise<DiscussionView> {
    return this.serial(async () => {
      await this.discussionById(id);
      const at = this.now();
      await this.db.query('update discussions set status = $2, outcome = $3, updated_at = $4 where id = $1', [id, 'resolved', outcome, new Date(at)]);
      const next = this.patchDiscussion(id, { status: 'resolved', outcome, updatedAt: at });
      this.changed();
      return this.discussionView(next);
    });
  }

  /** The manager writes in a settled discussion: it opens again, and the thread keeps how it had been settled. */
  reopenDiscussion(id: number): Promise<void> {
    return this.serial(async () => {
      const d = await this.discussionById(id);
      if (d.status === 'open') return;
      const at = this.now();
      const note = d.outcome ? `Settled earlier as: ${d.outcome}` : null;
      const row = await this.db.transaction(async (tx) => {
        await tx.query('update discussions set status = $2, outcome = null, updated_at = $3 where id = $1', [id, 'open', new Date(at)]);
        return note ? (await tx.query<MessageRow>('insert into discussion_messages (discussion_id, at, sender, text) values ($1, $2, $3, $4) returning *', [id, new Date(at), 'office', note])).rows[0] : null;
      });
      this.patchDiscussion(id, { status: 'open', outcome: null, updatedAt: at, messages: row ? [...d.messages, messageOf(row)].slice(-this.limits.messages) : d.messages });
      this.changed();
    });
  }

  // ---------- proposals ----------

  /** The CEO's project card in a chat; it replaces the chat's pending one. */
  propose(chatId: number, draft: ProposalDraft): Promise<ProjectProposal> {
    return this.serial(async () => {
      await this.chatById(chatId);
      const at = new Date(this.now());
      const row = await this.db.transaction(async (tx) => {
        await tx.query("update proposals set status = 'replaced' where chat_id = $1 and status = 'pending'", [chatId]);
        return (
          await tx.query<ProposalRow>('insert into proposals (chat_id, at, status, repo, brief, team_size, tasks) values ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb) returning *', [
            chatId,
            at,
            'pending',
            JSON.stringify(draft.repo),
            draft.brief,
            draft.teamSize,
            JSON.stringify(draft.tasks),
          ])
        ).rows[0];
      });
      for (const p of this.proposals.values()) if (p.chatId === chatId && p.status === 'pending') this.proposals.set(p.id, { ...p, status: 'replaced' });
      const proposal = proposalOf(row);
      this.proposals.set(proposal.id, proposal);
      this.changed();
      return proposal;
    });
  }

  /** A proposal, from memory or the database; 404 when there's none. */
  proposal(id: number): Promise<ProjectProposal> {
    return this.serial(() => this.proposalById(id));
  }

  patchProposal(id: number, patch: ProposalPatch): Promise<ProjectProposal> {
    return this.serial(async () => {
      const next = { ...(await this.proposalById(id)), ...patch, id };
      await this.db.query(
        'update proposals set status = $2, repo = $3::jsonb, team_size = $4, tasks = $5::jsonb, step = $6, floor_id = $7, issue_numbers = $8::jsonb, error = $9, decided_at = $10 where id = $1',
        [id, next.status, JSON.stringify(next.repo), next.teamSize, JSON.stringify(next.tasks), next.step, next.floorId, JSON.stringify(next.issueNumbers), next.error, next.decidedAt === null ? null : new Date(next.decidedAt)],
      );
      if (this.chats.has(next.chatId)) {
        this.proposals.set(id, next);
        this.changed(false);
      }
      return next;
    });
  }

  // ---------- inside ----------

  // Changes merge into what memory holds now (setSession writes it outside the queue); a thread not in memory is left.
  private patchChat(id: number, patch: Partial<Chat>): Chat {
    const next = { ...this.chats.get(id)!, ...patch, id };
    if (this.chats.has(id)) this.chats.set(id, next);
    return next;
  }

  private patchDiscussion(id: number, patch: Partial<Discussion>): Discussion {
    const next = { ...this.discussions.get(id)!, ...patch, id };
    if (this.discussions.has(id)) this.discussions.set(id, next);
    return next;
  }

  private chatOf(r: ChatRow, messages: DeskMessage[]): Chat {
    return { id: r.id, title: r.title, sessionId: r.session_id, createdAt: r.created_at.getTime(), updatedAt: r.updated_at.getTime(), messages };
  }

  private discussionOf(r: DiscussionRow, messages: DeskMessage[]): Discussion {
    return {
      id: r.id,
      title: r.title,
      floorId: r.floor_id,
      status: r.status === 'resolved' ? 'resolved' : 'open',
      outcome: r.outcome,
      context: r.context,
      sessionId: r.session_id,
      openedAt: r.opened_at.getTime(),
      updatedAt: r.updated_at.getTime(),
      messages,
    };
  }

  private chatView(c: Chat): ChatView {
    return { id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, replying: this.replying.chats.has(c.id), messages: c.messages };
  }

  private discussionView(d: Discussion): DiscussionView {
    const { id, title, floorId, openedAt, updatedAt, status, outcome, messages } = d;
    return { id, title, floorId, openedAt, updatedAt, status, outcome, replying: this.replying.discussions.has(id), messages };
  }

  private async loadChats() {
    const rows = (await this.db.query<ChatRow>('select * from chats order by updated_at desc, id desc limit $1', [this.limits.chats])).rows;
    this.chats.clear();
    this.proposals.clear();
    for (const r of rows) await this.readChat(r);
  }

  private async loadDiscussions() {
    const rows = (await this.db.query<DiscussionRow>("select * from discussions order by (status = 'open') desc, updated_at desc, id desc limit $1", [this.limits.discussions])).rows;
    this.discussions.clear();
    for (const r of rows) await this.readDiscussion(r);
  }

  /** A chat into memory with its latest messages and its proposals. */
  private async readChat(r: ChatRow): Promise<Chat> {
    const messages = (await this.db.query<MessageRow>('select * from (select * from chat_messages where chat_id = $1 order by id desc limit $2) m order by id', [r.id, this.limits.messages])).rows.map(messageOf);
    for (const p of (await this.db.query<ProposalRow>('select * from proposals where chat_id = $1 order by id', [r.id])).rows) this.proposals.set(p.id, proposalOf(p));
    const chat = this.chatOf(r, messages);
    this.chats.set(chat.id, chat);
    return chat;
  }

  private async readDiscussion(r: DiscussionRow): Promise<Discussion> {
    const messages = (await this.db.query<MessageRow>('select * from (select * from discussion_messages where discussion_id = $1 order by id desc limit $2) m order by id', [r.id, this.limits.messages])).rows.map(messageOf);
    const d = this.discussionOf(r, messages);
    this.discussions.set(d.id, d);
    return d;
  }

  /** A chat, from memory or (one too old for the snapshot) the database. */
  private async chatById(id: number): Promise<Chat> {
    const c = this.chats.get(id);
    if (c) return c;
    const row = Number.isSafeInteger(id) ? (await this.db.query<ChatRow>('select * from chats where id = $1', [id])).rows[0] : undefined;
    if (!row) throw new HttpError(404, `No chat ${id}`);
    return this.readChat(row);
  }

  private async discussionById(id: number): Promise<Discussion> {
    const d = this.discussions.get(id);
    if (d) return d;
    const row = Number.isSafeInteger(id) ? (await this.db.query<DiscussionRow>('select * from discussions where id = $1', [id])).rows[0] : undefined;
    if (!row) throw new HttpError(404, `No discussion ${id}`);
    return this.readDiscussion(row);
  }

  private async proposalById(id: number): Promise<ProjectProposal> {
    const p = this.proposals.get(id);
    if (p) return p;
    const row = Number.isSafeInteger(id) ? (await this.db.query<ProposalRow>('select * from proposals where id = $1', [id])).rows[0] : undefined;
    if (!row) throw new HttpError(404, `No proposal ${id}`);
    return proposalOf(row);
  }

  /** Memory back to the limits, the view rebuilt, and every tab told. */
  private changed(trim = true) {
    if (trim) {
      for (const c of [...this.chats.values()].sort(recent).slice(this.limits.chats)) {
        this.chats.delete(c.id);
        for (const p of [...this.proposals.values()]) if (p.chatId === c.id) this.proposals.delete(p.id);
      }
      for (const d of [...this.discussions.values()].sort(relevant).slice(this.limits.discussions)) this.discussions.delete(d.id);
    }
    this.view = this.build();
    this.store.publish({ type: 'desk', desk: this.view });
  }

  private build(): DeskView {
    const chats = [...this.chats.values()].sort(recent).map((c) => this.chatView(c));
    return {
      chats,
      proposals: [...this.proposals.values()].filter((p) => this.chats.has(p.chatId)).sort((a, b) => a.id - b.id),
      discussions: [...this.discussions.values()].sort(relevant).map((d) => this.discussionView(d)),
      owners: this.owners,
    };
  }

  /** One change at a time, so a thread's messages keep their order and memory follows the database. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
