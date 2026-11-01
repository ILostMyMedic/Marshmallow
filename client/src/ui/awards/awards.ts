// What the awards panel (AwardsPanel.tsx) and the CEO's awards wall (world/AwardsWall.tsx) show, pure so it's tested:
// which award tier a trophy is, a tier's name without its floor, and every family's progress for the company and each
// floor: its tiers won (the trophies are the truth) or not yet, the bar to the next one and what that pays, and the
// coins the awards have paid. shared/awards.ts holds the list the server awards by; this only lays it out. New in
// Marshmallow.
import { AWARDS, awardId, tierCount, type AwardFamily, type AwardStat, type AwardStats, type AwardTier } from '../../../../shared/awards';
import type { Floor, Trophy } from '../../../../shared/types';

/** A trophy's award: its family, its tier and the tier's place in the family (0 is the first). */
export interface TierRef {
  family: AwardFamily;
  tier: AwardTier;
  index: number;
}

/** The award tier a trophy is, from its id; null for a trophy that isn't one of shared/awards.ts's. */
export function tierOf(t: Pick<Trophy, 'id' | 'floorId'>): TierRef | null {
  for (const family of AWARDS) {
    if ((family.scope === 'floor') !== !!t.floorId) continue;
    const index = family.tiers.findIndex((tier) => awardId(family, tier.target, t.floorId) === t.id);
    if (index >= 0) return { family, tier: family.tiers[index], index };
  }
  return null;
}

