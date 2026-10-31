// One worker session as the real Claude Code CLI in a pseudo-terminal, behind the session contract (log lines, the
// current tool, the final text, finished), so the pipeline can't tell it from the demo's fakes.
//
// Claude Code reports through HTTP hooks passed with --settings: every tool call (PreToolUse also approves it, so the
// CLI never stops to ask), each finished turn (Stop, with the final text), failures (StopFailure) and, through its
// status line, cost and usage limits. After a build or fix the CLI waits at its prompt for a while (keepAlive), so the
// manager can use it and a follow-up picks it up again.
// Adapted from cubefarm server/cliRunner.ts (MIT): Claude Code on this computer (no Codex, OpenCode, Box or keeper).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IPty } from '@lydell/node-pty';
import { localModel } from '../../shared/models.ts';
import type { LogEntry } from '../../shared/types.ts';
import { HOME_DIR } from '../config.ts';
import { browserProblem, playwrightMcp } from './browser.ts';
import { claudeCommand, interruptions, launchArgs, modelEnv, STATUSLINE_SOURCE, trustKey } from './clis.ts';
import { clip, describeTool, resultText, screenshotFile, summariseResult, tidyPaths, todoLines } from './format.ts';
import type { SessionCallbacks, SessionHandle, SessionOptions, SessionResult } from './session.ts';
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

// ---------- the pseudo-terminal ----------

interface Pty {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Stops the CLI and everything it started. */
  kill(): void;
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
}
const lives = new Map<WorkerTerminal, LiveCli>();

/** Closes a CLI for good. */
function endLive(live: LiveCli) {
  if (lives.get(live.term) !== live) return;
  lives.delete(live.term);
  clearTimeout(live.idleTimer);
  routes.delete(live.token);
  live.term.releaseIdle = null;
  live.term.bind(null);
  live.proc?.kill();
  live.proc = null;
  live.term.note('── Claude Code session ended ──');
  fs.rm(live.dir, { recursive: true, force: true, maxRetries: 5 }, () => undefined);
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
  l.idleTimer = setTimeout(() => endLive(l), IDLE_MS);
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

/** The server is stopping: its CLIs stop with it. */
export function releaseClis() {
  for (const l of [...lives.values()]) endLive(l);
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

export function startCliSession(opts: SessionOptions, callbacks: SessionCallbacks): SessionHandle {
  const term = opts.terminal;
  if (!term) throw new Error('A real session needs its worker\'s terminal');
  // A follow-up to the session a CLI is still waiting in picks that CLI up again; anything else replaces it.
  const prev = lives.get(term);
  const adopt = !!prev?.proc && !prev.session && !!opts.resumeSessionId && prev.resumeId === opts.resumeSessionId;
  if (prev && !adopt) endLive(prev);
  let live: LiveCli | null = adopt ? prev! : null;

  const token = crypto.randomUUID();
  const sessionId = opts.resumeSessionId ?? crypto.randomUUID();
  const dir = path.join(SESSIONS_DIR, token);
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
      const id = resumableSession(b, fs.existsSync);
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
    // Back in the CLI that was waiting at its prompt: same conversation, same terminal.
    clearTimeout(live.idleTimer);
    term.releaseIdle = null;
    live.session = { hook, exited };
    live.statusLine = statusLine;
    if (live.resumeId) cb.sessionId(live.resumeId);
    handle.send(opts.prompt);
    return handle;
  }

  // ---------- a new CLI: files for this session, and the command line ----------

  const cmd = claudeCommand();
  if (!terminalsAvailable || !cmd) {
    const why = !terminalsAvailable ? 'the terminal module could not be loaded on this machine' : "Claude Code isn't installed (no bundled copy and no claude on PATH)";
    setTimeout(() => finish({ ok: false, text: '', errors: [`Could not start Claude Code: ${why}.`] }), 0);
    return handle;
  }
  const hookUrl = `${officeUrl}/api/hooks/${token}`;
  // The browser for a session. Its snapshots and unnamed screenshots go to the session's folder, not the worktree.
  const browser = opts.browserTesting ? playwrightMcp(path.join(dir, 'browser')) : null;
  const browserIssue = opts.browserTesting ? browserProblem(browser) : null;
  if (browserIssue) log([{ kind: 'error', text: browserIssue }]);
  let prompt = opts.prompt;
  if (opts.outputSchema) {
    prompt += `\n\nWhen you are done, end your final message with your report as one JSON object in a \`\`\`json block, matching this JSON schema:\n${JSON.stringify(opts.outputSchema)}`;
  }
  let files: { settings: string; mcp: string | null; system: string };
  try {
    writeHelpers();
    fs.mkdirSync(dir, { recursive: true });
    const settings = {
      hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, [{ hooks: [{ type: 'http', url: hookUrl, timeout: 30 }] }]])),
      statusLine: { type: 'command', command: `${shellArg(process.execPath)} ${shellArg(path.join(BIN_DIR, 'statusline.cjs'))} ${shellArg(hookUrl)}`, padding: 0 },
    };
    files = { settings: path.join(dir, 'settings.json'), mcp: browser ? path.join(dir, 'mcp.json') : null, system: path.join(dir, 'instructions.md') };
    fs.writeFileSync(files.settings, JSON.stringify(settings, null, 2));
    if (files.mcp) fs.writeFileSync(files.mcp, JSON.stringify({ mcpServers: { playwright: browser } }, null, 2));
    fs.writeFileSync(files.system, opts.systemAppend);
    if (prompt.length > INLINE_PROMPT_MAX) {
      const file = path.join(dir, 'task.md');
      fs.writeFileSync(file, prompt);
      prompt = `Your task is in ${file}. Read all of it first, then do what it says.`;
    }
  } catch (err) {
    setTimeout(() => finish({ ok: false, text: '', errors: [`Could not prepare Claude Code: ${(err as Error).message}`] }), 0);
    return handle;
  }
  officePrompts.push(prompt.trim());

  const launch = launchArgs({ prompt, model: opts.model, effort: opts.effort, resumeId: opts.resumeSessionId, sessionId, name: opts.label ?? 'Marshmallow', role: opts.role, files });

  // Each worker is a clean instance on the account Claude Code is logged into: no API keys (they would switch its
  // billing to the API) and nothing inherited from a Claude Code session the server itself was started from. A local
  // model then gets its server's address and a dummy token, from the office and nowhere else.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^(ANTHROPIC_|CLAUDE)/i.test(k) && k !== 'CLAUDE_CONFIG_DIR') continue;
    if (/^(NO_COLOR|FORCE_COLOR|TERM_PROGRAM|TERM_PROGRAM_VERSION|MARSHMALLOW_)/i.test(k)) continue;
    env[k] = v;
  }
  Object.assign(env, { TERM: 'xterm-256color', COLORTERM: 'truecolor' }, opts.env, launch.env, modelEnv(opts.model));

  if (opts.resumeSessionId) cb.sessionId(sessionId);
  term.note(`── Claude Code${opts.label ? ` · ${opts.label}` : ''}${opts.model ? ` · ${opts.model}` : ''} ──`);
  const l: LiveCli = { term, proc: null, token, dir, resumeId: sessionId, statusLine, session: { hook, exited } };

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
