// One worker session as the real Claude Code CLI in a pseudo-terminal, behind the session contract (log lines, the
// current tool, the final text, finished), so the pipeline can't tell it from the demo's fakes.
//
// Claude Code reports through HTTP hooks passed with --settings: every tool call (PreToolUse also approves it, so the
// CLI never stops to ask), each finished turn (Stop, with the final text), failures (StopFailure) and, through its
// status line, cost and usage limits. After a build or fix the CLI waits at its prompt for a while (keepAlive), so the
// manager can use it and a follow-up picks it up again.
//
// A Box worker's CLI runs under tmux in their Upstash Box instead (boxCli.ts): its hooks append to an events file there,
// which the office reads and hands to the same hook route, and it keeps working while the office is closed.
// Adapted from cubefarm server/cliRunner.ts (MIT): Claude Code, on this computer or in a Box (no Codex, OpenCode or keeper).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IPty } from '@lydell/node-pty';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { localModel } from '../../shared/models.ts';
import type { LogEntry } from '../../shared/types.ts';
import { BOX_ENV } from '../cloud.ts';
import { HOME_DIR } from '../config.ts';
import type { BoxApi } from '../machines/box/box.ts';
import { BOX_BIN, BOX_CLI_BIN, BOX_HOME, boxSessionDir, signInCommand, sq, tmuxKill } from '../machines/box/boxScripts.ts';
import { BOX_CDP, boxHooksReady, BoxPty, holdBoxHooks, finishedTurn, lookAtBoxCli, readFrom, type BoxCliRecord, type BoxTarget } from './boxCli.ts';
import { browserProblem, playwrightMcp } from './browser.ts';
import { claudeCommand, interruptions, launchArgs, modelEnv, playbookFiles, STATUSLINE_SOURCE, trustKey } from './clis.ts';
import { clip, describeTool, resultText, screenshotFile, summariseResult, tidyPaths, todoLines } from './format.ts';
import type { OfficeTools, SessionCallbacks, SessionHandle, SessionOptions, SessionResult } from './session.ts';
import type { WorkerTerminal } from './terminal.ts';

const nodePty = await import('@lydell/node-pty').catch((err: unknown) => {
  console.warn(`  terminals unavailable: ${(err as Error).message}`);
  return null;
});

/** The native terminal module loaded, so real sessions can run. */
export const terminalsAvailable = nodePty !== null;

const SESSIONS_DIR = path.join(HOME_DIR, 'sessions');
const BIN_DIR = path.join(HOME_DIR, 'bin');
/** After a turn ends the CLI may still pick up a queued message: only an idle prompt this long means it's done. */
const FINISH_GRACE_MS = 3000;
/** Starting up: how long before the office says the CLI seems to be waiting on something. */
const BOOT_MS = 60_000;
/** Claude's usage warning: pace new work from here. */
const USAGE_WARN_PCT = 90;
/** Prompts longer than this go in a file: Windows caps a command line at 32K characters. */
const INLINE_PROMPT_MAX = 8000;
/** A CLI left at its prompt this long is closed; its session can still be resumed. */
const IDLE_MS = 30 * 60_000;
/** The same in a Box: its idle Box can only pause once the CLI has closed. */
const BOX_IDLE_MS = 5 * 60_000;

// ---------- the pseudo-terminal ----------

/** A CLI's terminal: node-pty on this machine, or a Box's tmux (boxCli.ts). */
export interface Pty {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Stops the CLI and everything it started. */
  kill(): void;
  /** Kept with the terminal, for the office that picks it up after a restart (a Box's CLI). */
  setMeta?(meta: unknown): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (code: number) => void): void;
}

function killTree(proc: IPty) {
  if (process.platform === 'win32') {
    const tk = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    tk.once('error', () => undefined);
    return;
  }
  try {
    process.kill(-proc.pid, 'SIGTERM'); // the CLI leads its own session: take its MCP servers and tools with it
  } catch {
    proc.kill();
  }
}

function spawnPty(file: string, args: string[], o: { cols: number; rows: number; cwd: string; env: Record<string, string> }): Pty {
  if (!nodePty) throw new Error('the terminal module could not be loaded on this machine');
  // useConptyDll: Windows' own console host lingers after each CLI exits; the one node-pty ships goes with its terminal.
  const p = nodePty.spawn(file, args, { name: 'xterm-256color', cols: o.cols, rows: o.rows, cwd: o.cwd, env: o.env, useConptyDll: true });
  return {
    get pid() {
      return p.pid;
    },
    write: (data) => p.write(data),
    resize: (cols, rows) => p.resize(cols, rows),
    kill: () => killTree(p),
    onData: (cb) => void p.onData(cb),
    onExit: (cb) => void p.onExit(({ exitCode }) => cb(exitCode)),
  };
}

/** A pseudo-terminal whose CLI just died throws on writes and resizes before it reports the exit: ignore that. */
function quietly(fn: () => void) {
  try {
    fn();
  } catch {
    // the CLI is gone; its exit is on the way
  }
}

// ---------- routing the CLIs' calls back to their sessions ----------

let officeUrl = '';

