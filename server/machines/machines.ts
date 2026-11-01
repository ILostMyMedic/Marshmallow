// Workers' machines: every worker works on a machine of its own, with its own clone of its floor's repository, its
// worktree of that clone (where its branches are checked out) and its temp folder. A machine is a folder on this
// computer (phase 4) or an Upstash Box (phase 7), behind the same calls. A machine is named after its worker, so a
// rename moves nothing.
// Adapted from cubefarm server/machines.ts (MIT).

/** What a desk starts from: the floor's work branch (shared/branches.ts), or a pull request's head (testing it, fixing it). */
export interface DeskBase {
  workBranch: string;
  pr?: number;
}

/**
 * How a desk's dependencies were left: none to install, left to the worker (no lockfile to install from), skipped
 * (nothing changed since the last install), installed, or failed (the worker is told to install them itself).
 */
export type DepsOutcome = 'none' | 'agent' | 'skipped' | 'installed' | 'failed';

export interface DepsCallbacks {
  log(lines: string[]): void;
  /** An install is about to start (possibly waiting for a free slot): nothing matched. */
  installing(): void;
}

export interface MachineProvider {
  /** Where the worker's worktree of a repository is: their sessions run there. */
  deskDir(machine: string, fullName: string): string;
  /** Put the worker's worktree on `branch` for a task; their clone is made the first time. */
  prepareDesk(machine: string, fullName: string, base: DeskBase, branch: string, note?: (text: string) => void): Promise<string>;
  /** What every session on the machine runs with, on top of the office's environment. */
  env(machine: string): Record<string, string>;
  /** Stop what the worker left running: on their port, or started in their worktree. */
  release(machine: string, fullName: string, port: number): Promise<void>;
  /** Delete finished mm/ branches in the worker's clone that nothing in `keep` names; returns how many went. */
  sweep(machine: string, fullName: string, keep: string[]): Promise<number>;
  /** Remove the machine; work on no remote branch is saved to leftovers first. removed: false while it's in use. */
  remove(machine: string): Promise<{ removed: boolean; patches: string[] }>;
  /** The machines that exist. */
  list(): Promise<string[]>;
  /** The worker's worktree is there (a session started in a missing one fails). */
  exists(machine: string, fullName: string): Promise<boolean>;
  /** npm ci in the worker's prepared worktree unless nothing changed since the last one; never throws. */
  installDeps(machine: string, fullName: string, cb: DepsCallbacks): Promise<DepsOutcome>;
}

/** A worker's machine: the start of their id, which never changes (a short name keeps Windows paths short). */
export const machineName = (workerId: string) => workerId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase() || 'worker';

/** The dev-server port reserved for a worker, from their id, so teammates' servers never collide. */
export function devPort(workerId: string): number {
  const n = parseInt(workerId.slice(0, 4), 16);
  return 5200 + ((Number.isNaN(n) ? 0 : n) % 700);
}

/** The line for the worker's instructions ('' when the office left the dependencies alone). Adapted from cubefarm server/deps.ts (MIT). */
export function depsPromptLine(outcome: DepsOutcome | null | undefined): string {
  if (outcome === 'installed' || outcome === 'skipped') return 'Dependencies are already installed for this checkout; run npm install only if you change package.json.';
  if (outcome === 'failed') return "The office couldn't install this checkout's dependencies: run npm install yourself first.";
  return '';
}
