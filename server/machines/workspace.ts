// Folders on this computer: each floor's own checkout, and each worker's machine.
//   <WORKSPACE_ROOT>/<owner>__<repo>/main      the floor's checkout: fetched, never worked in; machines borrow its objects
//   <WORKSPACE_ROOT>/<owner>__<repo>/preview   a worktree of it where the floor's preview runs (server/previews.ts)
//   <MACHINES_DIR>/<machine>/repos/<owner>__<repo>   the worker's own clone (no checkout of its own)
//   <MACHINES_DIR>/<machine>/work/<owner>__<repo>    its worktree, where the worker's branches are checked out
//   <MACHINES_DIR>/<machine>/tmp                     its temp folder
// Each clone has a lock of its own, so workers never wait for each other's git.
// Adapted from cubefarm server/workspace.ts (MIT): the clone, worktrees, leftover processes, and agents' machines.
import fs from 'node:fs/promises';
import path from 'node:path';
import { LEFTOVERS_DIR, MACHINES_DIR, WORKSPACE_ROOT } from '../config.ts';
import { gh, git, run } from '../exec.ts';
import type { DeskBase } from './machines.ts';

const locks = new Map<string, Promise<unknown>>();

/** Serialises git work per clone, so concurrent worktree changes don't fight over index locks. */
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
  locks.set(key, next);
  return next;
}

const repoFolder = (fullName: string) => fullName.replace('/', '__');
export const mainDir = (fullName: string) => path.join(WORKSPACE_ROOT, repoFolder(fullName), 'main');
export const previewDir = (fullName: string) => path.join(WORKSPACE_ROOT, repoFolder(fullName), 'preview');
/** The preview worktree's branch, in the floor's checkout only: nothing is ever committed or pushed from it. */
const PREVIEW_BRANCH = 'mm/preview';

async function exists(p: string) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

/** Removes a folder, retrying while Windows still has handles open in it. */
const removeDir = (dir: string) => fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });

// Tool droppings that should never be committed from a desk (shared by all worktrees of a clone).
const LOCAL_EXCLUDES = ['.playwright-mcp/'];

async function addLocalExcludes(clone: string) {
  const file = path.join(clone, '.git', 'info', 'exclude');
  const current = await fs.readFile(file, 'utf8').catch(() => '');
  const missing = LOCAL_EXCLUDES.filter((l) => !current.split(/\r?\n/).includes(l));
  if (missing.length === 0) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${current && !current.endsWith('\n') ? '\n' : ''}# added by Marshmallow\n${missing.join('\n')}\n`);
}

/** The floor's own checkout: cloned the first time, fetched after. */
export function ensureClone(fullName: string): Promise<void> {
  return withLock(fullName, async () => {
    const dir = mainDir(fullName);
    if (await exists(path.join(dir, '.git'))) {
      await git(['fetch', 'origin', '--prune'], { cwd: dir, timeoutMs: 180_000 });
    } else {
      await fs.mkdir(path.dirname(dir), { recursive: true });
      await gh(['repo', 'clone', fullName, dir], { timeoutMs: 600_000 });
    }
    await addLocalExcludes(dir);
  });
}

// ---------- worktrees ----------

export interface WorktreeEntry {
  path: string;
  /** The branch it has checked out (null: a detached HEAD). */
  branch: string | null;
  locked: boolean;
}

/** The worktrees in `git worktree list --porcelain` output, the main worktree first. */
export function parseWorktrees(porcelain: string): WorktreeEntry[] {
  const out: WorktreeEntry[] = [];
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) out.push({ path: path.resolve(line.slice(9)), branch: null, locked: false });
    else if (!out.length) continue;
    else if (line.startsWith('branch ')) out[out.length - 1].branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'locked' || line.startsWith('locked ')) out[out.length - 1].locked = true;
  }
  return out;
}

const samePath = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

/** The other worktree (not `desk`) that has `branch` checked out, if any. */
export function branchHolder(worktrees: WorktreeEntry[], branch: string, desk: string): string | null {
  return worktrees.find((w) => w.branch === branch && !samePath(w.path, path.resolve(desk)))?.path ?? null;
}

/** A git lock file this old was left by a git that died: nothing still running holds it. */
const STALE_LOCK_MS = 10 * 60_000;

