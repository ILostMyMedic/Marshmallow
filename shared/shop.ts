// The shop: what it sells, the spots on every office floor that bought things snap into, and what a floor may buy.
// Shared, so the server checks a purchase by the same rules the browser shows. Floors keep what they have (nothing is
// sold back); an item's price rises with each one a floor already has. Pure, so it's tested.
// Adapted from cubefarm shared/progress.ts (MIT): the catalogue, the slots and the price rule; tiers are new.
import type { FloorItem } from './types.ts';

/** What a spot takes: wall art, a small floor item, a big one, a rug, or the default kit (upgrades only). */
export type SpotKind = 'wall' | 'floor' | 'big' | 'rug' | 'kit';

export interface ShopSpot {
  id: string;
  kind: SpotKind;
  /** Where it is, for the shop's spot picker. */
  label: string;
}

/**
 * Every office floor's spots. The kit's (server/db/floorPlans.ts DEFAULT_KIT) hold what every floor has from the start;
 * the rest start empty. Where each one is in the room: client/src/world/decor/spots.ts, by the same ids.
 */
export const SHOP_SPOTS: readonly ShopSpot[] = [
  { id: 'kitchen', kind: 'kit', label: 'The kitchenette counter' },
  { id: 'kitchen-fridge', kind: 'kit', label: 'The kitchenette' },
  { id: 'lounge', kind: 'kit', label: 'The lounge' },
  { id: 'games', kind: 'kit', label: 'The play area' },
  { id: 'north-wall', kind: 'kit', label: 'The north wall' },
  { id: 'gong-corner', kind: 'kit', label: 'The north-west corner' },
  { id: 'big-1', kind: 'big', label: 'North-east corner' },
  { id: 'big-2', kind: 'big', label: 'South-west, by the ping-pong table' },
  { id: 'big-3', kind: 'big', label: 'South-east, by the kitchenette' },
  { id: 'floor-1', kind: 'floor', label: 'West of the elevator' },
  { id: 'floor-2', kind: 'floor', label: 'East of the elevator' },
  { id: 'floor-3', kind: 'floor', label: 'West wall, by the lounge' },
  { id: 'floor-4', kind: 'floor', label: 'North wall, east' },
  { id: 'rug-1', kind: 'rug', label: 'Under the lounge' },
  { id: 'rug-2', kind: 'rug', label: 'Under the ping-pong table' },
  { id: 'wall-1', kind: 'wall', label: 'North wall, east' },
  { id: 'wall-2', kind: 'wall', label: 'North wall, far east' },
  { id: 'wall-3', kind: 'wall', label: 'South wall, west of the elevator' },
  { id: 'wall-4', kind: 'wall', label: 'South wall, east of the elevator' },
  { id: 'wall-5', kind: 'wall', label: 'West wall, by the lounge' },
];

/** Something the shop sells into an empty spot of its kind. */
export interface ShopExtra {
  type: 'extra';
  id: string;
  name: string;
  icon: string;
  blurb: string;
  kind: Exclude<SpotKind, 'kit'>;
  /** The first one's price; each one more a floor has costs a quarter more (priceOf). */
  price: number;
}

/** A better version of a kit item, in the kit item's own spot: `item` at `tier - 1` becomes `tier`. */
export interface ShopUpgrade {
  type: 'upgrade';
  id: string;
  name: string;
  icon: string;
  blurb: string;
  item: string;
  tier: number;
  price: number;
}

export type ShopEntry = ShopExtra | ShopUpgrade;

export const SHOP: readonly ShopEntry[] = [
  { type: 'extra', id: 'vending-machine', name: 'Vending machine', icon: '🥤', blurb: 'Cans and snacks at the press of a button. The team will use it.', kind: 'big', price: 120 },
  { type: 'extra', id: 'beer-fridge', name: 'Beer fridge', icon: '🍺', blurb: 'Glass-fronted and humming. Opens after hours.', kind: 'big', price: 150 },
  { type: 'extra', id: 'sofa', name: 'Sofa', icon: '🛋️', blurb: 'A second sofa for the floor, in its colour.', kind: 'big', price: 90 },
  { type: 'extra', id: 'plant', name: 'Potted plant', icon: '🪴', blurb: 'A leafy plant in a bright pot.', kind: 'floor', price: 20 },
  { type: 'extra', id: 'fig', name: 'Fiddle-leaf fig', icon: '🌳', blurb: 'A tall indoor tree for a corner.', kind: 'floor', price: 40 },
  { type: 'extra', id: 'beanbags', name: 'Beanbags', icon: '🫘', blurb: 'Two squashy beanbags.', kind: 'floor', price: 35 },
  { type: 'extra', id: 'rug', name: 'Rug', icon: '🟫', blurb: 'A patterned rug in the floor’s colours.', kind: 'rug', price: 30 },
  { type: 'extra', id: 'poster', name: 'Repo poster', icon: '🖼️', blurb: 'Art made from this floor’s repository: its name, languages and colour. No two floors alike.', kind: 'wall', price: 30 },
  { type: 'extra', id: 'neon', name: 'Neon sign', icon: '💡', blurb: 'The repository’s name in glowing tubes.', kind: 'wall', price: 80 },
  { type: 'upgrade', id: 'espresso-machine', name: 'Espresso machine', icon: '☕', blurb: 'Swaps the coffee machine for a chrome espresso machine.', item: 'coffee-machine', tier: 2, price: 100 },
  { type: 'upgrade', id: 'tournament-table', name: 'Tournament ping-pong table', icon: '🏓', blurb: 'Swaps the ping-pong table for a tournament one.', item: 'pingpong-table', tier: 2, price: 120 },
];

