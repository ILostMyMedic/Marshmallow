import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerEvent } from '../shared/types.ts';
import { createDemoBackend, type DemoBackend } from './backend/demo.ts';
import { fakeLanguages } from './backend/demoGithub.ts';
import { Floors, LANGUAGES_EVERY_MS } from './floors.ts';
import { Store } from './store.ts';

const REPO = 'demo-co/pixel-todo';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let dir: string;
let store: Store;
let backend: DemoBackend;
let floors: Floors;
let events: ServerEvent[];
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-floors-'));
  store = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  backend = createDemoBackend({ home: null, timing: { cloneMs: 1, checksMs: () => 5 } });
  floors = new Floors(store, backend);
  events = [];
  store.addClient({ OPEN: 1, readyState: 1, send: (t: string) => events.push(JSON.parse(t)), on: () => undefined } as unknown as WebSocket);
});
afterEach(async () => {
  backend.github.close();
  await store.flush();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('Floors', () => {
  it('connects a repository as the next floor up, then clones and syncs it', async () => {
    const floor = await floors.connect(REPO, { autoAssign: true });
    expect(floor).toMatchObject({ id: REPO, floor: 1, autoAssign: true, cloneStatus: 'cloning' });
    expect((await floors.connect('demo-co/weather-api')).floor).toBe(2);
    await floors.sync(REPO);
    await wait(10);
    const now = store.floor(REPO);
    expect(now.cloneStatus).toBe('ready');
    expect(now.issues.length).toBeGreaterThan(0);
    expect(now.lastSync).not.toBeNull();
  });

  it('checks the clone of a floor loaded after a restart on its first sync', async () => {
    await floors.connect(REPO);
    await wait(10);
    await store.flush();
    const restarted = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
    await restarted.load();
    expect(restarted.floor(REPO).cloneStatus).toBe('pending');
    await new Floors(restarted, backend).sync(REPO);
    await wait(10);
    expect(restarted.floor(REPO).cloneStatus).toBe('ready');
  });

  it('refuses a bad name, an unknown repository and one that is already a floor', async () => {
    await expect(floors.connect('not a repo')).rejects.toMatchObject({ status: 400 });
    await expect(floors.connect('nobody/nothing')).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Could not resolve') });
    await floors.connect(REPO);
    await expect(floors.connect(REPO.toUpperCase())).rejects.toMatchObject({ status: 409 });
  });

  it('reports issues filed since the last sync, but not the ones it finds first', async () => {
    await floors.connect(REPO);
    await floors.sync(REPO);
    expect(events.some((e) => e.type === 'issuesFiled')).toBe(false);
    const n = await backend.github.createIssue(REPO, 'Export to CSV', '');
    await floors.sync(REPO);
    expect(events.filter((e) => e.type === 'issuesFiled')).toEqual([expect.objectContaining({ floorId: REPO, numbers: [n] })]);
  });

  it("files the manager's task as an issue and shows it on the floor straight away", async () => {
    await floors.connect(REPO);
    await floors.sync(REPO);
    const { number } = await floors.fileIssue(REPO, '  Export to CSV ', 'A button on the list page.');
    expect(store.floor(REPO).issues).toContainEqual(expect.objectContaining({ number, title: 'Export to CSV' }));
    await expect(floors.fileIssue(REPO, '   ', '')).rejects.toMatchObject({ status: 400 });
    await expect(floors.fileIssue(REPO, 'x'.repeat(300), '')).rejects.toMatchObject({ status: 400 });
    await expect(floors.fileIssue('nobody/nothing', 'Hi', '')).rejects.toMatchObject({ status: 404 });
  });

  it('says on the floor when a sync fails', async () => {
    await floors.connect(REPO);
    await floors.sync(REPO);
    backend.github.listIssues = async () => {
      throw new Error('HTTP 502: Bad Gateway\nmore detail');
    };
    await floors.sync(REPO);
    expect(store.floor(REPO).syncError).toBe('HTTP 502: Bad Gateway');
    expect(store.floor(REPO).issues.length).toBeGreaterThan(0); // keeps what it had
  });

  it("keeps the repository's languages from the connect, and asks again on a sync an hour later or after a restart", async () => {
    const meta = vi.spyOn(backend.github, 'repoMeta');
    await floors.connect(REPO);
    expect(store.floor(REPO).languages).toEqual(fakeLanguages(REPO));
    await floors.sync(REPO);
    await floors.sync(REPO);
    expect(meta).toHaveBeenCalledTimes(1); // the connect's
    meta.mockResolvedValueOnce({ ...(await backend.github.repoMeta(REPO)), languages: [{ name: 'Rust', share: 1 }] });
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + LANGUAGES_EVERY_MS);
    try {
      await floors.sync(REPO);
      await wait(10);
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
    expect(store.floor(REPO).languages).toEqual([{ name: 'Rust', share: 1 }]);
    await store.flush();
    const restarted = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
    await restarted.load();
    expect(restarted.floor(REPO).languages).toEqual([{ name: 'Rust', share: 1 }]);
    await new Floors(restarted, backend).sync(REPO);
    await wait(10);
    expect(restarted.floor(REPO).languages).toEqual(fakeLanguages(REPO));
  });
});
