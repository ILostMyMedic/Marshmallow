// The office's milestones, from how many PRs it has merged: the company's (every floor together) and each floor's. Pure,
// so the tests check every one; records.ts awards the ones reached and dates each by the merge that reached it.
import type { Trophy } from '../../shared/types.ts';

/** A milestone reached: the trophy without its date, and the merge count that earned it (to find that merge). */
export type Milestone = Omit<Trophy, 'earnedAt'> & { count: number };

const COMPANY: readonly [number, string][] = [
  [1, '🚀'],
  [10, '🥉'],
  [25, '🥈'],
  [50, '🥇'],
  [100, '🏆'],
  [250, '👑'],
  [500, '💫'],
  [1000, '🏛️'],
];

const FLOOR: readonly [number, string][] = [
  [1, '🎉'],
  [10, '⭐'],
  [50, '🌟'],
  [100, '💎'],
];

/** Every milestone `total` merges in all and `perFloor` merges on each floor have reached; `name` gives a floor's name. */
export function milestones(total: number, perFloor: Record<string, number>, name: (floorId: string) => string): Milestone[] {
  const out: Milestone[] = [];
  for (const [n, icon] of COMPANY) {
    if (total < n) break;
    out.push(
      n === 1
        ? { id: 'company:1', floorId: null, icon, title: 'First ship', detail: 'The company merged its first pull request', count: n }
        : { id: `company:${n}`, floorId: null, icon, title: `${n} PRs shipped`, detail: `The company has merged ${n} pull requests`, count: n },
    );
  }
  for (const [floorId, count] of Object.entries(perFloor)) {
    const floor = name(floorId);
    for (const [n, icon] of FLOOR) {
      if (count < n) break;
      out.push(
        n === 1
          ? { id: `floor:${floorId}:1`, floorId, icon, title: `${floor}'s first merge`, detail: `The first pull request merged on ${floor}`, count: n }
          : { id: `floor:${floorId}:${n}`, floorId, icon, title: `${floor}: ${n} merged`, detail: `${n} pull requests merged on ${floor}`, count: n },
      );
    }
  }
  return out;
}

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
