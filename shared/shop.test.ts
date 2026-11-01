import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT } from '../server/db/floorPlans.ts';
import { checkMove, checkPurchase, freeSpots, knownItems, priceOf, resettle, SHOP, SHOP_SPOTS } from './shop.ts';
import type { FloorItem } from './types.ts';

const item = (spot: string, name: string, tier = 1): FloorItem => ({ spot, item: name, tier, since: 0 });
const KIT: FloorItem[] = DEFAULT_KIT.map((k) => item(k.spot, k.item));
const withKit = (...extra: FloorItem[]) => [...KIT, ...extra];

describe('the catalogue', () => {
  it('has unique ids, and unique spot ids', () => {
    expect(new Set(SHOP.map((e) => e.id)).size).toBe(SHOP.length);
    expect(new Set(SHOP_SPOTS.map((s) => s.id)).size).toBe(SHOP_SPOTS.length);
  });

  it('has spots for every kind of extra it sells', () => {
    for (const e of SHOP) if (e.type === 'extra') expect(SHOP_SPOTS.some((s) => s.kind === e.kind), e.id).toBe(true);
  });

  it("has the kit's spots as its kit spots, and upgrades only kit items, one tier after another", () => {
    expect(SHOP_SPOTS.filter((s) => s.kind === 'kit').map((s) => s.id).sort()).toEqual(DEFAULT_KIT.map((k) => k.spot).sort());
    for (const e of SHOP) {
      if (e.type !== 'upgrade') continue;
      expect(DEFAULT_KIT.map((k) => k.item), e.id).toContain(e.item);
      expect(e.tier, e.id).toBeGreaterThanOrEqual(2);
      if (e.tier > 2) expect(SHOP.some((u) => u.type === 'upgrade' && u.item === e.item && u.tier === e.tier - 1), e.id).toBe(true);
    }
  });

  it('prices each one more a floor has a quarter dearer, rounded to 5', () => {
    expect(priceOf(20, 0)).toBe(20);
    expect(priceOf(20, 1)).toBe(25);
    expect(priceOf(30, 1)).toBe(40); // 37.5
    expect(priceOf(35, 1)).toBe(45); // 43.75
    expect(priceOf(120, 2)).toBe(180);
  });
});

describe('checkPurchase', () => {
  it('puts an extra in the first free spot of its kind, at tier 1, for its price', () => {
    expect(checkPurchase(KIT, 100, 'plant')).toMatchObject({ ok: true, spot: 'floor-1', item: 'plant', tier: 1, price: 20 });
    expect(freeSpots(withKit(item('floor-1', 'plant')), 'floor')[0].id).toBe('floor-2');
    expect(checkPurchase(withKit(item('floor-1', 'plant')), 100, 'plant')).toMatchObject({ ok: true, spot: 'floor-2', price: 25 });
  });

  it('puts it in the spot picked, when that spot is free and of its kind', () => {
    expect(checkPurchase(KIT, 100, 'plant', 'floor-3')).toMatchObject({ ok: true, spot: 'floor-3' });
    expect(checkPurchase(KIT, 100, 'plant', 'wall-1')).toEqual({ ok: false, error: "The potted plant can't go in north wall, east" });
    expect(checkPurchase(withKit(item('floor-3', 'fig')), 100, 'plant', 'floor-3')).toEqual({ ok: false, error: 'West wall, by the lounge already has something in it' });
    expect(checkPurchase(KIT, 100, 'plant', 'kitchen')).toMatchObject({ ok: false });
    expect(checkPurchase(KIT, 100, 'plant', 'roof')).toEqual({ ok: false, error: 'There\'s no spot called "roof"' });
  });

  it('refuses an extra with no room left for it, or too few coins', () => {
    const full = withKit(item('rug-1', 'rug'), item('rug-2', 'rug'));
    expect(checkPurchase(full, 1000, 'rug')).toEqual({ ok: false, error: 'No spot left on this floor for the rug' });
    expect(checkPurchase(KIT, 100, 'vending-machine')).toEqual({ ok: false, error: 'Vending machine: 120 coins, and this floor has 100' });
    expect(checkPurchase(KIT, 120, 'vending-machine')).toMatchObject({ ok: true, spot: 'big-1', price: 120 });
  });

  it("upgrades a kit item in its own spot, one tier at a time, once", () => {
    expect(checkPurchase(KIT, 100, 'espresso-machine')).toMatchObject({ ok: true, spot: 'kitchen', item: 'coffee-machine', tier: 2, price: 100 });
    expect(checkPurchase(KIT, 99, 'espresso-machine')).toEqual({ ok: false, error: 'Espresso machine: 100 coins, and this floor has 99' });
    const upgraded = KIT.map((i) => (i.item === 'coffee-machine' ? { ...i, tier: 2 } : i));
    expect(checkPurchase(upgraded, 1000, 'espresso-machine')).toEqual({ ok: false, error: 'This floor already has the espresso machine' });
    expect(checkPurchase(KIT.filter((i) => i.item !== 'coffee-machine'), 1000, 'espresso-machine')).toEqual({ ok: false, error: 'This floor has no coffee machine to upgrade' });
    // the catalogue's upgrades are all tier 2 for now: a kit item below tier 1 stands in for a missing tier
    const below = KIT.map((i) => (i.item === 'coffee-machine' ? { ...i, tier: 0 } : i));
    expect(checkPurchase(below, 1000, 'espresso-machine')).toEqual({ ok: false, error: 'The espresso machine needs the upgrade before it first' });
  });

  it("refuses what the shop doesn't sell", () => {
    expect(checkPurchase(KIT, 1000, 'jacuzzi')).toEqual({ ok: false, error: 'The shop doesn\'t sell "jacuzzi"' });
    expect(checkPurchase(KIT, 1000, 'coffee-machine')).toMatchObject({ ok: false });
  });
});

