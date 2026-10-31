// The demo's cloud: a fake Upstash account (any key opens it) whose Boxes are created, set up, paused and deleted with a
// little delay, a fake gh login, and a fake sign-in in the worker's terminal. Box workers' sessions are the demo's fake
// ones, so nothing is left to pick up after a restart. A new Box's Claude Code isn't signed in until the fake sign-in.
// Adapted from cubefarm server/demo.ts (MIT): demoBoxes, demoCloud, demoSignIn.
import { CloudError, type BoxApi, type BoxInfo } from '../machines/box/box.ts';
import type { BoxSignIn } from '../sessions/cliRunner.ts';
import type { WorkerTerminal } from '../sessions/terminal.ts';
import type { CloudBackend } from './backend.ts';

/** Where a demo Box's desk is: its repo and branch, for the fake sessions' pull requests. */
export type DemoBoxDesk = { fullName: string; branch: string };

/**
 * A fake Upstash account. `logins`: the Boxes whose Claude Code is signed in. `onDesk` hears each desk a Box sets up.
 * `ms` scales every delay (the tests make them instant).
 */
export function demoBoxes(logins: Set<string>, onDesk: (boxId: string, desk: DemoBoxDesk) => void, ms = 1000): BoxApi {
  const boxes = new Map<string, BoxInfo>();
  const installed = new Set<string>();
  let seq = 0;
  const wait = (f: number) => new Promise((r) => setTimeout(r, Math.round(ms * f)));
  const box = (id: string) => {
    const b = boxes.get(id);
    if (!b) throw new CloudError('That Box is gone.', 'gone');
    return b;
  };
  return {
    list: async () => [...boxes.values()].map((b) => ({ ...b })),
    create: async (o) => {
      await wait(2.5);
      const b: BoxInfo = { id: `demo-box-${++seq}`, name: o.name, labels: o.labels, status: 'running' };
      boxes.set(b.id, b);
      return { ...b };
    },
    get: async (id) => (boxes.has(id) ? { ...boxes.get(id)! } : null),
    resume: async (id) => {
      await wait(0.8);
      box(id).status = 'running';
    },
    pause: async (id) => {
      box(id).status = 'paused';
    },
    remove: async (id) => {
      boxes.delete(id);
      logins.delete(id);
    },
    run: async (id, script) => {
      box(id).status = 'running';
      if (script.includes('MARSHMALLOW_SIGNED_IN')) return { code: 0, output: logins.has(id) ? 'MARSHMALLOW_SIGNED_IN' : 'MARSHMALLOW_SIGNED_OUT' };
      if (script.includes('auth logout')) {
        logins.delete(id);
        return { code: 0, output: '' };
      }
      if (script.includes('MARSHMALLOW_SETUP_OK')) {
        await wait(3.5);
        return { code: 0, output: 'MARSHMALLOW_SETUP_OK' };
      }
      if (script.includes('git worktree add')) {
        await wait(0.9);
        const desk = script.match(/^W='\/workspace\/home\/work\/([^']+)'$/m)?.[1];
        const branch = script.match(/^B='([^']+)'$/m)?.[1];
        if (desk && branch) onDesk(id, { fullName: desk.replace('__', '/'), branch });
        return { code: 0, output: desk ? `/workspace/home/work/${desk}` : '' };
      }
      if (script.includes('DEPS_')) {
        if (installed.has(id)) return { code: 0, output: 'DEPS_SKIPPED' };
        if (!script.includes('npm ci')) return { code: 0, output: 'DEPS_STALE' };
        await wait(1.5);
        installed.add(id);
        return { code: 0, output: 'DEPS_INSTALLED' };
      }
      return { code: 0, output: script.includes('leftovers.patch') ? 'NONE' : '' };
    },
    read: async () => null,
    write: async () => undefined,
    files: async () => [],
    session: async () => {
      throw new CloudError("The demo's Boxes have no terminals: its sessions are fake.", 'other');
    },
    browser: async () => true,
  };
}

/** Where the demo's sign-in sends the manager: nowhere real. */
const DEMO_SIGN_IN = 'https://example.com/marshmallow-demo/claude-sign-in';

/**
 * The demo's sign-in in a Box worker's terminal, drawn as Claude Code's own looks, with a made-up link: pasting
 * anything and pressing Enter finishes it, and the fake account remembers the Box as signed in.
 */
function demoSignIn(o: { boxId: string; term: WorkerTerminal }, logins: Set<string>, exited: (code: number) => void): BoxSignIn {
  const { term } = o;
  term.note('── Signing Claude Code in · ☁ cloud machine (demo) ──');
  term.write(['Opening browser to sign in…', `If the browser didn't open, visit: ${DEMO_SIGN_IN}`, '', '\x1b[2m(demo) Paste anything and press Enter.\x1b[0m', 'Paste code here if prompted > '].join('\r\n'));
  let line = '';
  let over = false;
  const close = () => {
    over = true;
    term.bind(null);
  };
  term.bind({
    write: (data) => {
      for (const ch of data.replace(/\x1b\[[0-9;?]*[A-Za-z~]|\x1b./g, '')) {
        if (over) return;
        if (ch === '\r') {
          if (!line.trim()) continue;
          term.write('\r\n\x1b[32mLogin successful.\x1b[0m\r\n');
          logins.add(o.boxId);
          close();
          exited(0);
        } else if (ch === '\x7f' || ch === '\b') line = line.slice(0, -1);
        else if (ch >= ' ') line += ch; // never echoed, as the real prompt doesn't
      }
    },
    resize: () => undefined,
  });
  return {
    stop: () => {
      if (over) return;
      close();
      term.note('── sign-in closed ──');
    },
  };
}

/** The demo's cloud: one fake account and gh login, nothing to pick up after a restart, and expirable sign-ins. */
export function demoCloud(onDesk: (boxId: string, desk: DemoBoxDesk) => void, ms?: number): CloudBackend {
  const logins = new Set<string>();
  const account = demoBoxes(logins, onDesk, ms);
  return {
    boxes: () => account,
    env: () => ({}),
    ghToken: async () => 'demo-github-token-0000',
    gitIdentity: async (login) => ({ name: login ?? 'Demo Manager', email: 'demo@example.com' }),
    reconnect: async () => [], // fake sessions end with the office
    detach: () => undefined,
    signIn: (o, exited) => demoSignIn(o, logins, exited),
    expireSignIns: () => logins.clear(),
  };
}
