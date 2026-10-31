// BUILD-PLAN phase 3's "done when": a demo floor with 5 issues ends with 5 merged PRs, including QA fails and their
// fixes, with the real scheduler and pipeline on the demo backend at full speed. And phase 6's: a backlog of 8 issues
// grows a floor from 1 worker to 3, and it shrinks back once they sit idle.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerEvent, Worker } from '../../shared/types.ts';
import { createDemoBackend, type DemoBackend } from '../backend/demo.ts';
import { Floors } from '../floors.ts';
import { Store } from '../store.ts';
import { IssueCap } from '../team/ceo/issueRules.ts';
import { officeHandlers } from '../team/ceo/office.ts';
import type { TeamTiming } from '../team/workers.ts';
import { createPipeline, type Pipeline } from './pipeline.ts';

const REPO = 'demo-co/pixel-todo';
const INSTANT = { stepMs: () => 1, prepareMs: 1, installMs: 1, cloneMs: 1, checksMs: () => 5, closeAfterMergeMs: 5 };

let dir: string;
let store: Store;
let backend: DemoBackend;
let floors: Floors;
let pipeline: Pipeline;
let events: ServerEvent[];
let syncing: NodeJS.Timeout;

/** The office with the demo backend; `rand` settles every coin toss in the fake GitHub and sessions. */
function office(rand: number, teamTiming?: TeamTiming) {
  backend = createDemoBackend({ home: null, timing: INSTANT, rand: () => rand });
  floors = new Floors(store, backend);
  pipeline = createPipeline(store, backend, floors, null, { teamTiming });
  // The server syncs every 45 s; here often, so merges waiting on checks see them finish.
  syncing = setInterval(() => void floors.syncAll(), 25);
}

function hire(name: string, desk: number, floorId = REPO) {
  const w: Worker = {
    id: `${name.toLowerCase()}-0000-4000`,
    name,
    floorId,
    role: 'worker',
    seed: desk,
    desk,
    model: '',
    effort: '',
    host: 'local',
    status: 'idle',
    task: null,
    activity: null,
    idleSince: Date.now(),
    startedAt: null,
    endedAt: null,
    costUsd: 0,
    turns: 0,
    lastError: null,
    sessionId: null,
    leaving: false,
  };
  store.putWorker(w);
}

async function until(done: () => boolean | Promise<boolean>, ms = 15_000) {
  const end = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-pipeline-'));
  store = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  events = [];
  store.addClient({ OPEN: 1, readyState: 1, on: () => undefined, send: (t: string) => events.push(JSON.parse(t)) } as unknown as WebSocket);
});

