// Adapted from cubefarm server/clis.test.ts (MIT): the Claude Code parts.
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeCommand, CROSS_TURN_TOOLS, interruptions, launchArgs, localUrl, modelEnv, trustKey, unwrapCmdShim, type LaunchContext } from './clis.ts';

const dir = path.join(os.tmpdir(), 'npm-global');

describe('claudeCommand', () => {
  it("is the Claude Code the Agent SDK bundles, so the hooks match what the office was written against", () => {
    const cmd = claudeCommand();
    expect(cmd?.file).toMatch(/claude-agent-sdk-[\w-]+[\\/]claude(\.exe)?$/);
  });
});

describe('unwrapCmdShim', () => {
  it('runs node on the script a node shim points at, keeping its node flags', () => {
    const shim = [
      '@ECHO off',
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ')',
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" --no-warnings=DEP0040 "%dp0%\\node_modules\\@acme\\cli\\bin\\cli.js" %*',
    ].join('\r\n');
    expect(unwrapCmdShim(path.join(dir, 'cli.cmd'), shim)).toEqual({ file: process.execPath, args: ['--no-warnings=DEP0040', path.join(dir, 'node_modules\\@acme\\cli\\bin\\cli.js')] });
  });

  it('runs the executable an exe shim points at', () => {
    const shim = '@ECHO off\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\some-cli\\bin\\cli.exe"   %*\r\n';
    expect(unwrapCmdShim(path.join(dir, 'cli.cmd'), shim)).toEqual({ file: path.join(dir, 'node_modules\\some-cli\\bin\\cli.exe'), args: [] });
  });

  it('gives up on shims it does not recognise', () => {
    expect(unwrapCmdShim(path.join(dir, 'x.cmd'), '@echo off\r\necho hi\r\n')).toBeNull();
  });
});

describe('launchArgs', () => {
  const ctx = (patch: Partial<LaunchContext> = {}): LaunchContext => ({
    prompt: '--looks like a flag',
    model: '',
    effort: 'medium',
    sessionId: '11111111-1111-1111-1111-111111111111',
    name: 'Ada · #1',
    role: 'worker',
    files: { settings: 'settings.json', mcp: null, system: 'instructions.md' },
    ...patch,
  });

  it('starts Claude Code on a chosen session id, with the prompt after --', () => {
    const { args, env } = launchArgs(ctx());
    expect(args.slice(0, 2)).toEqual(['--session-id', '11111111-1111-1111-1111-111111111111']);
    expect(args.slice(-2)).toEqual(['--', '--looks like a flag']);
    expect(args).toContain('--append-system-prompt-file');
    expect(args).not.toContain('--mcp-config');
    expect(args).toContain('--strict-mcp-config');
    expect(env).toEqual({ DISABLE_AUTOUPDATER: '1' });
  });

  it("resumes a session, and keeps the CEO's hands off the shell", () => {
    const { args } = launchArgs(ctx({ resumeId: 'abc', role: 'ceo', files: { settings: 's', mcp: 'mcp.json', system: 'i' } }));
    expect(args.slice(0, 2)).toEqual(['--resume', 'abc']);
    expect(args).toContain('--mcp-config');
    expect(args.slice(args.indexOf('--disallowedTools'), args.indexOf('--'))).toEqual(['--disallowedTools', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', ...CROSS_TURN_TOOLS, 'Bash', 'PowerShell', 'NotebookEdit']);
  });

  it("asks for a Claude model and effort by name, and a local model by the server's own name, without effort", () => {
    const claude = launchArgs(ctx({ model: 'claude-opus-5-5' })).args;
    expect(claude.slice(claude.indexOf('--model'), claude.indexOf('--model') + 4)).toEqual(['--model', 'claude-opus-5-5', '--effort', 'medium']);
    const local = launchArgs(ctx({ model: 'ollama/gpt-oss:20b' })).args;
    expect(local.slice(local.indexOf('--model'), local.indexOf('--model') + 2)).toEqual(['--model', 'gpt-oss:20b']);
    expect(local).not.toContain('--effort');
  });
});

describe('modelEnv', () => {
  it("leaves Claude's models to Claude Code's own login", () => {
    expect(modelEnv('claude-opus-5-5')).toEqual({});
    expect(modelEnv('')).toEqual({});
  });

  it("points a local model at its server, with a dummy token, for every model Claude Code reaches for", () => {
    const env = modelEnv('ollama/gpt-oss:20b', {});
    expect(env).toMatchObject({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:11434', ANTHROPIC_AUTH_TOKEN: 'ollama', ANTHROPIC_API_KEY: '', ANTHROPIC_MODEL: 'gpt-oss:20b' });
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('gpt-oss:20b');
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('gpt-oss:20b');
  });

  it("takes the server's address from MARSHMALLOW_OLLAMA_URL when set", () => {
    expect(localUrl('ollama', { MARSHMALLOW_OLLAMA_URL: ' http://gpu-box:11434 ' })).toBe('http://gpu-box:11434');
    expect(modelEnv('ollama/qwen3:8b', { MARSHMALLOW_OLLAMA_URL: 'http://gpu-box:11434' }).ANTHROPIC_BASE_URL).toBe('http://gpu-box:11434');
  });
});

describe('trustKey', () => {
  it("moves Claude Code's trust question off its default \"No, exit\", then confirms \"Yes\"", () => {
    const question = (selected: 'no' | 'yes') =>
      [
        'Accessing workspace:',
        'C:\\Users\\me\\.marshmallow\\machines\\ada01df0\\work\\me__app',
        'Quick safety check: Is this a project you created or one you trust?',
        "Claude Code'll be able to read, edit, and execute files here.",
        selected === 'no' ? '❯ No, exit' : '  No, exit',
        selected === 'yes' ? '❯ Yes, I trust this folder' : '  Yes, I trust this folder',
        'Enter to confirm · Esc to cancel',
      ].join('\n');
    expect(trustKey(question('no'))).toBe('down');
    expect(trustKey(question('yes'))).toBe('enter');
  });

  it('leaves every other screen alone', () => {
    expect(trustKey('❯ Try "refactor <filepath>"')).toBeNull();
  });
});

describe('interruptions', () => {
  it('counts the lines where Claude Code says it interrupted a turn', () => {
    expect(interruptions(['● Bash(sleep 4)', '  ⎿  Interrupted · What should Claude do instead?', '❯ '].join('\n'))).toBe(1);
    expect(interruptions('● done\n❯ ')).toBe(0);
  });
});
