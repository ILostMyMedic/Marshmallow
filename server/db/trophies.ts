// Reading the office's merges back: who built a PR, from the branch the office gave it. The milestones it used to hold
// are awards now (shared/awards.ts).

/** Who built a PR, from the office's branch name (mm/issue-<n>-<their name, slugified>); null for anyone else's PR. */
export function builderFromBranch(ref: string | null | undefined): string | null {
  const m = ref?.match(/^mm\/issue-\d+-([a-z0-9-]+)$/i);
  if (!m) return null;
  return m[1]
    .split('-')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}