afterEach(async () => {
  clearInterval(syncing);
  pipeline.scheduler.stop();
  pipeline.stopAll();
  backend.github.close();
  await new Promise((r) => setTimeout(r, 50)); // let ended sessions finish their bookkeeping
  await store.flush();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('the pipeline on the demo', () => {
  it('turns 5 issues into 5 merged PRs, each failing QA once and fixed', async () => {
    office(0.3); // every first QA round fails, every fix pushes, round two passes; checks pass, no conflicts
    for (const n of [6, 7]) await backend.github.closeIssue(REPO, n, 'Not now'); // five clear issues left
    await floors.connect(REPO, { autoAssign: true });
    hire('Ada', 0);
    hire('Grace', 1);
    hire('Linus', 2);
    pipeline.scheduler.start(20);

    await until(async () => (await backend.github.listPulls(REPO)).filter((p) => p.state === 'MERGED').length === 5 && store.qaList().length === 0);

    const merged = (await backend.github.listPulls(REPO)).filter((p) => p.state === 'MERGED');
    expect(merged.map((p) => p.closesIssues[0]).sort()).toEqual([1, 2, 3, 4, 5]);
    await until(async () => (await backend.github.listIssues(REPO)).length === 0);
    const kinds = events.flatMap((e) => (e.type === 'prOpened' || e.type === 'qaFailed' || e.type === 'qaPassed' || e.type === 'merged' ? [e.type] : []));
    expect(kinds.filter((k) => k === 'prOpened')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'qaFailed')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'qaPassed')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'merged')).toHaveLength(5);
    // Every PR's first QA round went to someone other than its author. (A later one can go to them: a teammate who took
    // over a fix while the author was busy is the developer on record by then.)
    const firstTester = new Map<number, string | null>();
    for (const e of events) if ((e.type === 'qaFailed' || e.type === 'qaPassed') && !firstTester.has(e.prNumber)) firstTester.set(e.prNumber, e.qaWorkerId);
    for (const e of events) if (e.type === 'prOpened') expect(firstTester.get(e.prNumber)).not.toBe(e.workerId);
    expect(store.workerList().every((w) => w.status === 'idle' || w.status === 'done')).toBe(true);
  });

  it('merges straight through when QA passes, and a lone worker tests their own PR', async () => {
    office(0.9);
    await floors.connect('demo-co/weather-api', { autoAssign: true });
    hire('Ada', 0, 'demo-co/weather-api');
    pipeline.scheduler.start(20);
    await until(async () => (await backend.github.listPulls('demo-co/weather-api')).filter((p) => p.state === 'MERGED').length === 3);
    expect(events.some((e) => e.type === 'qaFailed')).toBe(false);
  });

  it('starts nothing new while Claude is at its limit, and paces new issues after a warning', async () => {
    office(0.9);
    await floors.connect(REPO, { autoAssign: true });
    hire('Ada', 0);
    hire('Grace', 1);
    pipeline.ctx.usage.limited(Date.now() + 60_000);
    pipeline.scheduler.start(20);
    await new Promise((r) => setTimeout(r, 150));
    expect(store.workerList().every((w) => w.status === 'idle')).toBe(true);
    expect(store.snapshot().usage.state).toBe('paused');
    expect(store.snapshot().messages.at(-1)?.text).toMatch(/usage limit/);
  });

  it('a stopped worker gives their issue back on reset', async () => {
    office(0.9);
    backend = createDemoBackend({ home: null, timing: { ...INSTANT, stepMs: () => 60_000 }, rand: () => 0.9 });
    floors = new Floors(store, backend);
    pipeline = createPipeline(store, backend, floors);
    await floors.connect(REPO, { autoAssign: true });
    hire('Ada', 0);
    pipeline.scheduler.start(20);
    await until(() => store.worker('ada-0000-4000').status === 'working');
    pipeline.stopWorker('ada-0000-4000');
    expect(store.worker('ada-0000-4000').status).toBe('stopped');
    pipeline.scheduler.stop();
    pipeline.resetWorker('ada-0000-4000');
    expect(store.worker('ada-0000-4000')).toMatchObject({ status: 'idle', task: null });
  });
});

