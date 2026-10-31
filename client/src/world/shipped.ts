// What the lobby's shipped wall lists (ShippedWall.tsx paints it): the latest merges, each with its floor, who built and
// tested it and when, and each floor's total. Pure, so it's tested; the CEO's milestones board and the trophies' panel
// use the same words.
import type { Floor, RecordsView, ShippedWork } from '../../../shared/types';
import { floorName, GONE_COLOR } from './trophyShelf';
import { dayStart } from './tour';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "31 Oct 2026". */
export function dateLabel(at: number): string {
  const d = new Date(at);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** When, as the wall says it: the time today, "yesterday", the weekday within the week, else the date. */
export function whenLabel(at: number, now: number): string {
  const d = new Date(at);
  const today = dayStart(now);
  if (at >= today) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (at >= dayStart(today - 1)) return 'yesterday';
  if (at >= today - 6 * 86_400_000) return DAYS[d.getDay()];
  return d.getFullYear() === new Date(now).getFullYear() ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : dateLabel(at);
}

/** Who built and tested it: "Ada · tested by Grace", or "from outside the office" for a PR nobody here built. */
export function byLine(w: Pick<ShippedWork, 'builtBy' | 'testedBy'>): string {
  const built = w.builtBy ?? 'from outside the office';
  return w.testedBy ? `${built} · tested by ${w.testedBy}` : built;
}

export interface WallRow {
  key: string;
  title: string;
  pr: number;
  floor: string;
  color: string;
  by: string;
  when: string;
}

type FloorBits = Pick<Floor, 'id' | 'fullName' | 'color'>;

/** The latest `max` merges, newest first, as the wall lists them. */
export function wallRows(records: Pick<RecordsView, 'recent'>, floors: readonly FloorBits[], now: number, max: number): WallRow[] {
  return records.recent.slice(0, max).map((w) => ({
    key: `${w.floorId}#${w.prNumber}`,
    title: w.title,
    pr: w.prNumber,
    floor: floorName(floors, w.floorId),
    color: floors.find((f) => f.id === w.floorId)?.color ?? GONE_COLOR,
    by: byLine(w),
    when: whenLabel(w.mergedAt, now),
  }));
}

export interface FloorTotal {
  key: string;
  name: string;
  color: string;
  total: number;
}

/** Each floor's total, most first (a tie in floor order); floors gone from the office keep theirs, greyed. */
export function floorTotals(records: Pick<RecordsView, 'totals'>, floors: readonly (FloorBits & Pick<Floor, 'floor'>)[]): FloorTotal[] {
  const order = (id: string) => floors.find((f) => f.id === id)?.floor ?? Number.MAX_SAFE_INTEGER;
  return Object.entries(records.totals)
    .filter(([, n]) => n > 0)
    .sort(([a, n], [b, m]) => m - n || order(a) - order(b) || a.localeCompare(b))
    .map(([id, total]) => ({ key: id, name: floorName(floors, id), color: floors.find((f) => f.id === id)?.color ?? GONE_COLOR, total }));
}

/** "1 PR", "12 PRs". */
export const prs = (n: number) => `${n} PR${n === 1 ? '' : 's'}`;