/** A worktree's index.lock (in its gitdir, which its .git file points at) when it is stale, else null. */
async function staleIndexLock(wt: string): Promise<string | null> {
  const ref = (await fs.readFile(path.join(wt, '.git'), 'utf8').catch(() => '')).match(/gitdir:\s*(.+)/)?.[1]?.trim();
  if (!ref) return null;
  const lock = path.join(path.resolve(wt, ref), 'index.lock');
  const stat = await fs.stat(lock).catch(() => null);
  return stat && Date.now() - stat.mtimeMs > STALE_LOCK_MS ? lock : null;
}

/** Puts an existing worktree on `branch` at `ref` (null: a detached HEAD), keeping ignored files (node_modules, build caches). */
async function reuseDesk(wt: string, branch: string | null, ref: string) {
  await git(branch ? ['checkout', '--force', '-B', branch, ref] : ['checkout', '--force', '--detach', ref], { cwd: wt });
  await git(['reset', '--hard', ref], { cwd: wt });
  // Untracked leftovers from the last task go; ignored files stay.
  await git(['clean', '-fd'], { cwd: wt }).catch(() => undefined);
}

/**
 * Empties a desk's folder for a fresh worktree. On Windows a folder can't be removed while a process has it as its
 * working directory; if everything inside it is gone, that's fine: `git worktree add` takes an empty folder.
 */
async function clearDeskFolder(wt: string) {
  try {
    await removeDir(wt);
  } catch (err) {
    const left = await fs.readdir(wt).catch(() => null);
    if (left?.length !== 0) {
      throw new Error(`Could not clear the desk folder ${wt}: ${(err as Error).message}. A program started by the previous task is probably still running there. Close it and try again.`);
    }
  }
}

/**
 * Puts the worktree `wt` of `clone` on `branch` at the work branch or a PR's head (fetched first), reusing it in
 * place when it's there. Callers hold the clone's lock. `note` hears what the worker should know (a detached HEAD, a
 * rebuild).
 */
async function setUpWorktree(clone: string, wt: string, fullName: string, base: DeskBase, branch: string, note?: (text: string) => void): Promise<string> {
  await git(['fetch', 'origin', '--prune'], { cwd: clone, timeoutMs: 180_000 });
  let ref = `origin/${base.workBranch}`;
  if (base.pr) {
    // refs/pull/N/head works for branches in this repo and for forks alike
    ref = `origin/pr/${base.pr}`;
    await git(['fetch', 'origin', `+refs/pull/${base.pr}/head:refs/remotes/${ref}`], { cwd: clone, timeoutMs: 180_000 });
  }
  try {
    await git(['rev-parse', '--verify', ref], { cwd: clone });
  } catch {
    throw new Error(
      base.pr ? `Could not fetch pull request #${base.pr} of ${fullName}.` : `${fullName} has no ${base.workBranch} branch yet. Push an initial commit (or create the branch) before work is handed out.`,
    );
  }

  // git lets a branch be checked out in one worktree only. When another has it, this desk works on it detached and
  // pushes with `git push origin HEAD:<branch>`: the other checkout is never touched.
  await git(['worktree', 'prune'], { cwd: clone });
  // Real paths on both sides, or a desk can take itself for the holder (8.3 names, /var vs /private/var on macOS).
  const real = (p: string) => fs.realpath(p).catch(() => p);
  const worktrees = await Promise.all(parseWorktrees(await git(['worktree', 'list', '--porcelain'], { cwd: clone })).map(async (w) => ({ ...w, path: await real(w.path) })));
  const holder = branchHolder(worktrees, branch, await real(wt));
  const local = holder ? null : branch;
  if (holder) note?.(`${branch} is checked out at ${holder}, so this desk works on it as a detached HEAD at ${ref}; push with git push origin HEAD:${branch}.`);

  // Reuse the worktree in place: deleting it fails on Windows while a process still has its working directory inside,
  // and reuse keeps node_modules warm between tasks.
  if (await exists(path.join(wt, '.git'))) {
    try {
      try {
        await reuseDesk(wt, local, ref);
      } catch (err) {
        // A git that died mid-command leaves index.lock behind, and every git after it fails.
        const lock = /index\.lock/.test((err as Error).message) ? await staleIndexLock(wt) : null;
        if (!lock) throw err;
        await fs.rm(lock, { force: true, maxRetries: 3 });
        note?.(`Removed a stale git lock (${lock}) left in the desk.`);
        await reuseDesk(wt, local, ref);
      }
      return wt;
    } catch (err) {
      note?.(`Couldn't reuse the desk in place, so it's rebuilt: ${(err as Error).message}`);
    }
  }

  if (await exists(wt)) {
    await git(['worktree', 'remove', '--force', wt], { cwd: clone }).catch(() => undefined);
    await clearDeskFolder(wt);
  }
  await git(['worktree', 'prune'], { cwd: clone });
  await fs.mkdir(path.dirname(wt), { recursive: true });
  await git(['worktree', 'add', ...(local ? ['-B', local] : ['--detach']), wt, ref], { cwd: clone });
  return wt;
}

