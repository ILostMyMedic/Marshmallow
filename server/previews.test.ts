import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Floor, PreviewView, PullInfo, ServerEvent } from '../shared/types.ts';
import { createDemoBackend, type DemoBackend } from './backend/demo.ts';
import { appPage } from './backend/demoPreviews.ts';
import { openDb, type Db } from './db/db.ts';
import { PreviewSettings } from './db/previewSettings.ts';
import { portOpen } from './previewRunner.ts';
import { keptPort, parsePreviewPatch, Previews, reservedPort, trimLog } from './previews.ts';
import { Store } from './store.ts';

// Floors' previews on the demo backend: its fake apps really listen, on 127.0.0.1 only, on ports clear of a running
// office's (6601…).
const BASE = 41_000 + (process.pid % 400) * 10;
const TODO = 'demo-co/pixel-todo';
const API = 'demo-co/weather-api';

const floor = (id: string, n: number): Floor => ({
  id,
  fullName: id,
  description: '',
  url: `https://github.com/${id}`,
  defaultBranch: 'main',
  workBranch: null,
  floor: n,
  color: '#fff',
  autoAssign: false,
  browserTesting: false,
  mission: '',
  summary: '',
  qaBrief: '',
  teamSize: null,
  held: [],
  languages: [],
  cloneStatus: 'ready',
  cloneError: null,
  issues: [],
  pulls: [],
  lastSync: null,
  syncError: null,
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean | Promise<boolean>, ms = 4000) {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error('timed out');
    await wait(5);
  }
}

let dir: string;
let events: ServerEvent[];
let store: Store;
let backend: DemoBackend;
let db: Db;
let previews: Previews;

const newStore = () => {
  const s = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  s.addClient({ OPEN: 1, readyState: 1, send: (t: string) => events.push(JSON.parse(t)), on: () => undefined } as unknown as WebSocket);
  s.putFloor(floor(TODO, 1));
  s.putFloor(floor(API, 2));
  return s;
};
async function office(dbDir: string | null) {
  db = await openDb(dbDir);
  const settings = new PreviewSettings(db);
  await settings.load();
  previews = new Previews(store, backend, settings, { base: BASE, officePorts: [4600], logEmitMs: 5 });
}
const view = (id = TODO) => previews.view(id);
const running = (id = TODO) => () => view(id).state === 'running';
const seen = (id = TODO) => events.filter((e): e is { type: 'preview'; preview: PreviewView } => e.type === 'preview' && e.preview.floorId === id).map((e) => e.preview);

