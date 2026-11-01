// A floor's work branch in the pipeline (shared/branches.ts). The office merges its PRs only into the work branch, so an
// office PR opened against another branch (a worker's slip, or the work branch changed since) is moved onto it. And
// GitHub closes a merged PR's "Closes #N" issues only when it merged into the default branch: merges into a work branch
// like dev leave them open, so the office closes them itself, after its own merges and on later syncs.
import { workBranchOf } from '../../../shared/branches.ts';
import type { Floor, PullInfo } from '../../../shared/types.ts';
import { issuesResolvedBy, RECENT_MERGE_MS } from './issueClaims.ts';

type BasePull = Pick<PullInfo, 'state' | 'headRefName' | 'baseRefName'>;

/** An open office PR (mm/issue-) aimed at another branch than the floor's work branch: it's moved before it's tested, fixed or merged. */
export function offWorkBranch(floor: Pick<Floor, 'workBranch' | 'defaultBranch'>, pr: BasePull): boolean {
  return pr.state === 'OPEN' && pr.headRefName.startsWith('mm/issue-') && !!pr.baseRefName && pr.baseRefName !== workBranchOf(floor);
}

export type ShippedPull = BasePull & Pick<PullInfo, 'number' | 'mergedAt' | 'closesIssues'>;

/**
 * Issues still open whose PR merged lately into another branch than the default one, which GitHub never closes; `done`:
 * the PRs whose issues the office closed already (once per PR, so an issue the manager reopens stays open).
 */
export function unclosedByMerge(f: { defaultBranch: string; issues: readonly { number: number }[]; pulls: readonly ShippedPull[] }, done: ReadonlySet<number>, now: number): { pr: number; base: string; issues: number[] }[] {
  const open = new Set(f.issues.map((i) => i.number));
  return f.pulls
    .filter((p) => p.state === 'MERGED' && !done.has(p.number) && p.baseRefName && p.baseRefName !== f.defaultBranch && p.mergedAt && now - Date.parse(p.mergedAt) < RECENT_MERGE_MS)
    .map((p) => ({ pr: p.number, base: p.baseRefName, issues: issuesResolvedBy(p).filter((n) => open.has(n)) }))
    .filter((x) => x.issues.length > 0);
}