/**
 * The floor's preview worktree, beside its checkout and out of the workers' way (they work in clones of their own), on
 * the work branch's latest commit (fetched first). Its ignored files (node_modules) stay between runs.
 */
export async function preparePreview(fullName: string, branch: string, note?: (text: string) => void): Promise<string> {
  if (!(await exists(path.join(mainDir(fullName), '.git')))) await ensureClone(fullName);
  return withLock(fullName, () => setUpWorktree(mainDir(fullName), previewDir(fullName), fullName, { workBranch: branch }, PREVIEW_BRANCH, note));
}

// ---------- leftover processes ----------

// Only these kinds of processes are stopped when walking up from a leftover to its (orphaned) launcher.
const LAUNCHERS = ['node.exe', 'cmd.exe', 'bash.exe', 'sh.exe', 'conhost.exe', 'python.exe', 'npm.exe', 'npx.exe', 'bun.exe', 'deno.exe'];

/** What a desk clean-up leaves alone: the office's own processes, and command lines that carry these paths. */
export interface OfficeProcesses {
  /** The office and every CLI running in a worker's terminal. */
  pids: number[];
  /** Paths only the CLIs' own command lines carry (the office's session files): those are workers, not leftovers. */
  markers: string[];
}

/** A path as it can appear in a command line: as is, with forward slashes, and JSON-escaped. */
export const pathForms = (p: string) => [...new Set([p, p.replaceAll('\\', '/'), p.replaceAll('\\', '\\\\')])];

/** The processes of a `ps -A -ww -o pid=,args=` listing whose command line points into a desk, except the office's. */
export function leftoversInDesk(listing: string, desk: string, keep: OfficeProcesses): number[] {
  const out: number[] = [];
  for (const line of listing.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!m) continue;
    const [pid, args] = [Number(m[1]), m[2]];
    if (keep.pids.includes(pid) || keep.markers.some((mark) => pathForms(mark).some((f) => args.includes(f)))) continue;
    if (pathForms(desk).some((f) => args.includes(f))) out.push(pid);
  }
  return out;
}

/**
 * Stops what a worker left running: anything listening on its port (null: leave the port alone) or whose command line
 * points into one of `dirs`, plus the shell/node chain that launched it. Never the office's own processes: the walk up
 * stops at them.
 */
