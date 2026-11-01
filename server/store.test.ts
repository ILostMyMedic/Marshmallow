import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Floor, ServerEvent, Worker } from '../shared/types.ts';
import { nextIdleSince, Store, type SavedState } from './store.ts';

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-store-'));
  file = path.join(dir, 'state.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

const about = { version: '0.0.0', demo: true };

const floor = (over: Partial<Floor> = {}): Floor => ({
  id: 'demo/app',
  fullName: 'demo/app',
  description: '',
  url: 'https://github.com/demo/app',
  defaultBranch: 'main',
  floor: 1,
  color: '#ff8a5b',
  autoAssign: true,
  browserTesting: true,
  mission: '',
  summary: '',
  qaBrief: '',
  teamSize: null,
  held: [],
  languages: [],
  cloneStatus: 'ready',
  cloneError: null,
  issues: [{ number: 1, title: 'An issue', body: '', url: '', labels: [], createdAt: '' }],
  pulls: [],
  lastSync: 1,
  syncError: null,
  ...over,
});

const worker = (over: Partial<Worker> = {}): Worker => ({
  id: 'w1',
  name: 'Ada',
  floorId: 'demo/app',
  role: 'worker',
  seed: 42,
  desk: 0,
  model: '',
  effort: '',
  host: 'local',
  status: 'idle',
  task: null,
  activity: null,
  idleSince: 100,
  startedAt: null,
  endedAt: null,
  costUsd: 0,
  turns: 0,
  lastError: null,
  sessionId: null,
  leaving: false,
  ...over,
});

/** A tab that keeps what it's sent. */
function tab() {
  const events: ServerEvent[] = [];
  const ws = { OPEN: 1, readyState: 1, send: (text: string) => events.push(JSON.parse(text)), on: () => ws } as unknown as WebSocket;
  return { ws, events };
}

describe('Store', () => {
  it('starts empty without a state file', async () => {
    const store = new Store(file, about);
    await store.load();
    expect(store.snapshot()).toMatchObject({ version: '0.0.0', demo: true, floors: [], workers: [], qa: [], logs: {} });
  });

  it("saves and loads the office, leaving GitHub's side of floors out", async () => {
    const store = new Store(file, about);
    store.putFloor(floor());
    store.putWorker(worker({ activity: { kind: 'edit', detail: 'App.tsx' } }));
    store.appendLog('w1', [{ kind: 'system', text: 'hello' }], 5);
    store.updateSettings({ companyName: 'Fluff Inc' });
    await store.flush();

    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as SavedState;
    expect(saved.floors[0]).not.toHaveProperty('issues');
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);

    const again = new Store(file, about);
    await again.load();
    const snap = again.snapshot();
    expect(snap.settings.companyName).toBe('Fluff Inc');
    expect(snap.floors[0]).toMatchObject({ id: 'demo/app', issues: [], cloneStatus: 'pending' });
    expect(snap.workers[0]).toMatchObject({ name: 'Ada', activity: null });
    expect(snap.logs.w1.map((l) => l.text)).toEqual(['hello']);
    // log ids carry on from the saved ones
    expect(again.appendLog('w1', [{ kind: 'text', text: 'next' }])[0].id).toBe(snap.logs.w1[0].id + 1);
    await again.flush(); // not a timer's write after the folder is gone
  });

  it('loads a floor saved before it had languages with none', async () => {
    const { languages: _l, cloneStatus: _c, cloneError: _e, issues: _i, pulls: _p, lastSync: _s, syncError: _y, ...old } = floor();
    fs.writeFileSync(file, JSON.stringify({ floors: [old] }));
    const store = new Store(file, about);
    await store.load();
    expect(store.floor('demo/app').languages).toEqual([]);
  });

  it("keeps a state file that isn't JSON aside and starts afresh", async () => {
    fs.writeFileSync(file, '{ not json');
    const store = new Store(file, about);
    await store.load();
    expect(store.snapshot().floors).toEqual([]);
    expect(fs.readdirSync(dir).some((f) => f.startsWith('state.json.unreadable-'))).toBe(true);
  });

  it('sends a tab the snapshot, then each change and moment', async () => {
    const store = new Store(file, about);
    const { ws, events } = tab();
    store.addClient(ws);
    store.putFloor(floor());
    store.putWorker(worker());
    store.moment({ type: 'hired', at: 1, worker: worker() });
    store.patchWorker('w1', { status: 'working' }, 200);
    store.removeWorker('w1');
    expect(events.map((e) => e.type)).toEqual(['snapshot', 'floor', 'worker', 'hired', 'worker', 'workerRemoved']);
    await store.flush();
  });

  it('answers 404 for a floor or worker it does not have', () => {
    const store = new Store(file, about);
    expect(() => store.worker('nobody')).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => store.patchFloor('demo/none', { mission: 'x' })).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('nextIdleSince', () => {
  it('clears while busy and starts counting when they stop', () => {
    const idle = worker({ idleSince: 100 });
    const busy = worker({ status: 'working', idleSince: null });
    expect(nextIdleSince(idle, busy, 500)).toBeNull();
    expect(nextIdleSince(busy, worker({ status: 'done' }), 900)).toBe(900);
  });

  it("keeps counting through changes that don't make them busy", () => {
    expect(nextIdleSince(worker({ status: 'done', idleSince: 100 }), worker({ status: 'idle' }), 900)).toBe(100);
  });
});