describe('checkMove', () => {
  const plan = withKit(item('floor-1', 'plant'), item('floor-2', 'fig'), item('wall-1', 'poster'));

  it('moves an extra to an empty spot of its kind', () => {
    expect(checkMove(plan, 'floor-1', 'floor-3')).toBeNull();
    expect(checkMove(plan, 'wall-1', 'wall-5')).toBeNull();
  });

  it("refuses an empty spot, a spot that isn't one, the kit, another kind, or a spot that's taken", () => {
    expect(checkMove(plan, 'floor-4', 'floor-3')).toBe('Nothing stands there');
    expect(checkMove(plan, 'floor-1', 'attic')).toBe('There\'s no spot called "attic"');
    expect(checkMove(plan, 'kitchen', 'big-1')).toBe('The kit stays where it is');
    expect(checkMove(plan, 'floor-1', 'wall-2')).toBe("That doesn't go in north wall, far east");
    expect(checkMove(plan, 'floor-1', 'floor-2')).toBe('East of the elevator already has something in it');
  });
});

describe('knownItems', () => {
  it("keeps the kit's spots and the extras the catalogue sells, and leaves out an older catalogue's rows", () => {
    expect(knownItems(withKit(item('floor-1', 'plant'), item('floor-2', 'lava-lamp'), item('balcony', 'plant')))).toEqual(withKit(item('floor-1', 'plant')));
    // a kit spot keeps whatever stands in it: the game draws the kit by its spot
    expect(knownItems([item('kitchen', 'samovar')])).toEqual([item('kitchen', 'samovar')]);
  });

  it('leaves out an extra standing in a kind of spot it no longer goes in (the beanbags before they grew)', () => {
    expect(knownItems(withKit(item('floor-3', 'beanbags'), item('big-2', 'beanbags')))).toEqual(withKit(item('big-2', 'beanbags')));
  });
});

describe('the games and the bigger beanbags', () => {
  it('sells the beanbags and the hoop for a big spot and the dartboard for a wall', () => {
    expect(checkPurchase(KIT, 1000, 'beanbags')).toMatchObject({ ok: true, spot: 'big-1', price: 60 });
    expect(checkPurchase(KIT, 1000, 'beanbags', 'floor-1')).toEqual({ ok: false, error: "The beanbags can't go in west of the elevator" });
    expect(checkPurchase(KIT, 1000, 'hoop', 'big-3')).toMatchObject({ ok: true, spot: 'big-3', item: 'hoop', price: 110 });
    expect(checkPurchase(KIT, 1000, 'dartboard')).toMatchObject({ ok: true, spot: 'wall-1', price: 45 });
    expect(checkPurchase(KIT, 1000, 'dartboard', 'big-1')).toMatchObject({ ok: false });
    const full = withKit(item('big-1', 'vending-machine'), item('big-2', 'sofa'), item('big-3', 'hoop'));
    expect(checkPurchase(full, 1000, 'beanbags')).toEqual({ ok: false, error: 'No spot left on this floor for the beanbags' });
    expect(checkMove(withKit(item('big-1', 'beanbags')), 'big-1', 'floor-2')).toBe("That doesn't go in east of the elevator");
    expect(checkMove(withKit(item('big-1', 'beanbags')), 'big-1', 'big-3')).toBeNull();
  });
});

describe('resettle', () => {
  const at = (spot: string, name: string, since: number): FloorItem => ({ spot, item: name, tier: 1, since });

  it('leaves a plan where everything fits alone', () => {
    expect(resettle(withKit(item('big-1', 'beanbags'), item('floor-1', 'plant')))).toEqual({ moves: [], refunds: [] });
  });

  it('moves beanbags from a small spot to the first free big one, oldest first, and refunds the ones with no room', () => {
    const plan = withKit(at('floor-3', 'beanbags', 20), at('floor-1', 'beanbags', 10), at('big-1', 'vending-machine', 5), at('floor-4', 'beanbags', 30), at('big-3', 'sofa', 1));
    expect(resettle(plan)).toEqual({
      moves: [{ from: 'floor-1', to: 'big-2', item: 'beanbags' }],
      refunds: [
        { spot: 'floor-3', item: 'beanbags' },
        { spot: 'floor-4', item: 'beanbags' },
      ],
    });
  });

  it("moves into a spot holding a row the catalogue forgot, and never onto something it still sells", () => {
    const plan = withKit(at('floor-2', 'beanbags', 1), at('big-1', 'lava-lamp', 0), at('big-2', 'hoop', 0), at('big-3', 'beer-fridge', 0));
    expect(resettle(plan)).toEqual({ moves: [{ from: 'floor-2', to: 'big-1', item: 'beanbags' }], refunds: [] });
    // what it leaves the plan with fits: knownItems keeps all of it
    const after = plan.map((i) => (i.spot === 'floor-2' ? { ...i, spot: 'big-1' } : i)).filter((i) => i.item !== 'lava-lamp');
    expect(knownItems(after)).toEqual(after);
  });
});
