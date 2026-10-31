// Where Marshmallow keeps its files, where it listens, and the demo switch.
// Adapted from cubefarm server/config.ts (MIT).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Whether to run on the fakes (no GitHub, git, npm or Claude usage): `--demo`, or MARSHMALLOW_DEMO=1/true. */
export function isDemo(argv: string[], env: NodeJS.ProcessEnv): boolean {
  return argv.includes('--demo') || env.MARSHMALLOW_DEMO === '1' || env.MARSHMALLOW_DEMO === 'true';
}

/**
 * Where everything Marshmallow writes lives: MARSHMALLOW_HOME (resolved against the folder it was started in), else
 * ~/.marshmallow. The default sits outside any project, so workers in cloned repos never pick up this project's
 * CLAUDE.md or settings by walking up the tree.
 */
export function homeDir(env: NodeJS.ProcessEnv, home = os.homedir()): string {
  const own = env.MARSHMALLOW_HOME?.trim();
  return own ? path.resolve(own) : path.join(home, '.marshmallow');
}

/** The demo keeps its own state, so it never mixes with the real office's. */
export function stateFile(home: string, demo: boolean): string {
  return path.join(home, demo ? 'demo-state.json' : 'state.json');
}

/** The office database's folder (server/db/): the demo keeps its own, as it does its state. */
export function dbDir(home: string, demo: boolean): string {
  return path.join(home, demo ? 'demo-db' : 'db');
}

/**
 * Why the real office can't use this home, or null when it can. Workers clone repositories into it and run Claude
 * Code there, which walks up the folders for instructions: a home inside a project (this one's .mm-home) would hand
 * them that project's CLAUDE.md and settings. The demo runs no real sessions, so any home will do.
 */
export function homeProblem(home: string, cwd: string, demo: boolean): string | null {
  if (demo) return null;
  const rel = path.relative(path.resolve(cwd), path.resolve(home));
  const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  return inside && fs.existsSync(path.join(cwd, 'package.json'))
    ? `${home} is inside ${cwd}: workers would pick up its CLAUDE.md. Leave MARSHMALLOW_HOME unset (~/.marshmallow) or point it outside the project; ./.mm-home is for --demo.`
    : null;
}

export const PORT = Number(process.env.MARSHMALLOW_PORT ?? 4600);
// Workers run commands on this machine and there's no sign-in, so the server only takes connections from it.
export const HOST = '127.0.0.1';
export const VERSION: string = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf8')).version;

export const HOME_DIR = homeDir(process.env);
export const DEMO = isDemo(process.argv, process.env);
export const STATE_FILE = stateFile(HOME_DIR, DEMO);
export const DB_DIR = dbDir(HOME_DIR, DEMO);
/** Floors' own checkouts: <WORKSPACE_ROOT>/<owner>__<repo>/main. */
export const WORKSPACE_ROOT = path.join(HOME_DIR, 'workspaces');
/** Workers' machines: <MACHINES_DIR>/<machine>/ (server/machines/workspace.ts). */
export const MACHINES_DIR = path.join(HOME_DIR, 'machines');
/** Work on no remote branch, saved when a machine goes: <LEFTOVERS_DIR>/<owner>__<repo>/. */
export const LEFTOVERS_DIR = path.join(HOME_DIR, 'leftovers');

// How often each connected repo's issues and PRs are refreshed from GitHub.
export const SYNC_INTERVAL_MS = 45_000;
// How often idle workers on auto-assign floors look for new work.
export const SCHEDULER_INTERVAL_MS = 8_000;
// How often each floor's desks and finished branches are swept (also at start and after a worker leaves).
export const DESK_SWEEP_INTERVAL_MS = 30 * 60_000;
/** How often the watchdog looks for stuck work. */
export const WATCHDOG_INTERVAL_MS = 60_000;
// Terminal lines kept per worker.
export const LOG_BUFFER = 600;
