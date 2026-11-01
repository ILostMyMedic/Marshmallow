// Claude Code as the workers run it: which binary (the one the Agent SDK bundles, so the hook and settings formats are
// the ones this code was written against), its command line, the environment for a Claude or a local Ollama model,
// the playbook's files in a session's folder, what its screens mean (folder trust, an interrupted turn), and the
// status-line script it runs.
// Adapted from cubefarm server/clis.ts (MIT): the Claude Code parts.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { localModel, LOCAL_SERVERS } from '../../shared/models.ts';
import { withRules, type SessionPlaybook } from '../../shared/playbook.ts';
import type { EffortLevel } from '../../shared/types.ts';
import type { BoxVersions } from '../machines/box/boxScripts.ts';

const WIN = process.platform === 'win32';

/** The executable for a command name on PATH: on Windows only .exe/.cmd/.bat/.com, never an extensionless sh shim. */
export function resolveCommand(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const dirs = (env[key] ?? '').split(path.delimiter).filter(Boolean);
  const exts = WIN ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((e) => /^\.(exe|cmd|bat|com)$/i.test(e)) : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext.toLowerCase());
      try {
        const st = fs.statSync(file);
        if (st.isFile() && (WIN || (st.mode & 0o111) !== 0)) return file;
      } catch {
        // not here
      }
    }
  }
  return null;
}

/**
 * npm installs Windows CLIs as .cmd shims. Running one puts every argument through cmd.exe, which expands %VARS% and
 * trips over quotes in a prompt, so run what the shim runs instead: the package's .exe, or node on its script.
 */
export function unwrapCmdShim(shimPath: string, text: string): { file: string; args: string[] } | null {
  const line = text.split(/\r?\n/).find((l) => /%\*\s*$/.test(l));
  if (!line) return null;
  const dir = path.dirname(shimPath);
  const targets = [...line.matchAll(/"%dp0%\\([^"]+)"/g)].map((m) => path.join(dir, m[1]));
  const target = targets[targets.length - 1];
  if (!target) return null;
  if (/\.exe$/i.test(target)) return { file: target, args: [] };
  if (!/\.[cm]?js$/i.test(target)) return null;
  const between = line.slice(line.indexOf('"%_prog%"') + '"%_prog%"'.length, line.lastIndexOf(`"%dp0%\\`));
  const nodeFlags = line.includes('"%_prog%"') ? between.trim().split(/\s+/).filter((f) => f.startsWith('--')) : [];
  const localNode = path.join(dir, 'node.exe');
  return { file: fs.existsSync(localNode) ? localNode : process.execPath, args: [...nodeFlags, target] };
}

let bundled: string | null | undefined;

/** The Claude Code the Agent SDK ships as a per-platform package. Same lookup as the SDK's own. */
function bundledClaude(): string | null {
  if (bundled !== undefined) return bundled;
  bundled = null;
  let sdk: string;
  try {
    sdk = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk');
  } catch {
    return null;
  }
  const { platform, arch } = process;
  // Only Linux needs the report (glibc or musl). On Windows it walks every native handle, which can take the whole
  // server down while pseudo-consoles close on other threads.
  const report = platform === 'linux' ? (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined) : undefined;
  const musl = platform === 'linux' && !report?.header?.glibcVersionRuntime;
  const targets = platform === 'linux' ? (musl ? [`linux-${arch}-musl`, `linux-${arch}`] : [`linux-${arch}`, `linux-${arch}-musl`]) : [`${platform}-${arch}`];
  for (const target of targets) {
    try {
      bundled = createRequire(sdk).resolve(`@anthropic-ai/claude-agent-sdk-${target}/claude${WIN ? '.exe' : ''}`);
      return bundled;
    } catch {
      // not installed for this target
    }
  }
  return null;
}

/** How to start Claude Code: the program and the arguments that come before the office's own; null when there's none. */
export function claudeCommand(): { file: string; args: string[] } | null {
  const found = bundledClaude() ?? resolveCommand('claude');
  if (!found) return null;
  if (WIN && /\.(cmd|bat)$/i.test(found)) {
    try {
      return unwrapCmdShim(found, fs.readFileSync(found, 'utf8')) ?? { file: found, args: [] };
    } catch {
      return { file: found, args: [] };
    }
  }
  return { file: found, args: [] };
}

/** Tools that wait for something to happen after the turn ends: a worker's session ends with its turn, so they never fire. */
export const CROSS_TURN_TOOLS = ['Monitor', 'ScheduleWakeup', 'CronCreate', 'CronDelete', 'CronList', 'RemoteTrigger'];

