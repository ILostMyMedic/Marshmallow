// The company's week, for the whiteboard by the CEO's meeting table (CeoWeekBoard.tsx): the last seven days' merges
// day by day, and the week's merges, PRs opened and issues filed, and the floor that merged the most. From the office
// database's shipped work and the floors' PRs and issues (a merge in both counts once). Pure, so it's tested. New in
// Marshmallow.
import type { Floor, ShippedWork } from '../../../shared/types';

export interface WeekDay {
  /** Mon, Tue… */
  label: string;
  merged: number;
  today: boolean;
}

export interface Week {
  /** The last seven days, oldest first, ending today. */
  days: WeekDay[];
  merged: number;
  opened: number;
  filed: number;
  /** The floor that merged the most this week (the first of a tie); null before anything's merged. */
  best: { name: string; merged: number } | null;
}

const LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type FloorBits = Pick<Floor, 'id' | 'fullName' | 'pulls' | 'issues'>;

/** The week up to `now` (local days, from midnight six days ago). */
export function companyWeek(floors: readonly FloorBits[], recent: readonly Pick<ShippedWork, 'floorId' | 'prNumber' | 'mergedAt'>[], now: number): Week {
  // midnight of each of the seven days, and of tomorrow
  const starts = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 6 + i);
    return d.getTime();
  });
  const dayOf = (t: number) => {
    if (!(t >= starts[0] && t < starts[7])) return -1;
    let i = 6;
    while (t < starts[i]) i--;
    return i;
  };
  const days: WeekDay[] = starts.slice(0, 7).map((t, i) => ({ label: LABELS[new Date(t).getDay()], merged: 0, today: i === 6 }));
  const byFloor = new Map<string, number>();
  const seen = new Set<string>();
  const merge = (floorId: string, pr: number, at: number) => {
    const key = `${floorId}#${pr}`;
    const i = dayOf(at);
    if (i < 0 || seen.has(key)) return;
    seen.add(key);
    days[i].merged++;
    byFloor.set(floorId, (byFloor.get(floorId) ?? 0) + 1);
  };
  for (const r of recent) merge(r.floorId, r.prNumber, r.mergedAt);
  let opened = 0;
  let filed = 0;
  for (const f of floors) {
    for (const p of f.pulls) {
      if (p.state === 'MERGED' && p.mergedAt) merge(f.id, p.number, Date.parse(p.mergedAt));
      if (dayOf(Date.parse(p.createdAt)) >= 0) opened++;
    }
    for (const i of f.issues) if (dayOf(Date.parse(i.createdAt)) >= 0) filed++;
  }
  let best: Week['best'] = null;
  for (const f of floors) {
    const n = byFloor.get(f.id) ?? 0;
    if (n && (!best || n > best.merged)) best = { name: f.fullName.split('/').pop() ?? f.fullName, merged: n };
  }
  return { days, merged: seen.size, opened, filed, best };
}