describe('autoscaling by the rules', () => {
  it('grows a floor with a backlog of 8 issues from 1 worker to 3, and shrinks it back once they sit idle', async () => {
    office(0.9, { idleMs: 300, cooldownMs: 30 });
    await backend.github.createIssue(REPO, 'Undo a deleted todo', 'A toast with Undo for five seconds after deleting.');
    await floors.connect(REPO, { autoAssign: true });
    pipeline.ctx.team.hire(REPO);
    pipeline.scheduler.start(20);
    const team = () => store.workerList().filter((w) => w.floorId === REPO && !w.leaving).length;

    await until(() => team() === 3);
    expect(store.snapshot().messages.map((m) => m.text)).toContain('📈 Floor 1: 1 → 3 workers (the rules). 8 issues ready and 0 PRs waiting for 1 free worker.');

    // Every issue but the vague one (its worker asks the manager first) gets merged; then nothing is left to do.
    await until(async () => (await backend.github.listPulls(REPO)).filter((p) => p.state === 'MERGED').length === 7, 30_000);
    await until(() => team() === 1, 30_000);
    expect(store.snapshot().messages.at(-1)?.text).toMatch(/^📉 Floor 1: [23] → 1 worker \(the rules\)\. /);
    expect(events.filter((e) => e.type === 'hired')).toHaveLength(3);
    expect(events.filter((e) => e.type === 'left')).toHaveLength(2);
    expect(store.floor(REPO).teamSize).toBeNull();
  }, 60_000);

  it('lets a busy worker finish before they leave, holds the size it was given, and keeps the last worker', async () => {
    office(0.9);
    backend = createDemoBackend({ home: null, timing: { ...INSTANT, stepMs: () => 60_000 }, rand: () => 0.9 });
    floors = new Floors(store, backend);
    pipeline = createPipeline(store, backend, floors);
    store.updateSettings({ autoscale: false });
    await floors.connect(REPO, { autoAssign: true });
    const ada = pipeline.ctx.team.hire(REPO);
    const grace = pipeline.ctx.team.hire(REPO);
    pipeline.scheduler.start(20);
    await until(() => store.workerList().every((w) => w.status === 'working'));

    pipeline.ctx.team.resize(REPO, 1, 'Testing.', 'manager');
    expect(store.worker(grace.id)).toMatchObject({ leaving: true, status: 'working' }); // the highest desk goes
    expect(store.floor(REPO).teamSize).toBe(1);
    pipeline.stopWorker(grace.id);
    await until(() => !store.hasWorker(grace.id));
    expect(() => pipeline.ctx.team.letGo(ada.id)).toThrow(/last worker/);
  });
});

describe('the CEO on the demo', () => {
  it('onboards a floor, plans a brief into issues, and acts on a message', async () => {
    office(0.9);
    const ceo = pipeline.ctx.ceo.hire();
    await floors.connect(REPO, { autoAssign: false });
    pipeline.ctx.ceo.joined(REPO);
    pipeline.scheduler.start(20);

    // Onboarding: a profile, and a team size the floor then holds.
    await until(() => store.floor(REPO).teamSize !== null && store.snapshot().messages.some((m) => m.from === 'ceo'));
    expect(store.floor(REPO)).toMatchObject({ summary: 'pixel-todo · demo project', teamSize: 3 });
    expect(store.workerList().filter((w) => w.floorId === REPO)).toHaveLength(3);
    expect(store.worker(ceo.id).status).toBe('idle');

    // A plan files three issues, two waiting on the first.
    pipeline.ctx.ceo.plan(REPO, 'Share a list');
    await until(async () => (await backend.github.listIssues(REPO)).length === 10);
    const filed = (await backend.github.listIssues(REPO)).filter((i) => i.title.includes('Share a list'));
    expect(filed.map((i) => i.body.startsWith(`Depends on #${filed[0].number}`))).toEqual([false, true, true]);
    expect(filed[0].body).toContain("_Filed by Marshmallow's CEO._");

    // The manager's message: close an issue.
    pipeline.ctx.ceo.message('Please close #6 on floor 1');
    await until(async () => (await backend.github.issueState(REPO, 6)) === 'CLOSED');
    await until(() => store.snapshot().messages.at(-1)?.text === 'Done: #6 on floor 1 is closed.');
    expect(store.snapshot().messages.some((m) => m.from === 'manager' && m.text === 'Please close #6 on floor 1')).toBe(true);
  });

  it('refuses to file issues nobody asked for', async () => {
    office(0.9);
    await floors.connect(REPO, { autoAssign: false });
    const job = { kind: 'onboard' as const, floorId: REPO, text: '', at: 0 };
    const h = officeHandlers(pipeline.ctx, job, new IssueCap(12), 'Mallow');
    await expect(h.fileIssue({ floor: 1, title: 'Unasked', body: 'x' })).rejects.toThrow(/Only the manager decides on new work/);
  });
});