/** The server's own address, for the hook endpoint the CLIs call back on. Set once it listens. */
export function setOfficeUrl(url: string) {
  officeUrl = url;
}

const routes = new Map<string, (body: Record<string, unknown>) => Record<string, unknown>>();

/** A hook or status-line call from a CLI (POST /api/hooks/:token). The answer is the hook's output. */
export function handleHook(token: string, body: unknown): Record<string, unknown> {
  const route = routes.get(token);
  if (!route || !body || typeof body !== 'object' || Array.isArray(body)) return {};
  try {
    return route(body as Record<string, unknown>);
  } catch (err) {
    console.warn('  a hook failed', err);
    return {};
  }
}

/** The CEO sessions' office tools, by session token. */
const offices = new Map<string, OfficeTools>();

/** The CEO's office tools over MCP (POST /api/mcp/:token): Streamable HTTP, stateless, a fresh server per request. */
export async function handleMcp(token: string, req: Request, res: Response) {
  const office = offices.get(token);
  if (!office) {
    res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'This session has ended.' }, id: null });
    return;
  }
  const server = office.serve();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

let helpersWritten = false;

/** The status-line script the CLIs run. Rewritten once per start, so updates reach them. */
function writeHelpers() {
  if (helpersWritten) return;
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.writeFileSync(path.join(BIN_DIR, 'statusline.cjs'), STATUSLINE_SOURCE);
  helpersWritten = true;
}

/** A command line for Claude Code's shell (Git Bash on Windows): forward slashes, quoted. */
const shellArg = (p: string) => `"${p.replaceAll('\\', '/')}"`;

const HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'Notification'];

/** PreToolUse's answer: nobody may be watching to answer a permission question, so every tool call is approved. */
const ALLOW = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'Approved by Marshmallow' } };

const toolInput = (b: Record<string, unknown>) => (b.tool_input && typeof b.tool_input === 'object' ? b.tool_input : {}) as Record<string, unknown>;

/** What a tool call returned, as text, and any images in it (Playwright screenshots). */
function toolOutput(response: unknown): { text: string; images: { data: string; mime: string }[] } {
  const images: { data: string; mime: string }[] = [];
  const blocks = Array.isArray(response) ? response : Array.isArray((response as { content?: unknown })?.content) ? (response as { content: unknown[] }).content : null;
  if (blocks) {
    for (const b of blocks as Record<string, unknown>[]) {
      const source = b?.source as { type?: string; data?: string; media_type?: string } | undefined;
      if (b?.type === 'image' && source?.type === 'base64' && source.data) images.push({ data: source.data, mime: source.media_type ?? 'image/png' });
      else if (b?.type === 'image' && typeof b.data === 'string') images.push({ data: b.data, mime: String(b.mimeType ?? 'image/png') });
    }
    return { text: resultText(blocks), images };
  }
  if (typeof response === 'string') return { text: response, images };
  const r = response as { stdout?: unknown; stderr?: unknown; file?: { content?: unknown }; filenames?: unknown } | null;
  if (r && typeof r === 'object') {
    if (typeof r.stdout === 'string' || typeof r.stderr === 'string') return { text: [r.stdout, r.stderr].filter((s) => typeof s === 'string' && s).join('\n'), images };
    if (typeof r.file?.content === 'string') return { text: r.file.content, images };
    if (Array.isArray(r.filenames)) return { text: r.filenames.join('\n'), images };
  }
  return { text: '', images };
}

// ---------- CLIs that outlive their session ----------

/** A CLI running in a worker's terminal. After a build or fix it waits at its prompt, and a follow-up picks it up. */
interface LiveCli {
  term: WorkerTerminal;
  proc: Pty | null;
  token: string;
  dir: string;
  resumeId: string | null; // the session a follow-up resumes
  statusLine: string;
  /** The session driving it; null while it waits at its prompt. */
  session: { hook(b: Record<string, unknown>): Record<string, unknown>; exited(code: number): void } | null;
  idleTimer?: NodeJS.Timeout;
  /** Where it runs when it's a Box worker's. */
  box?: { api: BoxApi; boxId: string };
}
const lives = new Map<WorkerTerminal, LiveCli>();

/** Closes a CLI for good. */
function endLive(live: LiveCli) {
  if (lives.get(live.term) !== live) return;
  lives.delete(live.term);
  clearTimeout(live.idleTimer);
  routes.delete(live.token);
  offices.delete(live.token);
  live.term.releaseIdle = null;
  live.term.bind(null);
  live.proc?.kill();
  live.proc = null;
  live.term.note('── Claude Code session ended ──');
  // A Box's session folder goes with its tmux (BoxPty.kill).
  if (!live.box) fs.rm(live.dir, { recursive: true, force: true, maxRetries: 5 }, () => undefined);
}

