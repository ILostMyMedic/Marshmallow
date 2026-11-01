// The awards: what the office and each floor can win, in families of tiers, each tier a trophy that pays coins. The
// merge milestones are the trophies the office has always had (their ids kept, so trophies already won stay won); the
// rest are new. Shared, so the server awards by the same list the browser shows progress against. Pure, so it's tested.
// New: cubefarm's achievements (shared/progress.ts) pay nothing.
import { SHOP_SPOTS } from './shop.ts';

/** What an award counts. The server keeps each one per floor and for the company (server/db/awards.ts). */
export type AwardStat =
  | 'merges' // PRs merged
  | 'cleanQa' // merged PRs whose first QA round passed
  | 'fixed' // merged PRs fixed after failing QA
  | 'hatTrick' // times a floor merged three PRs within an hour
  | 'busyDay' // the most PRs the company merged in one day
  | 'nightOwl' // PRs merged between 22:00 and 05:00, the office's time
  | 'team' // the most workers a floor has had at once
  | 'floors' // the most floors the company has had at once
  | 'purchases' // things bought in the shop
  | 'furnished' // a floor's shop spots with something in them
  | 'upgrades' // a floor's kit items upgraded
  | 'projects' // projects started from a chat with the CEO
  | 'discussions'; // discussions settled

export type AwardScope = 'company' | 'floor';

export interface AwardTier {
  /** The count that wins it. */
  target: number;
  icon: string;
  /** "{floor}" is replaced by the floor's name. */
  title: string;
  detail: string;
  /** Coins it pays: a floor's award to that floor, the company's to every floor. */
  reward: number;
}

export interface AwardFamily {
  id: string;
  scope: AwardScope;
  stat: AwardStat;
  name: string;
  /** What counts, for the awards panel: "PRs merged on this floor". */
  counts: string;
  tiers: readonly AwardTier[]; // smallest target first
}

/** How many shop spots a floor has (the kit's aside): filling every one is the furnished award. */
export const SHOP_SPOT_COUNT = SHOP_SPOTS.filter((s) => s.kind !== 'kit').length;

