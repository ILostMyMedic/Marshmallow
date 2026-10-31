// A floor's board: its GitHub issues and PRs and the workers on them sorted into five columns (backlog, in progress, in
// QA, ready to merge, merged), with a note and a colour on each card. The whiteboard on the north wall draws it, and
// its 2D view lists it. Pure. Adapted from cubefarm client/src/store.ts (kanbanFor) and qaCard.ts (MIT).
import { blockers } from '../../shared/issues';
import type { Floor, PullInfo, QaRecord, UsageView, Worker } from '../../shared/types';
import { qaKey } from './store';

/** amber, red or green; none is the column's own colour. */
export type CardTone = 'warn' | 'bad' | 'good';

export interface KanbanCard {
  key: string;
  number: number;
  title: string;
  url?: string;
  worker?: Worker;
  note?: string;
  tone?: CardTone;
  prNumber?: number;
  qa?: QaRecord;
}

export interface KanbanColumns {
  backlog: KanbanCard[];
  progress: KanbanCard[];
  qa: KanbanCard[];
  ready: KanbanCard[];
  merged: KanbanCard[];
}

/**
 * The note and tone of an open PR's card. Only needs-human is red: failed and fixing go back to a developer by
 * themselves, so they are amber. mergeNote only shows where it still means something: on a passed PR waiting to merge,
 * or on one that needs the manager.
 */
export function qaCardNote(rec: Pick<QaRecord, 'status' | 'round' | 'mergeNote'> | null | undefined, pr: Pick<PullInfo, 'isDraft' | 'mergeable' | 'checks'>): { note: string; tone?: CardTone } {
  switch (rec?.status) {
    case 'passed':
      return {
        note: rec.mergeNote
          ? `QA ✓ · ${rec.mergeNote}`
          : pr.mergeable === 'CONFLICTING'
            ? 'QA ✓ · conflicts'
            : pr.checks === 'failing'
              ? 'QA ✓ · CI failing'
              : pr.checks === 'pending'
                ? 'QA ✓ · waiting for checks'
                : '✅ QA passed',
        tone: pr.mergeable === 'CONFLICTING' || pr.checks === 'failing' ? 'warn' : 'good',
      };
    case 'needs-human':
      return { note: `⚠️ needs you${rec.mergeNote ? ` · ${rec.mergeNote}` : ''}`, tone: 'bad' };
    case 'failed':
      return { note: '🔧 back to the developer', tone: 'warn' };
    case 'fixing':
      return { note: `🔧 fixing · round ${rec.round}`, tone: 'warn' };
    case 'testing':
      return { note: `🔍 testing · round ${rec.round}` };
    case 'queued':
      return { note: `waiting for QA${rec.round > 1 ? ` · round ${rec.round}` : ''}` };
    default:
      return { note: pr.isDraft ? 'draft' : 'not tested yet', tone: 'warn' };
  }
}

/**
 * Sorts a floor's GitHub state and QA records into the five columns. With `usage`, backlog issues auto-assign would
 * start but Claude's usage holds back say so ("⏸ paced").
 */
export function kanbanFor(floor: Floor, workers: readonly Worker[], qaRecords: Record<string, QaRecord>, usage?: Pick<UsageView, 'state'>): KanbanColumns {
  const openPulls = floor.pulls.filter((p) => p.state === 'OPEN');
  const team = workers.filter((w) => w.role === 'worker' && w.floorId === floor.id);
  const byId = new Map(team.map((w) => [w.id, w]));
  // While testing, a worker's prNumber is the PR under test, not one of theirs.
  const authors = team.filter((w) => w.task?.kind !== 'qa');
  const authorOf = (n: number, head: string) => authors.find((w) => w.task?.prNumber === n) ?? authors.find((w) => !!w.task?.branch && w.task.branch === head);

  const progress: KanbanCard[] = [];
  for (const w of team) {
    const t = w.task;
    if (!t || t.kind !== 'issue' || t.issueNumber == null || w.status === 'idle') continue;
    // Their PR's card is the work now; once it's closed or merged there is no card.
    if (t.prNumber != null) continue;
    const note = w.status === 'preparing' ? 'setting up' : w.status === 'working' ? 'working' : w.status === 'error' ? 'needs help' : w.status === 'stopped' ? 'stopped' : 'finished · no PR';
    progress.push({ key: `w-${w.id}`, number: t.issueNumber, title: t.title, worker: w, note, tone: w.status === 'error' ? 'bad' : w.status === 'stopped' || w.status === 'done' ? 'warn' : undefined });
  }

  const qa: KanbanCard[] = [];
  const ready: KanbanCard[] = [];
  for (const p of openPulls) {
    const rec = qaRecords[qaKey(floor.id, p.number)];
    const dev = (rec?.devWorkerId ? byId.get(rec.devWorkerId) : undefined) ?? authorOf(p.number, p.headRefName);
    const tester = rec?.qaWorkerId ? byId.get(rec.qaWorkerId) : undefined;
    const card = { key: `pr-${p.number}`, number: p.number, prNumber: p.number, title: p.title, url: p.url, qa: rec, ...qaCardNote(rec, p) };
    if (rec?.status === 'passed') ready.push({ ...card, worker: dev });
    else qa.push({ ...card, worker: rec?.status === 'testing' ? tester : dev });
  }

  const claimed = new Set<number>([...progress.map((c) => c.number), ...openPulls.flatMap((p) => p.closesIssues)]);
  const open = new Set(floor.issues.map((i) => i.number));
  const held = new Map(floor.held.map((h) => [h.issue, h.pr]));
  const paced = floor.autoAssign && usage && usage.state !== 'normal' ? (usage.state === 'paused' ? '⏸ paused' : '⏸ paced') : '';
  const backlog: KanbanCard[] = floor.issues
    .filter((i) => !claimed.has(i.number))
    .map((i) => {
      const waits = blockers(i.body, open);
      const labels = i.labels.slice(0, 2).join(', ');
      const card = { key: `i-${i.number}`, number: i.number, title: i.title, url: i.url };
      // Its PR was closed: it waits for the manager rather than going back to auto-assign.
      if (held.has(i.number)) return { ...card, note: `⏸ PR #${held.get(i.number)} closed · waits for you`, tone: 'warn' as const };
      return { ...card, note: (waits.length ? `⏳ after #${waits.join(', #')}` : [paced, labels].filter(Boolean).join(' · ')) || undefined };
    });

  const merged: KanbanCard[] = floor.pulls
    .filter((p) => p.state === 'MERGED')
    .sort((a, b) => (b.mergedAt ?? '').localeCompare(a.mergedAt ?? ''))
    .map((p) => ({ key: `m-${p.number}`, number: p.number, prNumber: p.number, title: p.title, url: p.url, worker: authorOf(p.number, p.headRefName) }));

  return { backlog, progress, qa, ready, merged };
}
