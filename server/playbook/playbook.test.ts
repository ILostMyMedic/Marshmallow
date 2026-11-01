import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlaybookDraft, PlaybookView } from '../../shared/playbook.ts';
import type { Floor, ServerEvent, Worker } from '../../shared/types.ts';
import { openDb, type Db } from '../db/db.ts';
import type { SessionOptions } from '../sessions/session.ts';
import { Store } from '../store.ts';
import { Playbook, PROPOSALS_KEPT } from './playbook.ts';
import { withPlaybook } from './session.ts';

const REPO = 'acme/app';

let dir: string;
let store: Store;
let db: Db;
let events: ServerEvent[];
let clock: number;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-playbook-'));
  store = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  store.putFloor({ id: REPO, fullName: REPO, defaultBranch: 'main', workBranch: 'dev', floor: 1, pulls: [], issues: [], held: [], languages: [] } as unknown as Floor);
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

async function newPlaybook() {
  const p = new Playbook(db, store, () => (clock += 1000));
  await p.load();
  return p;
}
const draft = (o: Partial<PlaybookDraft> = {}): PlaybookDraft => ({ scope: 'office', floorId: null, kind: 'rules', name: 'tests-first', description: '', body: '- Run the tests', tools: '', model: '', ...o });
const lastView = (): PlaybookView | undefined => events.filter((e): e is Extract<ServerEvent, { type: 'playbook' }> => e.type === 'playbook').at(-1)?.playbook;
const status = (p: Promise<unknown>) => p.then(
  () => 'ok',
  (err: { status?: number }) => err.status,
);

describe('the playbook', () => {
  it('keeps docs, tidied, writes them through and tells every tab the whole playbook', async () => {
    const pb = await newPlaybook();
    const doc = await pb.create(draft({ body: '- Run the tests\r\n\r\n' }));
    expect(doc).toMatchObject({ id: 1, scope: 'office', floorId: null, kind: 'rules', name: 'tests-first', body: '- Run the tests', enabled: true, updatedAt: 1_001_000 });
    await pb.create(draft({ scope: 'floor', floorId: REPO, kind: 'agent', name: 'reviewer', description: 'Reviews\nthe diff', body: 'Review it', tools: 'Read,Grep' }));
    expect(lastView()?.docs.map((d) => [d.name, d.description, d.tools])).toEqual([
      ['tests-first', '', ''],
      ['reviewer', 'Reviews the diff', 'Read, Grep'],
    ]);
    // a fresh start reads the same back
    expect((await newPlaybook()).get()).toEqual(pb.get());
  });

  it('refuses a doc out of shape (400), on a floor that is not connected (404), or with a name its scope has (409)', async () => {
    const pb = await newPlaybook();
    await pb.create(draft());
    expect(await status(pb.create(draft({ name: 'Tests First' })))).toBe(400);
    expect(await status(pb.create(draft({ kind: 'skill', name: 'x', description: '' })))).toBe(400);
    expect(await status(pb.create(draft({ scope: 'floor', floorId: 'nobody/here' })))).toBe(404);
    expect(await status(pb.create(draft()))).toBe(409);
    // the same name is fine on a floor, or as another kind
    expect(await status(pb.create(draft({ scope: 'floor', floorId: REPO })))).toBe('ok');
    expect(await status(pb.create(draft({ kind: 'command', description: 'Run the tests' })))).toBe('ok');
  });

  it("changes a doc's text and name, switches it off and on, and deletes it", async () => {
    const pb = await newPlaybook();
    const a = await pb.create(draft());
    await pb.create(draft({ name: 'small-prs' }));
    expect(await pb.update(a.id, { body: '- Run every test', enabled: false })).toMatchObject({ body: '- Run every test', enabled: false });
    expect(await status(pb.update(a.id, { name: 'small-prs' }))).toBe(409);
    expect(await status(pb.update(a.id, { body: ' ' }))).toBe(400);
    expect(await status(pb.update(99, { enabled: true }))).toBe(404);
    expect((await pb.update(a.id, { enabled: true })).enabled).toBe(true);
    await pb.remove(a.id);
    expect(pb.get().docs.map((d) => d.name)).toEqual(['small-prs']);
    expect(await status(pb.remove(a.id))).toBe(404);
  });

  it('adds a template to the office or a floor once, placeholders kept for each floor to fill', async () => {
    const pb = await newPlaybook();
    const doc = await pb.applyTemplate('work-branch-flow', 'floor', REPO);
    expect(doc).toMatchObject({ scope: 'floor', floorId: REPO, kind: 'rules', name: 'work-branch-flow' });
    expect(doc.body).toContain('{workBranch}');
    expect(await status(pb.applyTemplate('work-branch-flow', 'floor', REPO))).toBe(409);
    expect(await status(pb.applyTemplate('work-branch-flow', 'office', null))).toBe('ok');
    expect(await status(pb.applyTemplate('no-such-template', 'office', null))).toBe(404);
  });

  it("fills a floor's sessions in for its work branch, and gives the CEO the office's rules only", async () => {
    const pb = await newPlaybook();
    await pb.applyTemplate('work-branch-flow', 'floor', REPO);
    await pb.create(draft({ body: '- {defaultBranch} runs live' }));
    await pb.applyTemplate('write-tests', 'office', null);
    const worker = { id: 'w1', role: 'worker', floorId: REPO, name: 'Ada', status: 'idle' } as Worker;
    const ceo = { id: 'c1', role: 'ceo', floorId: '', name: 'Mallow', status: 'idle' } as Worker;
    store.putWorker(worker);
    store.putWorker(ceo);
    const opts = { cwd: '/x', prompt: 'Build it', systemAppend: 'Do the task.' } as SessionOptions;

    const w = withPlaybook(store, pb, 'w1', opts);
    expect(w.ownSetup).toBe(false);
    expect(w.playbook?.rules).toContain('- main runs live');
    expect(w.playbook?.rules).toContain('open your pull request into `dev`');
    expect(w.playbook?.rules.indexOf('main runs live')).toBeLessThan(w.playbook!.rules.indexOf('into `dev`')); // the office's first
    expect(w.playbook?.entries.map((e) => e.path)).toEqual(['skills/write-tests/SKILL.md']);

    const c = withPlaybook(store, pb, 'c1', opts);
    expect(c.playbook?.rules).toContain('the default branch runs live');
    expect(c.playbook?.rules).not.toContain('work branch');
    expect(c.playbook?.files).toEqual([]);

    store.updateSettings({ workersUseMySetup: true });
    expect(withPlaybook(store, null, 'w1', opts)).toEqual({ ...opts, ownSetup: true });
  });
});

