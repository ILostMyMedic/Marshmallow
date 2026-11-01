// A floor's work branch: the branch its work starts from and merges into (dev, say). Unset, it's the repository's
// default branch. Desks, PRs, merges, fixes, QA and previews all follow it, through workBranchOf.
import type { Floor } from './types.ts';

/** The branch the floor's work starts from and merges into. */
export const workBranchOf = (floor: Pick<Floor, 'workBranch' | 'defaultBranch'>): string => floor.workBranch || floor.defaultBranch;

/** Why a name can't be a branch (git check-ref-format's rules, as the office uses them), or null when it can. */
export function branchProblem(name: string): string | null {
  if (!name) return 'A branch needs a name';
  if (name.length > 200) return 'Keep the branch name under 200 characters';
  if (!/^[\w./-]+$/.test(name)) return 'A branch name can only have letters, digits, ".", "_", "-" and "/"';
  if (/^[-/.]|[/.]$|\/\/|\.\.|\/\.|\.lock(\/|$)/.test(name)) return `"${name}" isn't a valid branch name`;
  return null;
}
