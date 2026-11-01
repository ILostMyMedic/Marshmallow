// A card the manager approves becomes a floor on the demo backend: its repository, brief, team and tasks as issues;
// failures say what was done, and approving again carries on. And the whole flow on the demo, from a chat to merges.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerEvent } from '../../shared/types.ts';
import { createDemoBackend, type DemoBackend } from '../backend/demo.ts';
import { openDb, type Db } from '../db/db.ts';
import { Desk } from '../db/desk.ts';
import { Floors } from '../floors.ts';
import { createPipeline, type Pipeline } from '../pipeline/pipeline.ts';
import { Store } from '../store.ts';
import { IssueCap } from '../team/ceo/issueRules.ts';
import { officeHandlers, type JobMade } from '../team/ceo/office.ts';
import type { CeoJob } from '../team/ceo/prompts.ts';
import { Projects } from './projects.ts';
import { PLAN_FOOTER, type ProposeInput } from './proposals.ts';

const INSTANT = { stepMs: () => 1, prepareMs: 1, installMs: 1, cloneMs: 1, checksMs: () => 5, closeAfterMergeMs: 5 };
const NEW_REPO = 'demo-manager/kids-recipes';

let dir: string;
let store: Store;
let events: ServerEvent[];
let db: Db;
let desk: Desk;
let backend: DemoBackend;
let floors: Floors;
let pipeline: Pipeline;
let projects: Projects;
let syncing: NodeJS.Timeout | undefined;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-projects-'));
  store = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  events = [];
  store.addClient({ OPEN: 1, readyState: 1, send: (t: string) => events.push(JSON.parse(t)), on: () => undefined } as unknown as WebSocket);
  db = await openDb(null);
  desk = new Desk(db, store);
  await desk.load();
  backend = createDemoBackend({ home: null, timing: INSTANT, rand: () => 0.9 });
  floors = new Floors(store, backend);
  pipeline = createPipeline(store, backend, floors, null, { desk });
  projects = new Projects(pipeline.ctx, desk);
  desk.setOwners(await backend.github.owners());
});