export const AWARDS: readonly AwardFamily[] = [
  {
    id: 'merges',
    scope: 'company',
    stat: 'merges',
    name: 'Shipping',
    counts: 'PRs merged in all',
    tiers: [
      { target: 1, icon: '🚀', title: 'First ship', detail: 'The company merged its first pull request', reward: 25 },
      { target: 10, icon: '🥉', title: '10 PRs shipped', detail: 'The company has merged 10 pull requests', reward: 40 },
      { target: 25, icon: '🥈', title: '25 PRs shipped', detail: 'The company has merged 25 pull requests', reward: 60 },
      { target: 50, icon: '🥇', title: '50 PRs shipped', detail: 'The company has merged 50 pull requests', reward: 100 },
      { target: 100, icon: '🏆', title: '100 PRs shipped', detail: 'The company has merged 100 pull requests', reward: 150 },
      { target: 250, icon: '👑', title: '250 PRs shipped', detail: 'The company has merged 250 pull requests', reward: 250 },
      { target: 500, icon: '💫', title: '500 PRs shipped', detail: 'The company has merged 500 pull requests', reward: 400 },
      { target: 1000, icon: '🏛️', title: '1000 PRs shipped', detail: 'The company has merged 1000 pull requests', reward: 750 },
    ],
  },
  {
    id: 'busy-day',
    scope: 'company',
    stat: 'busyDay',
    name: 'Busy days',
    counts: 'the most PRs merged in one day',
    tiers: [
      { target: 5, icon: '📅', title: 'Busy day', detail: 'Five pull requests merged in one day', reward: 40 },
      { target: 15, icon: '📆', title: 'Shipping spree', detail: 'Fifteen pull requests merged in one day', reward: 100 },
      { target: 40, icon: '🗓️', title: 'Launch day', detail: 'Forty pull requests merged in one day', reward: 250 },
    ],
  },
  {
    id: 'night-owl',
    scope: 'company',
    stat: 'nightOwl',
    name: 'Night shift',
    counts: 'PRs merged between 10 pm and 5 am',
    tiers: [
      { target: 1, icon: '🦉', title: 'Night owl', detail: 'A pull request merged in the middle of the night', reward: 20 },
      { target: 25, icon: '🌙', title: 'Graveyard shift', detail: 'Twenty-five pull requests merged at night', reward: 80 },
    ],
  },
  {
    id: 'floors',
    scope: 'company',
    stat: 'floors',
    name: 'Growing',
    counts: 'floors at once',
    tiers: [
      { target: 2, icon: '🏢', title: 'Second floor', detail: 'Two floors in the building', reward: 30 },
      { target: 3, icon: '🏬', title: 'Growing company', detail: 'Three floors in the building', reward: 60 },
      { target: 5, icon: '🏙️', title: 'High-rise', detail: 'Five floors in the building', reward: 150 },
    ],
  },
  {
    id: 'projects',
    scope: 'company',
    stat: 'projects',
    name: 'Founding',
    counts: 'projects started from a chat with the CEO',
    tiers: [
      { target: 1, icon: '💡', title: 'From idea to floor', detail: 'A project planned in a chat with the CEO got its floor', reward: 50 },
      { target: 3, icon: '🧪', title: 'Serial founder', detail: 'Three projects started from chats with the CEO', reward: 150 },
    ],
  },
  {
    id: 'discussions',
    scope: 'company',
    stat: 'discussions',
    name: 'Settling things',
    counts: 'discussions settled',
    tiers: [
      { target: 1, icon: '🤝', title: 'Settled it', detail: 'A discussion with the CEO settled', reward: 15 },
      { target: 10, icon: '🗣️', title: 'Round table', detail: 'Ten discussions settled', reward: 60 },
    ],
  },
  {
    id: 'merges',
    scope: 'floor',
    stat: 'merges',
    name: 'Shipping',
    counts: 'PRs merged on this floor',
    tiers: [
      { target: 1, icon: '🎉', title: "{floor}'s first merge", detail: 'The first pull request merged on {floor}', reward: 15 },
      { target: 10, icon: '⭐', title: '{floor}: 10 merged', detail: '10 pull requests merged on {floor}', reward: 40 },
      { target: 50, icon: '🌟', title: '{floor}: 50 merged', detail: '50 pull requests merged on {floor}', reward: 100 },
      { target: 100, icon: '💎', title: '{floor}: 100 merged', detail: '100 pull requests merged on {floor}', reward: 200 },
    ],
  },
  {
    id: 'clean',
    scope: 'floor',
    stat: 'cleanQa',
    name: 'Clean passes',
    counts: 'merged PRs that passed QA first time',
    tiers: [
      { target: 1, icon: '✅', title: '{floor}: clean pass', detail: 'A pull request on {floor} passed QA first time', reward: 10 },
      { target: 10, icon: '🧼', title: '{floor}: clean sheet', detail: 'Ten pull requests on {floor} passed QA first time', reward: 40 },
      { target: 50, icon: '🏅', title: '{floor}: flawless', detail: 'Fifty pull requests on {floor} passed QA first time', reward: 120 },
    ],
  },
  {
    id: 'fixed',
    scope: 'floor',
    stat: 'fixed',
    name: 'Comebacks',
    counts: 'merged PRs fixed after failing QA',
    tiers: [
      { target: 1, icon: '🔧', title: '{floor}: comeback', detail: 'A pull request on {floor} failed QA, got fixed and merged', reward: 10 },
      { target: 10, icon: '🛠️', title: '{floor}: fixers', detail: 'Ten pull requests on {floor} fixed after failing QA', reward: 40 },
      { target: 25, icon: '⚙️', title: '{floor}: never give up', detail: 'Twenty-five pull requests on {floor} fixed after failing QA', reward: 80 },
    ],
  },
  {
    id: 'hat-trick',
    scope: 'floor',
    stat: 'hatTrick',
    name: 'Hat tricks',
    counts: 'times three PRs merged within an hour',
    tiers: [
      { target: 1, icon: '🎩', title: '{floor}: hat trick', detail: 'Three pull requests merged on {floor} within an hour', reward: 30 },
      { target: 10, icon: '🪄', title: '{floor}: on a roll', detail: 'Ten hat tricks on {floor}', reward: 100 },
    ],
  },
  {
    id: 'team',
    scope: 'floor',
    stat: 'team',
    name: 'Team',
    counts: 'workers on this floor at once',
    tiers: [
      { target: 3, icon: '👥', title: '{floor}: team of three', detail: 'Three workers on {floor} at once', reward: 20 },
      { target: 6, icon: '🧑‍🤝‍🧑', title: '{floor}: full house', detail: 'Six workers on {floor} at once', reward: 50 },
      { target: 10, icon: '🏟️', title: '{floor}: big team', detail: 'Ten workers on {floor} at once', reward: 100 },
    ],
  },
  {
    id: 'purchases',
    scope: 'floor',
    stat: 'purchases',
    name: 'Shopping',
    counts: 'things bought in the shop',
    tiers: [
      { target: 1, icon: '🛍️', title: '{floor}: first purchase', detail: '{floor} bought its first thing in the shop', reward: 10 },
      { target: 5, icon: '🧾', title: '{floor}: regulars', detail: '{floor} bought five things in the shop', reward: 30 },
    ],
  },
  {
    id: 'furnished',
    scope: 'floor',
    stat: 'furnished',
    name: 'Home sweet home',
    counts: 'shop spots filled',
    tiers: [
      { target: Math.ceil(SHOP_SPOT_COUNT / 2), icon: '🛋️', title: '{floor}: cosy', detail: 'Half the shop spots on {floor} filled', reward: 40 },
      { target: SHOP_SPOT_COUNT, icon: '🏠', title: '{floor}: fully furnished', detail: 'Every shop spot on {floor} filled', reward: 150 },
    ],
  },
  {
    id: 'upgrades',
    scope: 'floor',
    stat: 'upgrades',
    name: 'Deluxe',
    counts: 'kit items upgraded',
    tiers: [{ target: 2, icon: '✨', title: '{floor}: deluxe', detail: '{floor} has the espresso machine and the tournament table', reward: 60 }],
  },
];