describe("the CEO's proposals", () => {
  it('waits on a card, then a new doc goes in as the manager edited it', async () => {
    const pb = await newPlaybook();
    const p = await pb.propose({ kind: 'chat', id: 7 }, draft({ body: '- Run the tests\n- Then lint' }), ' PRs fail CI ');
    expect(p).toMatchObject({ id: 1, thread: { kind: 'chat', id: 7 }, status: 'pending', docId: null, before: null, why: 'PRs fail CI', decidedAt: null });
    expect(pb.get().docs).toEqual([]); // nothing changes before the manager approves
    const { proposal, doc } = await pb.approve(p.id, { body: '- Run the tests' });
    expect(doc).toMatchObject({ name: 'tests-first', body: '- Run the tests', enabled: true });
    expect(proposal).toMatchObject({ status: 'approved', docId: doc.id, decidedAt: expect.any(Number) });
    expect(proposal.draft.body).toBe('- Run the tests');
    expect(await status(pb.approve(p.id))).toBe(409);
    expect(await status(pb.decline(p.id))).toBe(409);
  });

  it('keeps the doc it changes as it was, for the diff, and switches it on when approved', async () => {
    const pb = await newPlaybook();
    const doc = await pb.create(draft(), false);
    const p = await pb.propose({ kind: 'discussion', id: 2 }, draft({ body: '- Run the tests\n- Say which ran' }), 'Reviewers ask');
    expect(p).toMatchObject({ docId: doc.id, before: { description: '', body: '- Run the tests' } });
    const out = await pb.approve(p.id);
    expect(out.doc).toMatchObject({ id: doc.id, body: '- Run the tests\n- Say which ran', enabled: true });
    expect(pb.get().docs).toHaveLength(1);
  });

  it("keeps a subagent's tools and model when the CEO changes its text", async () => {
    const pb = await newPlaybook();
    await pb.create(draft({ kind: 'agent', name: 'reviewer', description: 'Reviews', body: 'Review', tools: 'Read, Grep', model: 'sonnet' }));
    const p = await pb.propose({ kind: 'chat', id: 1 }, draft({ kind: 'agent', name: 'reviewer', description: 'Reviews', body: 'Review closely' }), 'x');
    expect((await pb.approve(p.id)).doc).toMatchObject({ body: 'Review closely', tools: 'Read, Grep', model: 'sonnet' });
  });

  it('refuses a proposal out of shape, or one that changes nothing, and declines', async () => {
    const pb = await newPlaybook();
    await pb.create(draft());
    expect(await status(pb.propose({ kind: 'chat', id: 1 }, draft(), 'again'))).toBe(409);
    expect(await status(pb.propose({ kind: 'chat', id: 1 }, draft({ name: 'Bad Name' }), 'x'))).toBe(400);
    const p = await pb.propose({ kind: 'chat', id: 1 }, draft({ name: 'small-prs', body: '- Keep PRs small' }), 'x');
    expect((await pb.decline(p.id)).status).toBe('declined');
    expect(pb.get().docs.map((d) => d.name)).toEqual(['tests-first']);
    expect(await status(pb.approve(99))).toBe(404);
  });

  it(`keeps the latest ${PROPOSALS_KEPT} proposals`, async () => {
    const pb = await newPlaybook();
    for (let i = 0; i < PROPOSALS_KEPT + 2; i++) await pb.propose({ kind: 'chat', id: 1 }, draft({ name: `rule-${i}` }), 'x');
    expect(pb.get().proposals).toHaveLength(PROPOSALS_KEPT);
    expect(pb.get().proposals[0].id).toBe(3);
    expect((await newPlaybook()).get().proposals.map((p) => p.id)).toEqual(pb.get().proposals.map((p) => p.id));
  });
});
