// BUILD-PLAN phase 7's "done when", on a fake Upstash account: a worker set to Box starts an issue, the office stops
// mid-task and starts again, and it catches up with the PR the worker opened meanwhile. The real runner (its Box
// branch, BoxPty, the restart pick-up) and the real pipeline run; only Upstash and GitHub are fakes. The fake Box has
// no Claude Code in it: the test writes the CLI's hook events into its events file, as hook.cjs would.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerEvent } from '../../shared/types.ts';
import type { CloudBackend } from '../backend/backend.ts';
import { createDemoBackend, type DemoBackend } from '../backend/demo.ts';
import { Floors } from '../floors.ts';
import type { BoxApi, BoxInfo, BoxSession } from '../machines/box/box.ts';
import { createPipeline, type Pipeline } from '../pipeline/pipeline.ts';
import { detachBoxClis, holdHooks, hooksReady, reconnectBoxClis, releaseClis, startCliSession } from '../sessions/cliRunner.ts';
import { Terminals } from '../sessions/terminals.ts';
import { Store } from '../store.ts';

const REPO = 'demo-co/weather-api';

/** One fake Box: files, a tmux that's alive or not, and tail sessions that follow the events file. */
function fakeBox() {
  const files = new Map<string, string>();
  const tails = new Set<{ file: string; onData: (d: string) => void }>();
  const box: BoxInfo = { id: 'box-1', name: '', labels: [], status: 'running' };
  const state = { alive: false, terminals: 0 };
  const session = (onClose?: () => void): BoxSession => {
    let end!: (code: number) => void;
    const done = new Promise<number>((r) => (end = r));
    return { write: () => undefined, resize: () => undefined, close: () => (onClose?.(), end(-1)), done };
  };
  const api: BoxApi = {
    list: async () => (box.labels.length ? [{ ...box }] : []),
    create: async (o) => Object.assign(box, { name: o.name, labels: o.labels, status: 'running' as const }),
    get: async () => ({ ...box }),
    resume: async () => undefined,
    pause: async () => undefined,
    remove: async () => undefined,
    run: async (_id, script) => {
      if (script.includes('has-session')) return { code: 0, output: state.alive ? 'ALIVE' : 'GONE' };
      if (script.includes('kill-server')) return (state.alive = false), { code: 0, output: '' };
      if (script.includes('MARSHMALLOW_SETUP_OK')) return { code: 0, output: 'MARSHMALLOW_SETUP_OK' };
      if (script.includes('MARSHMALLOW_SIGNED_IN')) return { code: 0, output: 'MARSHMALLOW_SIGNED_IN' };
      if (script.includes('git worktree add')) return { code: 0, output: '/workspace/home/work/demo-co__weather-api' };
      if (script.includes('DEPS_')) return { code: 0, output: 'DEPS_NONE' };
      return { code: 0, output: '' };
    },
    read: async (_id, file, o = {}) => {
      const text = files.get(file);
      return text === undefined ? null : text.slice(o.offset ?? 0, (o.offset ?? 0) + (o.length ?? text.length));
    },
    write: async (_id, file, content) => void files.set(file, content),
    files: async () => [],
    session: async (_id, o) => {
      const tail = o.cmd.match(/tail -c \+(\d+) -F '([^']+)'/);
      if (!tail) {
        state.terminals++;
        if (o.cmd.includes('new-session')) state.alive = true;
        return session();
      }
      const sub = { file: tail[2], onData: o.onData };
      tails.add(sub);
      const from = Number(tail[1]) - 1;
      setTimeout(() => tails.has(sub) && o.onData((files.get(sub.file) ?? '').slice(from)), 0);
      return session(() => tails.delete(sub));
    },
    browser: async () => false,
  };
  /** The session's events file, once its CLI was started. */
  const eventsFile = () => {
    const launch = [...files].find(([f]) => f.endsWith('/launch.json'));
    return launch ? (JSON.parse(launch[1]) as { events: string }).events : null;
  };
  /** The CLI's hooks report an event: appended to the events file, and to whoever is following it. */
  const emit = (ev: Record<string, unknown>) => {
    const file = eventsFile()!;
    const line = `${JSON.stringify(ev)}\n`;
    files.set(file, (files.get(file) ?? '') + line);
    for (const t of tails) if (t.file === file) t.onData(line);
  };
  return { api, state, emit, eventsFile };
}

let dir: string;
let box: ReturnType<typeof fakeBox>;
let github: DemoBackend['github'];
let offices: { pipeline: Pipeline; store: Store; terminals: Terminals }[] = [];

/** An office: its own store, terminals and pipeline, on the same home, fake GitHub and fake Box. */
async function office() {
  const demo = createDemoBackend({ home: null, timing: { stepMs: () => 1, prepareMs: 1, installMs: 1, cloneMs: 1, checksMs: () => 60_000, closeAfterMergeMs: 5, boxMs: 1 }, rand: () => 0.9 });
  if (github) Object.assign(demo, { github });
  github = demo.github;
  const cloud: CloudBackend = { ...demo.cloud, boxes: () => box.api, reconnect: reconnectBoxClis, detach: detachBoxClis };
  const backend = { ...demo, startSession: startCliSession, cloud };
  const store = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  await store.load();
  const events: ServerEvent[] = [];
  store.addClient({ OPEN: 1, readyState: 1, on: () => undefined, send: (t: string) => events.push(JSON.parse(t)) } as never);
  const terminals = new Terminals(path.join(dir, 'terminals'));
  const pipeline = createPipeline(store, backend, new Floors(store, backend), terminals, { cloud: { secretsFile: path.join(dir, 'secrets.json') } });
  offices.push({ pipeline, store, terminals });
  return { pipeline, store, events, floors: new Floors(store, backend) };
}

