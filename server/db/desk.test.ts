import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeskView, OfficeMessage, ServerEvent } from '../../shared/types.ts';
import { Store } from '../store.ts';
import { openDb, type Db } from './db.ts';
import { Desk, titleFrom, type DeskLimits, type ProposalDraft } from './desk.ts';

let dir: string;
let store: Store;
let db: Db;
let events: ServerEvent[];
let clock: number;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-desk-'));
  store = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  events = [];
  store.addClient({ OPEN: 1, readyState: 1, send: (t: string) => events.push(JSON.parse(t)), on: () => undefined } as unknown as WebSocket);
  db = await openDb(null);
  clock = 1_000_000;
});
afterEach(async () => {
  await db.close();
  await store.flush();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

/** A desk on the test's database, its clock a tick on with every reading. */
async function newDesk(limits?: DeskLimits) {
  const desk = new Desk(db, store, limits, () => (clock += 1000));
  await desk.load();
  return desk;
}
const lastDesk = (): DeskView | undefined => events.filter((e): e is Extract<ServerEvent, { type: 'desk' }> => e.type === 'desk').at(-1)?.desk;
const draft = (name = 'todo'): ProposalDraft => ({
  repo: { kind: 'new', owner: 'me', name, description: 'A todo app', private: true },
  brief: 'Todos for kids',
  teamSize: 2,
  tasks: [
    { title: 'Skeleton', body: '', dependsOn: [] },
    { title: 'Lists', body: 'Lists of todos', dependsOn: [0] },
  ],
});

describe('titleFrom', () => {
  it("names a chat by its first message's first line, at most 60 characters", () => {
    expect(titleFrom('  A recipe app\nfor kids')).toBe('A recipe app');
    expect(titleFrom('')).toBe('New chat');
    const long = titleFrom('x'.repeat(80));
    expect(long).toHaveLength(60);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('the desk', () => {
  it('keeps chats with their messages, the most recently active first, and tells every tab', async () => {
    const desk = await newDesk();
    const a = await desk.createChat('Recipes');
    const b = await desk.createChat('Weather');
    await desk.post('chat', a.id, 'manager', 'Recipes for kids?');
    await desk.post('chat', a.id, 'ceo', 'Who is it for?');
    expect(desk.get().chats.map((c) => c.id)).toEqual([a.id, b.id]);
    expect(desk.get().chats[0].messages.map((m) => [m.from, m.text])).toEqual([
      ['manager', 'Recipes for kids?'],
      ['ceo', 'Who is it for?'],
    ]);
    expect(lastDesk()).toEqual(desk.get());

    await desk.post('chat', b.id, 'manager', 'Sunny?');
    expect(desk.get().chats[0].id).toBe(b.id);
    expect((await desk.renameChat(b.id, 'Forecasts')).title).toBe('Forecasts');
    await expect(desk.post('chat', 999, 'manager', 'hi')).rejects.toMatchObject({ status: 404 });
    await expect(desk.chat(999)).rejects.toMatchObject({ status: 404 });
  });

  it("keeps each thread's CEO session out of the view, and everything across a restart", async () => {
    const desk = await newDesk();
    const chat = await desk.createChat('Recipes');
    await desk.post('chat', chat.id, 'manager', 'Hello');
    void desk.setSession('chat', chat.id, 'session-chat');
    expect(desk.thread('chat', chat.id)?.sessionId).toBe('session-chat'); // at once, for a job queued behind
    const d = await desk.openDiscussion({ title: 'Scope', floorId: 'acme/app', context: 'while planning floor 1', message: 'A slice?' });
    await desk.setSession('discussion', d.id, 'session-d');
    expect(JSON.stringify(desk.get())).not.toContain('session-');

    const again = await newDesk();
    expect(again.get().chats.map((c) => [c.title, c.messages.map((m) => m.text)])).toEqual([['Recipes', ['Hello']]]);
    expect(again.thread('chat', chat.id)).toMatchObject({ sessionId: 'session-chat', context: '', floorId: null });
    expect(again.thread('discussion', d.id)).toMatchObject({ sessionId: 'session-d', context: 'while planning floor 1', floorId: 'acme/app', title: 'Scope' });
  });

  it('holds the latest chats and messages in the view, and an older chat comes back when one is deleted or written to', async () => {
    const desk = await newDesk({ chats: 2, messages: 3, discussions: 2 });
    const [a, b, c] = [await desk.createChat('A'), await desk.createChat('B'), await desk.createChat('C')];
    expect(desk.get().chats.map((x) => x.title)).toEqual(['C', 'B']);
    for (let i = 1; i <= 5; i++) await desk.post('chat', c.id, 'manager', `m${i}`);
    expect(desk.get().chats[0].messages.map((m) => m.text)).toEqual(['m3', 'm4', 'm5']);
    // Writing to a chat out of view brings it back to the top.
    await desk.post('chat', a.id, 'manager', 'back');
    expect(desk.get().chats.map((x) => x.title)).toEqual(['A', 'C']);
    // Deleting one lets the next most recent in.
    await desk.deleteChat(c.id);
    expect(desk.get().chats.map((x) => x.title)).toEqual(['A', 'B']);
    expect((await db.query('select * from chat_messages where chat_id = $1', [c.id])).rows).toEqual([]);
    await expect(desk.deleteChat(b.id + 100)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps discussions open first, settles them, and opens a settled one again with how it had been settled', async () => {
    const desk = await newDesk();
    const d1 = await desk.openDiscussion({ title: 'Scope', floorId: null, context: '', message: 'A slice?' });
    const d2 = await desk.openDiscussion({ title: 'Sign-in', floorId: null, context: '', message: 'Email links?' });
    await desk.post('discussion', d1.id, 'manager', 'A slice');
    expect(desk.get().discussions.map((d) => d.title)).toEqual(['Scope', 'Sign-in']);
    const settled = await desk.resolveDiscussion(d1.id, 'Start with a slice');
    expect(settled).toMatchObject({ status: 'resolved', outcome: 'Start with a slice' });
    expect(desk.get().discussions.map((d) => d.title)).toEqual(['Sign-in', 'Scope']); // open ones first

    await desk.reopenDiscussion(d1.id);
    const view = await desk.discussion(d1.id);
    expect(view).toMatchObject({ status: 'open', outcome: null });
    expect(view.messages.map((m) => [m.from, m.text])).toEqual([
      ['ceo', 'A slice?'],
      ['manager', 'A slice'],
      ['office', 'Settled earlier as: Start with a slice'],
    ]);
    expect(d2.messages).toHaveLength(1);
  });

  it('puts a project card in a chat, replacing the pending one, and changes it as it starts', async () => {
    const desk = await newDesk();
    const chat = await desk.createChat('Todos');
    const first = await desk.propose(chat.id, draft('todo'));
    const second = await desk.propose(chat.id, draft('todo-2'));
    expect(desk.get().proposals.map((p) => [p.id, p.status])).toEqual([
      [first.id, 'replaced'],
      [second.id, 'pending'],
    ]);
    expect(second).toMatchObject({ chatId: chat.id, repo: { kind: 'new', name: 'todo-2' }, tasks: [{ title: 'Skeleton' }, { dependsOn: [0] }], floorId: null, issueNumbers: [], decidedAt: null });
    const patched = await desk.patchProposal(second.id, { status: 'starting', step: 'Creating…', teamSize: 3, issueNumbers: [4, 5], decidedAt: 42 });
    expect(desk.get().proposals.at(-1)).toEqual(patched);
    await expect(desk.proposal(999)).rejects.toMatchObject({ status: 404 });
    await expect(desk.deleteChat(chat.id)).rejects.toMatchObject({ status: 409 }); // while it's starting

    // A project left starting when the office stopped comes back failed, to be approved again.
    const again = await newDesk();
    expect(await again.proposal(second.id)).toMatchObject({ status: 'failed', step: null, teamSize: 3, issueNumbers: [4, 5], decidedAt: 42, error: expect.stringContaining('stopped') });
    await again.deleteChat(chat.id);
    expect(again.get().proposals).toEqual([]);
    expect((await db.query('select * from proposals')).rows).toEqual([]);
  });

  it("copies the phone's old chat with the CEO into a chat of its own, once", async () => {
    const msg = (id: number, from: OfficeMessage['from'], text: string, floorId: string | null = null): OfficeMessage => ({ id, at: id * 1000, text, floorId, from });
    const phone = [msg(1, 'office', 'PR #3 needs you'), msg(2, 'manager', 'How are things?'), msg(3, 'ceo', 'Floor 1 is busy.'), msg(4, 'ceo', 'Onboarded floor 2', 'acme/b')];
    const desk = await newDesk();
    expect(await desk.importPhone(phone)).toBe(true);
    expect(desk.get().chats).toMatchObject([{ title: 'Earlier messages', createdAt: 2000, updatedAt: 3000, messages: [{ from: 'manager', text: 'How are things?', at: 2000 }, { from: 'ceo', text: 'Floor 1 is busy.' }] }]);
    expect(desk.thread('chat', desk.get().chats[0].id)?.sessionId).toBeNull();
    // Never again, even once that chat is deleted.
    await desk.deleteChat(desk.get().chats[0].id);
    expect(await desk.importPhone(phone)).toBe(false);
    expect(desk.get().chats).toEqual([]);
  });

  it('marks the threads the CEO is replying in, and owners, telling the tabs only of changes', async () => {
    const desk = await newDesk();
    const chat = await desk.createChat('Todos');
    const d = await desk.openDiscussion({ title: 'Scope', floorId: null, context: '', message: '?' });
    const before = events.length;
    desk.setReplying([chat.id], [d.id]);
    desk.setReplying([chat.id], [d.id]);
    desk.setOwners(['me', 'acme']);
    desk.setOwners(['me', 'acme']);
    expect(events.length - before).toBe(2);
    expect(desk.get()).toMatchObject({ chats: [{ replying: true }], discussions: [{ replying: true }], owners: ['me', 'acme'] });
    expect((await desk.chat(chat.id)).replying).toBe(true);
    desk.setReplying([], []);
    expect(desk.get().chats[0].replying).toBe(false);
  });
});
