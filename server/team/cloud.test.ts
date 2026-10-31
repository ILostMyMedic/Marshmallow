// Box workers on the demo's fake Upstash: hired into a Box that's created and set up, held until their Claude Code is
// signed in in their terminal, then building an issue to a PR. An idle Box pauses, the next task wakes it, and a
// worker moves back to this computer.
// Adapted from cubefarm server/cloudAgents.test.ts and cloudSignIn.test.ts (MIT): the scenarios, on Marshmallow's demo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerEvent } from '../../shared/types.ts';
import { createDemoBackend, type DemoBackend } from '../backend/demo.ts';
import { Floors } from '../floors.ts';
import { createPipeline, type Pipeline } from '../pipeline/pipeline.ts';
import { Terminals } from '../sessions/terminals.ts';
import { Store } from '../store.ts';

const REPO = 'demo-co/weather-api';

let dir: string;
let store: Store;
let backend: DemoBackend;
let floors: Floors;
let terminals: Terminals;
let pipeline: Pipeline;
let events: ServerEvent[];

async function until(done: () => boolean | Promise<boolean>, ms = 15_000) {
  const end = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** The manager types in a worker's terminal, as the debug page's xterm does over /ws/term. */
function typeInto(workerId: string, data: string) {
  const handlers: Record<string, (raw: unknown) => void> = {};
  const ws = { OPEN: 1, readyState: 1, send: () => undefined, on: (ev: string, cb: (raw: unknown) => void) => (handlers[ev] = cb) } as unknown as WebSocket;
  terminals.attach(workerId, ws);
  handlers.message(JSON.stringify({ t: 'input', data }));
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-cloud-workers-'));
  store = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  events = [];
  store.addClient({ OPEN: 1, readyState: 1, on: () => undefined, send: (t: string) => events.push(JSON.parse(t)) } as unknown as WebSocket);
  backend = createDemoBackend({ home: null, timing: { stepMs: () => 1, prepareMs: 1, installMs: 1, cloneMs: 1, checksMs: () => 60_000, closeAfterMergeMs: 5, boxMs: 1 }, rand: () => 0.9 });
  floors = new Floors(store, backend);
  terminals = new Terminals(path.join(dir, 'terminals'));
  pipeline = createPipeline(store, backend, floors, terminals, { cloud: { secretsFile: path.join(dir, 'demo-secrets.json'), pauseMs: 50 } });
  await pipeline.ctx.cloud.init();
  store.updateSettings({ autoscale: false });
});

afterEach(async () => {
  pipeline.scheduler.stop();
  pipeline.stopAll();
  backend.github.close();
  await new Promise((r) => setTimeout(r, 50));
  await store.flush();
  await terminals.saveAll();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('Box workers on the demo', () => {
  it('hires into a set-up Box, waits for the sign-in, builds, pauses when idle and wakes for the next task', async () => {
    const cloud = pipeline.ctx.cloud;
    expect(cloud.hostForHire('')).toBe('local'); // no key yet
    const view = await cloud.account.setKey('any-demo-key');
    expect(view.keySet).toBe(true);
    store.updateSettings({ cloud: { machineKind: 'box', boxSize: 'small', boxLimit: 10 } });
    expect(cloud.hostForHire('ollama/gpt-oss:20b')).toBe('local'); // a cloud machine can't reach Ollama here

    await floors.connect(REPO, { autoAssign: true });
    await floors.sync(REPO);
    const ada = pipeline.ctx.team.hire(REPO);
    expect(ada.host).toBe('box');
    pipeline.scheduler.start(20);

    // The Box comes up, and its Claude Code isn't signed in: Ada takes nothing until it is.
    await until(() => store.worker(ada.id).needsSignIn === true);
    expect(store.worker(ada.id).cloud).toBe('ready');
    await new Promise((r) => setTimeout(r, 100));
    expect(store.worker(ada.id).task).toBeNull();
    expect(store.snapshot().messages.at(-1)?.text).toMatch(/needs you to sign Claude Code in/);

    // The manager signs it in, in her terminal; she builds an issue to a PR.
    await cloud.startSignIn(ada.id);
    typeInto(ada.id, 'demo-code-1234\r');
    await until(() => store.worker(ada.id).needsSignIn === false);
    await until(() => events.some((e) => e.type === 'prOpened' && e.workerId === ada.id));

    // With nothing left to do and no CLI in it, her Box pauses; a new issue wakes it.
    await until(() => store.worker(ada.id).cloud === 'paused');
    const n = await backend.github.createIssue(REPO, 'Cache forecasts', "Keep each city's forecast for ten minutes.");
    await floors.sync(REPO);
    await until(() => events.some((ev) => ev.type === 'prOpened' && ev.workerId === ada.id && ev.issueNumber === n));
    expect(store.worker(ada.id).cloud).not.toBe('paused');
  }, 30_000);

  it('moves a worker between this computer and a Box, never one on a local model', async () => {
    const cloud = pipeline.ctx.cloud;
    await floors.connect(REPO, { autoAssign: false });
    const ada = pipeline.ctx.team.hire(REPO);
    expect(ada.host).toBe('local');
    await expect(cloud.move(ada.id, 'box')).rejects.toThrow(/Upstash Box API key/);
    await cloud.account.setKey('any-demo-key');
    store.patchWorker(ada.id, { model: 'ollama/gpt-oss:20b' });
    await expect(cloud.move(ada.id, 'box')).rejects.toThrow(/can't reach/);
    store.patchWorker(ada.id, { model: '' });
    expect((await cloud.move(ada.id, 'box')).host).toBe('box');
    await until(() => store.worker(ada.id).cloud === 'ready');
    expect((await cloud.move(ada.id, 'local')).host).toBe('local');
    expect(store.worker(ada.id).cloud).toBeUndefined();
  });
});
