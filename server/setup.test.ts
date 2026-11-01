import { describe, expect, it } from 'vitest';
import { demoSetupStatus, parseClaudeAuth, setupStatus, workerLikeEnv, type Ran, type SetupDeps } from './setup.ts';

const ran = (stdout: string, ok = true, missing = false): Ran => ({ ok, missing, stdout });

/** Fake programs and servers: `programs` answers by program, `tags` is the local server's model list (null: it's down). */
function deps(o: { gh?: Ran; claude?: Ran | null; tags?: unknown; env?: NodeJS.ProcessEnv } = {}) {
  const calls: { file: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const d: SetupDeps = {
    run: async (file, args, env) => {
      calls.push({ file, args, env });
      return file === 'gh' ? (o.gh ?? ran('octocat')) : (o.claude ?? ran('{}'));
    },
    claude: () => (o.claude === null ? null : { file: 'claude.exe', args: [] }),
    getJson: async () => (o.tags === undefined ? { models: [{ name: 'gpt-oss:20b' }] } : o.tags),
    env: o.env ?? {},
    upstash: () => ({ keySet: false, keyError: null }),
  };
  return { d, calls };
}

const SIGNED_IN = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'ada@example.com', orgId: 'org-1', subscriptionType: 'max' });

describe('the sign-ins', () => {
  it("say who gh acts as, Claude Code's sign-in, the local servers' models and the Upstash key", async () => {
    const { d, calls } = deps({ claude: ran(SIGNED_IN) });
    const s = await setupStatus(d);
    expect(s.github).toEqual({ state: 'ok', login: 'octocat' });
    expect(s.claude).toEqual({ state: 'ok', method: 'Claude account', plan: 'max', account: 'ada@example.com' });
    expect(s.localServers).toEqual([{ id: 'ollama', label: 'Ollama', url: 'http://127.0.0.1:11434', reachable: true, models: ['gpt-oss:20b'] }]);
    expect(s.upstash).toEqual({ keySet: false, keyError: null });
    expect(calls.map((c) => [c.file, ...c.args])).toEqual([
      ['gh', 'api', 'user', '--jq', '.login'],
      ['claude.exe', 'auth', 'status', '--json'],
    ]);
  });

  it('never carry a key or a token, and ask Claude Code as workers run it, without the office’s Claude variables', async () => {
    const env = { PATH: '/bin', ANTHROPIC_API_KEY: 'sk-ant-secret-key', CLAUDE_CODE_OAUTH_TOKEN: 'oauth-secret', CLAUDE_CONFIG_DIR: '/cfg', MARSHMALLOW_CLAUDE_TOKEN: 'mm-secret' };
    const { d, calls } = deps({ claude: ran(JSON.stringify({ loggedIn: true, authMethod: 'apiKey', apiKey: 'sk-ant-secret-key', token: 'oauth-secret' })), env });
    const s = await setupStatus(d);
    expect(JSON.stringify(s)).not.toMatch(/secret/);
    expect(s.claude).toMatchObject({ state: 'ok', method: 'API key' });
    expect(calls[1].env).toEqual({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/cfg' });
  });

  it('say what is missing or signed out', async () => {
    const out = await setupStatus(deps({ gh: ran('', false), claude: ran(JSON.stringify({ loggedIn: false }), false), tags: null }).d);
    expect(out.github).toEqual({ state: 'signed-out', login: null });
    expect(out.claude).toEqual({ state: 'signed-out', method: null, plan: null, account: null });
    expect(out.localServers[0]).toMatchObject({ reachable: false, models: [] });
    const none = await setupStatus(deps({ gh: ran('', false, true), claude: null }).d);
    expect(none.github.state).toBe('missing');
    expect(none.claude.state).toBe('missing');
    expect((await setupStatus(deps({ claude: ran('Error: something odd', false) }).d)).claude.state).toBe('unknown');
  });

  it('are all signed in on the demo, with the fake Upstash key as it is', () => {
    const s = demoSetupStatus(() => ({ keySet: true, keyError: null }));
    expect(s).toMatchObject({ github: { state: 'ok', login: 'demo-manager' }, claude: { state: 'ok' }, upstash: { keySet: true } });
    expect(s.localServers.every((x) => x.reachable && x.models.length > 0)).toBe(true);
  });
});

describe('parseClaudeAuth', () => {
  it('reads the JSON, pretty-printed as Claude Code prints it, even after a line of noise', () => {
    expect(parseClaudeAuth(`warning: something\n${SIGNED_IN}`)).toEqual({ loggedIn: true, method: 'Claude account', plan: 'max', account: 'ada@example.com' });
    expect(parseClaudeAuth(`${JSON.stringify(JSON.parse(SIGNED_IN), null, 2)}\r\n`)).toEqual({ loggedIn: true, method: 'Claude account', plan: 'max', account: 'ada@example.com' });
    expect(parseClaudeAuth('not json')).toEqual({ loggedIn: null, method: null, plan: null, account: null });
  });
});

describe('workerLikeEnv', () => {
  it('drops ANTHROPIC_, CLAUDE and MARSHMALLOW_ variables but CLAUDE_CONFIG_DIR', () => {
    expect(workerLikeEnv({ A: '1', ANTHROPIC_BASE_URL: 'x', claude_code_x: 'y', CLAUDE_CONFIG_DIR: 'c' })).toEqual({ A: '1', CLAUDE_CONFIG_DIR: 'c' });
  });
});
