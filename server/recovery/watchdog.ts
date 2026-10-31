// Adapted from cubefarm server/watchdog.ts (MIT): the automatic remedies, without the office doctor.

// The office's watchdog: every minute it looks for work that's stuck, and heals what it safely can. A quiet session is
// nudged once, then its work goes back in line; a desk that takes too long to set up is released and its work
// requeued; a failed or stopped worker still holding finished work is cleared; a PR left "testing" or "fixing" with
// nobody on it goes back in its queue. At most one remedy per item per hour.

import type { WorkState } from './reconcile.ts';

/** A session with no output and no tool activity for this long is quiet. */
export const QUIET_MS = 20 * 60_000;
/** After a nudge, how long a quiet session gets to answer before its work goes back in line. */
export const NUDGE_WAIT_MS = 10 * 60_000;
/** Setting up a desk taking longer than this is stuck. */
export const PREPARING_MS = 10 * 60_000;
/** A PR "testing" or "fixing" with nobody on it gets this long first: a finished session's report may still be posting. */
export const ORPHAN_GRACE_MS = 3 * 60_000;
/** At most one automatic remedy per item in this window. */
export const REMEDY_EVERY_MS = 60 * 60_000;

export interface WatchWorker {
  id: string;
  floorId: string;
  role: string;
  status: string;
  task: 'issue' | 'qa' | 'fix' | null;
  issueNumber: number | null;
  prNumber: number | null;
  startedAt: number | null;
  /** The latest output or tool activity of their session. */
  activeAt: number;
  /** Their task's state as the office knows it. */
  work: WorkState;
}

export interface WatchQa {
  floorId: string;
  prNumber: number;
  status: string;
  qaWorkerId: string | null;
  devWorkerId: string | null;
  updatedAt: number;
}

export type ProblemKind = 'quiet' | 'preparing' | 'stale' | 'qa-orphan' | 'fix-orphan';

export interface Problem {
  kind: ProblemKind;
  /** The item: what the per-hour limit is kept by. */
  key: string;
  floorId: string;
  workerId: string | null;
  prNumber: number | null;
  issueNumber: number | null;
  since: number;
}

const BUSY = ['preparing', 'working'];
const workKey = (w: WatchWorker) => `${w.floorId}#${w.task === 'issue' && !w.prNumber ? `i${w.issueNumber}` : `p${w.prNumber}`}`;

/** Everything stuck right now. */
export function diagnose(workers: readonly WatchWorker[], qa: readonly WatchQa[], now: number): Problem[] {
  const out: Problem[] = [];
  const of = (w: WatchWorker, kind: ProblemKind, since: number): Problem => ({
    kind,
    key: `${kind}:${w.id}:${workKey(w)}`,
    floorId: w.floorId,
    workerId: w.id,
    prNumber: w.prNumber,
    issueNumber: w.issueNumber,
    since,
  });
  for (const w of workers) {
    if (w.role === 'ceo' || !w.task) continue;
    if (w.status === 'working' && now - w.activeAt >= QUIET_MS) out.push(of(w, 'quiet', w.activeAt));
    else if (w.status === 'preparing' && w.startedAt != null && now - w.startedAt >= PREPARING_MS) out.push(of(w, 'preparing', w.startedAt));
    else if ((w.status === 'error' || w.status === 'stopped') && (w.work === 'closed' || w.work === 'merged')) out.push(of(w, 'stale', w.startedAt ?? now));
  }
  const on = (id: string | null, q: WatchQa, task: 'qa' | 'fix') =>
    workers.some((w) => w.id === id && BUSY.includes(w.status) && w.task === task && w.floorId === q.floorId && w.prNumber === q.prNumber);
  for (const q of qa) {
    if (now - q.updatedAt < ORPHAN_GRACE_MS) continue;
    const base = { floorId: q.floorId, prNumber: q.prNumber, issueNumber: null, since: q.updatedAt };
    if (q.status === 'testing' && !on(q.qaWorkerId, q, 'qa')) out.push({ ...base, kind: 'qa-orphan', key: `qa-orphan:${q.floorId}#p${q.prNumber}`, workerId: q.qaWorkerId });
    if (q.status === 'fixing' && !on(q.devWorkerId, q, 'fix')) out.push({ ...base, kind: 'fix-orphan', key: `fix-orphan:${q.floorId}#p${q.prNumber}`, workerId: q.devWorkerId });
  }
  return out;
}

/** What the watchdog remembers between ticks: when it last remedied each item, and which quiet sessions it nudged. */
export interface WatchMemory {
  remedied: Map<string, number>;
  nudged: Map<string, number>;
}

/** nudge: say something to the quiet session · requeue: stop it and put the work back · clear: clear the desk · retry-qa / refix: back in the PR's queue. */
export type Remedy = 'nudge' | 'requeue' | 'clear' | 'retry-qa' | 'refix';

const REMEDY: Record<ProblemKind, Exclude<Remedy, 'nudge'>> = {
  quiet: 'requeue',
  preparing: 'requeue',
  stale: 'clear',
  'qa-orphan': 'retry-qa',
  'fix-orphan': 'refix',
};

/**
 * What the watchdog does about each problem now. A quiet session is nudged first and gets time to answer; an item
 * remedied within the hour is left alone.
 */
export function triage(problems: readonly Problem[], memory: WatchMemory, now: number): { problem: Problem; remedy: Remedy }[] {
  const out: { problem: Problem; remedy: Remedy }[] = [];
  for (const p of problems) {
    const last = memory.remedied.get(p.key);
    if (last !== undefined && now - last < REMEDY_EVERY_MS) continue;
    if (p.kind === 'quiet') {
      const nudgedAt = memory.nudged.get(p.key);
      if (nudgedAt === undefined) out.push({ problem: p, remedy: 'nudge' });
      else if (now - nudgedAt >= NUDGE_WAIT_MS) out.push({ problem: p, remedy: REMEDY.quiet });
      continue;
    }
    out.push({ problem: p, remedy: REMEDY[p.kind] });
  }
  return out;
}

/**
 * Forget nudges and remedies older than the window. A nudge is kept that long even if the session spoke up: one that
 * goes quiet again on the same work within the hour has had its nudge.
 */
export function forget(memory: WatchMemory, now: number) {
  for (const map of [memory.nudged, memory.remedied]) for (const [key, at] of map) if (now - at >= REMEDY_EVERY_MS) map.delete(key);
}

/** "1 minute", "45 minutes", "2 hours". */
export const ago = (ms: number) => {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min < 90 ? `${min} minute${min === 1 ? '' : 's'}` : `${Math.round(min / 60)} hours`;
};

/** The nudge a quiet session gets, typed into it like the manager's messages. */
export function nudgeText(quietMs: number): string {
  return `The office hasn't seen any output from you for ${ago(quietMs)}. If you're stuck, say what's blocking you; otherwise carry on and finish your task.`;
}
