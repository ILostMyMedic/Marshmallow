// What the shop panel (ShopPanel.tsx) shows, pure so it's tested: which floor it opens on, the catalogue in its groups,
// each entry's price and state for a floor, the spots an extra can go in, what stands on the floor (the kit by its
// tier's name, and what was bought) and where each bought thing could move, and the floor's ledger lines.
// shared/shop.ts holds the rules the server checks a purchase by; this only puts them into words.
// Adapted from cubefarm client/src/ui/Catalogue.tsx (MIT): the price, "No room" and the floor tabs; the rest is new.
import { checkMove, freeSpots, knownItems, ownedCount, priceOf, SHOP, SHOP_SPOTS, spotOf, type ShopEntry, type ShopSpot, type SpotKind } from '../../../../shared/shop';
import type { CoinEntry, CoinReason, FloorItem } from '../../../../shared/types';

/** The floor the shop opens on: the one asked for, else the floor you're on, else the first. */
export function shopFloor<F extends { id: string; floor: number }>(floors: readonly F[], wanted: string | undefined, here: number | null): F | undefined {
  return floors.find((f) => f.id === wanted) ?? floors.find((f) => f.floor === here) ?? floors[0];
}

export type GroupId = Exclude<SpotKind, 'kit'> | 'upgrade';

const GROUP_TITLES: [GroupId, string][] = [
  ['big', 'Big things'],
  ['floor', 'Small things'],
  ['rug', 'Rugs'],
  ['wall', 'Wall art'],
  ['upgrade', 'Upgrades'],
];

const spotsOf = (kind: SpotKind) => SHOP_SPOTS.filter((s) => s.kind === kind).length;

/** The catalogue by group, in the panel's order, each with how many spots of its kind a floor has. */
export function catalogue(): { id: GroupId; title: string; hint: string; entries: ShopEntry[] }[] {
  return GROUP_TITLES.map(([id, title]) => ({
    id,
    title,
    hint: id === 'upgrade' ? 'Swap a piece of the kit for a better one' : `${spotsOf(id)} spots on each floor`,
    entries: SHOP.filter((e) => (e.type === 'upgrade' ? id === 'upgrade' : e.kind === id)),
  }));
}

/** Whether an entry can be bought now, and if not, why not. */
export type EntryState =
  | { kind: 'buy' }
  | { kind: 'full' } // no free spot of its kind
  | { kind: 'poor'; need: number } // coins short
  | { kind: 'owned' } // an upgrade the floor has (or one past it)
  | { kind: 'needs'; first: string } // an upgrade whose tier before isn't there yet
  | { kind: 'missing'; item: string }; // an upgrade for a kit item the floor hasn't got

export interface EntryView {
  entry: ShopEntry;
  /** What it costs this floor (an extra costs more for each one already here). */
  price: number;
  /** How many the floor has: of an extra, or the upgrade's item at its tier or past it (0 or 1). */
  owned: number;
  state: EntryState;
  /** Where an extra could go, free spots first to last (empty for an upgrade). */
  spots: ShopSpot[];
}

/** The kit every floor starts with (server/db/floorPlans.ts DEFAULT_KIT), by item. */
const KIT: Record<string, { name: string; icon: string }> = {
  'coffee-machine': { name: 'Coffee machine', icon: '☕' },
  fridge: { name: 'Fridge', icon: '🧊' },
  couch: { name: 'Couch', icon: '🛋️' },
  'pingpong-table': { name: 'Ping-pong table', icon: '🏓' },
  whiteboard: { name: 'Whiteboard', icon: '📋' },
  gong: { name: 'Gong', icon: '🔔' },
};