async function until(done: () => boolean | Promise<boolean>, ms = 15_000) {
  const end = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-box-restart-'));
  box = fakeBox();
  github = undefined as never;
  offices = [];
});

afterEach(async () => {
  releaseClis();
  for (const o of offices) {
    o.pipeline.scheduler.stop();
    o.pipeline.stopAll();
    await o.store.flush();
    await o.terminals.saveAll();
  }
  github?.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

/** Ada starts issue #1 in her Box, and the office stops mid-task. */
async function startThenStop() {
  holdHooks();
  hooksReady();

  // The office: an Upstash key, new workers in Boxes, one worker on a floor with its issues.
  const a = await office();
  await a.pipeline.ctx.cloud.init();
  await a.pipeline.ctx.cloud.account.setKey('upstash-key');
  a.store.updateSettings({ autoscale: false, cloud: { machineKind: 'box', boxSize: 'small', boxLimit: 10 } });
  await a.floors.connect(REPO, { autoAssign: true });
  await a.floors.sync(REPO);
  const ada = a.pipeline.ctx.team.hire(REPO);
  expect(ada.host).toBe('box');
  a.pipeline.scheduler.start(20);

  // Ada takes issue #1 and her Claude Code starts in her Box, under tmux.
  await until(() => box.state.alive && box.eventsFile() !== null);
  const task = a.store.worker(ada.id).task!;
  expect(task).toMatchObject({ kind: 'issue', issueNumber: 1 });
  box.emit({ hook_event_name: 'UserPromptSubmit', session_id: 's1', transcript_path: '/t/s1.jsonl', transcript_exists: true, prompt: 'Please resolve GitHub issue #1' });
  box.emit({ hook_event_name: 'PreToolUse', session_id: 's1', transcript_path: '/t/s1.jsonl', transcript_exists: true, tool_name: 'Edit', tool_use_id: 'u1', tool_input: { file_path: '/workspace/home/work/demo-co__weather-api/src/forecast.ts' } });
  await until(() => a.store.boxCli(ada.id) !== null && a.store.snapshot().logs[ada.id]?.some((l) => l.text.includes('Edit src/forecast.ts')) === true);
  expect(a.store.worker(ada.id)).toMatchObject({ status: 'working', sessionId: 's1' });

  // The office stops mid-task; the CLI carries on in the Box.
  a.pipeline.scheduler.stop();
  releaseClis();
  await a.store.flush();
  expect(box.state.alive).toBe(true);
  return { ada, task };
}

/** The office starts again and picks Ada's CLI up. */
async function restart() {
  holdHooks();
  const b = await office();
  await b.pipeline.ctx.cloud.init();
  const back = await b.pipeline.ctx.cloud.reconnect();
  b.pipeline.reattach(back);
  hooksReady();
  return { b, back };
}

describe('a Box worker across an office restart', () => {
  it('catches up with the PR the worker opened while the office was closed, their CLI still running', async () => {
    const { ada, task } = await startThenStop();
    // Meanwhile it pushes, opens the PR and finishes its turn, then waits at its prompt.
    const pr = github.openPull(REPO, { title: 'Add /forecast endpoint', branch: task.branch!, closes: 1 });
    box.emit({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Bash', tool_use_id: 'u2', tool_input: { command: 'gh pr create --fill' } });
    box.emit({ hook_event_name: 'Stop', session_id: 's1', last_assistant_message: `Opened ${pr.url}. It closes #1.` });

    // The office starts again: Ada's CLI is picked up, its events come in, and the build ends with that PR.
    const { b, back } = await restart();
    expect(back).toEqual([{ workerId: ada.id, resumeId: 's1', busy: true }]);

    await until(() => b.events.some((e) => e.type === 'prOpened' && e.prNumber === pr.number), 20_000);
    expect(b.store.worker(ada.id)).toMatchObject({ status: 'done', task: { prNumber: pr.number } });
    expect(b.store.findQa(REPO, pr.number)).toMatchObject({ devWorkerId: ada.id });
  }, 30_000);

  it('replays what a CLI that finished and exited while the office was closed reported', async () => {
    const { ada, task } = await startThenStop();
    const pr = github.openPull(REPO, { title: 'Add /forecast endpoint', branch: task.branch!, closes: 1 });
    box.emit({ hook_event_name: 'Stop', session_id: 's1', last_assistant_message: 'Opened ' + pr.url + '.' });
    box.emit({ hook_event_name: 'MarshmallowExit', code: 0 });
    box.state.alive = false;

    const { b, back } = await restart();
    expect(back).toEqual([{ workerId: ada.id, resumeId: 's1', busy: true }]);
    await until(() => b.events.some((e) => e.type === 'prOpened' && e.prNumber === pr.number), 20_000);
    expect(b.store.worker(ada.id).task?.prNumber).toBe(pr.number);
  }, 30_000);

  it('lets go of a CLI that vanished mid-turn (a paused Box loses its tmux), so its task can be given back', async () => {
    const { ada } = await startThenStop();
    box.state.alive = false; // no Stop and no exit: the turn never finished
    const { b, back } = await restart();
    expect(back).toEqual([]);
    expect(b.store.boxCli(ada.id)).toBeNull();
  }, 30_000);
});