describe('a floor preview', () => {
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-previews-'));
    events = [];
    store = newStore();
    backend = createDemoBackend({ home: null, timing: { previewMs: 5 }, rand: () => 0.9 });
    await office(null);
  });
  afterEach(async () => {
    await previews.stopAll();
    backend.github.close();
    await db.close();
    await store.flush();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });

  it('reads stopped on the port kept for its floor until the manager starts it', () => {
    expect(store.snapshot().previews[TODO]).toMatchObject({ state: 'stopped', port: BASE + 1, url: null, command: null, config: { command: null, port: null } });
    expect(store.snapshot().previews[API].port).toBe(BASE + 2);
  });

  it('starts by hand: refreshed, installed, started, then the floor app answers on 127.0.0.1', async () => {
    expect(await previews.start(TODO)).toMatchObject({ state: 'preparing', port: BASE + 1, url: null });
    await until(running());
    const up = view();
    // The command as a person would say it; the flags the office adds show only in the log
    expect(up).toMatchObject({ url: `http://127.0.0.1:${BASE + 1}/`, command: 'npm run dev', error: null });
    expect(up.log).toContain(`$ npm run dev -- --port ${BASE + 1} --strictPort --host 127.0.0.1`);
    expect(view(API).command).toBeNull();
    expect(up.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(seen().map((p) => p.state).filter((s, i, all) => s !== all[i - 1])).toEqual(['preparing', 'installing', 'starting', 'running']);
    expect(up.log).toContain('$ npm ci --no-audit --no-fund');
    const page = await (await fetch(up.url!)).text();
    expect(page).toContain('Pixel Todo');
    expect(page).toContain(up.sha!.slice(0, 7));
    // Started again while it's up: left as it is
    expect((await previews.start(TODO)).startedAt).toBe(up.startedAt);
  });

  it('restarts after a merge on its floor, on the new commit and without installing again; other floors stay as they are', async () => {
    await previews.start(TODO);
    await until(running());
    const before = view();
    const pr = backend.github.openPull(TODO, { title: 'Add dark mode toggle', branch: 'mm/issue-1-ada', closes: 1 });
    await backend.github.mergePull(TODO, pr.number, 'squash');
    store.moment({ type: 'merged', at: Date.now(), floorId: API, prNumber: 99, devWorkerId: null });
    expect(view(API).state).toBe('stopped');
    expect(view().startedAt).toBe(before.startedAt);

    store.moment({ type: 'merged', at: Date.now(), floorId: TODO, prNumber: pr.number, devWorkerId: null });
    await until(() => running()() && view().sha !== before.sha);
    const after = view();
    expect(after.log[0]).toBe(`↻ PR #${pr.number} was merged: restarting on the latest commit.`);
    expect(after.log).toContain('Dependencies unchanged since the last install; skipping it.');
    expect(await (await fetch(after.url!)).text()).toContain('Add dark mode toggle');
  });

  it('stops on demand, freeing its port, and when its floor goes', async () => {
    await previews.start(TODO);
    await until(running());
    expect(await portOpen(BASE + 1)).toBe(true);
    expect(await previews.stop(TODO)).toMatchObject({ state: 'stopped', url: null, error: null });
    expect(await portOpen(BASE + 1)).toBe(false);

    await previews.start(API);
    await until(running(API));
    store.removeFloor(API);
    await until(async () => !(await portOpen(BASE + 2)));
    expect(store.snapshot().previews).not.toHaveProperty(API);
  });

  it("reports a port another program holds as an error, and leaves that program alone", async () => {
    const squatter = net.createServer().listen(BASE + 1, '127.0.0.1');
    await new Promise((r) => squatter.once('listening', r));
    try {
      await expect(previews.start(TODO)).rejects.toMatchObject({ status: 409 });
      expect(view()).toMatchObject({ state: 'error', error: expect.stringMatching(/already in use by another program/) });
      expect(squatter.listening).toBe(true);
    } finally {
      squatter.close();
    }
  });

  it("runs the manager's command, and shows why it failed with its output", async () => {
    const set = await previews.configure(TODO, { command: '  frobnicate --serve {port}  ' });
    expect(set).toMatchObject({ config: { command: 'frobnicate --serve {port}', port: null }, command: 'frobnicate --serve {port}' });
    await previews.start(TODO);
    await until(() => view().state === 'error');
    expect(view().command).toBe('frobnicate --serve {port}');
    expect(view().error).toMatch(/exited \(code 1\) before it answered/);
    expect(view().log).toContain(`$ frobnicate --serve ${BASE + 1}`);
    expect(view().log.join('\n')).toMatch(/'frobnicate' is not recognized/);
  });

  it("keeps the manager's settings through a restart, while every preview comes back stopped", async () => {
    await db.close();
    await office(path.join(dir, 'db'));
    await previews.configure(TODO, { port: BASE + 7, command: 'npm run serve -- --port {port}' });
    await previews.start(API);
    await until(running(API));

    await previews.stopAll();
    await db.close();
    await store.flush();
    store = newStore();
    await office(path.join(dir, 'db'));
    expect(view()).toMatchObject({ state: 'stopped', port: BASE + 7, command: 'npm run serve -- --port {port}', config: { port: BASE + 7, command: 'npm run serve -- --port {port}' } });
    expect(view(API)).toMatchObject({ state: 'stopped', sha: null });
    // null hands both back to the office
    expect(await previews.configure(TODO, { port: null, command: null })).toMatchObject({ port: BASE + 1, command: null, config: { port: null, command: null } });
  });

  it("refuses a port that's the office's, a worker's or another floor's", async () => {
    await expect(previews.configure(TODO, { port: 4600 })).rejects.toMatchObject({ status: 400 });
    await expect(previews.configure(TODO, { port: 5300 })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/workers/) });
    await expect(previews.configure(TODO, { port: BASE + 2 })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(API) });
    await expect(previews.configure(TODO, { port: 80 })).rejects.toMatchObject({ status: 400 });
    await expect(previews.configure('nobody/here', {})).rejects.toMatchObject({ status: 404 });
    await expect(previews.start('nobody/here')).rejects.toMatchObject({ status: 404 });
    expect(view().config).toEqual({ command: null, port: null });
  });
});

describe("the previews' rules", () => {
  it('keeps each floor a port of its own, clear of the reserved ones and the taken ones', () => {
    expect(keptPort(1, new Set(), () => false, 6600)).toBe(6601);
    expect(keptPort(1, new Set([6601]), () => false, 6600)).toBe(6701);
    expect(keptPort(1, new Set([6701]), (p) => p === 6601, 6600)).toBe(6801);
  });

  it('knows the ports the office keeps for itself and its workers', () => {
    for (const p of [4600, 5600, 4700, 5700, 4317, 5317, 5200, 5899]) expect(reservedPort(p, []), String(p)).not.toBeNull();
    expect(reservedPort(7000, [7000])).toMatch(/office's own/);
    expect(reservedPort(6601, [4600])).toBeNull();
    expect(reservedPort(5900, [])).toBeNull();
  });

  it("checks the manager's command and port", () => {
    expect(parsePreviewPatch({})).toEqual({});
    expect(parsePreviewPatch({ command: '  npm run serve  ', port: 3000 })).toEqual({ command: 'npm run serve', port: 3000 });
    expect(parsePreviewPatch({ command: null, port: null })).toEqual({ command: null, port: null });
    for (const bad of [{ command: '   ' }, { command: 'a\nb' }, { command: 5 }, { command: 'x'.repeat(1001) }, { port: 1023 }, { port: 65536 }, { port: 3000.5 }, { port: '3000' }]) {
      expect(() => parsePreviewPatch(bad), JSON.stringify(bad).slice(0, 40)).toThrow();
    }
    expect(() => parsePreviewPatch(null)).toThrow();
    expect(() => parsePreviewPatch(['x'])).toThrow();
  });

  it('keeps the last lines of the output, each clipped', () => {
    expect(trimLog(['a', 'b'], ['c', 'd'], 3)).toEqual(['b', 'c', 'd']);
    const long = trimLog([], ['x'.repeat(600)]);
    expect(long[0]).toHaveLength(501);
    expect(long[0].endsWith('…')).toBe(true);
  });

  it("escapes what the demo app shows of a repository's PRs", () => {
    const pr = { number: 3, title: '<script>alert(1)</script>' } as PullInfo;
    const page = appPage({ fullName: 'acme/my-app', description: 'Mine & yours', branch: 'main', sha: 'abcdef1234', shipped: [pr], port: 6601 });
    expect(page).toContain('<title>My App</title>');
    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).toContain('Mine &#38; yours');
  });
});
