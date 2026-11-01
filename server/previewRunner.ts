// A floor's app, run for the manager to check what the team shipped (server/previews.ts is the service): the floor's
// preview worktree refreshed to its work branch's latest commit, dependencies installed when they're missing or
// changed, the app started on the floor's port (127.0.0.1 only) and watched until it answers there.
// Adapted from cubefarm server/previewRunner.ts (MIT). Cut: PR previews and their slot worktrees (the PR theatre), the
// floor's own environment variables and the {tmp} placeholder, and the "unconfigured" state (nothing to run is an error
// that says so).
import { spawn, type ChildProcess } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { HOME_DIR } from './config.ts';
import { git } from './exec.ts';
import { writeJsonAtomic } from './files.ts';
import { depsCurrent, INSTALL_TIMEOUT_MS, killTree, readDeps, writeMarker } from './machines/deps.ts';
import { preparePreview, previewDir, releasePreviews, type OfficeProcesses } from './machines/workspace.ts';

export interface PreviewJob {
  fullName: string;
  /** The branch it runs the latest commit of: the floor's work branch. */
  branch: string;
  port: number;
  /** The manager's command, its {port} filled in (fillPort), or null: the package.json's script. */
  command: string | null;
}

export interface PreviewCallbacks {
  status(state: 'preparing' | 'installing' | 'starting' | 'running'): void;
  /** The commit it runs. */
  sha(sha: string): void;
  /** With no command set: the script found to run the app, as a person would say it ("npm run dev"), without the office's flags. */
  command(command: string): void;
  log(lines: string[]): void;
  /** The run ended by itself: it couldn't start, or the app stopped. */
  failed(message: string): void;
}

export interface PreviewHandle {
  /** Stops the app and everything it started; safe in any phase. */
  stop(): Promise<void>;
}

export interface PreviewBackend {
  start(job: PreviewJob, cb: PreviewCallbacks): PreviewHandle;
  /** The office started: what an office that stopped hard left running for the floors' previews goes. */
  clearOrphans(fullNames: string[]): Promise<void>;
}

export const LOOPBACK = '127.0.0.1';
export const START_TIMEOUT_MS = 3 * 60_000;
// Colours, cursor moves and terminal links in a dev server's output.
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g;

// ---------- choosing how to run the app ----------

/** The manager's command with {port} filled in. */
export const fillPort = (command: string, port: number) => command.replaceAll('{port}', String(port));

// How the common dev servers are told the port and to listen on 127.0.0.1 only; the rest read PORT and HOST.
const TOOLS: { match: RegExp; flags: (port: number) => string }[] = [
  { match: /^vite(?!\s+(build|optimize)\b)(\s|$)/, flags: (p) => `--port ${p} --strictPort --host ${LOOPBACK}` },
  { match: /^(next\s+(dev|start)|gatsby\s+(develop|serve))(\s|$)/, flags: (p) => `-p ${p} -H ${LOOPBACK}` },
  {
    match: /^(astro\s+(dev|preview|start)|nuxi?\s+(dev|preview|start)|ng\s+serve|vue-cli-service\s+serve|webpack\s+serve|webpack-dev-server|docusaurus\s+(start|serve)|parcel(?!\s+build\b))(\s|$)/,
    flags: (p) => `--port ${p} --host ${LOOPBACK}`,
  },
  { match: /^http-server(\s|$)/, flags: (p) => `-p ${p} -a ${LOOPBACK}` },
  { match: /^serve(\s|$)/, flags: (p) => `-l tcp://${LOOPBACK}:${p}` },
];

/** The part of a script that runs last (`vite build && vite preview` → `vite preview`), without the env settings or npx in front. */
export function lastCommand(script: string): string {
  let cmd = (script.split(/&&|\|\||;/).pop() ?? '').trim();
  for (;;) {
    const next = cmd.replace(/^(cross-env(-shell)?\s+|[A-Za-z_][A-Za-z0-9_]*=\S*\s+|npx\s+(-y\s+|--yes\s+)?|bunx\s+|yarn\s+(?=\S)(?!run\b))/, '');
    if (next === cmd) return cmd;
    cmd = next;
  }
}

