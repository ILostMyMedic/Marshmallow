import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Activity, ServerEvent, Worker } from '../../shared/types.ts';
import { createDemoBackend, type DemoBackend } from '../backend/demo.ts';
import type { SessionOptions } from '../sessions/session.ts';
import { Store } from '../store.ts';
import { Sessions, type SessionEnd } from './sessions.ts';

const REPO = 'demo-co/pixel-todo';

let dir: string;
let store: Store;
let backend: DemoBackend;
let sessions: Sessions;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-sessions-'));
  store = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  backend = createDemoBackend({ home: null, timing: { stepMs: () => 1, prepareMs: 1, checksMs: () => 5 }, rand: () => 0.9 });
  sessions = new Sessions(store, backend);
  store.putWorker(worker());
});
afterEach(async () => {
  backend.github.close();
  await store.flush();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

function worker(): Worker {
  return {
    id: 'w1',
    name: 'Ada',
    floorId: REPO,
    role: 'worker',
    seed: 1,
    desk: 0,
    model: '',
    effort: '',
    host: 'local',
    status: 'preparing',
    task: { kind: 'issue', issueNumber: 3, title: 'Drag and drop to reorder', branch: 'mm/issue-3-ada', prNumber: null, prUrl: null },
    activity: null,
    idleSince: null,
    startedAt: Date.now(),
    endedAt: null,
    costUsd: 0,
    turns: 0,
    lastError: null,
    sessionId: null,
  };
}

const options = (cwd: string): SessionOptions => ({
  cwd,
  prompt: '#3: Drag and drop to reorder',
  systemAppend: '',
  model: 'claude-opus-5-5',
  effort: 'medium',
  browserTesting: true,
  role: 'worker',
  task: 'issue',
  subject: { issueNumber: 3, prNumber: null, title: 'Drag and drop to reorder' },
});

describe('Sessions', () => {
  it("shows a session's lines and signs on the worker as it runs, then adds up what it cost", async () => {
    const cwd = await backend.machines.prepareDesk('w1', REPO, { defaultBranch: 'main' }, 'mm/issue-3-ada');
    const signs: (Activity | null)[] = [];
    const tab = { OPEN: 1, readyState: 1, on: () => undefined, send: (t: string) => {
      const ev = JSON.parse(t) as ServerEvent;
      if (ev.type === 'worker') signs.push(ev.worker.activity);
    } };
    store.addClient(tab as unknown as WebSocket);
    const end = await new Promise<SessionEnd>((resolve) => {
      sessions.start('w1', options(cwd), resolve);
      expect(store.worker('w1').status).toBe('working');
      expect(sessions.isRunning('w1')).toBe(true);
    });
    expect(end.result.ok).toBe(true);
    expect(end.sessionId).toMatch(/^demo-/);
    expect(end.shots.length).toBe(1);
    expect(signs.map((s) => s?.kind)).toEqual(expect.arrayContaining(['edit', 'test']));
    const w = store.worker('w1');
    expect(w).toMatchObject({ activity: null, endedAt: expect.any(Number) });
    expect(w.costUsd).toBeGreaterThan(0);
    expect(store.snapshot().logs.w1.some((l) => l.text.includes('git push'))).toBe(true);
    expect(sessions.isRunning('w1')).toBe(false);
  });

  it('refuses a second session, and stopping ends the first through onEnd', () => {
    let end: SessionEnd | null = null;
    sessions.start('w1', options('/x'), (e) => (end = e));
    expect(() => sessions.start('w1', options('/x'), () => undefined)).toThrow(expect.objectContaining({ status: 409 }));
    expect(sessions.stop('w1')).toBe(true);
    expect(end).toMatchObject({ result: { ok: false } });
    expect(sessions.stop('w1')).toBe(false);
  });

  it('puts the manager on the log and shows them talking', () => {
    sessions.start('w1', options('/x'), () => undefined);
    expect(sessions.send('w1', 'please add tests')).toBe(true);
    expect(store.worker('w1').activity).toEqual({ kind: 'talk', detail: 'your message' });
    sessions.stop('w1');
  });
});
