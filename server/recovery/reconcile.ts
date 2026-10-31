// Adapted from cubefarm server/reconcile.ts (MIT).

// Restart reconciliation. Before an office that restarted schedules anything, every worker with a task is checked
// against GitHub and their desk: work that closed or merged while the office was down is cleared, a Box worker's CLI
// that kept working is followed again only if its desk is still there, and work that can't carry on goes back in line
// without a strike. A session started in a desk folder that's gone dies at once (Windows exit 267, "the directory name
// is invalid"), so nothing resumes without its desk.

export type WorkState = 'open' | 'closed' | 'merged' | 'unknown';

/** The work's state from GitHub's answers (null: not asked, or no answer). A merged PR wins; a closed issue or PR ends it. */
export function workState(issue: 'OPEN' | 'CLOSED' | null, pr: 'OPEN' | 'CLOSED' | 'MERGED' | null): WorkState {
  if (pr === 'MERGED') return 'merged';
  if (pr === 'CLOSED' || issue === 'CLOSED') return 'closed';
  if (pr === 'OPEN' || issue === 'OPEN') return 'open';
  return 'unknown';
}

export interface ReconcileWorker {
  role: string;
  /** Their status when the office stopped. */
  status: string;
  task: 'issue' | 'qa' | 'fix' | null;
  work: WorkState;
  deskExists: boolean;
  /** Their Box's CLI kept working on this task (restartRecovery.ts followKeptCli). */
  cliAlive: boolean;
  /** Their session may be resumed (restartRecovery.ts resumesAfterRestart). */
  resumable: boolean;
}

/**
 * none: nothing to do · clear: the work is finished, clear the desk · reattach: follow the CLI that kept working ·
 * resume: resume the session · requeue: clear the worker and put the work back in line, no strike · keep: leave as is.
 */
export type ReconcileStep = 'none' | 'clear' | 'reattach' | 'resume' | 'requeue' | 'keep';

/** What becomes of one worker after a restart. Work GitHub couldn't be asked about counts as still open. */
export function reconcileStep(w: ReconcileWorker): ReconcileStep {
  if (w.role === 'ceo' || !w.task) return 'none';
  if (w.work === 'closed' || w.work === 'merged') return 'clear';
  if (w.status !== 'preparing' && w.status !== 'working') {
    // Done (waiting on QA) keeps its card: a fix sets up a desk of its own. A failed or stopped one whose desk is gone
    // could only be picked up again from scratch.
    return w.deskExists || w.status === 'done' || w.status === 'idle' ? 'keep' : 'requeue';
  }
  if (!w.deskExists) return 'requeue';
  if (w.cliAlive) return 'reattach';
  return w.resumable ? 'resume' : 'requeue';
}

export interface RestartCounts {
  cleared: number;
  reattached: number;
  resumed: number;
  requeued: number;
}

const many = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;

/** The one office message after a restart, e.g. "↻ Restarted: cleared 7 finished tasks and reattached 2 live sessions." Null when nothing happened. */
export function restartMessage(c: RestartCounts): string | null {
  const parts = [
    c.cleared && `cleared ${many(c.cleared, 'finished task')}`,
    c.reattached && `reattached ${many(c.reattached, 'live session')}`,
    c.resumed && `resumed ${many(c.resumed, 'session')}`,
    c.requeued && `put ${many(c.requeued, 'task')} back in line`,
  ].filter((p): p is string => !!p);
  if (!parts.length) return null;
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `↻ Restarted: ${list}.`;
}
