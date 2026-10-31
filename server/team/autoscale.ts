// How big a floor's team should be, and how to get there. scalePlan is the arithmetic behind every size change (the
// rules', the CEO's scale_team, the manager's); rulesSize is the free sizer for floors nobody holds at a size.
// Adapted from cubefarm server/ceo.ts (MIT): TeamNow, ScalePlan, plannedSize, scalePlan, floorCapacity.
import { blockers, holdUps } from '../../shared/issues.ts';
import type { QaStatus } from '../../shared/types.ts';

/** A floor's team as a size change sees it. */
export interface TeamNow {
  /** `free`: may go now without losing work. `leaving`: already asked to go, once their task ends. */
  workers: { id: string; desk: number; free: boolean; leaving: boolean }[];
}

/** How to reach a team size. */
export interface ScalePlan {
  size: number; // the size asked for, kept between 1 and the floor's max
  hire: number;
  stay: string[]; // workers on their way out asked to stay after all
  letGo: string[]; // free workers first, then the highest desks; busy ones leave once their task ends
}

/** The team a floor will have once its leavers are gone. */
export const plannedSize = (t: TeamNow) => t.workers.filter((w) => !w.leaving).length;

/** Withdraws changes going the other way first (a leaver stays before anyone is hired), then adds what's missing. */
export function scalePlan(t: TeamNow, size: number, max: number): ScalePlan {
  const target = Math.max(1, Math.min(max, Math.round(size)));
  const plan: ScalePlan = { size: target, hire: 0, stay: [], letGo: [] };
  const diff = target - plannedSize(t);
  if (diff > 0) {
    plan.stay = t.workers.filter((w) => w.leaving).slice(0, diff).map((w) => w.id);
    plan.hire = diff - plan.stay.length;
  } else if (diff < 0) {
    plan.letGo = t.workers
      .filter((w) => !w.leaving)
      .sort((x, y) => Number(y.free) - Number(x.free) || y.desk - x.desk)
      .slice(0, -diff)
      .map((w) => w.id);
  }
  return plan;
}

/** Things to do per worker the rules aim for: a backlog of 8 issues wants 3 workers. */
export const WORK_PER_WORKER = 3;

/** A floor as the rules see it. */
export interface FloorLoad {
  size: number; // workers staying on the floor
  max: number;
  busy: number; // of them, on a task now
  ready: number; // issues a free worker may start (0 while auto-assign is off: nobody would start them)
  waiting: number; // open PRs waiting for a tester or a fixer
  idleLong: number; // workers idle a while with no fix owed to them: the ones the rules may let go
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The rules' call on a floor's size: one worker per WORK_PER_WORKER things to do (tasks under way, ready issues,
 * waiting PRs), at least one and at most the max. It grows at once. It shrinks only while nothing waits to be started
 * or tested, and only by workers who sat idle a while. Null: the size is right.
 */
export function rulesSize(f: FloorLoad): { size: number; reason: string } | null {
  const want = Math.max(1, Math.min(f.max, Math.ceil((f.busy + f.ready + f.waiting) / WORK_PER_WORKER)));
  if (want > f.size) {
    if (f.size === 0 && want === 1) return { size: want, reason: 'A floor needs at least one worker.' };
    return { size: want, reason: `${plural(f.ready, 'issue')} ready and ${plural(f.waiting, 'PR')} waiting for ${plural(f.size - f.busy, 'free worker')}.` };
  }
  if (f.ready > 0 || f.waiting > 0) return null;
  const size = Math.max(want, f.size - f.idleLong);
  return size < f.size ? { size, reason: `${plural(f.size - size, 'worker')} sat idle with little left to do.` } : null;
}

export interface FloorCapacity {
  issuesWaitingOnOthers: number; // not started yet and waiting for another open issue
  longestDependencyChain: number;
  prsAwaitingQa: number; // open PRs queued for or in QA, re-test rounds included
  prsBeingFixed: number; // open PRs back for fixes: waiting for a worker, or being fixed
}

/** The backlog, QA and fix numbers in company_status, so the CEO can see where work waits for workers. */
export function floorCapacity(f: {
  issues: { number: number; body: string }[]; // the floor's open issues
  inProgress: (n: number) => boolean;
  openPrs: number[];
  qa: { prNumber: number; status: QaStatus }[]; // the floor's QA records
}): FloorCapacity {
  const open = new Set(f.issues.map((i) => i.number));
  const prs = new Set(f.openPrs);
  return {
    issuesWaitingOnOthers: f.issues.filter((i) => !f.inProgress(i.number) && blockers(i.body, open).length > 0).length,
    longestDependencyChain: Math.max(0, ...[...holdUps(f.issues).values()].map((w) => w.chain)),
    prsAwaitingQa: f.qa.filter((q) => prs.has(q.prNumber) && (q.status === 'queued' || q.status === 'testing')).length,
    prsBeingFixed: f.qa.filter((q) => prs.has(q.prNumber) && (q.status === 'failed' || q.status === 'fixing')).length,
  };
}