/**
 * The flags that tell a script's dev server the port and to listen on 127.0.0.1 only. '' when it reads PORT and HOST
 * itself (node server.js, react-scripts), names a port of its own (the manager then sets the preview's port or
 * command), or runs several programs at once.
 */
export function portFlags(script: string, port: number): string {
  const cmd = lastCommand(script);
  if (/(^|\s)(--port|--listen|-p|-l)(\s|=|$)/.test(cmd)) return '';
  if (/^(concurrently|npm-run-all|run-p|run-s)(\s|$)|\s&(\s|$)|\|/.test(cmd)) return '';
  return TOOLS.find((t) => t.match.test(cmd))?.flags(port) ?? '';
}

/** The package.json script that runs the app: dev, else start, else preview; null when it has none of them. */
export function appScript(pkg: unknown): { name: string; script: string } | null {
  const scripts = (pkg as { scripts?: unknown } | null)?.scripts;
  if (!scripts || typeof scripts !== 'object') return null;
  const all = scripts as Record<string, unknown>;
  const name = ['dev', 'start', 'preview'].find((s) => typeof all[s] === 'string' && all[s].trim());
  return name ? { name, script: all[name] as string } : null;
}

/** The app's command as a person would say it ("npm run dev"), without the flags the office adds when it runs it. */
export const scriptCommand = (name: string) => `npm run ${name}`;

/** How the office runs the app with no command set: its script, told the port the ways its tool understands. null: nothing to run. */
export function defaultCommand(pkg: unknown, port: number): string | null {
  const found = appScript(pkg);
  if (!found) return null;
  const flags = portFlags(found.script, port);
  return `${scriptCommand(found.name)}${flags ? ` -- ${flags}` : ''}`;
}

/** Where the app says it answers: the first local address in its output (Vite's "Local:", Next's "- Local:"), one on `port` first. */
export function urlFromOutput(lines: string[], port?: number): { url: string; port: number; path: string } | null {
  const re = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})(\/[^\s'"<>)\]]*)?/gi;
  let first: { url: string; port: number; path: string } | null = null;
  for (const line of lines) {
    for (const m of line.replace(ANSI, '').matchAll(re)) {
      const tail = (m[2] ?? '').replace(/[.,;:!]+$/, '');
      const found = { url: m[0].slice(0, m[0].length - (m[2] ?? '').length) + tail, port: Number(m[1]), path: tail || '/' };
      if (port !== undefined && found.port === port) return found;
      first ??= found;
    }
  }
  return first;
}

/**
 * What the app runs with: the office's environment without Claude's credentials and config, or the office's own
 * MARSHMALLOW_* settings (an app that is itself an office never inherits this one's home or port); then the port and
 * 127.0.0.1 the usual ways (PORT, HOST), and no browser tab opening.
 */
export function previewEnv(port: number, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && !/^(ANTHROPIC_|CLAUDE|MARSHMALLOW_)/i.test(k)) env[k] = v;
  return { ...env, PORT: String(port), HOST: LOOPBACK, BROWSER: 'none' };
}

