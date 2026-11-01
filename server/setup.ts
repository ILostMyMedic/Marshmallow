// The sign-ins the office runs on, checked when the console's Settings tab asks (GET /api/setup/status): the GitHub
// account gh acts as, whether Claude Code is signed in on this computer (`claude auth status`, as workers would run
// it), the local model servers and their models, and whether an Upstash key is saved. Only who and whether goes out:
// never a key or a token. The demo answers with fake signed-in statuses.
import { execFile } from 'node:child_process';
import { LOCAL_SERVERS } from '../shared/models.ts';
import type { SetupStatus } from '../shared/setup.ts';
import { DEMO_LOGIN } from './backend/demoGithub.ts';
import { claudeCommand, localUrl } from './sessions/clis.ts';

/** A program's output, kept on failure too (claude auth status exits non-zero when signed out). */
export interface Ran {
  ok: boolean;
  /** The program isn't installed. */
  missing: boolean;
  stdout: string;
}

export interface SetupDeps {
  /** Runs a program without a shell; never throws. */
  run(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<Ran>;
  /** Claude Code as sessions start it; null when there's none. */
  claude(): { file: string; args: string[] } | null;
  /** GETs a local URL's JSON; null when nothing answers. */
  getJson(url: string): Promise<unknown>;
  env: NodeJS.ProcessEnv;
  upstash(): { keySet: boolean; keyError: string | null };
}

const TIMEOUT_MS = 15_000;

/** The environment workers' Claude Code gets from the office: none of its ANTHROPIC_, CLAUDE or MARSHMALLOW_ variables but CLAUDE_CONFIG_DIR. */
export function workerLikeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && (!/^(ANTHROPIC_|CLAUDE|MARSHMALLOW_)/i.test(k) || k === 'CLAUDE_CONFIG_DIR')) out[k] = v;
  return out;
}

const AUTH_METHODS: Record<string, string> = { 'claude.ai': 'Claude account', console: 'Anthropic Console account', apiKey: 'API key', api_key: 'API key', oauth_token: 'token' };

/** What `claude auth status --json` says, as the card shows it: whether, how, which plan and which account. */
export function parseClaudeAuth(out: string): Omit<SetupStatus['claude'], 'state'> & { loggedIn: boolean | null } {
  let raw: { loggedIn?: unknown; authMethod?: unknown; subscriptionType?: unknown; email?: unknown };
  try {
    // Pretty-printed, possibly after a line of noise: the object from its first brace to its last.
    raw = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  } catch {
    return { loggedIn: null, method: null, plan: null, account: null };
  }
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const method = text(raw.authMethod);
  return { loggedIn: typeof raw.loggedIn === 'boolean' ? raw.loggedIn : null, method: method && (AUTH_METHODS[method] ?? method), plan: text(raw.subscriptionType), account: text(raw.email) };
}

async function github(d: SetupDeps): Promise<SetupStatus['github']> {
  const r = await d.run('gh', ['api', 'user', '--jq', '.login'], d.env);
  const login = r.stdout.trim();
  if (r.ok && /^[\w-]+$/.test(login)) return { state: 'ok', login };
  return { state: r.missing ? 'missing' : 'signed-out', login: null };
}

async function claude(d: SetupDeps): Promise<SetupStatus['claude']> {
  const none = { method: null, plan: null, account: null };
  const cmd = d.claude();
  if (!cmd) return { state: 'missing', ...none };
  const r = await d.run(cmd.file, [...cmd.args, 'auth', 'status', '--json'], workerLikeEnv(d.env));
  if (r.missing) return { state: 'missing', ...none };
  const { loggedIn, ...rest } = parseClaudeAuth(r.stdout);
  if (loggedIn === true) return { state: 'ok', ...rest };
  return { state: loggedIn === false ? 'signed-out' : 'unknown', ...none };
}

async function localServers(d: SetupDeps): Promise<SetupStatus['localServers']> {
  return Promise.all(
    LOCAL_SERVERS.map(async (s) => {
      const url = localUrl(s.id, d.env);
      // Ollama's model list; a server that answers is reachable, models or not.
      const tags = (await d.getJson(`${url}/api/tags`)) as { models?: { name?: unknown }[] } | null;
      const models = (tags?.models ?? []).flatMap((m) => (typeof m?.name === 'string' ? [m.name] : [])).slice(0, 30);
      return { id: s.id, label: s.label, url, reachable: tags !== null, models };
    }),
  );
}

/** Every sign-in, checked side by side. */
export async function setupStatus(d: SetupDeps): Promise<SetupStatus> {
  const [gh, cc, servers] = await Promise.all([github(d), claude(d), localServers(d)]);
  return { github: gh, claude: cc, localServers: servers, upstash: d.upstash(), checkedAt: Date.now() };
}

/** The demo's: everything signed in, a local model server with a model, and the fake Upstash account's key as it is. */
export function demoSetupStatus(upstash: SetupDeps['upstash']): SetupStatus {
  return {
    github: { state: 'ok', login: DEMO_LOGIN },
    claude: { state: 'ok', method: 'Claude account', plan: 'max', account: 'manager@demo.example' },
    localServers: LOCAL_SERVERS.map((s) => ({ id: s.id, label: s.label, url: s.url, reachable: true, models: ['gpt-oss:20b', 'qwen3-coder:30b'] })),
    upstash: upstash(),
    checkedAt: Date.now(),
  };
}

function runProgram(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<Ran> {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024, env: { ...env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } }, (err, stdout) =>
        resolve({ ok: !err, missing: (err as NodeJS.ErrnoException | null)?.code === 'ENOENT', stdout: String(stdout ?? '') }),
      );
    } catch {
      resolve({ ok: false, missing: true, stdout: '' });
    }
  });
}

async function getJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_500) });
    return res.ok ? await res.json() : {};
  } catch {
    return null;
  }
}

/** The real checks: gh, the Claude Code sessions run, and the local servers over HTTP. */
export const realSetupDeps = (upstash: SetupDeps['upstash']): SetupDeps => ({ run: runProgram, claude: claudeCommand, getJson, env: process.env, upstash });
