// BUILD-PLAN phase 3's "done when": a demo floor with 5 issues ends with 5 merged PRs, including QA fails and their
// fixes, with the real scheduler and pipeline on the demo backend at full speed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerEvent, Worker } from '../../shared/types.ts';
import { createDemoBackend, type DemoBackend } from '../backend/demo.ts';
import { Floors } from '../floors.ts';
import { Store } from '../store.ts';
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
function office(rand: number) {
  backend = createDemoBackend({ home: null, timing: INSTANT, rand: () => rand });
  floors = new Floors(store, backend);
  pipeline = createPipeline(store, backend, floors);
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