/** Whether something accepts connections on the port at `host` (127.0.0.1 unless asked). */
export function portOpen(port: number, host = LOOPBACK): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(800, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

// ---------- running it ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** package.json's contents, or null when there is none. */
async function readPackage(dir: string): Promise<unknown> {
  let text: string;
  try {
    text = await fs.readFile(path.join(dir, 'package.json'), 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`package.json isn't valid JSON: ${(err as Error).message}`);
  }
}

class Stopped extends Error {}

/** One run of a floor's app, from its worktree to a listening port. */
class RealPreview implements PreviewHandle {
  private child: ChildProcess | null = null;
  private stopped = false;
  private spawned = false; // the app was started: its port and leftovers are the office's to clear
  private partial = '';
  private tail: string[] = [];

  constructor(
    private readonly job: PreviewJob,
    private readonly cb: PreviewCallbacks,
    private readonly keep: () => OfficeProcesses,
    private readonly running: RunningApps,
  ) {
    void this.run().catch(async (err) => {
      if (this.stopped || err instanceof Stopped) return;
      this.stopped = true;
      if (this.child) await killTree(this.child);
      this.cb.failed((err as Error).message);
      if (!this.spawned) return;
      this.running.set(this.job.fullName, null);
      // A launcher that died can leave its server behind in the worktree
      void releasePreviews([this.job.fullName], null, this.keep()).catch(() => undefined);
    });
  }

  async stop() {
    this.stopped = true;
    if (this.child) await killTree(this.child);
    if (!this.spawned) return;
    // Still answering: something the app started outside its process tree holds the port, and goes too.
    if (await portOpen(this.job.port)) await releasePreviews([this.job.fullName], this.job.port, this.keep()).catch(() => undefined);
    this.running.set(this.job.fullName, null);
  }

  private check() {
    if (this.stopped) throw new Stopped();
  }

  private async run() {
    const { job, cb } = this;
    cb.status('preparing');
    cb.log([`Fetching ${job.branch} into the preview worktree…`]);
    const wt = await preparePreview(job.fullName, job.branch, (text) => cb.log([text]));
    this.check();
    const [sha = '', subject = ''] = (await git(['log', '-1', '--format=%H%n%s'], { cwd: wt })).split(/\r?\n/);
    cb.sha(sha);
    cb.log([`HEAD is now at ${sha.slice(0, 7)} ${subject}`]);

    const pkg = await readPackage(wt);
    const found = job.command ? null : appScript(pkg);
    const command = job.command ?? defaultCommand(pkg, job.port);
    if (!command) {
      throw new Error(pkg ? "package.json has no dev, start or preview script: set the command that runs this floor's app." : "Nothing to run: there's no package.json, and no command is set for this floor's app.");
    }
    if (found) cb.command(scriptCommand(found.name));
    const env = previewEnv(job.port);
    if (pkg) await this.install(wt, env);
    this.check();

    cb.status('starting');
    cb.log([`$ ${command}`]);
    this.spawned = true;
    this.running.set(job.fullName, job.port);
    let exitCode: number | null | undefined;
    const exited = this.spawn(command, wt, env).then((code) => (exitCode = code));
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (!(await portOpen(job.port))) {
      this.check();
      if (exitCode !== undefined) throw new Error(`The app exited (code ${exitCode}) before it answered on ${LOOPBACK}:${job.port}.${await this.hint()}`);
      if (Date.now() > deadline) throw new Error(`The app didn't answer on ${LOOPBACK}:${job.port} within ${START_TIMEOUT_MS / 60_000} minutes.${await this.hint()}`);
      await sleep(700);
    }
    this.check();
    cb.status('running');
    await exited;
    // Some launchers exit while the server they started keeps serving: it's only over once the port closes.
    while (!this.stopped && (await portOpen(job.port))) await sleep(3000);
    this.check();
    throw new Error(`The app stopped (exit code ${exitCode}).`);
  }

  /** Why the app may not answer where the office looks: it says it's elsewhere, or it listens on IPv6 only. */
  private async hint(): Promise<string> {
    const said = urlFromOutput(this.tail, this.job.port);
    if (said && said.port !== this.job.port) return ` It says it's at ${said.url}: have its command use the port it's given (PORT, or {port} in the command), or set this floor's preview port to ${said.port}.`;
    if (await portOpen(this.job.port, '::1')) return ` It answers on [::1]:${this.job.port}, not on ${LOOPBACK}: have it listen on ${LOOPBACK} (HOST, or its --host flag).`;
    return '';
  }

  /** npm ci (npm install without a lockfile), skipped when package.json and the lockfile haven't changed since the last one. */
  private async install(wt: string, env: Record<string, string>) {
    const deps = await readDeps(wt);
    if (depsCurrent(deps)) return this.cb.log(['Dependencies unchanged since the last install; skipping it.']);
    this.cb.status('installing');
    const cmd = deps.lock !== null ? 'npm ci --no-audit --no-fund' : 'npm install --no-audit --no-fund';
    this.cb.log([`$ ${cmd}`]);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), INSTALL_TIMEOUT_MS)));
    const code = await Promise.race([this.spawn(cmd, wt, env), timeout]).finally(() => clearTimeout(timer));
    this.check();
    if (code === 'timeout') {
      if (this.child) await killTree(this.child);
      throw new Error(`${cmd} took longer than ${INSTALL_TIMEOUT_MS / 60_000} minutes.`);
    }
    if (code !== 0) throw new Error(`${cmd} failed (code ${code}): its output is in the log.`);
    this.child = null;
    await writeMarker(wt, deps.hash);
  }

  /**
   * Runs a command line (the manager's command is one) through the platform's shell, its output into the log; resolves
   * with its exit code. On Windows cmd.exe gets the line as it is, as spawn's shell option does; elsewhere it gets a
   * process group of its own, so killTree takes the whole tree.
   */
  private spawn(cmd: string, cwd: string, env: Record<string, string>): Promise<number | null> {
    this.check();
    const stdio: ['ignore', 'pipe', 'pipe'] = ['ignore', 'pipe', 'pipe'];
    const child =
      process.platform === 'win32'
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${cmd}"`], { cwd, env, stdio, windowsHide: true, windowsVerbatimArguments: true })
        : spawn('/bin/sh', ['-c', cmd], { cwd, env, stdio, windowsHide: true, detached: true });
    this.child = child;
    const onData = (buf: Buffer) => this.output(buf.toString());
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    return new Promise((resolve) => {
      child.once('error', (err) => {
        this.lines([err.message]);
        resolve(-1);
      });
      child.once('close', (code) => {
        this.lines([this.partial]);
        this.partial = '';
        resolve(code);
      });
    });
  }

  private output(text: string) {
    const lines = (this.partial + text).replace(ANSI, '').split(/\r?\n|\r/);
    this.partial = lines.pop() ?? '';
    this.lines(lines);
  }

  private lines(lines: string[]) {
    const out = lines.filter((l) => l.trim());
    if (!out.length) return;
    this.tail = [...this.tail, ...out].slice(-100);
    this.cb.log(out);
  }
}

