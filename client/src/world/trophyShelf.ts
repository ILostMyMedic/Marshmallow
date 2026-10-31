// The trophies as the office shows them: what each one looks like (its shape and metal from its icon, bigger for a
// bigger milestone), where it stands in the lobby's cabinet (the company's on the top shelf, the floors' below), what
// its plaque says, and the trophies grouped for the panel. Pure, so it's tested; TrophyCabinet.tsx draws them.
import type { Floor, RecordsView, Trophy } from '../../../shared/types';

export type TrophyShape = 'cup' | 'star' | 'rocket' | 'gem' | 'crown';
export type Metal = 'bronze' | 'silver' | 'gold' | 'crystal';

export interface TrophyLook {
  shape: TrophyShape;
  metal: Metal;
  /** 1 for a first merge, up to 1.5 for a thousand. */
  scale: number;
}

// server/db/trophies.ts's icons (without emoji variation selectors): the company's rocket, cups, crown, star and gem,
// and a floor's cup, stars and gem.
const BY_ICON: Record<string, [TrophyShape, Metal]> = {
  '🚀': ['rocket', 'silver'],
  '🥉': ['cup', 'bronze'],
  '🥈': ['cup', 'silver'],
  '🥇': ['cup', 'gold'],
  '🏆': ['cup', 'gold'],
  '👑': ['crown', 'gold'],
  '💫': ['star', 'gold'],
  '🏛': ['gem', 'crystal'],
  '🎉': ['cup', 'bronze'],
  '⭐': ['star', 'silver'],
  '🌟': ['star', 'gold'],
  '💎': ['gem', 'crystal'],
};

/** How many merges a trophy marks, from its id (`company:<n>` or `floor:<floor id>:<n>`); 1 when it doesn't say. */
export function milestoneOf(t: Pick<Trophy, 'id'>): number {
  const n = Number(t.id.slice(t.id.lastIndexOf(':') + 1));
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** A trophy's shape, metal and size. An icon it doesn't know gets a cup, its metal by the milestone. */
export function trophyLook(t: Pick<Trophy, 'id' | 'icon'>): TrophyLook {
  const n = milestoneOf(t);
  const [shape, metal] = BY_ICON[t.icon.replace(/️/g, '')] ?? ['cup', n >= 50 ? 'gold' : n >= 10 ? 'silver' : 'bronze'];
  return { shape, metal, scale: Math.round((1 + Math.log10(n) / 6) * 100) / 100 };
}

const byMilestone = (a: Trophy, b: Trophy) => milestoneOf(a) - milestoneOf(b) || a.earnedAt - b.earnedAt;

/** A trophy in the cabinet: its shelf (0 is the top), its place along it from the left, and how many share the shelf. */
export interface ShelfSpot {
  trophy: Trophy;
  shelf: number;
  slot: number;
  of: number;
}

/**
 * Where each trophy stands in a cabinet of `shelves` shelves holding `perShelf` each: the company's on the top shelf,
 * the floors' below, each floor's together in `floorOrder` (floors no longer there last), smallest milestone first. A
 * floor that would straddle two shelves moves down whole when the rest still fit. When there are more than the shelves
 * hold, the smallest milestones give way: `hidden` counts them.
 */
export function shelfLayout(trophies: readonly Trophy[], floorOrder: readonly string[], perShelf: number, shelves = 3): { spots: ShelfSpot[]; hidden: number } {
  const company = trophies.filter((t) => !t.floorId).sort(byMilestone);
  const keptCompany = company.slice(-perShelf);
  const rank = (id: string) => {
    const i = floorOrder.indexOf(id);
    return i < 0 ? floorOrder.length : i;
  };
  const floors = trophies.filter((t) => t.floorId).sort((a, b) => rank(a.floorId!) - rank(b.floorId!) || a.floorId!.localeCompare(b.floorId!) || byMilestone(a, b));
  const room = perShelf * (shelves - 1);
  const dropped = new Set(
    [...floors]
      .sort(byMilestone)
      .slice(0, Math.max(0, floors.length - room))
      .map((t) => t.id),
  );
  const kept = floors.filter((t) => !dropped.has(t.id));

  const rows: Trophy[][] = [keptCompany];
  let row: Trophy[] = [];
  let left = kept.length;
  for (let i = 0; i < kept.length; ) {
    const floorId = kept[i].floorId;
    let end = i;
    while (end < kept.length && kept[end].floorId === floorId) end++;
    const group = kept.slice(i, end);
    // down a shelf rather than split, if this floor fits on one and everything left fits below
    const below = (shelves - 1 - rows.length) * perShelf;
    if (row.length && row.length + group.length > perShelf && group.length <= perShelf && left <= below) {
      rows.push(row);
      row = [];
    }
    for (const t of group) {
      if (row.length === perShelf) {
        rows.push(row);
        row = [];
      }
      row.push(t);
    }
    left -= group.length;
    i = end;
  }
  if (row.length) rows.push(row);

  const spots = rows.flatMap((r, shelf) => r.map((trophy, slot) => ({ trophy, shelf, slot, of: r.length })));
  return { spots, hidden: company.length - keptCompany.length + dropped.size };
}

/** What the plaque under a trophy says, in two short lines: whose it is and what for. */
export function plaqueLines(t: Trophy, floorName: (floorId: string) => string): [string, string] {
  const n = milestoneOf(t);
  if (!t.floorId) return ['Company', n === 1 ? 'First ship' : `${n} shipped`];
  return [floorName(t.floorId), n === 1 ? 'First merge' : `${n} merged`];
}

/** A floor's short name ("app" for "owner/app"), or its id's when it's gone. */
export function floorName(floors: readonly Pick<Floor, 'id' | 'fullName'>[], floorId: string): string {
  const full = floors.find((f) => f.id === floorId)?.fullName ?? floorId;
  return full.split('/').pop() || full;
}

/** A floor that's gone, in the lists. */
export const GONE_COLOR = '#8d93ab';
/** The company's colour, in the lists. */
export const COMPANY_COLOR = '#ffd166';

export interface TrophyGroup {
  key: string;
  name: string;
  color: string;
  /** PRs this group shipped: the company's total, or the floor's. */
  total: number;
  /** Newest first. */
  trophies: Trophy[];
}

/** The trophies for the panel: the company's first, then each floor's in floor order (floors gone last), newest first. */
export function trophyGroups(records: Pick<RecordsView, 'trophies' | 'totals' | 'total'>, floors: readonly Pick<Floor, 'id' | 'fullName' | 'color' | 'floor'>[]): TrophyGroup[] {
  const newestFirst = (list: Trophy[]) => [...list].sort((a, b) => b.earnedAt - a.earnedAt || milestoneOf(b) - milestoneOf(a));
  const company = records.trophies.filter((t) => !t.floorId);
  const out: TrophyGroup[] = company.length ? [{ key: 'company', name: 'The company', color: COMPANY_COLOR, total: records.total, trophies: newestFirst(company) }] : [];
  const ids = [...new Set(records.trophies.map((t) => t.floorId).filter((id): id is string => !!id))];
  const order = (id: string) => floors.find((f) => f.id === id)?.floor ?? Number.MAX_SAFE_INTEGER;
  ids.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  for (const id of ids) {
    const floor = floors.find((f) => f.id === id);
    out.push({ key: id, name: floorName(floors, id), color: floor?.color ?? GONE_COLOR, total: records.totals[id] ?? 0, trophies: newestFirst(records.trophies.filter((t) => t.floorId === id)) });
  }
  return out;
}
