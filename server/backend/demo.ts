// `--demo`: the backend with a fake GitHub, fake machines and fake Claude Code sessions, so the whole office runs
// with no GitHub, git, npm or Claude usage. The fake GitHub is saved in the office's home; desks start over on each
// start.
// Adapted from cubefarm server/demo.ts (MIT).
import path from 'node:path';
import type { LogEntry } from '../../shared/types.ts';
import type { MachineProvider } from '../machines/machines.ts';
import type { SessionCallbacks, SessionOptions } from '../sessions/session.ts';
import type { Backend } from './backend.ts';
import { FakeGitHub } from './demoGithub.ts';
import { fakeSession } from './demoSessions.ts';

/** How long the demo's pretend work takes, in ms (the tests make it all instant). */
export interface DemoTiming {
  stepMs(): number;
  prepareMs: number;
  installMs: number;
  cloneMs: number;
  checksMs(): number;
  closeAfterMergeMs: number;
}

const DEFAULT_TIMING: DemoTiming = {
  stepMs: () => 700 + Math.random() * 600, // a build's 19 steps take about 20 s
  prepareMs: 900,
  installMs: 1500,
  cloneMs: 400,
  checksMs: () => 12_000 + Math.random() * 10_000,
  closeAfterMergeMs: 5_000,
};

// How each kind of log line looks in the worker's terminal.
const ANSI: Record<LogEntry['kind'], (text: string) => string> = {
  text: (t) => t,
  tool: (t) => `\x1b[36m${t}\x1b[0m`,
  result: (t) => `\x1b[2m${t}\x1b[0m`,
  system: (t) => `\x1b[2m${t}\x1b[0m`,
  error: (t) => `\x1b[31m${t}\x1b[0m`,
  manager: (t) => `\x1b[35m${t}\x1b[0m`,
  done: (t) => `\x1b[32m${t}\x1b[0m`,
  thinking: (t) => `\x1b[2;3m${t}\x1b[0m`,
};

/** A fake session's lines also go into the worker's terminal, as a real CLI would draw them. */
function inTerminal(o: SessionOptions, cb: SessionCallbacks): SessionCallbacks {
  const term = o.terminal;
  if (!term) return cb;
  term.note(`── Claude Code (demo)${o.label ? ` · ${o.label}` : ''} ──`);
  return {
    ...cb,
    log: (entries) => {
      for (const e of entries) term.write(`${ANSI[e.kind](e.text)}\r\n`);
      cb.log(entries);
    },
    finished: (r) => {
      term.note(r.ok ? '── session ended ──' : `── session ended: ${r.errors.join('; ')} ──`);
      cb.finished(r);
    },
  };
}

export interface DemoBackend extends Backend {
  github: FakeGitHub;
  /** Everything back to how a first start finds it (the debug page's reset). */
  reset(): void;
}

export function createDemoBackend(opts: { home: string | null; timing?: Partial<DemoTiming>; rand?: () => number }): DemoBackend {
  const timing = { ...DEFAULT_TIMING, ...opts.timing };
  const rand = opts.rand ?? Math.random;
  const github = new FakeGitHub({ file: opts.home ? path.join(opts.home, 'demo-github.json') : null, rand, checksMs: timing.checksMs, closeAfterMergeMs: timing.closeAfterMergeMs });
  // What each desk has checked out. Desks are pretend, so a restart finds none.
  const desks = new Map<string, { fullName: string; branch: string }>();
  const installed = new Set<string>();
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const deskDir = (machine: string, fullName: string) => `/demo/machines/${machine}/work/${fullName}`;

  const machines: MachineProvider = {
    deskDir,
    prepareDesk: async (machine, fullName, _base, branch) => {
      await wait(timing.prepareMs);
      const dir = deskDir(machine, fullName);
      desks.set(dir, { fullName, branch });
      return dir;
    },
    env: () => ({}),
    release: async () => undefined,
    sweep: async () => 0,
    remove: async (machine) => {
      for (const dir of desks.keys()) {
        if (!dir.startsWith(`/demo/machines/${machine}/`)) continue;
        desks.delete(dir);
        installed.delete(dir);
      }
      return { removed: true, patches: [] };
    },
    list: async () => [...new Set([...desks.keys()].map((dir) => dir.split('/')[3]))],
    exists: async (machine, fullName) => desks.has(deskDir(machine, fullName)),
    // The first task on a desk installs, the next ones find nothing changed.
    installDeps: async (machine, fullName, cb) => {
      const dir = deskDir(machine, fullName);
      if (installed.has(dir)) {
        cb.log(['Dependencies unchanged since the last install; skipping it.']);
        return 'skipped';
      }
      cb.log(['Installing dependencies…', '$ npm ci']);
      cb.installing();
      await wait(timing.installMs);
      cb.log(['Dependencies installed.']);
      installed.add(dir);
      return 'installed';
    },
  };

  return {
    demo: true,
    github,
    ensureClone: () => wait(timing.cloneMs),
    mainDir: (fullName) => `/demo/${fullName}/main`,
    machines,
    startSession: (o, cb) => fakeSession(o, inTerminal(o, cb), { github, desk: desks.get(o.cwd) ?? null, rand, stepMs: timing.stepMs }),
    reset: () => {
      github.reset();
      desks.clear();
      installed.clear();
    },
  };
}