/** A CLI is running in its terminal: its output, its keys and its hooks are connected. */
function wire(l: LiveCli) {
  const p = l.proc!;
  lives.set(l.term, l);
  routes.set(l.token, (b) => (l.session ? l.session.hook(b) : idleHook(l, b)));
  l.term.bind({ write: (d) => quietly(() => p.write(d)), resize: (c, r) => quietly(() => p.resize(c, r)) });
  p.onData((data) => {
    if (lives.get(l.term) === l) l.term.write(data);
  });
  p.onExit((code) => {
    l.proc = null;
    if (lives.get(l.term) !== l) return; // already replaced or closed
    if (l.session) l.session.exited(code);
    else endLive(l); // quit while waiting at its prompt
  });
}

/** The task is done, but the CLI stays at its prompt for the manager (or a follow-up), for a while. */
function waitAtPrompt(l: LiveCli) {
  clearTimeout(l.idleTimer);
  l.idleTimer = setTimeout(() => endLive(l), l.box ? BOX_IDLE_MS : IDLE_MS);
  l.term.releaseIdle = async () => endLive(l);
}

/** A CLI waiting at its prompt: what the manager types there isn't a task of the office's. */
function idleHook(live: LiveCli, b: Record<string, unknown>): Record<string, unknown> {
  switch (String(b.hook_event_name ?? '')) {
    case 'PreToolUse':
      return ALLOW;
    case 'UserPromptSubmit': {
      const text = String(b.prompt ?? '').trim();
      if (!text || live.term.onIdlePrompt?.(text)) return {};
      return { decision: 'block', reason: "This session's task is over. Message the worker from the office to give them a follow-up." };
    }
    case 'StatusLine':
      return { statusLine: live.statusLine };
  }
  return {};
}

/** What a desk clean-up must leave alone: every CLI in a terminal, and command lines carrying the office's session files. */
export function officeProcesses(): { pids: number[]; markers: string[] } {
  const pids = [...lives.values()].map((l) => l.proc?.pid ?? 0).filter((p) => p > 0);
  return { pids, markers: [SESSIONS_DIR, BIN_DIR] };
}

/** The server is stopping: its CLIs on this computer stop with it; Box workers' CLIs carry on in their Boxes. */
export function releaseClis() {
  for (const l of [...lives.values()]) {
    if (!l.box) {
      endLive(l);
      continue;
    }
    lives.delete(l.term);
    routes.delete(l.token);
    clearTimeout(l.idleTimer);
    (l.proc as BoxPty | null)?.detach();
  }
}

/** Stop reading Box workers' events (before the office writes its state for the last time), keeping their CLIs. */
export function detachBoxClis() {
  for (const l of lives.values()) if (l.box) (l.proc as BoxPty | null)?.detach();
}

/** The office follows its sessions again after starting (reattached ones included): Box events that waited come in. */
export function hooksReady() {
  boxHooksReady();
}

/** Box events wait again, as at a fresh start (a test restarting the office in one process). */
export function holdHooks() {
  holdBoxHooks();
}

/** A Box worker's CLI the office was following when it closed, to pick up again (reconnectBoxClis). */
export interface KeptBoxCli {
  workerId: string;
  rec: BoxCliRecord;
  api: BoxApi;
  /** Its record changed (null: the CLI is gone). */
  record(rec: BoxCliRecord | null): void;
  /** The office's connection to it dropped (false) or is back (true). */
  connection?(up: boolean): void;
}

/** A CLI that's back in its worker's terminal after a restart; busy: a session was driving it. */
export interface ReconnectedCli {
  workerId: string;
  resumeId: string | null;
  busy: boolean;
}

/**
 * The office started: pick up Box workers' CLIs in their Boxes. One still running is attached again and its events
 * since the office last looked are replayed once the office follows its session (hooksReady); one that ended while the
 * office was away comes back too when it finished a turn first (its events replayed, then its exit), so its task
 * finishes as it would have. A Box Upstash can't be reached about is attached optimistically: it keeps trying, and a
 * CLI that turns out to be gone ends then. Ones whose worker or terminal is gone are stopped.
 */
export async function reconnectBoxClis(kept: KeptBoxCli[], terminalFor: (workerId: string) => WorkerTerminal | null): Promise<ReconnectedCli[]> {
  const back: ReconnectedCli[] = [];
  await Promise.all(
    kept.map(async (k) => {
      const term = terminalFor(k.workerId);
      if (!term || lives.has(term)) {
        k.record(null);
        await k.api.run(k.rec.boxId, tmuxKill(k.rec.token)).catch(() => undefined);
        return;
      }
      const look = await Promise.race([lookAtBoxCli(k.api, k.rec), new Promise<null>((r) => setTimeout(() => r(null), 45_000))]).catch(() => null);
      if (look && !look.alive && !finishedTurn(look.events)) {
        k.record(null); // gone without finishing: the office gives its task back
        return;
      }
      const l: LiveCli = { term, proc: null, token: k.rec.token, dir: k.rec.dir, resumeId: k.rec.resumeId, statusLine: 'Marshmallow', session: null, box: { api: k.api, boxId: k.rec.boxId } };
      const p = boxPty(l, { api: k.api, boxId: k.rec.boxId, record: (r) => k.record(r), connection: k.connection }, term.cols, term.rows, readFrom(k.rec));
      l.proc = p;
      wire(l);
      waitAtPrompt(l);
      if (look && !look.alive) p.replay(look.events, look);
      else await p.open('attach');
      back.push({ workerId: k.workerId, resumeId: l.resumeId, busy: k.rec.busy });
    }),
  );
  return back;
}