afterEach(async () => {
  clearInterval(syncing);
  pipeline.scheduler.stop();
  pipeline.stopAll();
  await projects.settle();
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

/** A card in a new chat, put there through the CEO's propose_project as a chat job would. */
async function card(over: Partial<ProposeInput> = {}) {
  const chat = await desk.createChat('Kids recipes');
  const job: CeoJob = { kind: 'chat', floorId: null, chatId: chat.id, discussionId: null, text: '', at: 0 };
  const made: JobMade = { proposalId: null, discussions: 0 };
  const out = await officeHandlers(pipeline.ctx, job, new IssueCap(12), 'Mallow', made).proposeProject({
    new_repo_name: 'kids-recipes',
    brief: 'Recipes kids can cook',
    team_size: 3,
    tasks: [
      { title: 'Skeleton', body: 'App shell and CI' },
      { title: 'Recipes', body: 'A list of recipes', depends_on: [0] },
      { title: 'Shopping list', body: 'A shopping list', depends_on: [0, 1] },
      { title: 'Print view', body: 'Print a recipe', depends_on: [0] },
    ],
    ...over,
  });
  return { chat, out, id: made.proposalId! };
}
const lastLine = () => desk.get().chats[0].messages.at(-1);

describe('starting an approved project', () => {
  it('creates the repository, connects it with the brief and the agreed team, and files the kept tasks in order', async () => {
    pipeline.ctx.ceo.hire();
    const { out, id } = await card();
    expect(out).toBe(`Proposed a new private repository, ${NEW_REPO}, a team of 3 and 4 starting tasks. The manager sees it as a card in this chat and approves or declines it there; nothing is created until then. Tell them about it briefly in your final message.`);
    expect(backend.github.has(NEW_REPO)).toBe(false); // nothing on GitHub before the manager approves

    const p = await projects.approve(id, { teamSize: 2, tasks: [0, 2, 3] });
    expect(p).toMatchObject({ status: 'starting', teamSize: 2, step: `Creating ${NEW_REPO} on GitHub…`, decidedAt: expect.any(Number) });
    expect(p.tasks.map((t) => [t.title, t.dependsOn])).toEqual([
      ['Skeleton', []],
      ['Shopping list', [0]],
      ['Print view', [0]],
    ]);
    await projects.settle();

    expect(await desk.proposal(id)).toMatchObject({ status: 'started', step: null, floorId: NEW_REPO, issueNumbers: [1, 2, 3], error: null });
    expect((await backend.github.listMyRepos()).find((r) => r.nameWithOwner === NEW_REPO)?.visibility).toBe('PRIVATE');
    const floor = store.floor(NEW_REPO);
    expect(floor).toMatchObject({ floor: 1, autoAssign: true, mission: 'Recipes kids can cook', teamSize: 2 });
    expect(store.workerList().filter((w) => w.floorId === NEW_REPO && w.role === 'worker')).toHaveLength(2);
    const issues = await backend.github.listIssues(NEW_REPO);
    expect(issues.map((i) => [i.number, i.title])).toEqual([
      [1, 'Skeleton'],
      [2, 'Shopping list'],
      [3, 'Print view'],
    ]);
    expect(issues[0].body).toBe(`App shell and CI${PLAN_FOOTER}`);
    expect(issues[1].body).toBe(`Depends on #1\n\nA shopping list${PLAN_FOOTER}`);
    // On the board at once, and announced once, though the floor syncs again.
    expect(floor.issues.map((i) => i.number)).toEqual([1, 2, 3]);
    await floors.sync(NEW_REPO);
    await new Promise((r) => setTimeout(r, 30));
    expect(events.filter((e) => e.type === 'issuesFiled')).toEqual([expect.objectContaining({ floorId: NEW_REPO, numbers: [1, 2, 3] })]);
    expect(lastLine()).toMatchObject({ from: 'office', text: `🚀 Started floor 1: ${NEW_REPO} (https://github.com/${NEW_REPO}), a team of 2, issues #1–#3.` });
    // The CEO onboards it keeping the agreed team, and plans nothing: the card was the plan.
    expect(pipeline.ctx.ceo.waiting()).toEqual([expect.objectContaining({ kind: 'onboard', floorId: NEW_REPO, project: { teamSize: 2 } })]);
    await expect(projects.approve(id)).rejects.toMatchObject({ status: 409 });
  });

  it('refuses an empty repository and a taken name, saying so in the chat, until the card is right', async () => {
    const { id } = await card({ new_repo_name: undefined, existing_repo: 'demo-co/recipe-box' });
    vi.spyOn(backend.github, 'repoMeta').mockResolvedValueOnce({ nameWithOwner: 'demo-co/recipe-box', description: '', url: 'https://github.com/demo-co/recipe-box', defaultBranch: 'main', empty: true, languages: [] });
    await projects.approve(id);
    await projects.settle();
    expect(await desk.proposal(id)).toMatchObject({ status: 'failed', floorId: null, error: 'demo-co/recipe-box is empty. Workers start from its default branch, so it needs a first commit (a README will do)' });
    expect(store.floorList()).toEqual([]);
    expect(lastLine()).toMatchObject({ from: 'office', text: "⚠ Couldn't start demo-co/recipe-box: demo-co/recipe-box is empty. Workers start from its default branch, so it needs a first commit (a README will do). Change the card if need be and approve it again: it carries on from there." });

    await expect(projects.approve(id, { repo: { kind: 'new', owner: 'someone', name: 'x' } })).rejects.toMatchObject({ status: 400 });
    await projects.approve(id, { repo: { kind: 'new', owner: 'demo-co', name: 'pixel-todo', description: '', private: true } });
    await projects.settle();
    expect(await desk.proposal(id)).toMatchObject({ status: 'failed', error: 'GraphQL: Name already exists on this account (createRepository)', repo: { kind: 'new', name: 'pixel-todo' } });

    await projects.approve(id, { repo: { kind: 'new', owner: 'demo-co', name: 'recipes-2', description: 'Recipes', private: false } });
    await projects.settle();
    expect(await desk.proposal(id)).toMatchObject({ status: 'started', floorId: 'demo-co/recipes-2', issueNumbers: [1, 2, 3, 4] });
    expect((await backend.github.listMyRepos()).find((r) => r.nameWithOwner === 'demo-co/recipes-2')?.visibility).toBe('PUBLIC');
  });

  it('says what was done when filing fails, and approving again files the rest on the same floor', async () => {
    const create = backend.github.createIssue.bind(backend.github);
    let calls = 0;
    vi.spyOn(backend.github, 'createIssue').mockImplementation(async (...a) => {
      if (++calls === 2) throw new Error('HTTP 502: Bad Gateway');
      return create(...a);
    });
    const { id } = await card();
    await projects.approve(id);
    await projects.settle();
    expect(await desk.proposal(id)).toMatchObject({ status: 'failed', floorId: NEW_REPO, issueNumbers: [1], repo: { kind: 'existing', fullName: NEW_REPO } });
    expect(lastLine()?.text).toBe(`⚠ Couldn't start ${NEW_REPO}: HTTP 502: Bad Gateway. Already done: created ${NEW_REPO} on GitHub; connected it as floor 1; filed #1. Change the card if need be and approve it again: it carries on from there.`);

    await expect(projects.approve(id, { tasks: [0, 1] })).rejects.toMatchObject({ status: 409 });
    await expect(projects.approve(id, { repo: { kind: 'existing', fullName: 'demo-co/recipe-box' } })).rejects.toMatchObject({ status: 409 });
    await projects.approve(id);
    await projects.settle();
    expect(await desk.proposal(id)).toMatchObject({ status: 'started', floorId: NEW_REPO, issueNumbers: [1, 2, 3, 4] });
    expect(store.floorList().map((f) => f.id)).toEqual([NEW_REPO]);
    expect((await backend.github.listIssues(NEW_REPO)).find((i) => i.number === 3)?.body.startsWith('Depends on #1, #2\n\n')).toBe(true);
    expect(store.workerList().filter((w) => w.floorId === NEW_REPO)).toHaveLength(3);
  });

  it("declines a card with the manager's note, back in the chat and to the CEO, and decides a card only once", async () => {
    pipeline.ctx.ceo.hire();
    const { chat, id } = await card();
    expect(await projects.decline(id, '  Too big for now ')).toMatchObject({ status: 'declined', decidedAt: expect.any(Number) });
    expect(lastLine()).toMatchObject({ from: 'manager', text: 'Declined the project: Too big for now' });
    expect(desk.get().chats[0].replying).toBe(true);
    expect(pipeline.ctx.ceo.waiting()).toEqual([expect.objectContaining({ kind: 'chat', chatId: chat.id })]);
    await expect(projects.approve(id)).rejects.toMatchObject({ status: 409 });
    await expect(projects.decline(id)).rejects.toMatchObject({ status: 409 });
    await expect(projects.approve(999)).rejects.toMatchObject({ status: 404 });
  });
});

describe('the desktop on the demo', () => {
  it('talks an idea over in a chat, puts it on a card at "go ahead", and the approved card becomes a floor that ships its tasks', async () => {
    const ceo = pipeline.ctx.ceo.hire();
    pipeline.scheduler.start(20);
    syncing = setInterval(() => void floors.syncAll(), 25);
    const chat = await pipeline.ctx.ceo.newChat('A recipe app for kids');
    expect(chat).toMatchObject({ title: 'A recipe app for kids', replying: true, messages: [{ from: 'manager' }] });
    await until(() => lastLine()?.from === 'ceo');
    expect(lastLine()?.text).toContain('Nice idea!');
    expect(desk.get().proposals).toEqual([]);

    await pipeline.ctx.ceo.postToChat(chat.id, 'Go ahead');
    await until(() => desk.get().proposals.length === 1 && lastLine()?.from === 'ceo');
    const [proposal] = desk.get().proposals;
    expect(proposal).toMatchObject({ status: 'pending', repo: { kind: 'new', owner: 'demo-manager', name: 'recipe-app-for-kids', private: true }, teamSize: 2 });
    expect(lastLine()).toMatchObject({ proposalId: proposal.id, text: expect.stringContaining("Here's the plan on a card") });

    await projects.approve(proposal.id);
    await until(() => desk.get().proposals[0].status === 'started');
    const repo = 'demo-manager/recipe-app-for-kids';
    // The CEO onboards it and keeps the team; the workers build, test and merge its three tasks.
    await until(() => store.floor(repo).summary !== '' && store.worker(ceo.id).status === 'idle');
    expect(store.floor(repo).teamSize).toBe(2);
    await until(async () => (await backend.github.listPulls(repo)).filter((p) => p.state === 'MERGED').length === 3, 30_000);
  }, 40_000);
});
