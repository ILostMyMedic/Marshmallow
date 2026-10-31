// BUILD-PLAN phase 8 on the demo, with the real scheduler and pipeline: closing an issue or PR stops whoever works on
// it; an office that restarts picks up where it left off (a closed issue cleared, an interrupted build resumed or put
// back in line, QA nobody finished tested again); a reset hands a tester's PR back to QA; and the watchdog nudges a
// quiet session, then puts its work back.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerEvent, Worker } from '../../shared/types.ts';
import { createDemoBackend, type DemoBackend } from '../backend/demo.ts';
import { Floors } from '../floors.ts';
import { Store } from '../store.ts';
import { readyIssues } from './scheduler.ts';
import { createPipeline, type Pipeline } from './pipeline.ts';

const REPO = 'demo-co/pixel-todo';
const MIN = 60_000;

let dir: string;
let backend: DemoBackend;
let step: number; // each fake session step's length: long keeps a session running
let offices: { store: Store; pipeline: Pipeline }[];

/** An office on the shared state file and fake GitHub. `demo`: false resumes sessions after a restart, as the real office does. */
async function office(o: { demo?: boolean } = {}) {
  const store = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  await store.load();
  const events: ServerEvent[] = [];
  store.addClient({ OPEN: 1, readyState: 1, on: () => undefined, send: (t: string) => events.push(JSON.parse(t)) } as unknown as WebSocket);
  const b = { ...backend, demo: o.demo ?? true };
  const floors = new Floors(store, b);
  const pipeline = createPipeline(store, b, floors);
  store.updateSettings({ autoscale: false });
  offices.push({ store, pipeline });
  return { store, floors, pipeline, events };
}