const words = (id: string) => {
  const s = id.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** An item at a tier, as people call it: an upgrade by its own name, the kit's and the extras' by theirs. */
export function itemLook(item: string, tier: number, inKit: boolean): { name: string; icon: string } {
  const up = tier > 1 ? SHOP.find((e) => e.type === 'upgrade' && e.item === item && e.tier === tier) : undefined;
  if (up) return { name: up.name, icon: up.icon };
  if (inKit && KIT[item]) return KIT[item];
  const extra = SHOP.find((e) => e.type === 'extra' && e.id === item);
  if (extra) return { name: extra.name, icon: extra.icon };
  return KIT[item] ?? { name: words(item), icon: '📦' };
}

/** An entry's price, count and state for a floor with `plan` and `coins`, by the rules the server checks (checkPurchase). */
export function entryView(entry: ShopEntry, plan: readonly FloorItem[], coins: number): EntryView {
  if (entry.type === 'upgrade') {
    const current = plan.find((i) => i.item === entry.item);
    const price = entry.price;
    const owned = current && current.tier >= entry.tier ? 1 : 0;
    let state: EntryState;
    if (!current) state = { kind: 'missing', item: itemLook(entry.item, 1, true).name };
    else if (current.tier >= entry.tier) state = { kind: 'owned' };
    else if (current.tier !== entry.tier - 1) state = { kind: 'needs', first: itemLook(entry.item, entry.tier - 1, true).name };
    else if (coins < price) state = { kind: 'poor', need: price - coins };
    else state = { kind: 'buy' };
    return { entry, price, owned, state, spots: [] };
  }
  const owned = ownedCount(plan, entry.id);
  const price = priceOf(entry.price, owned);
  const spots = freeSpots(plan, entry.kind);
  const state: EntryState = !spots.length ? { kind: 'full' } : coins < price ? { kind: 'poor', need: price - coins } : { kind: 'buy' };
  return { entry, price, owned, state, spots };
}

/** What an entry's state says where its Buy button would be. */
export function stateLabel(state: EntryState): string {
  switch (state.kind) {
    case 'buy':
      return 'Buy';
    case 'full':
      return 'No room';
    case 'poor':
      return `Need ${state.need} more coin${state.need === 1 ? '' : 's'}`;
    case 'owned':
      return 'Owned';
    case 'needs':
      return `Needs the ${state.first.toLowerCase()} first`;
    case 'missing':
      return `No ${state.item.toLowerCase()} here to upgrade`;
  }
}

/** The spot an extra goes in: the one picked while it's still free, else the first free one. */
export const chosenSpot = (spots: readonly ShopSpot[], picked: string | undefined) => (spots.some((s) => s.id === picked) ? picked! : spots[0]?.id);

/** Something standing on the floor, where, and where it could move to. */
export interface PlacedView {
  spot: ShopSpot;
  item: FloorItem;
  name: string;
  icon: string;
  kit: boolean;
  /** Free spots of its kind it may move to (none for the kit, which stays put). */
  moves: ShopSpot[];
}

/** What's on a floor, in spot order: the kit (upgraded tiers by their names) and what was bought. */
export function onFloor(plan: readonly FloorItem[]): PlacedView[] {
  const order = (id: string) => SHOP_SPOTS.findIndex((s) => s.id === id);
  return knownItems(plan)
    .slice()
    .sort((a, b) => order(a.spot) - order(b.spot))
    .map((item) => {
      const spot = spotOf(item.spot)!;
      const kit = spot.kind === 'kit';
      const look = itemLook(item.item, item.tier, kit);
      const moves = kit ? [] : freeSpots(plan, spot.kind).filter((to) => checkMove(plan, spot.id, to.id) === null);
      return { spot, item, name: look.name, icon: look.icon, kit, moves };
    });
}

/** The note after a purchase or a move: what went where. */
export const placedNote = (look: { name: string; icon: string }, spotLabel: string, moved = false) => `${look.icon} ${look.name} ${moved ? 'moved to' : 'is in place:'} ${spotLabel.charAt(0).toLowerCase()}${spotLabel.slice(1)}`;

/** Coins with their sign: +10, or −120 with a real minus. */
export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

/** How long ago `at` was, roughly. */
export function ago(at: number, now: number): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

const REASON_ICONS: Record<CoinReason, string> = { merge: '🔀', 'clean-qa': '✅', fixed: '🔧', award: '🏆', purchase: '🛍️', grant: '🎁' };

export interface LedgerLine {
  id: number;
  icon: string;
  amount: string;
  earned: boolean;
  text: string;
  when: string;
}

/** A floor's latest ledger lines, newest first: "+10 PR #12 merged", "−120 Vending machine". */
export function ledgerLines(recent: readonly CoinEntry[], floorId: string, now: number, max = 8): LedgerLine[] {
  return recent
    .filter((e) => e.floorId === floorId)
    .slice(0, max)
    .map((e) => ({ id: e.id, icon: REASON_ICONS[e.reason] ?? '🪙', amount: signed(e.amount), earned: e.amount > 0, text: e.detail, when: ago(e.at, now) }));
}

const REASON_WORDS: Partial<Record<string, (pr: number | null) => string>> = {
  merge: (pr) => (pr ? `PR #${pr} merged` : 'a merge'),
  'clean-qa': () => 'clean QA pass',
  fixed: () => 'fixed after QA',
  award: () => 'an award',
  grant: () => 'a gift',
};

/** Why a floor earned coins, in words: the moment's reasons as they come, or put into words when they're reason codes. */
export const earnedWhy = (reasons: readonly string[], prNumber: number | null) => reasons.map((r) => REASON_WORDS[r]?.(prNumber) ?? r).join(', ');