export const spotOf = (id: string): ShopSpot | undefined => SHOP_SPOTS.find((s) => s.id === id);
export const shopEntry = (id: string): ShopEntry | undefined => SHOP.find((e) => e.id === id);

/** How many of `item` a floor has. */
export const ownedCount = (plan: readonly FloorItem[], item: string) => plan.filter((i) => i.item === item).length;

/** An extra's price for a floor that has `owned` of it already: a quarter more each, rounded to 5. */
export const priceOf = (base: number, owned: number) => Math.round((base * (1 + 0.25 * owned)) / 5) * 5;

/** The spots of `kind` with nothing in them, in SHOP_SPOTS's order. */
export function freeSpots(plan: readonly FloorItem[], kind: SpotKind): ShopSpot[] {
  const taken = new Set(plan.map((i) => i.spot));
  return SHOP_SPOTS.filter((s) => s.kind === kind && !taken.has(s.id));
}

/** What buying `entryId` would do: put an item in a spot at a tier, for a price; or why it can't. */
export type Purchase = { ok: true; entry: ShopEntry; spot: string; item: string; tier: number; price: number } | { ok: false; error: string };

/**
 * Whether a floor with `plan` and `coins` may buy `entryId`, into `spot` (an extra; the first free spot of its kind when
 * it's left out). An upgrade goes in its kit item's spot, one tier at a time.
 */
export function checkPurchase(plan: readonly FloorItem[], coins: number, entryId: string, spot?: string | null): Purchase {
  const entry = shopEntry(entryId);
  if (!entry) return { ok: false, error: `The shop doesn't sell "${entryId}"` };
  if (entry.type === 'upgrade') {
    const current = plan.find((i) => i.item === entry.item);
    if (!current) return { ok: false, error: `This floor has no ${entry.item.replace(/-/g, ' ')} to upgrade` };
    if (current.tier >= entry.tier) return { ok: false, error: `This floor already has the ${entry.name}` };
    if (current.tier !== entry.tier - 1) return { ok: false, error: `The ${entry.name} needs the upgrade before it first` };
    if (coins < entry.price) return { ok: false, error: `The ${entry.name} costs ${entry.price} coins; this floor has ${coins}` };
    return { ok: true, entry, spot: current.spot, item: entry.item, tier: entry.tier, price: entry.price };
  }
  const price = priceOf(entry.price, ownedCount(plan, entry.id));
  let target: ShopSpot | undefined;
  if (spot) {
    target = spotOf(spot);
    if (!target) return { ok: false, error: `There's no spot called "${spot}"` };
    if (target.kind !== entry.kind) return { ok: false, error: `A ${entry.name.toLowerCase()} doesn't go in ${target.label.toLowerCase()}` };
    if (plan.some((i) => i.spot === target!.id)) return { ok: false, error: `${target.label} already has something in it` };
  } else {
    target = freeSpots(plan, entry.kind)[0];
    if (!target) return { ok: false, error: `This floor has no room for another ${entry.name.toLowerCase()}` };
  }
  if (coins < price) return { ok: false, error: `A ${entry.name.toLowerCase()} costs ${price} coins; this floor has ${coins}` };
  return { ok: true, entry, spot: target.id, item: entry.id, tier: 1, price };
}

/** Whether an item standing in `from` may move to the empty spot `to` (the same kind, not the kit's); why not, or null. */
export function checkMove(plan: readonly FloorItem[], from: string, to: string): string | null {
  const item = plan.find((i) => i.spot === from);
  if (!item) return 'Nothing stands there';
  const a = spotOf(from);
  const b = spotOf(to);
  if (!a || !b) return `There's no spot called "${a ? to : from}"`;
  if (a.kind === 'kit' || b.kind === 'kit') return "The kit stays where it is";
  if (a.kind !== b.kind) return `That doesn't go in ${b.label.toLowerCase()}`;
  if (plan.some((i) => i.spot === to)) return `${b.label} already has something in it`;
  return null;
}

/** A floor's plan with only what the catalogue still knows (rows from an older catalogue are left out). */
export const knownItems = (plan: readonly FloorItem[]) =>
  plan.filter((i) => spotOf(i.spot) && (spotOf(i.spot)!.kind === 'kit' || SHOP.some((e) => e.type === 'extra' && e.id === i.item)));