async function releaseDirs(dirs: string[], port: number | null, keep: OfficeProcesses): Promise<void> {
  const spare = [process.pid, ...keep.pids];
  if (process.platform === 'win32') {
    const psList = (paths: string[]) =>
      paths
        .flatMap(pathForms)
        .map((d) => `'${d.toLowerCase().replaceAll("'", "''")}'`)
        .join(', ');
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$spare = @(${spare.join(', ')})
$seed = @()
${port === null ? '' : `Get-NetTCPConnection -LocalPort ${port} -State Listen | ForEach-Object { $seed += [int]$_.OwningProcess }`}
$desks = @(${psList(dirs)})
$marks = @(${psList(keep.markers)})
$all = Get-CimInstance Win32_Process
$byId = @{}; foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
foreach ($p in $all) {
  if (-not $p.CommandLine) { continue }
  $cmd = $p.CommandLine.ToLower()
  $ours = $false
  foreach ($m in $marks) { if ($cmd.Contains($m)) { $ours = $true } }
  if ($ours) { continue }
  foreach ($d in $desks) { if ($cmd.Contains($d)) { $seed += [int]$p.ProcessId } }
}
$launchers = @(${LAUNCHERS.map((n) => `'${n}'`).join(', ')})
$kill = New-Object 'System.Collections.Generic.HashSet[int]'
foreach ($id in $seed) {
  $cur = $byId[$id]
  $first = $true
  while ($cur -and -not ($spare -contains [int]$cur.ProcessId) -and ($first -or $launchers -contains $cur.Name.ToLower())) {
    [void]$kill.Add([int]$cur.ProcessId)
    $first = $false
    $cur = $byId[[int]$cur.ParentProcessId]
  }
}
foreach ($id in $kill) { taskkill /PID $id /T /F 2>&1 | Out-Null }
Write-Output $kill.Count`;
    await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 30_000 }).catch(() => undefined);
    return;
  }
  const listening = port === null ? '' : await run('sh', ['-c', `lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null || true`]).catch(() => '');
  const listing = await run('ps', ['-A', '-ww', '-o', 'pid=,args=']).catch(() => '');
  const pids = new Set([...listening.split(/\s+/).map(Number), ...dirs.flatMap((d) => leftoversInDesk(listing, d, keep))]);
  for (const pid of pids) {
    if (!pid || spare.includes(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

// ---------- leftover work ----------

/** Can't be renamed: a process still has it (or something inside it) open. */
async function inUse(dir: string) {
  const probe = `${dir}.sweep`;
  try {
    await fs.rename(dir, probe);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ENOENT';
  }
  await fs.rename(probe, dir);
  return false;
}

const stamp = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

/**
 * Saves a worktree's modified tracked files and its commits that are on no remote branch to
 * <LEFTOVERS_DIR>/<owner>__<repo>/<label>-<YYYYMMDD>.patch (format-patch, then `git diff HEAD`). Null: nothing to save.
 */
async function saveLeftovers(fullName: string, desk: string, label: string): Promise<string | null> {
  const g = (args: string[]) => git(args, { cwd: desk, timeoutMs: 60_000 });
  if (!(await g(['rev-parse', '--verify', '-q', 'HEAD']).catch(() => ''))) return null;
  const dirty = await g(['status', '--porcelain', '--untracked-files=no']);
  const commits = Number(await g(['rev-list', '--count', 'HEAD', '--not', '--remotes']));
  if (!dirty && !commits) return null;
  const dir = path.join(LEFTOVERS_DIR, repoFolder(fullName));
  await fs.mkdir(dir, { recursive: true });
  const tmp = await fs.mkdtemp(path.join(dir, '.tmp-'));
  try {
    // Written to files, not read from stdout: exec trims it, and a patch's trailing whitespace matters.
    if (commits) await g(['format-patch', '-q', '-o', tmp, 'HEAD', '--not', '--remotes']);
    if (dirty) await g(['diff', 'HEAD', '--binary', `--output=${path.join(tmp, 'zz-uncommitted.patch')}`]);
    const parts = (await fs.readdir(tmp)).sort();
    const base = `${label}-${stamp(new Date())}`;
    let file = path.join(dir, `${base}.patch`);
    for (let n = 2; await exists(file); n++) file = path.join(dir, `${base}-${n}.patch`);
    await fs.writeFile(file, Buffer.concat(await Promise.all(parts.map((p) => fs.readFile(path.join(tmp, p))))));
    return file;
  } finally {
    await removeDir(tmp).catch(() => undefined);
  }
}

// ---------- workers' machines ----------

const OFFICE_BRANCH = /^mm\/(issue|qa)-/;
export const machineDir = (machine: string) => path.join(MACHINES_DIR, machine);
const machineClone = (machine: string, fullName: string) => path.join(machineDir(machine), 'repos', repoFolder(fullName));
export const machineDesk = (machine: string, fullName: string) => path.join(machineDir(machine), 'work', repoFolder(fullName));
export const machineTmp = (machine: string) => path.join(machineDir(machine), 'tmp');
const machineLock = (machine: string, fullName: string) => `machine:${machine}:${fullName}`;

/**
 * The machine's own clone, made the first time from the same origin as the floor's checkout, borrowing that
 * checkout's objects so it's quick, but sharing nothing afterwards.
 */
async function ensureMachineClone(machine: string, fullName: string): Promise<string> {
  const clone = machineClone(machine, fullName);
  if (await exists(path.join(clone, '.git'))) return clone;
  await removeDir(clone).catch(() => undefined); // a clone that died half-way
  await fs.mkdir(path.dirname(clone), { recursive: true });
  const main = mainDir(fullName);
  const origin = (await exists(path.join(main, '.git'))) ? await git(['remote', 'get-url', 'origin'], { cwd: main }).catch(() => '') : '';
  if (origin) await git(['clone', '-q', '--no-checkout', '--reference-if-able', main, '--dissociate', origin, clone], { timeoutMs: 600_000 });
  else await gh(['repo', 'clone', fullName, clone, '--', '--no-checkout'], { timeoutMs: 600_000 });
  await addLocalExcludes(clone);
  return clone;
}

/** Sets a worker's worktree up for a task on their machine; their clone is made the first time. */
export function prepareMachineDesk(machine: string, fullName: string, base: DeskBase, branch: string, note?: (text: string) => void): Promise<string> {
  return withLock(machineLock(machine, fullName), async () => setUpWorktree(await ensureMachineClone(machine, fullName), machineDesk(machine, fullName), fullName, base, branch, note));
}

/** Stops what a worker left running: on their port, or started in their worktree. Not their temp folder's browser. */
export function releaseMachine(machine: string, fullName: string, port: number, keep: OfficeProcesses = { pids: [], markers: [] }): Promise<void> {
  return releaseDirs([machineDesk(machine, fullName)], port, keep);
}

/**
 * Stops what floors' previews left running in their worktrees, and with `port` whatever answers on it (only ever the
 * port of a preview the office itself just ran: a port another program holds is never fought over).
 */
export function releasePreviews(fullNames: string[], port: number | null, keep: OfficeProcesses = { pids: [], markers: [] }): Promise<void> {
  return releaseDirs(fullNames.map(previewDir), port, keep);
}

/** Deletes finished mm/issue-* and mm/qa-* branches in a machine's clone that its worktree doesn't have out and `keep` doesn't name. */
export function sweepMachine(machine: string, fullName: string, keep: string[]): Promise<number> {
  return withLock(machineLock(machine, fullName), async () => {
    const clone = machineClone(machine, fullName);
    if (!(await exists(path.join(clone, '.git')))) return 0;
    const g = (args: string[]) => git(args, { cwd: clone, timeoutMs: 60_000 });
    await g(['worktree', 'prune']);
    const out = parseWorktrees(await g(['worktree', 'list', '--porcelain'])).map((w) => w.branch);
    const list = async () =>
      (await g(['for-each-ref', '--format=%(refname)', 'refs/heads/mm']))
        .split(/\r?\n/)
        .filter(Boolean)
        .map((r) => r.replace(/^refs\/heads\//, ''));
    const doomed = (await list()).filter((b) => OFFICE_BRANCH.test(b) && !keep.includes(b) && !out.includes(b));
    for (let i = 0; i < doomed.length; i += 40) await g(['branch', '-D', ...doomed.slice(i, i + 40)]).catch(() => undefined);
    if (!doomed.length) return 0;
    const left = new Set(await list());
    return doomed.filter((b) => !left.has(b)).length;
  });
}

/** Removes a machine; work on no remote branch is saved to leftovers first. A machine a process still has open stays. */
export async function removeMachine(machine: string): Promise<{ removed: boolean; patches: string[] }> {
  await Promise.all([...locks].filter(([key]) => key.startsWith(`machine:${machine}:`)).map(([, p]) => p.catch(() => undefined)));
  const dir = machineDir(machine);
  if (!(await exists(dir))) return { removed: true, patches: [] };
  if (await inUse(dir)) return { removed: false, patches: [] };
  const patches: string[] = [];
  for (const name of await fs.readdir(path.join(dir, 'work')).catch(() => [])) {
    const patch = await saveLeftovers(name.replace('__', '/'), path.join(dir, 'work', name), `machine-${machine}`).catch(() => null);
    if (patch) patches.push(patch);
  }
  try {
    await removeDir(dir);
    return { removed: true, patches };
  } catch {
    return { removed: false, patches };
  }
}

/** The machines on disk. */
export async function listMachines(): Promise<string[]> {
  return (await fs.readdir(MACHINES_DIR, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => e.name);
}