/** A Box CLI's terminal, saving its record as its events are handled. */
function boxPty(
  l: LiveCli,
  box: { api: BoxApi; boxId: string; record(rec: BoxCliRecord | null): void; connection?(up: boolean): void },
  cols: number,
  rows: number,
  offset: number,
  env?: Record<string, string>,
): BoxPty {
  const save = (off: number, turnAt: number) => box.record({ boxId: box.boxId, token: l.token, dir: l.dir, offset: off, turnAt, resumeId: l.resumeId, busy: !!l.session });
  return new BoxPty({ api: box.api, boxId: box.boxId, token: l.token, cols, rows, env, offset, event: (b) => handleHook(l.token, b), save, gone: () => box.record(null), connection: (up) => box.connection?.(up) }, l.dir);
}

/** A Box worker's Claude Code signing in in their terminal (startBoxSignIn). */
export interface BoxSignIn {
  /** Close it (it's no longer needed, or the worker left). */
  stop(): void;
}

/**
 * Sign a Box worker's Claude Code in with its own login, in their terminal: it prints a link and asks for the code the
 * page gives back, and the manager finishes Anthropic's flow there. The office only relays the terminal's keys and
 * screen, as for any CLI: it never reads the link, the code or the login, which stays in the Box user's home. It runs
 * with no credentials, and no record is kept. `exited` hears its exit code; stop() doesn't call it.
 */
export function startBoxSignIn(o: { api: BoxApi; boxId: string; term: WorkerTerminal }, exited: (code: number) => void): BoxSignIn {
  const prev = lives.get(o.term);
  if (prev) endLive(prev);
  const token = crypto.randomUUID();
  const dir = boxSessionDir(token);
  const l: LiveCli = { term: o.term, proc: null, token, dir, resumeId: null, statusLine: '', session: null, box: { api: o.api, boxId: o.boxId } };
  let over = false;
  const end = (code: number) => {
    if (over) return;
    over = true;
    endLive(l);
    exited(code);
  };
  l.session = { hook: () => ({}), exited: end };
  o.term.note('── Signing Claude Code in · ☁ cloud machine ──');
  void (async () => {
    try {
      await o.api.write(o.boxId, `${dir}/launch.json`, JSON.stringify({ ...signInCommand(), cwd: BOX_HOME, events: `${dir}/events.jsonl` }));
      if (over) return;
      const pty = boxPty(l, { api: o.api, boxId: o.boxId, record: () => undefined }, o.term.cols, o.term.rows, 0, {});
      l.proc = pty;
      wire(l);
      await pty.open('new');
    } catch (err) {
      o.term.note(`Couldn't start signing in: ${(err as Error).message}`);
      end(-1);
    }
  })();
  return {
    stop: () => {
      over = true;
      endLive(l);
    },
  };
}

// ---------- the session ----------

/**
 * The Claude Code session a hook reports, once its conversation is on disk: only then can --resume pick it up. Claude
 * writes the file during the first turn, after SessionStart and UserPromptSubmit, so a session kept any earlier could
 * be one that never existed.
 */
export function resumableSession(b: Record<string, unknown>, exists: (file: string) => boolean): string | null {
  const id = typeof b.session_id === 'string' ? b.session_id : '';
  const file = typeof b.transcript_path === 'string' ? b.transcript_path : '';
  return id && file && exists(file) ? id : null;
}

/** Claude Code was told to resume a conversation that isn't on disk (it says so and exits 1). */
export const lostConversation = (screen: string) => /No conversation found with session ID/i.test(screen);

/** The folders under a Box session's folder that its files need (the playbook's plugin), deepest last; posix paths. */
export function nestedFolders(files: readonly string[], dir: string): string[] {
  const out = new Set<string>();
  for (const f of files) {
    const parent = path.posix.dirname(f);
    if (parent !== dir && parent.startsWith(`${dir}/`)) out.add(parent);
  }
  return [...out].sort();
}

