import { describe, expect, it } from 'vitest';
import { SHOP, SHOP_SPOTS, shopEntry, type ShopEntry } from '../../../../shared/shop';
import type { CoinEntry, FloorItem } from '../../../../shared/types';
import { ago, catalogue, chosenSpot, earnedWhy, entryView, itemLook, ledgerLines, onFloor, placedNote, shopFloor, signed, stateLabel } from './shop';

const KIT: FloorItem[] = [
  { spot: 'kitchen', item: 'coffee-machine', tier: 1, since: 0 },
  { spot: 'kitchen-fridge', item: 'fridge', tier: 1, since: 0 },
  { spot: 'lounge', item: 'couch', tier: 1, since: 0 },
  { spot: 'games', item: 'pingpong-table', tier: 1, since: 0 },
  { spot: 'north-wall', item: 'whiteboard', tier: 1, since: 0 },
  { spot: 'gong-corner', item: 'gong', tier: 1, since: 0 },
];
const at = (spot: string, item: string, tier = 1): FloorItem => ({ spot, item, tier, since: 1 });
const entry = (id: string) => shopEntry(id) as ShopEntry;

describe('shopFloor', () => {
  const floors = [
    { id: 'demo/a', floor: 1 },
    { id: 'demo/b', floor: 2 },
  ];

  it('opens on the floor asked for, else the one you are on, else the first', () => {
    expect(shopFloor(floors, 'demo/b', 1)?.id).toBe('demo/b');
    expect(shopFloor(floors, undefined, 2)?.id).toBe('demo/b');
    expect(shopFloor(floors, 'gone/repo', 0)?.id).toBe('demo/a'); // from the lobby
    expect(shopFloor([], undefined, 1)).toBeUndefined();
  });
});

describe('catalogue', () => {
  it('groups every entry once, in the panel order, with the spots a floor has', () => {
    const groups = catalogue();
    expect(groups.map((g) => g.title)).toEqual(['Big things', 'Small things', 'Rugs', 'Wall art', 'Upgrades']);
    expect(groups.flatMap((g) => g.entries).length).toBe(SHOP.length);
    expect(groups[0].entries.map((e) => e.id)).toContain('vending-machine');
    expect(groups[0].hint).toBe(`${SHOP_SPOTS.filter((s) => s.kind === 'big').length} spots on each floor`);
    expect(groups[4].entries.every((e) => e.type === 'upgrade')).toBe(true);
  });
});

describe('entryView', () => {
  it('sells an extra into its free spots at its price', () => {
    const v = entryView(entry('vending-machine'), KIT, 500);
    expect(v.state).toEqual({ kind: 'buy' });
    expect(v.price).toBe(120);
    expect(v.owned).toBe(0);
    expect(v.spots.map((s) => s.id)).toEqual(['big-1', 'big-2', 'big-3']);
  });

  it('charges more for each one the floor has', () => {
    const v = entryView(entry('plant'), [...KIT, at('floor-1', 'plant')], 500);
    expect(v.owned).toBe(1);
    expect(v.price).toBe(25);
    expect(v.spots.map((s) => s.id)).toEqual(['floor-2', 'floor-3', 'floor-4']);
  });

  it('says when there is no room, before saying it is too dear', () => {
    const full = [...KIT, at('rug-1', 'rug'), at('rug-2', 'rug')];
    expect(entryView(entry('rug'), full, 0).state).toEqual({ kind: 'full' });
    expect(entryView(entry('neon'), KIT, 50).state).toEqual({ kind: 'poor', need: 30 });
  });

  it('walks an upgrade through its tiers', () => {
    const espresso = entry('espresso-machine');
    expect(entryView(espresso, KIT, 100).state).toEqual({ kind: 'buy' });
    expect(entryView(espresso, KIT, 99).state).toEqual({ kind: 'poor', need: 1 });
    const upgraded = KIT.map((i) => (i.item === 'coffee-machine' ? { ...i, tier: 2 } : i));
    expect(entryView(espresso, upgraded, 0)).toMatchObject({ state: { kind: 'owned' }, owned: 1 });
    expect(entryView(espresso, KIT.filter((i) => i.item !== 'coffee-machine'), 500).state).toEqual({ kind: 'missing', item: 'Coffee machine' });
  });

  it('wants the tier before an upgrade first', () => {
    const third: ShopEntry = { type: 'upgrade', id: 'gold-espresso', name: 'Gold espresso machine', icon: '🏆', blurb: '', item: 'coffee-machine', tier: 3, price: 300 };
    expect(entryView(third, KIT, 1000).state).toEqual({ kind: 'needs', first: 'Espresso machine' });
  });
});

describe('stateLabel', () => {
  it('words every state', () => {
    expect(stateLabel({ kind: 'buy' })).toBe('Buy');
    expect(stateLabel({ kind: 'full' })).toBe('No room');
    expect(stateLabel({ kind: 'poor', need: 30 })).toBe('Need 30 more coins');
    expect(stateLabel({ kind: 'poor', need: 1 })).toBe('Need 1 more coin');
    expect(stateLabel({ kind: 'owned' })).toBe('Owned');
    expect(stateLabel({ kind: 'needs', first: 'Espresso machine' })).toBe('Needs the espresso machine first');
    expect(stateLabel({ kind: 'missing', item: 'Coffee machine' })).toBe('No coffee machine here to upgrade');
  });
});

