// Adapted from cubefarm server/restartRecovery.ts (MIT).

// After an office restart: whose work picks up where it was, and what they're told. A worker still preparing a task
// hadn't started that task's session yet, so the session they remember, or a CLI still busy in their Box, belongs to
// an earlier task: resuming it would do that task again (a QA verdict posted twice) and pass the result off as this one.

export interface RestartWorker {
  status: string;
  task: 'issue' | 'qa' | 'fix' | null;
  sessionId: string | null;
  branch: string | null;
  issueNumber: number | null;
  issueTitle: string | null;
  prNumber: number | null;
}

/** A Box worker's CLI that kept running through the restart. resumeId: the session it is on, when known. */
export interface KeptCli {
  busy: boolean;
  resumeId: string | null;
}

/** The office follows a CLI that kept working through the restart only when it is on the worker's current task. */
export function followKeptCli(w: RestartWorker, cli: KeptCli | undefined): boolean {
  if (!cli?.busy || w.status === 'preparing') return false;
  return !(w.sessionId && cli.resumeId && cli.resumeId !== w.sessionId);
}

/**
 * A worker cut off by the restart resumes their session (true), or their work goes back in line: QA, the demo, and a
 * task that was still being prepared (preparing: their status when the office stopped), whose session never started.
 */
export function resumesAfterRestart(w: RestartWorker, preparing: boolean, demo: boolean): boolean {
  return !demo && !preparing && w.task !== 'qa' && !!w.sessionId && !!w.branch;
}

/** What a resumed worker is told: the job they were on, not just "carry on". */
export function resumeNote(w: RestartWorker, fix?: { round: number; fixReason: 'qa' | 'checks' | 'conflict' | null } | null): string {
  const yours = 'Uncommitted changes in your worktree are yours to finish.';
  if (w.task === 'fix' && w.prNumber && w.branch) {
    const job =
      fix?.fixReason === 'conflict'
        ? `resolving the merge conflicts on PR #${w.prNumber}`
        : fix?.fixReason === 'checks'
          ? `fixing the failing checks on PR #${w.prNumber}`
          : `fixing PR #${w.prNumber}${fix ? ` after QA round ${fix.round}` : ''}`;
    return `The office server restarted while you were ${job}. Finish the fix, commit, and push with: git push origin HEAD:${w.branch}. ${yours}`;
  }
  if (w.task === 'issue' && w.issueNumber && w.branch) {
    const pr = w.prNumber
      ? `push with: git push origin ${w.branch} to update PR #${w.prNumber}`
      : `push with: git push -u origin ${w.branch}, and open the pull request with "Closes #${w.issueNumber}" (or push to it if it's already open)`;
    return `The office server restarted while you were working on issue #${w.issueNumber}${w.issueTitle ? ` (${w.issueTitle})` : ''} on branch ${w.branch}. Finish it, commit, ${pr}. ${yours}`;
  }
  return 'The office server restarted while you were working. Check the state of your worktree and continue where you left off.';
}