/**
 * The ports the office's apps run on, by floor repository, in a file in its home. Node ends the office's own children
 * with it, but on Windows not theirs: after a hard stop (tsx watch's restarts end the office without its shutdown) an
 * app lives on holding its port, and its command line needn't say whose it is. The next office clears what listens on
 * the ports recorded here, and only those: they were the office's own when it stopped.
 */
export class RunningApps {
  private apps = new Map<string, number>();
  private writing: Promise<void> = Promise.resolve();
  /** What the last office left running, read when this one starts. */
  readonly left: Record<string, number>;

  constructor(private readonly file: string) {
    let saved: unknown = null;
    try {
      saved = JSON.parse(fsSync.readFileSync(file, 'utf8'));
    } catch {
      // none: the last office stopped cleanly, or never ran an app
    }
    this.left = Object.fromEntries(Object.entries(saved && typeof saved === 'object' ? saved : {}).filter((e): e is [string, number] => Number.isInteger(e[1])));
  }

  /** An app came up on `port` (null: it's gone). */
  set(fullName: string, port: number | null) {
    if (port === null) this.apps.delete(fullName);
    else this.apps.set(fullName, port);
    this.save();
  }

  /** Writes what runs now, so the leftovers, once cleared, are forgotten. */
  save(): Promise<void> {
    const now = Object.fromEntries(this.apps);
    this.writing = this.writing.then(() => writeJsonAtomic(this.file, now)).catch(() => undefined);
    return this.writing;
  }
}

/** The real previews. `keep`: the office's own processes, which clearing a preview's leftovers never stops. */
export function realPreviews(keep: () => OfficeProcesses, file = path.join(HOME_DIR, 'previews-running.json')): PreviewBackend {
  let apps: RunningApps | null = null; // read the first time it's needed: the demo never needs it
  const running = () => (apps ??= new RunningApps(file));
  return {
    start: (job, cb) => new RealPreview(job, cb, keep, running()),
    clearOrphans: async (fullNames) => {
      const r = running();
      for (const [fullName, port] of Object.entries(r.left)) await releasePreviews([fullName], port, keep()).catch(() => undefined);
      // And whatever names a preview worktree in its command line (an app run from its node_modules)
      const there = await Promise.all(fullNames.map((n) => fs.access(previewDir(n)).then(() => n, () => null)));
      const dirs = there.filter((n): n is string => n !== null);
      if (dirs.length) await releasePreviews(dirs, null, keep());
      if (Object.keys(r.left).length) await r.save();
    },
  };
}
