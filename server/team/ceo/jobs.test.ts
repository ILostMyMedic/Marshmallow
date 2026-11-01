// The CEO's jobs on the desk: each chat and discussion resumes its own session (never the CEO's latest, which every
// job overwrites), carries only what's new once it has one, and says in its thread when it couldn't reply.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDemoBackend, type DemoBackend } from '../../backend/demo.ts';
import { openDb, type Db } from '../../db/db.ts';
import { Desk } from '../../db/desk.ts';
import { Floors } from '../../floors.ts';
import { createPipeline, type Pipeline } from '../../pipeline/pipeline.ts';
import type { SessionOptions } from '../../sessions/session.ts';
import { Store } from '../../store.ts';

const INSTANT = { stepMs: () => 1, prepareMs: 1, installMs: 1, cloneMs: 1, checksMs: () => 5, closeAfterMergeMs: 5 };
const REPO = 'demo-co/pixel-todo';

let dir: string;
let store: Store;
let db: Db;
let desk: Desk;
let backend: DemoBackend;
let floors: Floors;
let pipeline: Pipeline;
/** Every session the office started, in order. */
let started: SessionOptions[];

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-ceo-'));
  store = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  db = await openDb(null);
  desk = new Desk(db, store);
  await desk.load();
  backend = createDemoBackend({ home: null, timing: INSTANT, rand: () => 0.9 });
  started = [];
  const start = backend.startSession;
  backend.startSession = (o, cb) => {
    started.push(o);
    return start(o, cb);
  };
  floors = new Floors(store, backend);
  pipeline = createPipeline(store, backend, floors, null, { desk });
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