function hire(store: Store, name: string, desk: number) {
  const w: Worker = {
    id: `${name.toLowerCase()}-0000-4000`,
    name,
    floorId: REPO,
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
  return w.id;
}

async function until(done: () => boolean | Promise<boolean>, ms = 15_000) {
  const end = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const logText = (store: Store, id: string) => (store.snapshot().logs[id] ?? []).map((l) => l.text);
const lastMessage = (store: Store) => store.snapshot().messages.at(-1)?.text ?? '';

/** Ada takes an issue and her session runs on; the scheduler then stops, so nothing new is handed out. */
async function adaBuilding() {
  const a = await office();
  await a.floors.connect(REPO, { autoAssign: true });
  const ada = hire(a.store, 'Ada', 0);
  a.pipeline.scheduler.start(20);
  await until(() => a.store.worker(ada).status === 'working');
  a.pipeline.scheduler.stop();
  return { a, ada, issue: a.store.worker(ada).task!.issueNumber! };
}

/** The office closes as on Ctrl+C: its sessions end with it and change nothing. */
async function shutDown(o: { store: Store; pipeline: Pipeline }) {
  o.pipeline.close();
  o.pipeline.stopAll();
  await o.store.flush();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-hardening-'));
  step = 60_000;
  backend = createDemoBackend({ home: null, timing: { stepMs: () => step, prepareMs: 1, installMs: 1, cloneMs: 1, checksMs: () => 60_000, closeAfterMergeMs: 5 }, rand: () => 0.9 });
  offices = [];
});

afterEach(async () => {
  for (const o of offices) {
    o.pipeline.scheduler.stop();
    o.pipeline.stopAll();
  }
  backend.github.close();
  await new Promise((r) => setTimeout(r, 50));
  for (const o of offices) await o.store.flush();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('closing an issue or PR', () => {
  it('stops whoever is building a closed issue and clears their desk', async () => {
    const { a, ada, issue } = await adaBuilding();
    await backend.github.closeIssue(REPO, issue, 'Not planned');
    await a.floors.sync(REPO);
    await until(() => a.store.worker(ada).status === 'idle');
    expect(a.store.worker(ada).task).toBeNull();
    expect(lastMessage(a.store)).toBe(`🛑 Stopped Ada: issue #${issue} on ${REPO} was closed.`);
    expect(logText(a.store, ada)).toEqual(expect.arrayContaining([`■ Stopped: issue #${issue} was closed.`, '↺ Cleared desk. Ready for new work.']));
    expect(a.store.floor(REPO).issues.some((i) => i.number === issue)).toBe(false);
  });

  it("drops a closed PR from QA and holds its issue for the manager, who can send it back in line", async () => {
    const a = await office();
    await a.floors.connect(REPO, { autoAssign: false });
    await a.floors.sync(REPO);
    const ada = hire(a.store, 'Ada', 0);
    const pr = backend.github.openPull(REPO, { title: 'Add dark mode', branch: 'mm/issue-2-ada', closes: 2 });
    a.store.patchWorker(ada, { status: 'done', task: { kind: 'issue', issueNumber: 2, title: 'Dark mode', branch: 'mm/issue-2-ada', prNumber: pr.number, prUrl: pr.url } });
    a.pipeline.ctx.qa.queue(REPO, pr.number, ada, 2);
    await backend.github.closePull(REPO, pr.number);
    await a.floors.sync(REPO);
    await until(() => a.store.findQa(REPO, pr.number) === null && a.store.worker(ada).task === null);
    expect(logText(a.store, ada)).toContain(`↺ PR #${pr.number} was closed. Cleared desk.`);
    const ready = () => readyIssues(a.store.floor(REPO), a.store.workerList(), () => false, Date.now()).map((i) => i.number);
    expect(a.store.floor(REPO).held).toEqual([{ issue: 2, pr: pr.number }]);
    expect(ready()).not.toContain(2);
    a.pipeline.ctx.closures.release(REPO, 2);
    expect(ready()).toContain(2);
  });

  it('clears a PR merged by hand from QA and from its author', async () => {
    const a = await office();
    await a.floors.connect(REPO, { autoAssign: false });
    await a.floors.sync(REPO);
    const ada = hire(a.store, 'Ada', 0);
    const pr = backend.github.openPull(REPO, { title: 'Add dark mode', branch: 'mm/issue-2-ada', closes: 2 });
    a.store.patchWorker(ada, { status: 'done', task: { kind: 'issue', issueNumber: 2, title: 'Dark mode', branch: 'mm/issue-2-ada', prNumber: pr.number, prUrl: pr.url } });
    a.pipeline.ctx.qa.queue(REPO, pr.number, ada, 2);
    await backend.github.mergePull(REPO, pr.number, 'squash');
    await a.floors.sync(REPO);
    await until(() => a.store.findQa(REPO, pr.number) === null && a.store.worker(ada).task === null);
    expect(logText(a.store, ada)).toContain(`🎉 PR #${pr.number} was merged. Ready for the next issue.`);
    expect(a.store.floor(REPO).held).toEqual([]);
  });
});

describe('a reset', () => {
  it("puts a tester's PR back in QA's queue and clears them once their session has ended", async () => {
    const a = await office();
    await a.floors.connect(REPO, { autoAssign: false });
    await a.floors.sync(REPO);
    const ada = hire(a.store, 'Ada', 0);
    const pr = backend.github.openPull(REPO, { title: 'Add dark mode', branch: 'mm/issue-2-grace', closes: 2 });
    a.pipeline.ctx.qa.queue(REPO, pr.number, null, 2);
    a.pipeline.scheduler.start(20);
    await until(() => a.store.worker(ada).status === 'working' && a.store.worker(ada).task?.kind === 'qa');
    a.pipeline.scheduler.stop();
    a.pipeline.resetWorker(ada);
    await until(() => a.store.worker(ada).status === 'idle');
    expect(a.store.findQa(REPO, pr.number)).toMatchObject({ status: 'queued', qaWorkerId: null });
    expect(logText(a.store, ada).slice(-2)).toEqual(['■ Stopped: reset by the manager.', '↺ Reset by the manager.']);
  });
});

describe('an office restart', () => {
  it('keeps who was working on what when the office closes', async () => {
    const { a, ada } = await adaBuilding();
    await shutDown(a);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) as { workers: Worker[] };
    expect(saved.workers.find((w) => w.id === ada)).toMatchObject({ status: 'working', task: { kind: 'issue' } });
  });

  it("resumes an interrupted build's session, told what it was doing", async () => {
    const { a, ada, issue } = await adaBuilding();
    const session = a.store.worker(ada).sessionId;
    await shutDown(a);
    step = 1; // the resumed session finishes quickly
    const b = await office({ demo: false });
    const counts = await b.pipeline.restart([]);
    expect(counts).toMatchObject({ resumed: 1, requeued: 0, cleared: 0 });
    expect(b.store.worker(ada)).toMatchObject({ sessionId: session, task: { kind: 'issue', issueNumber: issue } });
    expect(logText(b.store, ada).some((t) => t.startsWith(`▶ Office: The office server restarted while you were working on issue #${issue}`))).toBe(true);
    expect(lastMessage(b.store)).toBe('↻ Restarted: resumed 1 session.');
    await until(() => b.events.some((e) => e.type === 'prOpened' && e.workerId === ada && e.issueNumber === issue));
  });

  it('puts the demo\'s interrupted work back in line', async () => {
    const { a, ada, issue } = await adaBuilding();
    await shutDown(a);
    const b = await office();
    expect(await b.pipeline.restart([])).toMatchObject({ resumed: 0, requeued: 1 });
    expect(b.store.worker(ada)).toMatchObject({ status: 'idle', task: null });
    expect(logText(b.store, ada)).toContain('↺ The office restarted. Starting over from the queue.');
    await b.floors.sync(REPO);
    expect(readyIssues(b.store.floor(REPO), b.store.workerList(), () => false, Date.now()).map((i) => i.number)).toContain(issue);
  });

  it('clears work whose issue closed while the office was down', async () => {
    const { a, ada, issue } = await adaBuilding();
    await shutDown(a);
    await backend.github.closeIssue(REPO, issue, 'Done elsewhere');
    const b = await office({ demo: false });
    expect(await b.pipeline.restart([])).toMatchObject({ cleared: 1, resumed: 0, requeued: 0 });
    expect(b.store.worker(ada)).toMatchObject({ status: 'idle', task: null });
    expect(lastMessage(b.store)).toBe('↻ Restarted: cleared 1 finished task.');
  });

  it('tests a PR again that was left "testing" with nobody on it', async () => {
    const a = await office();
    await a.floors.connect(REPO, { autoAssign: false });
    const ada = hire(a.store, 'Ada', 0);
    const pr = backend.github.openPull(REPO, { title: 'Add dark mode', branch: 'mm/issue-2-ada', closes: 2 });
    a.pipeline.ctx.qa.queue(REPO, pr.number, null, 2);
    a.store.patchQa(REPO, pr.number, { status: 'testing', qaWorkerId: ada });
    a.store.patchWorker(ada, { status: 'done', task: { kind: 'qa', issueNumber: 2, title: 'Add dark mode', branch: 'mm/qa-1-ada', prNumber: pr.number, prUrl: pr.url } });
    await shutDown(a);
    const b = await office();
    await b.pipeline.restart([]);
    expect(b.store.findQa(REPO, pr.number)).toMatchObject({ status: 'queued', qaWorkerId: null });
  });
});

describe('the watchdog', () => {
  it('nudges a quiet session, then puts its work back in line', async () => {
    const { a, ada, issue } = await adaBuilding();
    const t0 = Date.now();
    a.pipeline.watchdog.tick(t0 + 21 * MIN);
    expect(a.store.worker(ada).status).toBe('working');
    expect(logText(a.store, ada)).toContain('🩺 No sign of life for 21 minutes: the office nudged them.');
    expect(logText(a.store, ada).some((t) => t.startsWith("▶ Office: The office hasn't seen any output from you for 21 minutes."))).toBe(true);
    a.pipeline.watchdog.tick(t0 + 25 * MIN); // the nudge gets ten minutes to work
    expect(a.store.worker(ada).status).toBe('working');
    a.pipeline.watchdog.tick(t0 + 32 * MIN);
    await until(() => a.store.worker(ada).status === 'idle');
    expect(lastMessage(a.store)).toBe(`🩺 The watchdog put Ada's #${issue} back in line (quiet for 32 minutes, even after a nudge).`);
  });

  it('sends a PR nobody is testing back to QA', async () => {
    const a = await office();
    await a.floors.connect(REPO, { autoAssign: false });
    const pr = backend.github.openPull(REPO, { title: 'Add dark mode', branch: 'mm/issue-2-ada', closes: 2 });
    a.pipeline.ctx.qa.queue(REPO, pr.number, null, 2);
    a.store.patchQa(REPO, pr.number, { status: 'testing', qaWorkerId: 'gone' });
    a.pipeline.watchdog.tick(Date.now() + 2 * MIN); // its report may still be posting
    expect(a.store.findQa(REPO, pr.number)?.status).toBe('testing');
    a.pipeline.watchdog.tick(Date.now() + 4 * MIN);
    expect(a.store.findQa(REPO, pr.number)).toMatchObject({ status: 'queued', qaWorkerId: null });
    expect(lastMessage(a.store)).toBe(`🩺 The watchdog sent PR #${pr.number} back to QA (nobody was testing it).`);
  });
});