export interface LaunchContext {
  prompt: string;
  /** A Claude model, `ollama/<name>`, or '' for Claude Code's own default. */
  model: string;
  effort: EffortLevel | '';
  resumeId?: string;
  sessionId: string; // the id the office gives a new session
  name: string; // shown in Claude Code's prompt box and the terminal title
  role: 'worker' | 'ceo';
  /** Files the office wrote for this session (settings, MCP config, instructions), and the playbook's plugin folder. */
  files: { settings: string; mcp: string | null; system: string; plugin?: string | null };
  /** Folders it may read besides its working directory. */
  addDirs?: string[];
  /** Load the manager's own Claude Code setup too (Settings.workersUseMySetup). */
  ownSetup?: boolean;
}

export interface Launch {
  args: string[];
  env: Record<string, string>;
}

/** A local model server's address: `MARSHMALLOW_<ID>_URL` (e.g. MARSHMALLOW_OLLAMA_URL) when set, else its usual one. */
export function localUrl(id: (typeof LOCAL_SERVERS)[number]['id'], env: NodeJS.ProcessEnv = process.env): string {
  const own = env[`MARSHMALLOW_${id.toUpperCase()}_URL`]?.trim();
  return own || LOCAL_SERVERS.find((s) => s.id === id)!.url;
}

/**
 * The environment for the model a session asks for. Claude's models need nothing: Claude Code uses its own login.
 * A local model points Claude Code at that server's Anthropic-compatible API, with a dummy token, and every model
 * Claude Code might reach for on its own (the small fast one, subagents') becomes the local one too.
 */
export function modelEnv(model: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const local = localModel(model);
  if (!local) return {};
  const name = local.model;
  return {
    ANTHROPIC_BASE_URL: localUrl(local.server.id, env),
    ANTHROPIC_AUTH_TOKEN: local.server.id,
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: name,
    ANTHROPIC_DEFAULT_OPUS_MODEL: name,
    ANTHROPIC_DEFAULT_SONNET_MODEL: name,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: name,
    ANTHROPIC_SMALL_FAST_MODEL: name,
    CLAUDE_CODE_SUBAGENT_MODEL: name,
  };
}

/** Claude Code's command line for a session. */
export function launchArgs(ctx: LaunchContext): Launch {
  const local = localModel(ctx.model);
  // The CEO changes things only through the office tools: no shell, and the clones it reads stay as they are.
  const disallowed = ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', ...CROSS_TURN_TOOLS, ...(ctx.role === 'ceo' ? ['Bash', 'PowerShell', 'NotebookEdit', 'Edit', 'Write'] : [])];
  const args = [
    ...(ctx.resumeId ? ['--resume', ctx.resumeId] : ['--session-id', ctx.sessionId]),
    ...(ctx.model ? ['--model', local ? local.model : ctx.model] : []),
    // Effort is Claude's: a local model is left to its own.
    ...(ctx.effort && !local ? ['--effort', ctx.effort] : []),
    // The office's PreToolUse hook answers every permission question.
    '--permission-mode',
    'acceptEdits',
    // The office's hooks, status line and browser (flag settings: they load whatever --setting-sources says).
    '--settings',
    ctx.files.settings,
    // Without the manager's own setup: the repo's settings and CLAUDE.md (project, local) and the office's only, so a
    // worker doesn't carry the manager's habits, hooks or plugins into someone else's repository. The login stays in
    // CLAUDE_CONFIG_DIR, which isn't a setting source. The docs don't say that leaving out "user" also leaves out the
    // user-level CLAUDE.md, skills, agents and commands (~/.claude): Phase 23's proving run checks it.
    ...(ctx.ownSetup ? [] : ['--setting-sources', 'project,local']),
    ...(ctx.files.mcp ? ['--mcp-config', ctx.files.mcp] : []),
    // The playbook's skills, subagents and commands, for this session only.
    ...(ctx.files.plugin ? ['--plugin-dir', ctx.files.plugin] : []),
    // Only the office's MCP servers: a worker approves its own tool calls, so it mustn't reach the manager's servers or
    // claude.ai connectors (mail, drives, calendars).
    '--strict-mcp-config',
    ...(ctx.addDirs ?? []).flatMap((d) => ['--add-dir', d]),
    '--append-system-prompt-file',
    ctx.files.system,
    '--name',
    ctx.name,
    '--disallowedTools',
    ...disallowed,
    '--',
    ctx.prompt,
  ];
  // The office's own copy: workers mustn't each try to update it. The CEO's office tools load up front: behind a tool
  // search, smaller models fumble finding them. Without the manager's setup, auto memory stays off too: its memory is
  // per project on the manager's account, and workers would read and write it. (Set by the office after the
  // environment's CLAUDE* variables are stripped, so it reaches the CLI.)
  return { args, env: { DISABLE_AUTOUPDATER: '1', ...(ctx.role === 'ceo' && { ENABLE_TOOL_SEARCH: 'false' }), ...(!ctx.ownSetup && { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }) } };
}

