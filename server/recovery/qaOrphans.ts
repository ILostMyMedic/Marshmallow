// Adapted from cubefarm server/qaOrphans.ts (MIT).

// QA a restart left behind. A tester is marked done before their report is posted, and the PR only leaves "testing"
// once it is: an office that stops in between comes back with a PR in "testing" that nobody is testing. Restart
// recovery only looks at workers who were busy, and the scheduler skips a PR in "testing", so the PR would sit there
// for good.

export interface OrphanQaRecord {
  floorId: string;
  prNumber: number;
  status: string;
  qaWorkerId: string | null;
}

export interface OrphanQaWorker {
  id: string;
  floorId: string;
  status: string;
  task: string | null;
  prNumber: number | null;
}

/**
 * The QA records marked "testing" that no busy worker is testing. Only meaningful when nothing can be mid-way through
 * finishing a QA session, i.e. at startup: while the office runs, a finished tester's report may still be posting.
 */
export function orphanedQa<R extends OrphanQaRecord>(qa: readonly R[], workers: readonly OrphanQaWorker[], busy: readonly string[]): R[] {
  return qa.filter(
    (q) =>
      q.status === 'testing' &&
      !workers.some((w) => w.id === q.qaWorkerId && busy.includes(w.status) && w.task === 'qa' && w.floorId === q.floorId && w.prNumber === q.prNumber),
  );
}