/**
 * A tier's trophy id. The merge milestones keep the ids their trophies always had (`company:<n>`, `floor:<floor>:<n>`);
 * the rest are `company:<family>:<n>` and `floor:<floor>:<family>:<n>`. Every id ends in its target.
 */
export function awardId(family: Pick<AwardFamily, 'id' | 'scope'>, target: number, floorId: string | null): string {
  if (family.scope === 'company') return family.id === 'merges' ? `company:${target}` : `company:${family.id}:${target}`;
  return family.id === 'merges' ? `floor:${floorId}:${target}` : `floor:${floorId}:${family.id}:${target}`;
}

/** A tier's text with the floor's name in it. */
export const awardText = (text: string, floorName: string) => text.replace(/\{floor\}/g, floorName);

/** The counts behind the awards: the company's, and each floor's by floor id. A count left out is 0. */
export interface AwardStats {
  company: Partial<Record<AwardStat, number>>;
  floors: Record<string, Partial<Record<AwardStat, number>>>;
}

export const EMPTY_AWARD_STATS: AwardStats = { company: {}, floors: {} };

/** A tier reached: its family, the tier, its trophy id and the floor it's for (null: the company's). */
export interface Reached {
  family: AwardFamily;
  tier: AwardTier;
  id: string;
  floorId: string | null;
}

/** Every tier the counts have reached: the company's, then each floor's. */
export function reachedAwards(stats: AwardStats): Reached[] {
  const out: Reached[] = [];
  for (const family of AWARDS.filter((f) => f.scope === 'company')) {
    const n = stats.company[family.stat] ?? 0;
    for (const tier of family.tiers) if (n >= tier.target) out.push({ family, tier, id: awardId(family, tier.target, null), floorId: null });
  }
  for (const [floorId, counts] of Object.entries(stats.floors)) {
    for (const family of AWARDS.filter((f) => f.scope === 'floor')) {
      const n = counts[family.stat] ?? 0;
      for (const tier of family.tiers) if (n >= tier.target) out.push({ family, tier, id: awardId(family, tier.target, floorId), floorId });
    }
  }
  return out;
}

/** How far along a family is: its count, the tiers won, and the next tier (null once all are won). */
export interface FamilyProgress {
  family: AwardFamily;
  count: number;
  won: number;
  next: AwardTier | null;
  /** From the last tier won (or 0) to the next one, 0 to 1; 1 once all are won. */
  fraction: number;
}

export function familyProgress(family: AwardFamily, count: number): FamilyProgress {
  const won = family.tiers.filter((t) => count >= t.target).length;
  const next = family.tiers[won] ?? null;
  const from = won > 0 ? family.tiers[won - 1].target : 0;
  const fraction = next ? Math.max(0, Math.min(1, (count - from) / (next.target - from))) : 1;
  return { family, count, won, next, fraction };
}

/** Every award's tier count, for "12 of 40 won". */
export const tierCount = (scope: AwardScope) => AWARDS.filter((f) => f.scope === scope).reduce((n, f) => n + f.tiers.length, 0);
