// New in Marshmallow.
import { describe, expect, it } from 'vitest';
import { BOTTLE } from '../beerBreak';
import { SNACKS } from '../fridge';
import { VEND_SNACKS } from '../vendingBreak';
import { heldEmoji, heldFrom, machineLabel, PLAYER, refusal, USE, vendFor } from './machineRules';

describe('E on a machine', () => {
  it('says what it does, the beer fridge that it opens after hours', () => {
    expect(machineLabel('vending', false)).toBe('Get a snack from the vending machine');
    expect(machineLabel('beer', true)).toBe('Grab a beer');
    expect(machineLabel('beer', false)).toBe('The beer fridge opens after hours');
  });

  it('is yours with your hands free and nobody else at it', () => {
    expect(refusal('vending', { held: null, user: null, open: true })).toBeNull();
    expect(refusal('beer', { held: null, user: null, open: true })).toBeNull();
    expect(refusal('vending', { held: null, user: PLAYER, open: true })).toBeNull();
  });

  it('keeps the beer fridge shut in the daytime, whatever else', () => {
    expect(refusal('beer', { held: null, user: null, open: false })).toBe('🕔 Not yet: the beer fridge opens after hours');
    expect(refusal('vending', { held: null, user: null, open: false })).toBeNull();
  });

  it('wants your hands free, as the mugs and the fridge do', () => {
    expect(refusal('vending', { held: { kind: 'mug', id: 'm', sips: 2 }, user: null, open: true })).toBe('🙌 Your hands are full');
    expect(refusal('beer', { held: { kind: 'snack', id: 's', snack: 'chocolate', left: 2 }, user: null, open: true })).toBe('🍫 One at a time: finish that one first (E)');
    expect(refusal('vending', { held: heldFrom('beer', BOTTLE, 1), user: null, open: true })).toBe('🍺 One at a time: finish that one first (E)');
  });

  it("waits for a worker who's at it", () => {
    expect(refusal('vending', { held: null, user: 'w1', userName: 'Ada', open: true })).toBe('⏳ Ada is using it: one at a time');
    expect(refusal('beer', { held: null, user: 'w1', open: true })).toBe('⏳ Someone is using it: one at a time');
  });
});

describe('what you get', () => {
  it("is one of the vending machine's cans or bars, each of them now and then", () => {
    const got = new Set([0, 0.2, 0.3, 0.55, 0.8, 0.999, 1].map(vendFor));
    expect([...got].sort()).toEqual([...VEND_SNACKS].sort());
  });

  it("goes into your hands whole: a snack in its bites, a beer as the fridge's brown bottle", () => {
    expect(heldFrom('vending', 'overclock', 3)).toEqual({ kind: 'snack', id: 'snack-player-v3', snack: 'overclock', left: SNACKS.overclock.portions });
    const beer = heldFrom('beer', 'overclock', 4);
    expect(beer).toMatchObject({ kind: 'snack', snack: BOTTLE, beer: true });
    expect(beer.kind === 'snack' && heldEmoji(beer)).toBe('🍺');
  });

  it('drops the snack before it lands in your hands, and shuts the beer door after the bottle is out', () => {
    expect(USE.vending.take).toBeGreaterThan(USE.vending.press + 1);
    expect(USE.beer.shut).toBeGreaterThan(USE.beer.take);
  });
});