export function startCliSession(opts: SessionOptions, callbacks: SessionCallbacks): SessionHandle {
  const term = opts.terminal;
  if (!term) throw new Error('A real session needs its worker\'s terminal');
  // A follow-up to the session a CLI is still waiting in picks that CLI up again, and so does an office that restarted
  // while it worked (reattach); anything else replaces it. A CLI is only picked up where the session is to run.
  const prev = lives.get(term);
  const waiting = !!prev?.proc && !prev.session;
  const sameHost = (prev?.box?.boxId ?? null) === (opts.box?.boxId ?? null);
  const adopt = waiting && (!!opts.reattach || (sameHost && !!opts.resumeSessionId && prev!.resumeId === opts.resumeSessionId));
  if (prev && !adopt) endLive(prev);
  let live: LiveCli | null = adopt ? prev! : null;
  const box = adopt ? null : (opts.box ?? null);
  const inBox = !!(box ?? live?.box);

  const token = crypto.randomUUID();
  const sessionId = opts.resumeSessionId ?? crypto.randomUUID();
  const dir = box ? boxSessionDir(token) : path.join(SESSIONS_DIR, token);
  const started = Date.now();
  const statusLine = `Marshmallow${opts.label ? ` · ${opts.label}` : ''}`;
  const toolNames = new Map<string, string>();
  const officePrompts: string[] = []; // prompts the office typed, so the ones the manager typed are told apart
  let kept: string | null = opts.resumeSessionId ?? null; // the session the worker has saved to resume
  const usageResets = new Map<string, number | null>();
  const warned = new Set<string>();
  let done = false;
  let costUsd = 0;
  let turns = 0;
  let lastText = '';
  let begun = false; // the CLI took its first prompt
  let finishTimer: NodeJS.Timeout | undefined;
  let bootTimer: NodeJS.Timeout | undefined;
  let screenTimer: NodeJS.Timeout | undefined;
  const nudged = new Set<string>();
  let trustKeys = 0; // keys pressed on a folder-trust question (a few at most)
  let trustedAt = 0;

  const cb = callbacks;
  const log = (entries: LogEntry[]) => entries.length && cb.log(entries);

  /** The session is over. A CLI kept alive (keepAlive) that ended its turn normally stays at its prompt (keep). */
  const finish = (r: Omit<SessionResult, 'costUsd' | 'turns'>, keep = false) => {
    if (done) return;
    done = true;
    for (const t of [finishTimer, bootTimer]) clearTimeout(t);
    clearInterval(screenTimer);
    if (term.onInput === watchKeys) term.onInput = null;
    const l = live;
    if (l && lives.get(term) === l) {
      l.session = null;
      if (keep && opts.keepAlive && l.proc) waitAtPrompt(l);
      else endLive(l);
    }
    cb.tool(null);
    cb.finished({ ...r, costUsd, turns });
  };

  /** A turn ended: finished, unless the CLI picks up another prompt within the grace period. */
  const turnEnded = (text: string) => {
    lastText = text;
    cb.tool(null);
    clearTimeout(finishTimer);
    finishTimer = setTimeout(() => finish({ ok: true, text: lastText, errors: [] }, true), FINISH_GRACE_MS);
  };
  const busy = () => {
    begun = true;
    clearTimeout(finishTimer);
  };

  /** The turn was interrupted from the terminal: the office treats it like Stop, and the CLI waits for the manager. */
  const interrupted = () => finish({ ok: false, text: lastText, errors: ['Interrupted in the terminal'], interrupted: true }, true);

  /** Esc typed in the terminal while the worker works: if the CLI then says it interrupted the turn, it's over. */
  const watchKeys = (data: string) => {
    if (data !== '\x1b' || done || !begun) return;
    const before = interruptions(term.screen());
    let looks = 0;
    const look = () => {
      if (done) return;
      if (interruptions(term.screen()) > before) interrupted();
      else if (++looks < 4) setTimeout(look, 1000);
    };
    setTimeout(look, 800);
  };
  term.onInput = watchKeys;

  const assistantLines = (text: string): LogEntry[] => {
    const lines = text.split('\n');
    const out: LogEntry[] = lines.slice(0, 30).map((l, i) => ({ kind: 'text', text: `${i === 0 ? '● ' : '  '}${l}` }));
    if (lines.length > 30) out.push({ kind: 'text', text: `  … (${lines.length - 30} more lines)` });
    return out;
  };

  // A local model costs nothing and has no usage limits: Claude Code prices a model it doesn't know as if it were Claude's.
  const local = !!localModel(opts.model);
  const onStatus = (b: Record<string, unknown>) => {
    if (local) return { statusLine };
    const cost = Number((b.cost as { total_cost_usd?: unknown } | undefined)?.total_cost_usd);
    if (Number.isFinite(cost)) costUsd = cost;
    const limits = (b.rate_limits ?? {}) as Record<string, { used_percentage?: unknown; resets_at?: unknown } | null>;
    for (const [type, l] of Object.entries(limits)) {
      const used = Number(l?.used_percentage);
      if (!Number.isFinite(used)) continue;
      const resetsAt = Number(l?.resets_at) > 0 ? Number(l?.resets_at) * 1000 : null;
      usageResets.set(type, used >= 100 ? resetsAt : null);
      if (used >= USAGE_WARN_PCT && used < 100 && !warned.has(type)) {
        warned.add(type);
        cb.usageWarning?.({ resetsAt, rateLimitType: type, utilization: used / 100 });
      }
    }
    return { statusLine };
  };

  const hook = (b: Record<string, unknown>): Record<string, unknown> => {
    const event = String(b.hook_event_name ?? '');
    const sub = typeof b.agent_id === 'string' && b.agent_id !== ''; // a subagent's call: kept off the log
    if (!sub && b.session_id !== kept) {
      // In a Box the hook program says whether the conversation file is there; here, the office looks.
      const id = resumableSession(b, inBox ? () => b.transcript_exists === true : fs.existsSync);
      if (id) {
        kept = id;
        if (live) live.resumeId = id;
        cb.sessionId(id);
      }
    }
    switch (event) {
      case 'PreToolUse': {
        const name = String(b.tool_name ?? '');
        const input = toolInput(b);
        if (!sub) {
          busy();
          turns += 1;
          toolNames.set(String(b.tool_use_id ?? ''), name);
          log([{ kind: 'tool', tool: name, text: `⏺ ${describeTool(opts.cwd, name, input)}` }, ...(name === 'TodoWrite' ? todoLines(input) : [])]);
          cb.tool(name);
          if (name === 'mcp__playwright__browser_navigate' && typeof input.url === 'string') cb.browserUrl(input.url);
        }
        return ALLOW;
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        if (sub) return {};
        const name = toolNames.get(String(b.tool_use_id ?? '')) ?? String(b.tool_name ?? '');
        const out = toolOutput(b.tool_response);
        for (const img of out.images) cb.screenshot(Buffer.from(img.data, 'base64'), img.mime);
        const saved = name === 'mcp__playwright__browser_take_screenshot' && !out.images.length ? screenshotFile(opts.cwd, out.text) : null;
        if (saved) cb.screenshot(saved.data, saved.mime);
        if (name.startsWith('mcp__playwright__')) {
          const url = out.text.match(/Page URL:\s*(\S+)/);
          if (url) cb.browserUrl(url[1]);
        }
        if (event === 'PostToolUseFailure') log([{ kind: 'error', text: `  ⎿ ${clip(tidyPaths(opts.cwd, String(b.error ?? out.text ?? 'Error')).split('\n')[0] || 'Error', 200)}` }]);
        else if (name !== 'TodoWrite') log(summariseResult(opts.cwd, name, out.text));
        cb.tool(null);
        return {};
      }
      case 'UserPromptSubmit': {
        if (sub) return {};
        busy();
        const prompt = String(b.prompt ?? '').trim();
        const i = officePrompts.findIndex((p) => p.slice(0, 60) === prompt.slice(0, 60));
        if (i >= 0) officePrompts.splice(i, 1);
        else if (prompt) log([{ kind: 'manager', text: `▶ Typed in the terminal: ${clip(prompt.split('\n')[0], 200)}` }]);
        return {};
      }
      case 'Stop': {
        const text = String(b.last_assistant_message ?? '').trim();
        turns += 1;
        if (text) {
          log(assistantLines(text));
          cb.turn?.(text);
        }
        turnEnded(text);
        return {};
      }
      case 'StopFailure': {
        const error = String(b.error ?? 'unknown');
        const details = String(b.error_details ?? '').trim();
        if (error === 'rate_limit') cb.limited?.([...usageResets.values()].find((t) => t !== null) ?? null);
        finish({ ok: false, text: lastText, errors: [`Claude Code stopped: ${error.replace(/_/g, ' ')}${details ? ` (${clip(details, 160)})` : ''}`] }, true);
        return {};
      }
      case 'Notification': {
        if (b.notification_type === 'permission_prompt') log([{ kind: 'error', text: '⚠ Claude Code is waiting for a permission answer: open the terminal to answer it.' }]);
        return {};
      }
      case 'StatusLine':
        return onStatus(b);
    }
    return {};
  };

  /** The CLI quit on its own: /exit typed in the terminal, a crash, or it couldn't start (not signed in, a bad flag…). */
  const exited = (exitCode: number) => {
    if (opts.resumeSessionId && !begun && lostConversation(term.screen())) {
      cb.sessionId(null);
      finish({ ok: false, text: '', errors: ["Claude Code couldn't find the conversation it was resuming, so the next session starts a new one."] });
      return;
    }
    const ok = exitCode === 0 && lastText !== '';
    finish({ ok, text: lastText, errors: ok ? [] : [`Claude Code exited${exitCode ? ` with code ${exitCode}` : ''} before finishing.`] });
  };

  const handle: SessionHandle = {
    send(text) {
      const proc = live?.proc;
      if (done || !proc) return;
      busy();
      officePrompts.push(text.trim());
      // Pasted, so newlines stay in the message instead of sending it early; then Enter.
      const clean = text.replace(/\x1b\[20[01]~/g, '').replace(/\r\n?/g, '\n');
      quietly(() => proc.write(`\x1b[200~${clean}\x1b[201~`));
      setTimeout(() => quietly(() => live?.proc?.write('\r')), 150);
    },
    stop() {
      finish({ ok: false, text: '', errors: ['Stopped by the manager'] });
    },
  };

  if (adopt && live) {
    // Back in the CLI that was waiting at its prompt: same conversation, same terminal. After a restart it's still on
    // its task: its events since the office last looked come in once the office follows its sessions (hooksReady).
    clearTimeout(live.idleTimer);
    term.releaseIdle = null;
    live.session = { hook, exited };
    live.statusLine = statusLine;
    if (live.resumeId) cb.sessionId(live.resumeId);
    if (opts.reattach) busy();
    else handle.send(opts.prompt);
    return handle;
  }

  // ---------- a new CLI: files for this session, and the command line ----------

  // In a Box Claude Code is the office's own pinned copy there, by its full path; here, the one bundled or found.
  const cmd = box ? { file: `${BOX_CLI_BIN}/claude`, args: [] as string[] } : claudeCommand();
  if (box && localModel(opts.model)) {
    setTimeout(() => finish({ ok: false, text: '', errors: [`${opts.model} runs on this computer's model server, which a cloud machine can't reach.`] }), 0);
    return handle;
  }
  if (!box && (!terminalsAvailable || !cmd)) {
    const why = !terminalsAvailable ? 'the terminal module could not be loaded on this machine' : "Claude Code isn't installed (no bundled copy and no claude on PATH)";
    setTimeout(() => finish({ ok: false, text: '', errors: [`Could not start Claude Code: ${why}.`] }), 0);
    return handle;
  }
  if (!cmd) return handle; // never by now: a Box has its own copy, and a missing local one returned above
  // A Box can't reach the office: its hooks append to the session's events file there, which the office reads.
  const events = `${dir}/events.jsonl`;
  const hookUrl = `${officeUrl}/api/hooks/${token}`;
  const p = box ? path.posix : path;
  // The browser for a session. Its snapshots and unnamed screenshots go to the session's folder, not the worktree. In a
  // Box, Playwright attaches to the Box's own Chromium.
  const browser = !opts.browserTesting ? null : box ? (box.browser ? { command: `${BOX_CLI_BIN}/playwright-mcp`, args: ['--cdp-endpoint', BOX_CDP, '--output-dir', `${dir}/browser`] } : null) : playwrightMcp(path.join(dir, 'browser'));
  const browserIssue = !opts.browserTesting ? null : box ? (box.browser ? null : "⚠ This cloud machine has no browser, so this session can't test in one.") : browserProblem(browser);
  if (browserIssue) log([{ kind: 'error', text: browserIssue }]);
  let prompt = opts.prompt;
  if (opts.outputSchema) {
    prompt += `\n\nWhen you are done, end your final message with your report as one JSON object in a \`\`\`json block, matching this JSON schema:\n${JSON.stringify(opts.outputSchema)}`;
  }
  let files: { settings: string; mcp: string | null; system: string; plugin: string | null };
  const boxFiles: [string, string][] = []; // written into the Box when the CLI starts
  const put = (file: string, text: string) => {
    if (box) return void boxFiles.push([file, text]);
    fs.mkdirSync(path.dirname(file), { recursive: true }); // the plugin's folders
    fs.writeFileSync(file, text);
  };
  try {
    if (!box) {
      writeHelpers();
      fs.mkdirSync(dir, { recursive: true });
    }
    const settings = {
      hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, [{ hooks: [box ? { type: 'command', command: `node ${BOX_BIN}/hook.cjs ${events}`, timeout: 30 } : { type: 'http', url: hookUrl, timeout: 30 }] }]])),
      statusLine: box
        ? { type: 'command', command: `node ${BOX_BIN}/statusline.cjs ${events}`, padding: 0 }
        : { type: 'command', command: `${shellArg(process.execPath)} ${shellArg(path.join(BIN_DIR, 'statusline.cjs'))} ${shellArg(hookUrl)}`, padding: 0 },
      ...(box?.apiKeyHelper ? { apiKeyHelper: box.apiKeyHelper } : {}),
    };
    // The CEO's office tools are served by the office, which a Box can't reach: the CEO stays on this computer.
    const servers = { ...(browser && { playwright: browser }), ...(opts.office && !box && { office: { type: 'http', url: `${officeUrl}/api/mcp/${token}` } }) };
    // The playbook: its rules after the office's instructions (paid every turn; a resumed conversation keeps the system
    // prompt it started with, Claude Code's --system-prompt-snapshot), its skills, subagents and commands as a plugin.
    const playbook = playbookFiles(dir, opts.systemAppend, opts.playbook, p);
    files = { settings: p.join(dir, 'settings.json'), mcp: Object.keys(servers).length ? p.join(dir, 'mcp.json') : null, system: playbook.system[0], plugin: playbook.pluginDir };
    put(files.settings, JSON.stringify(settings, null, 2));
    if (files.mcp) put(files.mcp, JSON.stringify({ mcpServers: servers }, null, 2));
    if (opts.office && !box) offices.set(token, opts.office);
    put(...playbook.system);
    for (const [file, text] of playbook.plugin) put(file, text);
    if (prompt.length > INLINE_PROMPT_MAX) {
      const file = p.join(dir, 'task.md');
      put(file, prompt);
      prompt = `Your task is in ${file}. Read all of it first, then do what it says.`;
    }
  } catch (err) {
    setTimeout(() => finish({ ok: false, text: '', errors: [`Could not prepare Claude Code: ${(err as Error).message}`] }), 0);
    return handle;
  }
  officePrompts.push(prompt.trim());

  const launch = launchArgs({ prompt, model: opts.model, effort: opts.effort, resumeId: opts.resumeSessionId, sessionId, name: opts.label ?? 'Marshmallow', role: opts.role, files, addDirs: opts.addDirs, ownSetup: opts.ownSetup });

  // Each worker is a clean instance on the account Claude Code is logged into: no API keys (they would switch its
  // billing to the API) and nothing inherited from a Claude Code session the server itself was started from. A local
  // model then gets its server's address and a dummy token, from the office and nowhere else.
  // In a Box nothing of the office's own environment goes along (a Windows PATH, the manager's other secrets): only
  // what a Box needs and the credentials its Claude Code signs in with.
  const env: Record<string, string> = {};
  if (box) Object.assign(env, BOX_ENV, box.env, launch.env, { MARSHMALLOW_STATUS: statusLine });
  else {
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      if (/^(ANTHROPIC_|CLAUDE)/i.test(k) && k !== 'CLAUDE_CONFIG_DIR') continue;
      if (/^(NO_COLOR|FORCE_COLOR|TERM_PROGRAM|TERM_PROGRAM_VERSION|MARSHMALLOW_)/i.test(k)) continue;
      env[k] = v;
    }
    Object.assign(env, { TERM: 'xterm-256color', COLORTERM: 'truecolor' }, opts.env, launch.env, modelEnv(opts.model));
  }

  if (opts.resumeSessionId) cb.sessionId(sessionId);
  term.note(`── Claude Code${opts.label ? ` · ${opts.label}` : ''}${opts.model ? ` · ${opts.model}` : ''}${box ? ' · ☁ cloud machine' : ''} ──`);
  const l: LiveCli = { term, proc: null, token, dir, resumeId: sessionId, statusLine, session: { hook, exited }, ...(box ? { box: { api: box.api, boxId: box.boxId } } : {}) };

  // Starting up: answer the folder-trust question for the office's own worktrees, and say so when the CLI waits on
  // something only the manager can do (signing in, a first-run screen).
  const watchBoot = (pty: Pty) => {
    screenTimer = setInterval(() => {
      if (done || Date.now() - started > BOOT_MS * 2) return clearInterval(screenTimer);
      const screen = term.screen();
      const key = trustKeys < 12 && Date.now() - trustedAt > 3000 ? trustKey(screen) : null;
      if (key === 'down') {
        trustKeys += 1;
        quietly(() => pty.write(term.appCursor ? '\x1bOB' : '\x1b[B'));
      } else if (key === 'enter') {
        trustKeys += 1;
        trustedAt = Date.now(); // the question takes a moment to go: don't answer it twice
        log([{ kind: 'system', text: '✓ Trusted the worktree for Claude Code.' }]);
        quietly(() => pty.write('\r'));
      }
      if (!nudged.has('login') && /Not logged in|run \/login|Select login method|Please login|Invalid API key/i.test(screen)) {
        // In a Box only the manager can sign it in, in the worker's terminal: the task waits for that.
        if (box) return finish({ ok: false, text: '', errors: ["Claude Code isn't signed in in their cloud machine."], signedOut: true });
        nudged.add('login');
        log([{ kind: 'error', text: '⚠ Claude Code needs you to sign in: open the terminal and sign in there, or run claude in a terminal of your own.' }]);
      } else if (!nudged.has('setup') && !trustKey(screen) && Date.now() - trustedAt > 5000 && /Choose the text style|Press Enter to continue|Bypass Permissions mode|Settings Error/i.test(screen)) {
        nudged.add('setup');
        log([{ kind: 'error', text: '⚠ Claude Code is waiting on a setup screen: open the terminal to answer it.' }]);
      }
    }, 1000);
    bootTimer = setTimeout(() => {
      if (!done && !begun) log([{ kind: 'error', text: "⚠ Claude Code hasn't started on the task yet. Open the terminal to see what it's waiting for." }]);
    }, BOOT_MS);
  };

  /** In the worker's Box: the session's files go there first, then the CLI starts under tmux. */
  const beginInBox = async (b: BoxTarget) => {
    try {
      boxFiles.push([`${dir}/launch.json`, JSON.stringify({ file: cmd.file, args: [...cmd.args, ...launch.args], cwd: opts.cwd, events })]);
      // The plugin's folders first: a file write in a Box isn't known to make more than its own folder.
      const folders = nestedFolders(boxFiles.map(([file]) => file), dir);
      if (folders.length) await b.api.run(b.boxId, `mkdir -p ${[dir, ...folders].map(sq).join(' ')}`, { timeoutMs: 60_000 });
      for (const [file, text] of boxFiles) await b.api.write(b.boxId, file, text);
      if (done) return;
      const boxed = boxPty(l, b, term.cols, term.rows, 0, env);
      l.proc = boxed;
      live = l;
      wire(l);
      watchBoot(boxed);
      await boxed.open('new');
    } catch (err) {
      finish({ ok: false, text: '', errors: [`Could not start Claude Code in the cloud machine: ${(err as Error).message}`] });
    }
  };
  if (box) {
    void beginInBox(box);
    return handle;
  }

  let pty: Pty;
  try {
    pty = spawnPty(cmd.file, [...cmd.args, ...launch.args], { cols: term.cols, rows: term.rows, cwd: opts.cwd, env });
  } catch (err) {
    setTimeout(() => finish({ ok: false, text: '', errors: [`Could not start Claude Code: ${(err as Error).message}`] }), 0);
    return handle;
  }
  l.proc = pty;
  live = l;
  wire(l);
  watchBoot(pty);
  return handle;
}
