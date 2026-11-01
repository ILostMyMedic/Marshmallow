// The CEO proposes playbook changes in a chat, through its office tool, on the demo: a card waits for the manager, an
// approved one changes the playbook and says so in the chat, a declined one's note goes back to the CEO.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDemoBackend, type DemoBackend } from '../backend/demo.ts';
import { openDb, type Db } from '../db/db.ts';
import { Desk } from '../db/desk.ts';
import { Floors } from '../floors.ts';
import { createPipeline, type Pipeline } from '../pipeline/pipeline.ts';
import { Store } from '../store.ts';
import { IssueCap } from '../team/ceo/issueRules.ts';
import { officeHandlers } from '../team/ceo/office.ts';
import type { CeoJob } from '../team/ceo/prompts.ts';
import { Playbook } from './playbook.ts';
import { approvePlaybookChange, changeLabel, declinePlaybookChange, playbookDraftFrom } from './proposals.ts';

const INSTANT = { stepMs: () => 1, prepareMs: 1, installMs: 1, cloneMs: 1, checksMs: () => 5, closeAfterMergeMs: 5 };

let dir: string;
let store: Store;
let db: Db;
let desk: Desk;
let playbook: Playbook;
let backend: DemoBackend;
let pipeline: Pipeline;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-playbook-ceo-'));
  store = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  db = await openDb(null);
  desk = new Desk(db, store);
  await desk.load();
  playbook = new Playbook(db, store);
  await playbook.load();
  backend = createDemoBackend({ home: null, timing: INSTANT, rand: () => 0.9 });
  pipeline = createPipeline(store, backend, new Floors(store, backend), null, { desk, playbook });
});

afterEach(async () => {
  pipeline.scheduler.stop();
  pipeline.stopAll();
  backend.github.close();
  await new Promise((r) => setTimeout(r, 50));
  await db.close();
  await store.flush();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

async function until(done: () => boolean | Promise<boolean>, ms = 15_000) {
  const end = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const job = (o: Partial<CeoJob>): CeoJob => ({ kind: 'chat', floorId: null, chatId: null, discussionId: null, text: '', at: 0, ...o });
const propose = (j: CeoJob, a: Partial<Parameters<ReturnType<typeof officeHandlers>['proposePlaybookChange']>[0]> = {}) =>
  officeHandlers(pipeline.ctx, j, new IssueCap(12), 'Mallow').proposePlaybookChange({ scope: 'office', kind: 'rules', name: 'tests-first', body: '- Run the tests', why: 'PRs fail CI', ...a });

describe('propose_playbook_change', () => {
  it('puts a card in the chat it was called from, and refuses outside a chat or discussion', async () => {
    const chat = await desk.createChat('Rules');
    expect(await propose(job({ chatId: chat.id }))).toBe('Proposed new the office\'s rules "tests-first". The manager sees it as a card in this chat and approves, edits or declines it there; nothing changes until then. Mention it briefly in your final message.');
    expect(playbook.get().proposals).toMatchObject([{ thread: { kind: 'chat', id: chat.id }, status: 'pending' }]);
    await expect(propose(job({ kind: 'onboard', floorId: 'x/y' }))).rejects.toThrow(/in a chat or a discussion/);
    await expect(propose(job({ chatId: chat.id }), { scope: 'floor' })).rejects.toThrow(/Say which floor/);
    await expect(propose(job({ chatId: chat.id }), { scope: 'floor', floor: 9 })).rejects.toThrow(/There is no floor 9/);
  });

  it('turns its input into a doc, checking scope and kind', () => {
    const floorOf = () => 'acme/app';
    expect(playbookDraftFrom({ scope: 'floor', floor: 1, kind: 'skill', name: 'x', description: 'd', body: 'b', why: 'w' }, floorOf)).toEqual({ scope: 'floor', floorId: 'acme/app', kind: 'skill', name: 'x', description: 'd', body: 'b', tools: '', model: '' });
    expect(() => playbookDraftFrom({ scope: 'office', kind: 'memo', name: 'x', body: 'b', why: 'w' }, floorOf)).toThrow(/kind must be/);
    expect(changeLabel({ scope: 'floor', floorId: 'acme/app', kind: 'agent', name: 'reviewer' })).toBe('acme/app\'s subagent "reviewer"');
  });

  it('sends a declined card\'s note to the CEO, who answers in the chat', async () => {
    pipeline.ctx.ceo.hire();
    pipeline.scheduler.start(20);
    const chat = await desk.createChat('Rules');
    await propose(job({ chatId: chat.id }));
    const [p] = playbook.get().proposals;
    await declinePlaybookChange(pipeline.ctx, playbook, p.id, 'Not now');
    expect((await desk.chat(chat.id)).messages[0]).toMatchObject({ from: 'manager', text: 'Declined the playbook change to the office\'s rules "tests-first": Not now' });
    await until(async () => (await desk.chat(chat.id)).messages.at(-1)?.from === 'ceo');
    expect((await desk.chat(chat.id)).messages.at(-1)?.text).toContain("I'll leave the playbook as it is");
  });
});

describe('the scripted CEO on the demo', () => {
  it('proposes rules when a chat asks for them, and once they are in, a line more for them', async () => {
    pipeline.ctx.ceo.hire();
    pipeline.scheduler.start(20);
    const chat = await pipeline.ctx.ceo.newChat('Can we have some rules for the workers?');
    await until(() => desk.get().chats[0]?.messages.at(-1)?.from === 'ceo');
    expect(desk.get().chats[0].messages.at(-1)?.text).toContain('I proposed office rules, "tests-first"');
    const [p] = playbook.get().proposals;
    expect(p).toMatchObject({ thread: { kind: 'chat', id: chat.id }, status: 'pending', docId: null, draft: { scope: 'office', kind: 'rules', name: 'tests-first' } });

    await approvePlaybookChange(pipeline.ctx, playbook, p.id, {});
    expect(playbook.get().docs.map((d) => d.name)).toEqual(['tests-first']);
    expect(desk.get().chats[0].messages.at(-1)).toMatchObject({ from: 'office', text: expect.stringContaining('Playbook: added the office\'s rules "tests-first"') });

    // asked again, it proposes one more line: a change, with the old text kept for the diff
    await pipeline.ctx.ceo.postToChat(chat.id, 'More rules please');
    await until(() => playbook.get().proposals.length === 2 && desk.get().chats[0].messages.at(-1)?.from === 'ceo');
    expect(playbook.get().proposals[1]).toMatchObject({ docId: playbook.get().docs[0].id, before: { body: playbook.get().docs[0].body } });
  }, 30_000);
});