/** A tier's name without its floor: "Hat trick" for "{floor}: hat trick", "First merge" for "{floor}'s first merge". */
export function tierName(tier: Pick<AwardTier, 'title'>): string {
  const s = tier.title.replace(/^\{floor\}(?::\s*|'s\s+)/, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Whether a trophy is one of the company's merge milestones (the CEO's milestones board shows those). */
export const isCompanyMilestone = (t: Pick<Trophy, 'id' | 'floorId'>) => {
  const ref = tierOf(t);
  return !!ref && ref.family.scope === 'company' && ref.family.stat === 'merges';
};

/** What each count is, short, one and many, for the progress line: "17 / 25 PRs merged". */
const UNITS: Record<AwardStat, [string, string]> = {
  merges: ['PR merged', 'PRs merged'],
  cleanQa: ['clean pass', 'clean passes'],
  fixed: ['comeback', 'comebacks'],
  hatTrick: ['hat trick', 'hat tricks'],
  busyDay: ['on the best day', 'on the best day'],
  nightOwl: ['night merge', 'night merges'],
  team: ['worker at once', 'workers at once'],
  floors: ['floor at once', 'floors at once'],
  purchases: ['thing bought', 'things bought'],
  furnished: ['spot filled', 'spots filled'],
  upgrades: ['upgrade', 'upgrades'],
  projects: ['project started', 'projects started'],
  discussions: ['settled', 'settled'],
};

/** A count's unit, agreeing with `n`: "1 night merge", "25 night merges". */
export const unitOf = (stat: AwardStat, n: number) => UNITS[stat][n === 1 ? 0 : 1];

/** One tier on a family's track: won (its trophy) or not yet. */
export interface ChipView {
  id: string;
  tier: AwardTier;
  name: string;
  trophy: Trophy | null;
}

/** A family's row: its count, its tiers, and the bar to the next tier not yet won (null once all are). */
export interface RowView {
  family: AwardFamily;
  count: number;
  chips: ChipView[];
  won: number;
  next: AwardTier | null;
  /** From the tier before the next one (or 0) to the next, 0 to 1; 1 once all are won. */
  fraction: number;
  /** "17 / 25 PRs merged · next pays +60 🪙", or "All 3 won · 4 workers at once" ("Won · 2 upgrades" for a tier alone). */
  progress: string;
  /** The icon of its highest tier won, else its first tier's (shown greyed). */
  icon: string;
}

/** The company's awards, or a floor's. */
export interface GroupView {
  /** 'company', or the floor's id. */
  key: string;
  name: string;
  color: string;
  /** The floor's number; null for the company. */
  floor: number | null;
  rows: RowView[];
  won: number;
  total: number;
  /** Coins its awards paid: a floor's to that floor; the company's to every floor (each). */
  paid: number;
}

export interface AwardsView {
  /** Tiers won and how many there are, for the company and the floors there now. */
  won: number;
  total: number;
  company: GroupView;
  floors: GroupView[];
  /** Coins paid: by the floors' awards, all told (floors since gone included), and by the company's to every floor. */
  paid: { floors: number; everyFloor: number };
}

/** The company's colour (trophyShelf.ts COMPANY_COLOR). */
const COMPANY = '#ffd166';

const shortName = (fullName: string) => fullName.split('/').pop() || fullName;

/** A family's row from its count and the trophies won (by id). */
export function rowView(family: AwardFamily, count: number, floorId: string | null, won: ReadonlyMap<string, Trophy>): RowView {
  const chips = family.tiers.map((tier): ChipView => {
    const id = awardId(family, tier.target, floorId);
    return { id, tier, name: tierName(tier), trophy: won.get(id) ?? null };
  });
  const nextAt = chips.findIndex((c) => !c.trophy);
  const next = nextAt < 0 ? null : chips[nextAt].tier;
  const from = nextAt > 0 ? family.tiers[nextAt - 1].target : 0;
  const fraction = next ? Math.max(0, Math.min(1, (count - from) / (next.target - from))) : 1;
  const wonCount = chips.filter((c) => c.trophy).length;
  const progress = next
    ? `${count} / ${next.target} ${unitOf(family.stat, next.target)} · next pays +${next.reward} 🪙`
    : `${chips.length === 1 ? 'Won' : `All ${chips.length} won`} · ${count} ${unitOf(family.stat, count)}`;
  const top = [...chips].reverse().find((c) => c.trophy);
  return { family, count, chips, won: wonCount, next, fraction, progress, icon: (top ?? chips[0]).tier.icon };
}

function groupView(key: string, name: string, color: string, floor: number | null, scope: 'company' | 'floor', counts: Partial<Record<AwardStat, number>>, won: ReadonlyMap<string, Trophy>): GroupView {
  const rows = AWARDS.filter((f) => f.scope === scope).map((f) => rowView(f, counts[f.stat] ?? 0, scope === 'company' ? null : key, won));
  const chips = rows.flatMap((r) => r.chips);
  return {
    key,
    name,
    color,
    floor,
    rows,
    won: chips.filter((c) => c.trophy).length,
    total: tierCount(scope),
    paid: chips.reduce((n, c) => n + (c.trophy?.reward ?? 0), 0),
  };
}

/**
 * Every award's progress: the company's, then each floor's in floor order. The store's counts drive the bars; the
 * trophies say which tiers are won (a count that has since dropped, a team that shrank, keeps what it won).
 */
export function awardsView(stats: AwardStats, trophies: readonly Trophy[], floors: readonly Pick<Floor, 'id' | 'fullName' | 'color' | 'floor'>[]): AwardsView {
  const won = new Map(trophies.map((t) => [t.id, t]));
  const company = groupView('company', 'The company', COMPANY, null, 'company', stats.company, won);
  const groups = [...floors].sort((a, b) => a.floor - b.floor).map((f) => groupView(f.id, shortName(f.fullName), f.color, f.floor, 'floor', stats.floors[f.id] ?? {}, won));
  const awarded = trophies.filter((t) => tierOf(t));
  return {
    won: company.won + groups.reduce((n, g) => n + g.won, 0),
    total: company.total + groups.reduce((n, g) => n + g.total, 0),
    company,
    floors: groups,
    paid: {
      floors: awarded.filter((t) => t.floorId).reduce((n, t) => n + t.reward, 0),
      everyFloor: awarded.filter((t) => !t.floorId).reduce((n, t) => n + t.reward, 0),
    },
  };
}

/** A group's award nearest to being won: the furthest along of those with a tier still to win (null once all are). */
export function nearestNext(g: Pick<GroupView, 'rows'>): RowView | null {
  let best: RowView | null = null;
  for (const r of g.rows) {
    if (!r.next) continue;
    if (!best || r.fraction > best.fraction || (r.fraction === best.fraction && r.next.reward < best.next!.reward)) best = r;
  }
  return best;
}

/**
 * The trophies the awards wall's shelf stands up: the newest `n` awards won, the company's and the floors', leaving out
 * the company's merge milestones (they stand on the milestones cabinet across the room). Oldest first, left to right.
 */
export function wallTrophies(trophies: readonly Trophy[], n: number): Trophy[] {
  return trophies
    .filter((t) => tierOf(t) && !isCompanyMilestone(t))
    .sort((a, b) => a.earnedAt - b.earnedAt || a.id.localeCompare(b.id))
    .slice(-n);
}

/** The awards won and how many there are, for "12 of 64 won" (the tour, the front desk). */
export function wonOf(trophies: readonly Pick<Trophy, 'id' | 'floorId'>[], floorIds: readonly string[]): { won: number; total: number } {
  const here = new Set(floorIds);
  const won = trophies.filter((t) => (t.floorId === null || here.has(t.floorId)) && tierOf(t)).length;
  return { won, total: tierCount('company') + tierCount('floor') * floorIds.length };
}
