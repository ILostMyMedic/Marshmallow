// Workers' machines against real throwaway repos: a bare "origin", the floor's checkout cloned from it, and an
// "upstream" clone that pushes new work. Everything lives in one temp folder whose path has spaces in it.
// Adapted from cubefarm server/workspace.test.ts (MIT).
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const savedEnv = { MARSHMALLOW_HOME: process.env.MARSHMALLOW_HOME, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL };
const ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'marshmallow machines '));
// Point the office at the temp folder before config.ts loads, so its folders resolve inside it.
process.env.MARSHMALLOW_HOME = path.join(ROOT, 'mm home');
// A known git setup, whoever runs the tests: an identity for test commits, and no user hooks or settings.
const gitConfig = path.join(ROOT, 'gitconfig');
await fs.writeFile(gitConfig, '[user]\n\tname = Machine Test\n\temail = machine-test@example.com\n[init]\n\tdefaultBranch = main\n');
process.env.GIT_CONFIG_GLOBAL = gitConfig;

const { git } = await import('../exec.ts');
const { branchHolder, leftoversInDesk, listMachines, machineDesk, mainDir, parseWorktrees, prepareMachineDesk, removeMachine, sweepMachine } = await import('./workspace.ts');

let seq = 0;

interface Repos {
  fullName: string;
  dir: string; // the floor's checkout (mainDir)
  upstream: string; // someone else's clone, pushing to origin
}

async function commitFile(cwd: string, file: string, content: string, message = `change ${file}`) {
  await fs.mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
  await fs.writeFile(path.join(cwd, file), content);
  await git(['add', '--', file], { cwd });
  await git(['commit', '-q', '-m', message], { cwd });
}

async function makeRepos(): Promise<Repos> {
  const n = ++seq;
  const fullName = `machine-test/repo-${n}`;
  const origin = path.join(ROOT, 'origins', `repo ${n}.git`);
  const upstream = path.join(ROOT, 'upstream', `repo ${n}`);
  await fs.mkdir(origin, { recursive: true });
  await git(['init', '-q', '--bare', '--initial-branch=main', origin]);
  await git(['clone', '-q', origin, upstream]);
  await commitFile(upstream, 'README.md', '# Test\n', 'initial');
  await git(['push', '-q', '-u', 'origin', 'main'], { cwd: upstream });
  const dir = mainDir(fullName);
  await fs.mkdir(path.dirname(dir), { recursive: true });
  await git(['clone', '-q', origin, dir]);
  return { fullName, dir, upstream };
}

const head = (cwd: string) => git(['rev-parse', 'HEAD'], { cwd });
const branchOf = (cwd: string) => git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });

afterAll(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fs.rm(ROOT, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

describe("workers' machines", { timeout: 60_000 }, () => {
  const realPaths = async (ps: string[]) => (await Promise.all(ps.map((p) => fs.realpath(p)))).sort();
  const worktrees = async (cwd: string) => realPaths(parseWorktrees(await git(['worktree', 'list', '--porcelain'], { cwd })).map((w) => w.path));
  const branches = async (cwd: string) =>
    (await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { cwd }))
      .split(/\r?\n/)
      .filter(Boolean)
      .sort();
  const isDir = (p: string) => fs.stat(p).then(
    (st) => st.isDirectory(),
    () => false,
  );

  it("works in a clone of its own, never a worktree of the floor's checkout", async () => {
    const r = await makeRepos();
    const desk = await prepareMachineDesk('ada00001', r.fullName, { workBranch: 'main' }, 'mm/issue-1-ada');
    expect(desk).toBe(machineDesk('ada00001', r.fullName));
    expect(await branchOf(desk)).toBe('mm/issue-1-ada');
    expect(await head(desk)).toBe(await git(['rev-parse', 'origin/main'], { cwd: r.dir }));
    expect(await worktrees(r.dir)).toEqual(await realPaths([r.dir])); // the floor's checkout knows nothing of it
    expect(await git(['remote', 'get-url', 'origin'], { cwd: desk })).toBe(await git(['remote', 'get-url', 'origin'], { cwd: r.dir }));
    // borrowed objects are copied, not linked: the clone stands on its own
    const common = await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: desk });
    expect(await fs.readFile(path.join(common, 'objects', 'info', 'alternates'), 'utf8').catch(() => '')).toBe('');
    expect(await listMachines()).toContain('ada00001');
  });

  it('reuses its worktree from task to task, at the latest commit, keeping ignored files', async () => {
    const r = await makeRepos();
    await commitFile(r.upstream, '.gitignore', 'node_modules/\n');
    await git(['push', '-q', 'origin', 'main'], { cwd: r.upstream });
    const desk = await prepareMachineDesk('ada00002', r.fullName, { workBranch: 'main' }, 'mm/issue-1-ada');
    await fs.mkdir(path.join(desk, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(desk, 'node_modules', 'kept.js'), 'warm');
    await fs.writeFile(path.join(desk, 'scratch.txt'), 'left over from the last task');
    await commitFile(r.upstream, 'notes.txt', 'new upstream work\n');
    await git(['push', '-q', 'origin', 'main'], { cwd: r.upstream });
    expect(await prepareMachineDesk('ada00002', r.fullName, { workBranch: 'main' }, 'mm/issue-2-ada')).toBe(desk);
    expect(await branchOf(desk)).toBe('mm/issue-2-ada');
    expect(await head(desk)).toBe(await git(['rev-parse', 'main'], { cwd: r.upstream }));
    expect(await fs.readFile(path.join(desk, 'node_modules', 'kept.js'), 'utf8')).toBe('warm');
    await expect(fs.access(path.join(desk, 'scratch.txt'))).rejects.toThrow();
  });

  it('checks out a PR its own machine never had: a teammate pushed it', async () => {
    const r = await makeRepos();
    const ada = await prepareMachineDesk('ada00003', r.fullName, { workBranch: 'main' }, 'mm/issue-3-ada');
    await commitFile(ada, 'feature.txt', 'from ada\n');
    await git(['push', '-q', 'origin', 'mm/issue-3-ada'], { cwd: ada });
    await git(['push', '-q', 'origin', 'HEAD:refs/pull/9/head'], { cwd: ada }); // what GitHub keeps for PR #9
    const notes: string[] = [];
    const bob = await prepareMachineDesk('bob00003', r.fullName, { workBranch: 'main', pr: 9 }, 'mm/issue-3-ada', (t) => notes.push(t));
    expect(notes).toEqual([]);
    expect(await branchOf(bob)).toBe('mm/issue-3-ada');
    expect(await fs.readFile(path.join(bob, 'feature.txt'), 'utf8')).toMatch(/^from ada\r?\n$/);
    expect(await branchOf(ada)).toBe('mm/issue-3-ada'); // Ada's own desk is untouched
  });

  it('clears a stale index.lock and reuses the desk in place', async () => {
    const r = await makeRepos();
    const desk = await prepareMachineDesk('tim00004', r.fullName, { workBranch: 'main' }, 'mm/issue-1-tim');
    // A git that died mid-command left its lock in the worktree's gitdir, 20 minutes ago.
    const gitdir = path.resolve(desk, (await fs.readFile(path.join(desk, '.git'), 'utf8')).replace('gitdir:', '').trim());
    const lock = path.join(gitdir, 'index.lock');
    await fs.writeFile(lock, '');
    const old = new Date(Date.now() - 20 * 60_000);
    await fs.utimes(lock, old, old);
    const notes: string[] = [];
    expect(await prepareMachineDesk('tim00004', r.fullName, { workBranch: 'main' }, 'mm/issue-2-tim', (t) => notes.push(t))).toBe(desk);
    expect(await branchOf(desk)).toBe('mm/issue-2-tim');
    await expect(fs.access(lock)).rejects.toThrow();
    expect(notes).toEqual([expect.stringMatching(/^Removed a stale git lock/)]);
  });

  it("starts a desk from the floor's work branch, not the default branch", async () => {
    const r = await makeRepos();
    await git(['checkout', '-q', '-b', 'dev'], { cwd: r.upstream });
    await commitFile(r.upstream, 'dev-only.txt', 'on dev\n');
    await git(['push', '-q', '-u', 'origin', 'dev'], { cwd: r.upstream });
    const desk = await prepareMachineDesk('ada00008', r.fullName, { workBranch: 'dev' }, 'mm/issue-1-ada');
    expect(await branchOf(desk)).toBe('mm/issue-1-ada');
    expect(await head(desk)).toBe(await git(['rev-parse', 'dev'], { cwd: r.upstream }));
    expect(await fs.readFile(path.join(desk, 'dev-only.txt'), 'utf8')).toMatch(/^on dev/);
  });

  it('says why when the repository has no default branch yet', async () => {
    const r = await makeRepos();
    await expect(prepareMachineDesk('ada00005', r.fullName, { workBranch: 'trunk' }, 'mm/issue-1-ada')).rejects.toThrow(/has no trunk branch yet/);
  });

  it('deletes finished branches in its clone, never the one it has out or one still in use', async () => {
    const r = await makeRepos();
    const desk = await prepareMachineDesk('ada00006', r.fullName, { workBranch: 'main' }, 'mm/issue-1-ada');
    await prepareMachineDesk('ada00006', r.fullName, { workBranch: 'main' }, 'mm/qa-7-ada');
    await prepareMachineDesk('ada00006', r.fullName, { workBranch: 'main' }, 'mm/issue-2-ada');
    const clone = path.dirname(await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: desk }));
    expect(await sweepMachine('ada00006', r.fullName, ['mm/qa-7-ada'])).toBe(1);
    expect(await branches(clone)).toEqual(['main', 'mm/issue-2-ada', 'mm/qa-7-ada']);
    expect(await sweepMachine('nobody00', r.fullName, [])).toBe(0);
  });

  it('saves work on no remote branch before it goes, and leaves a machine still in use', async () => {
    const r = await makeRepos();
    const desk = await prepareMachineDesk('ada00007', r.fullName, { workBranch: 'main' }, 'mm/issue-5-ada');
    await commitFile(desk, 'unpushed.txt', 'not on GitHub\n');
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { cwd: desk, windowsHide: true, stdio: 'ignore' });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (process.platform === 'win32') expect(await removeMachine('ada00007')).toEqual({ removed: false, patches: [] });
    } finally {
      child.kill();
      await exited;
    }
    const gone = await removeMachine('ada00007');
    expect(gone.removed).toBe(true);
    expect(gone.patches).toHaveLength(1);
    expect(path.basename(gone.patches[0])).toMatch(/^machine-ada00007-\d{8}\.patch$/);
    expect(await fs.readFile(gone.patches[0], 'utf8')).toContain('unpushed.txt');
    expect(await isDir(path.dirname(path.dirname(desk)))).toBe(false);
    expect(await removeMachine('ada00007')).toEqual({ removed: true, patches: [] });
  });
});