describe('chosenSpot', () => {
  const spots = SHOP_SPOTS.filter((s) => s.kind === 'big');
  it('keeps the pick while it is free, else takes the first free spot', () => {
    expect(chosenSpot(spots, 'big-2')).toBe('big-2');
    expect(chosenSpot(spots, undefined)).toBe('big-1');
    expect(chosenSpot(spots.slice(1), 'big-1')).toBe('big-2');
    expect(chosenSpot([], 'big-1')).toBeUndefined();
  });
});

describe('itemLook and onFloor', () => {
  it('names the kit, its upgrades and what was bought', () => {
    expect(itemLook('coffee-machine', 1, true)).toEqual({ name: 'Coffee machine', icon: '☕' });
    expect(itemLook('coffee-machine', 2, true)).toEqual({ name: 'Espresso machine', icon: '☕' });
    expect(itemLook('couch', 1, true).name).toBe('Couch');
    expect(itemLook('vending-machine', 1, false)).toEqual({ name: 'Vending machine', icon: '🥤' });
    expect(itemLook('mystery-box', 1, false).name).toBe('Mystery box');
  });

  it('lists the floor in spot order, the kit staying put and the rest movable to free spots of their kind', () => {
    const plan = [at('big-2', 'vending-machine'), ...KIT.map((i) => (i.item === 'pingpong-table' ? { ...i, tier: 2 } : i)), at('wall-1', 'poster'), at('nowhere', 'plant'), at('floor-1', 'old-thing')];
    const placed = onFloor(plan);
    expect(placed.map((p) => p.spot.id)).toEqual(['kitchen', 'kitchen-fridge', 'lounge', 'games', 'north-wall', 'gong-corner', 'big-2', 'wall-1']);
    expect(placed.find((p) => p.spot.id === 'games')).toMatchObject({ name: 'Tournament ping-pong table', kit: true, moves: [] });
    const vending = placed.find((p) => p.spot.id === 'big-2')!;
    expect(vending.kit).toBe(false);
    expect(vending.moves.map((s) => s.id)).toEqual(['big-1', 'big-3']);
    expect(placed.find((p) => p.spot.id === 'wall-1')!.moves.map((s) => s.id)).toEqual(['wall-2', 'wall-3', 'wall-4', 'wall-5']);
  });

  it('says what went where', () => {
    expect(placedNote({ name: 'Vending machine', icon: '🥤' }, 'North-east corner')).toBe('🥤 Vending machine is in place: north-east corner');
    expect(placedNote({ name: 'Rug', icon: '🟫' }, 'Under the lounge', true)).toBe('🟫 Rug moved to under the lounge');
  });
});

describe('the ledger', () => {
  const now = 10_000_000;
  const line = (id: number, floorId: string, amount: number, reason: CoinEntry['reason'], detail: string, ageMs: number): CoinEntry => ({ id, floorId, amount, reason, detail, prNumber: null, at: now - ageMs });

  it('signs coins with a real minus', () => {
    expect(signed(10)).toBe('+10');
    expect(signed(-120)).toBe('−120');
    expect(signed(0)).toBe('0');
  });

  it('says roughly how long ago', () => {
    expect(ago(now - 5_000, now)).toBe('just now');
    expect(ago(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(ago(now - 26 * 3_600_000, now)).toBe('yesterday');
    expect(ago(now - 4 * 86_400_000, now)).toBe('4 days ago');
    expect(ago(now + 1000, now)).toBe('just now'); // a clock a little ahead
  });

  it("keeps the floor's own lines, newest first as they come, up to the limit", () => {
    const recent = [line(3, 'demo/a', -120, 'purchase', 'Vending machine', 60_000), line(2, 'demo/b', 10, 'merge', 'PR #4 merged', 70_000), line(1, 'demo/a', 10, 'merge', 'PR #12 merged', 120_000)];
    const lines = ledgerLines(recent, 'demo/a', now);
    expect(lines.map((l) => `${l.amount} ${l.text}`)).toEqual(['−120 Vending machine', '+10 PR #12 merged']);
    expect(lines[0]).toMatchObject({ icon: '🛍️', earned: false, when: '1 min ago' });
    expect(lines[1]).toMatchObject({ icon: '🔀', earned: true });
    expect(ledgerLines(recent, 'demo/a', now, 1)).toHaveLength(1);
  });

  it('puts what a floor earned into words', () => {
    expect(earnedWhy(['PR #12 merged', 'clean QA pass'], 12)).toBe('PR #12 merged, clean QA pass');
    expect(earnedWhy(['merge', 'clean-qa', 'fixed'], 12)).toBe('PR #12 merged, clean QA pass, fixed after QA');
    expect(earnedWhy([], null)).toBe('');
  });
});