/** The playbook's files in a session's folder: the instructions with its rules after them, and its plugin. */
export interface PlaybookFiles {
  system: [string, string];
  /** The plugin's folder, for --plugin-dir; null when the session has no skills, subagents or commands. */
  pluginDir: string | null;
  plugin: [string, string][];
}

/**
 * What a session's folder gets from the playbook: `instructions.md` (the office's instructions for the task, then the
 * playbook's rules) and the plugin's files under `plugin/`. `p` is path.posix for a Box's folder.
 */
export function playbookFiles(dir: string, systemAppend: string, playbook: SessionPlaybook | undefined, p: Pick<typeof path, 'join'> = path): PlaybookFiles {
  const pluginDir = playbook?.files.length ? p.join(dir, 'plugin') : null;
  return {
    system: [p.join(dir, 'instructions.md'), withRules(systemAppend, playbook?.rules ?? '')],
    pluginDir,
    plugin: pluginDir ? playbook!.files.map((f): [string, string] => [p.join(pluginDir, ...f.path.split('/')), f.content]) : [],
  };
}

const TRUST_PROMPT = /Quick safety check|Do you trust the (files|contents) (in|of) this|trust this folder/i;

/**
 * The key that moves Claude Code's folder-trust question toward trusting the office's own worktree: Enter when the
 * selected option says yes, Down when it says no ("No, exit" comes first), null when there's no such question.
 */
export function trustKey(screen: string): 'enter' | 'down' | null {
  if (!TRUST_PROMPT.test(screen)) return null;
  const selected = screen.match(/^\s*[❯›]\s*(?:\d+\.\s*)?(.+)$/m)?.[1] ?? '';
  if (/^(yes|trust|continue|proceed)\b/i.test(selected.trim())) return 'enter';
  if (/^(no|exit|quit|cancel)\b/i.test(selected.trim())) return 'down';
  return null;
}

/**
 * Lines on screen where Claude Code says it interrupted a turn ("Interrupted · What should Claude do instead?"). Esc
 * fires no hook, so a new one is how the office knows the manager stopped the turn from the terminal.
 */
export function interruptions(screen: string): number {
  return screen.split('\n').filter((l) => /\binterrupted\b/i.test(l)).length;
}

/** Claude Code's status line: posts its data (cost, usage limits) to the office and shows the office's line. */
export const STATUSLINE_SOURCE = String.raw`// Marshmallow: Claude Code's status line. Forwards the session's status to the office and prints the office's line.
const url = process.argv[2];
let body = '';
process.stdin.on('data', (c) => (body += c));
process.stdin.on('end', async () => {
  try {
    const status = JSON.parse(body);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'StatusLine', session_id: status.session_id, cost: status.cost, rate_limits: status.rate_limits }),
      signal: AbortSignal.timeout(2000),
    });
    const out = await res.json();
    process.stdout.write(String(out.statusLine ?? ''));
  } catch {
    process.stdout.write('Marshmallow');
  }
});
`;

/** A field of an installed package's package.json, found from its entry file (its exports may not offer package.json). */
function packageField(pkg: string, field: string): string | null {
  try {
    let dir = path.dirname(createRequire(import.meta.url).resolve(pkg));
    for (let i = 0; i < 6; i++) {
      const file = path.join(dir, 'package.json');
      if (fs.existsSync(file)) {
        const json = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        if (json.name === pkg) return typeof json[field] === 'string' ? (json[field] as string) : null;
      }
      dir = path.dirname(dir);
    }
  } catch {
    // not installed
  }
  return null;
}

/**
 * The CLI versions a Box installs: the Claude Code the Agent SDK bundles, and the pinned Playwright MCP, so a Box
 * worker runs what a local one does. Adapted from cubefarm server/clis.ts (MIT): boxVersions.
 */
export function boxVersions(): BoxVersions {
  return {
    claude: packageField('@anthropic-ai/claude-agent-sdk', 'claudeCodeVersion') ?? 'latest',
    playwrightMcp: packageField('@playwright/mcp', 'version') ?? 'latest',
  };
}