describe('branchHolder', () => {
  const wt = (p: string, branch: string | null) => ({ path: path.resolve(p), branch, locked: false });
  it('names the other worktree that has the branch, never the desk itself', () => {
    const list = [wt('main', 'main'), wt('desks/barbara', 'mm/issue-1-barbara'), wt('desks/dennis', null)];
    expect(branchHolder(list, 'mm/issue-1-barbara', 'desks/dennis')).toBe(path.resolve('desks/barbara'));
    expect(branchHolder(list, 'mm/issue-1-barbara', 'desks/barbara')).toBeNull();
    expect(branchHolder(list, 'main', 'desks/dennis')).toBe(path.resolve('main'));
    expect(branchHolder(list, 'mm/issue-2-ken', 'desks/dennis')).toBeNull();
  });
});

describe('parseWorktrees', () => {
  it('reads git worktree list --porcelain', () => {
    const porcelain = ['worktree /projects/app', 'HEAD 1111', 'branch refs/heads/main', '', 'worktree /home/ada/desks/x', 'HEAD 2222', 'detached', '', 'worktree /home/ada/desks/y', 'HEAD 3333', 'branch refs/heads/mm/qa-3-y', 'locked', ''].join('\n');
    expect(parseWorktrees(porcelain)).toEqual([
      { path: path.resolve('/projects/app'), branch: 'main', locked: false },
      { path: path.resolve('/home/ada/desks/x'), branch: null, locked: false },
      { path: path.resolve('/home/ada/desks/y'), branch: 'mm/qa-3-y', locked: true },
    ]);
  });
});

describe('leftoversInDesk', () => {
  const desk = '/Users/ada/.marshmallow/machines/ada01df0/work/me__app';
  const keep = { pids: [300], markers: ['/Users/ada/.marshmallow/sessions'] };

  it("finds what a worker left running in their desk, but never a worker's own CLI or the office's processes", () => {
    const listing = [
      `  101 node ${desk}/node_modules/.bin/vite --port 5401`, // a dev server it left: a leftover
      `  102 /bin/zsh -c cd ${desk} && npm test`, // a command still running there
      `  103 node claude --settings /Users/ada/.marshmallow/sessions/abc/settings.json --add-dir ${desk}`, // the CLI itself
      `  300 node /Users/ada/project/${desk}`, // spared by pid
      '  105 node /somewhere/else/server.js',
    ].join('\n');
    expect(leftoversInDesk(listing, desk, keep)).toEqual([101, 102]);
  });

  it('recognises Windows paths, also JSON-escaped', () => {
    const winDesk = String.raw`C:\Users\Ada\.marshmallow\machines\ada01df0\work\me__app`;
    const listing = [`  7 node ${winDesk.replaceAll('\\', '\\\\')}\\server.js`, `  8 node ${winDesk}\\server.js`, '  9 node C:\\elsewhere\\x.js'].join('\n');
    expect(leftoversInDesk(listing, winDesk, { pids: [], markers: [] })).toEqual([7, 8]);
  });
});
