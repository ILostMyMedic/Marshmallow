// What every session gets from the office on top of its task's options: the playbook (a worker's floor's, filled in for
// it; the CEO, who works for the whole office, gets the office's rules only) and whether the manager's own Claude Code
// setup comes along (Settings.workersUseMySetup). Sessions.prepare runs it for every session (pipeline.ts sets it).
import type { PlaybookFloor } from '../../shared/playbook.ts';
import type { SessionOptions } from '../sessions/session.ts';
import type { Store } from '../store.ts';
import type { Playbook } from './playbook.ts';

/** The floor a worker's session fills the playbook in for; null for the CEO, or a worker whose floor has gone. */
export function sessionFloor(store: Store, workerId: string): PlaybookFloor | null {
  const w = store.hasWorker(workerId) ? store.worker(workerId) : null;
  if (!w || w.role !== 'worker' || !store.hasFloor(w.floorId)) return null;
  const f = store.floor(w.floorId);
  return { id: f.id, fullName: f.fullName, defaultBranch: f.defaultBranch, workBranch: f.workBranch };
}

export function withPlaybook(store: Store, playbook: Playbook | null, workerId: string, opts: SessionOptions): SessionOptions {
  const ownSetup = store.getSettings().workersUseMySetup;
  return { ...opts, ownSetup, ...(playbook && { playbook: playbook.forSession(sessionFloor(store, workerId)) }) };
}
