// Adapted from cubefarm server/boxScripts.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import {
  boxDeskDir,
  boxRepoDir,
  depsOutcome,
  depsScript,
  leftoversScript,
  prepareDeskScript,
  releaseScript,
  setupMarker,
  setupScript,
  signInCheckScript,
  signInCommand,
  signInOutcome,
  signOutScript,
  sq,
  sweepScript,
  tmuxAttach,
  tmuxSocket,
  tmuxStart,
} from './boxScripts.ts';

const versions = { claude: '2.1.316', playwrightMcp: '0.0.83' };

describe('sq', () => {
  it('makes one shell word of anything, quotes included', () => {
    expect(sq('plain')).toBe("'plain'");
    expect(sq("it's")).toBe(`'it'"'"'s'`);
    expect(sq('$(rm -rf /) `x` "y"')).toBe(`'$(rm -rf /) \`x\` "y"'`);
  });
});

describe('Box folders', () => {
  it("keeps each repo's clone and worktree under the Box's home", () => {
    expect(boxRepoDir('acme/web')).toBe('/workspace/home/repos/acme__web');
    expect(boxDeskDir('acme/web')).toBe('/workspace/home/work/acme__web');
  });

  it('gives each session a tmux server of its own, named from its token', () => {
    expect(tmuxSocket('3f2a9c1e-77b0-4c2d-9e5f-0a1b2c3d4e5f')).toBe('mm-3f2a9c1e77b0');
    expect(tmuxStart('3f2a9c1e-77b0-4c2d-9e5f-0a1b2c3d4e5f', 120, 40)).toContain('tmux -L mm-3f2a9c1e77b0');
    expect(tmuxStart('t', 120, 40)).toContain('new-session -A -s main -x 120 -y 40');
    expect(tmuxAttach('t')).toBe('exec tmux -L mm-t attach -t main');
  });
});

describe('setupScript', () => {
  const script = setupScript({ versions, rev: 1, gitName: "Ada O'Neil", gitEmail: 'ada@example.com' });

  it('installs the pinned CLIs and tmux, once per set of versions', () => {
    expect(script).toContain(`npm install -g --prefix '/workspace/home/.marshmallow/cli'`);
    expect(script).toContain(`'@anthropic-ai/claude-code@2.1.316' '@playwright/mcp@0.0.83'`);
    expect(script).not.toContain('sudo npm');
    expect(script).toContain('for t in tmux lsof gh');
    expect(script).toContain(`if [ -f '${setupMarker(versions, 1)}' ]`);
    expect(setupMarker(versions, 1)).not.toBe(setupMarker({ ...versions, claude: '2.1.400' }, 1));
    expect(script.trim().endsWith('echo MARSHMALLOW_SETUP_OK')).toBe(true);
  });

  it("gives git a helper that reads GitHub's token from the environment, never from disk", () => {
    expect(script).toContain('git config --global --unset-all credential.helper');
    expect(script).toContain('password=$GH_TOKEN');
    expect(script).not.toMatch(/ghp_|github_pat_/);
  });

  it("signs commits with the manager's identity, quoted", () => {
    expect(script).toContain(`git config --global user.name 'Ada O'"'"'Neil'`);
    expect(script).toContain(`git config --global user.email 'ada@example.com'`);
  });
});

describe('prepareDeskScript', () => {
  it("clones the repo the first time and puts the worktree on a new branch from the default branch's tip", () => {
    const s = prepareDeskScript('acme/web', { defaultBranch: 'main' }, 'mm/issue-12-ada');
    expect(s).toContain(`git clone -q --no-checkout 'https://github.com/acme/web.git' "$R"`);
    expect(s).toContain(`REF='origin/main'`);
    expect(s).toContain(`B='mm/issue-12-ada'`);
    expect(s).toContain('git worktree add -q -B "$B" "$W" "$REF"');
    expect(s).not.toContain('refs/pull');
  });

  it("fetches a PR's head for QA and fixes", () => {
    const s = prepareDeskScript('acme/web', { defaultBranch: 'main', pr: 7 }, 'mm/qa-7-ada');
    expect(s).toContain(`'+refs/pull/7/head:refs/remotes/origin/pr/7'`);
    expect(s).toContain(`REF='origin/pr/7'`);
    expect(s).toContain('Could not fetch pull request #7 of acme/web.');
  });

  it('refuses names that could break out of the script', () => {
    expect(() => prepareDeskScript('acme/web; rm -rf ~', { defaultBranch: 'main' }, 'b')).toThrow(/repository/);
    expect(() => prepareDeskScript('acme/web', { defaultBranch: 'main' }, "x'; rm -rf ~")).toThrow(/branch/);
  });
});

describe('the other desk scripts', () => {
  it('installs dependencies only from a lockfile that changed', () => {
    expect(depsScript('acme/web')).toContain('npm ci --no-audit --no-fund');
    expect(depsScript('acme/web', false)).toContain('echo DEPS_STALE');
    expect(depsScript('acme/web', false)).not.toContain('npm ci');
  });

  it('reads what the deps script said', () => {
    expect(depsOutcome('DEPS_NONE\n', 0)).toBe('none');
    expect(depsOutcome('DEPS_AGENT', 0)).toBe('agent');
    expect(depsOutcome('DEPS_SKIPPED', 0)).toBe('skipped');
    expect(depsOutcome('DEPS_STALE', 0)).toBe('stale');
    expect(depsOutcome('added 300 packages\nDEPS_INSTALLED\n', 0)).toBe('installed');
    expect(depsOutcome('npm ERR! 404\nDEPS_FAILED', 0)).toBe('failed');
    expect(depsOutcome('DEPS_INSTALLED', 1)).toBe('failed');
    expect(depsOutcome('', 0)).toBe('failed');
  });

  it('keeps the branches it is told to and the one checked out, and sweeps only mm/ branches', () => {
    const s = sweepScript('acme/web', ['mm/issue-3-ada', 'bad branch name']);
    expect(s).toContain('mm/issue-3-ada');
    expect(s).not.toContain('bad branch name');
    expect(s).toContain('refs/heads/mm |');
    expect(s).toContain('git branch -D "$b"');
  });

  it("saves unpushed work as a patch before a Box goes, and stops only the worker's leftovers", () => {
    expect(leftoversScript('acme/web')).toContain('git format-patch -q -o "$T" HEAD --not --remotes');
    expect(releaseScript(4105.7, 'acme/web')).toBe(`node '/workspace/home/.marshmallow/bin/release.cjs' 4105 '/workspace/home/work/acme__web' || true`);
  });
});

describe('signing Claude Code in', () => {
  it("asks the Box's own Claude Code whether it's signed in, by its exit code only", () => {
    expect(signInCheckScript()).toBe(`if '/workspace/home/.marshmallow/cli/bin/claude' auth status --json >/dev/null 2>&1; then echo MARSHMALLOW_SIGNED_IN; else echo MARSHMALLOW_SIGNED_OUT; fi`);
  });

  it('reads what the check said, and nothing when it never ran', () => {
    expect(signInOutcome('MARSHMALLOW_SIGNED_IN\n')).toBe(true);
    expect(signInOutcome('some noise\nMARSHMALLOW_SIGNED_OUT')).toBe(false);
    expect(signInOutcome('bash: line 1: claude: not found')).toBeNull();
    expect(signInOutcome('')).toBeNull();
  });

  it("runs Claude Code's own login, the one that works without a browser on the Box", () => {
    expect(signInCommand()).toEqual({ file: '/workspace/home/.marshmallow/cli/bin/claude', args: ['auth', 'login'] });
    expect(signOutScript()).toContain(`claude' auth logout`);
  });
});
