// What the CEO may do to a floor's issues: how many it may file in a job, how set_dependencies rewrites an issue, and
// when close_issue may close one.
// Adapted from cubefarm server/ceo.ts (MIT): IssueCap, planDependencies, checkCloseIssue.
import { blockers, holdUps, setDependsOn } from '../../../shared/issues.ts';
import { HttpError } from '../../httpError.ts';
import { issuesResolvedBy } from '../../pipeline/rules/issueClaims.ts';

/** At most `max` issues per job; also notes the floors that got issues, to sync when the job ends. */
export class IssueCap {
  filed = 0;
  readonly floors = new Set<string>();
  constructor(readonly max: number) {}

  check() {
    if (this.filed >= this.max) throw new Error(`You already filed ${this.max} issues in this job. That's plenty for one milestone. The manager's next message allows more.`);
  }

  record(floorId: string) {
    this.filed++;
    this.floors.add(floorId);
  }
}

export interface DependsRequest {
  floor: number;
  number: number;
  dependsOn: number[]; // [] = no dependencies
  issues: { number: number; body: string }[]; // the floor's open issues
  closed: (n: number) => boolean; // for numbers that aren't open: closed, rather than unknown
  inProgress: boolean;
}

export interface DependsPlan {
  body: string | null; // null: leave the body alone
  summary: string;
}

/** Longest chain of open issues this one waits for, one step per "Depends on". */
function waitsDepth(n: number, deps: Map<number, number[]>, seen = new Set<number>()): number {
  if (seen.has(n)) return 0;
  seen.add(n);
  const depth = Math.max(0, ...(deps.get(n) ?? []).map((d) => waitsDepth(d, deps, seen) + 1));
  seen.delete(n);
  return depth;
}

/** Does `from` wait for `to`, directly or through other issues? */
function reaches(from: number, to: number, waits: Map<number, number[]>, seen = new Set<number>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (waits.get(from) ?? []).some((n) => reaches(n, to, waits, seen));
}

/**
 * What set_dependencies changes, or why it refuses: a closed or unknown issue, one in progress, a dependency on
 * itself, on a closed or unknown issue, a cycle, or a chain deeper than two steps.
 */
export function planDependencies(r: DependsRequest): DependsPlan {
  const issue = r.issues.find((i) => i.number === r.number);
  if (!issue) throw new Error(r.closed(r.number) ? `#${r.number} is closed.` : `There is no open issue #${r.number} on floor ${r.floor}.`);
  if (r.inProgress) throw new Error(`#${r.number} is already in progress, so its dependencies can't change.`);
  const deps = [...new Set(r.dependsOn.map(Number))];
  const open = new Set(r.issues.map((i) => i.number));
  for (const d of deps) {
    if (d === r.number) throw new Error(`#${r.number} can't depend on itself.`);
    if (!open.has(d)) throw new Error(r.closed(d) ? `#${d} is closed, so there's nothing to wait for.` : `There is no open issue #${d} on floor ${r.floor}.`);
  }
  const body = setDependsOn(issue.body, deps);
  const after = r.issues.map((i) => (i.number === r.number ? { ...i, body } : i));
  const waits = new Map(after.map((i) => [i.number, blockers(i.body, open)]));
  const loop = deps.find((d) => reaches(d, r.number, waits));
  if (loop !== undefined) throw new Error(`#${loop} already waits for #${r.number}, directly or through other issues, so that would be a cycle.`);
  const depth = waitsDepth(r.number, waits) + (holdUps(after).get(r.number)?.chain ?? 0);
  if (depth > 2) throw new Error(`That makes a dependency chain ${depth} steps deep through #${r.number}. Keep chains to 2 steps at most: fold the dependent pieces into one issue instead of splitting further.`);
  return {
    body: body !== issue.body ? body : null,
    summary: `#${r.number} on floor ${r.floor}: ${deps.length ? `depends on ${deps.map((d) => `#${d}`).join(', ')}` : 'no dependencies'}.`,
  };
}

/**
 * Whether close_issue may close an issue: only one open on that floor (`state` is its state in the floor's repo;
 * null when unknown), and never one an open pull request closes: one that links it, or the office's mm/issue- branch
 * for it (GitHub links nothing for a PR into a work branch like dev).
 */
export function checkCloseIssue(r: { floor: number; number: number; state: 'OPEN' | 'CLOSED' | null; pulls: { number: number; state: string; closesIssues: number[]; headRefName?: string }[] }) {
  if (r.state === 'CLOSED') throw new HttpError(404, `#${r.number} on floor ${r.floor} is already closed.`);
  if (r.state !== 'OPEN') throw new HttpError(404, `There is no open issue #${r.number} on floor ${r.floor}.`);
  const pr = r.pulls.find((p) => p.state === 'OPEN' && issuesResolvedBy({ headRefName: p.headRefName ?? '', closesIssues: p.closesIssues }).includes(r.number));
  if (pr) throw new HttpError(409, `PR #${pr.number} closes #${r.number}. Close or finish that pull request first.`);
}