async function until(done: () => boolean, ms = 15_000) {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
const chatNow = (id: number) => desk.get().chats.find((c) => c.id === id)!;
const ceoSessions = () => started.filter((o) => o.role === 'ceo');

describe("the CEO's sessions", () => {
  it("resumes each chat's and discussion's own session, never the one the CEO's last job left", async () => {
    const ceo = pipeline.ctx.ceo.hire();
    await floors.connect(REPO, { autoAssign: false });
    pipeline.ctx.ceo.joined(REPO);
    pipeline.scheduler.start(20);
    await until(() => store.floor(REPO).summary !== '' && store.worker(ceo.id).status === 'idle');
    const onboarding = store.worker(ceo.id).sessionId;
    expect(ceoSessions().at(-1)?.resumeSessionId).toBeUndefined();
    expect(onboarding).toMatch(/^demo-/);

    // A new chat starts a session of its own, though the CEO's latest is the onboarding's.
    const chat = await pipeline.ctx.ceo.newChat('A recipe app for kids');
    expect(chat.replying).toBe(true);
    await until(() => chatNow(chat.id).messages.at(-1)?.from === 'ceo' && !chatNow(chat.id).replying);
    expect(ceoSessions().at(-1)).toMatchObject({ resumeSessionId: undefined, prompt: expect.stringContaining("You're in a chat with the manager about an idea") });
    expect(ceoSessions().at(-1)?.prompt).toContain('The chat so far:\nManager: A recipe app for kids');
    const recipes = desk.thread('chat', chat.id)?.sessionId;
    expect(recipes).toMatch(/^demo-/);
    expect(recipes).not.toBe(onboarding);

    // The next message resumes it, and carries only itself.
    await pipeline.ctx.ceo.postToChat(chat.id, 'For ages 8 to 12');
    await until(() => chatNow(chat.id).messages.length === 4);
    expect(ceoSessions().at(-1)).toMatchObject({ resumeSessionId: recipes, prompt: 'New in the chat:\nManager: For ages 8 to 12' });

    // Another idea, another session.
    const weather = await pipeline.ctx.ceo.newChat('A weather bot');
    await until(() => chatNow(weather.id).messages.length === 2);
    expect(ceoSessions().at(-1)?.resumeSessionId).toBeUndefined();
    expect(desk.thread('chat', weather.id)?.sessionId).not.toBe(recipes);

    // A plan starts afresh, opens a discussion, and the discussion's first reply starts its own session with where it
    // was opened; the next one resumes it.
    pipeline.ctx.ceo.plan(REPO, 'Share a list');
    await until(() => desk.get().discussions.length === 1 && store.worker(ceo.id).status === 'idle');
    expect(ceoSessions().at(-1)?.resumeSessionId).toBeUndefined();
    const d = desk.get().discussions[0];
    await pipeline.ctx.ceo.postToDiscussion(d.id, 'A slice');
    await until(() => desk.get().discussions[0].messages.at(-1)?.from === 'ceo');
    const first = ceoSessions().at(-1)!;
    expect(first.resumeSessionId).toBeUndefined();
    expect(first.prompt).toContain(`while planning floor 1 (${REPO}, clone at /demo/${REPO}/main) from the manager's brief: """Share a list"""`);
    expect(first.prompt).toContain('Manager: A slice');
    expect(first.ceoJob).toMatchObject({ kind: 'discussion', floorId: REPO, text: 'A slice', thread: { id: d.id, replies: 1 } });
    const discussion = desk.thread('discussion', d.id)?.sessionId;
    expect([recipes, onboarding]).not.toContain(discussion);
    // Settled by then: writing in it opens it again, and the thread keeps how it had been settled.
    await pipeline.ctx.ceo.postToDiscussion(d.id, 'Thanks');
    await until(() => desk.get().discussions[0].messages.length === 6 && desk.get().discussions[0].messages.at(-1)?.from === 'ceo');
    expect(ceoSessions().at(-1)).toMatchObject({ resumeSessionId: discussion, prompt: expect.stringMatching(/^New in the discussion:\nOffice: Settled earlier as: .+\nManager: Thanks$/) });
  });

  it('says in the thread when a job fails, and the next one carries those messages again', async () => {
    const ceo = pipeline.ctx.ceo.hire();
    const start = backend.startSession;
    let failing = true;
    backend.startSession = (o, cb) => {
      if (!failing) return start(o, cb);
      failing = false;
      setTimeout(() => cb.finished({ ok: false, text: '', costUsd: 0, turns: 0, errors: ['Claude Code stopped: overloaded'] }), 5);
      return { send: () => undefined, stop: () => undefined };
    };
    pipeline.scheduler.start(20);
    const chat = await pipeline.ctx.ceo.newChat('Hello there');
    await until(() => chatNow(chat.id).messages.at(-1)?.from === 'office' && !chatNow(chat.id).replying);
    expect(chatNow(chat.id).messages.at(-1)?.text).toBe("⚠ Mallow couldn't reply: Claude Code stopped: overloaded");
    expect(store.worker(ceo.id)).toMatchObject({ status: 'error', lastError: 'Claude Code stopped: overloaded' });
    expect(store.snapshot().messages).toEqual([]); // the thread says so, not the notices

    await pipeline.ctx.ceo.postToChat(chat.id, 'Are you there?');
    await until(() => chatNow(chat.id).messages.at(-1)?.from === 'ceo');
    // The failed job left no session, so this one starts afresh with the thread so far.
    expect(started.at(-1)?.resumeSessionId).toBeUndefined();
    expect(started.at(-1)?.prompt).toContain("Manager: Hello there\nOffice: ⚠ Mallow couldn't reply: Claude Code stopped: overloaded\nManager: Are you there?");
  });

  it('needs a CEO to write to, and drops the job of a chat deleted before its turn', async () => {
    await expect(pipeline.ctx.ceo.message('Hello')).rejects.toMatchObject({ status: 409 });
    expect(await pipeline.ctx.ceo.newChat()).toMatchObject({ title: 'New chat', messages: [], replying: false });
    const ceo = pipeline.ctx.ceo.hire();
    store.patchWorker(ceo.id, { status: 'stopped' }); // holds its jobs for now
    await expect(pipeline.ctx.ceo.postToChat(desk.get().chats[0].id, '   ')).rejects.toMatchObject({ status: 400 });
    await expect(pipeline.ctx.ceo.postToChat(999, 'Hi')).rejects.toMatchObject({ status: 404 });
    await expect(pipeline.ctx.ceo.postToDiscussion(999, 'Hi')).rejects.toMatchObject({ status: 404 });

    // The old message route writes into the latest chat.
    const latest = await pipeline.ctx.ceo.message('Still there?');
    expect(latest).toMatchObject({ title: 'New chat', replying: true, messages: [{ from: 'manager', text: 'Still there?' }] });
    const doomed = await pipeline.ctx.ceo.newChat('Never mind');
    expect(pipeline.ctx.ceo.waiting().map((j) => j.chatId)).toEqual([latest.id, doomed.id]);
    await desk.deleteChat(doomed.id);

    store.patchWorker(ceo.id, { status: 'idle' });
    pipeline.scheduler.start(20);
    await until(() => chatNow(latest.id).messages.at(-1)?.from === 'ceo' && pipeline.ctx.ceo.waiting().length === 0);
    expect(started.filter((o) => o.ceoJob?.thread?.id === doomed.id)).toEqual([]);
  });

  it("settles a discussion for the manager: their outcome goes to the CEO, and without one the CEO's stays", async () => {
    const ceo = pipeline.ctx.ceo.hire();
    store.patchWorker(ceo.id, { status: 'stopped' }); // holds its jobs
    const d = await desk.openDiscussion({ title: 'Scope', floorId: null, context: '', message: 'A slice?' });
    expect(await pipeline.ctx.ceo.resolveDiscussion(d.id, '  Start with a slice ')).toMatchObject({ status: 'resolved', outcome: 'Start with a slice', replying: true, messages: [{ from: 'ceo' }, { from: 'manager', text: 'Settled: Start with a slice' }] });
    expect(pipeline.ctx.ceo.waiting()).toEqual([expect.objectContaining({ kind: 'discussion', discussionId: d.id })]);
    expect(await pipeline.ctx.ceo.resolveDiscussion(d.id)).toMatchObject({ status: 'resolved', outcome: 'Start with a slice' });
    expect(pipeline.ctx.ceo.waiting()).toHaveLength(1);
    await expect(pipeline.ctx.ceo.resolveDiscussion(999)).rejects.toMatchObject({ status: 404 });
  });

  it("answers, after a restart, the threads whose last word is the manager's, with a CEO saved mid-job free again", async () => {
    const ceo = pipeline.ctx.ceo.hire();
    const waiting = await desk.createChat('Recipes');
    await desk.post('chat', waiting.id, 'manager', 'Still there?');
    const answered = await desk.createChat('Weather');
    await desk.post('chat', answered.id, 'manager', 'Hi');
    await desk.post('chat', answered.id, 'ceo', 'Hello!');
    const open = await desk.openDiscussion({ title: 'Scope', floorId: null, context: '', message: 'A slice?' });
    await desk.post('discussion', open.id, 'manager', 'Yes');
    const settled = await desk.openDiscussion({ title: 'Sign-in', floorId: null, context: '', message: 'Links?' });
    await desk.post('discussion', settled.id, 'manager', 'Links');
    await desk.resolveDiscussion(settled.id, 'Email links');

    // The queue isn't saved: a new office finds what waits on the CEO, and a CEO the state file says is working (its
    // session ended with the old office) free to do it.
    store.patchWorker(ceo.id, { status: 'working', activity: { kind: 'talk', detail: 'replying' } });
    const again = createPipeline(store, backend, floors, null, { desk });
    expect(again.ctx.ceo.waiting().map((j) => [j.kind, j.chatId ?? j.discussionId])).toEqual([
      ['chat', waiting.id],
      ['discussion', open.id],
    ]);
    expect(store.worker(ceo.id)).toMatchObject({ status: 'idle', activity: null });
    again.scheduler.stop();
  });
});
