// You at a floor's vending machine or beer fridge, as pure rules: what E says on each, whether it's yours to use now
// (hands free, nobody else at it, the beer fridge only after hours) and what ends up in your hands. playerMachines.ts
// runs them on the machine on screen; the workers' trips (vendingBreak.ts, beerBreak.ts) share the machine's claim, so
// you and a worker never use one at once. Pure, so it's tested. New in Marshmallow.
import { BEER, BOTTLE } from '../beerBreak';
import { SNACKS, type SnackId } from '../fridge';
import { VEND_SNACKS } from '../vendingBreak';
import type { Held } from '../view';
import type { MachineKind } from './machines';

/** Who you are, as a machine's claim knows you. */
export const PLAYER = 'player';

/**
 * How long each step takes (s): at the vending machine, the buttons before it drops and when it's in your hands (its
 * drop is VendingMachine.tsx's animation, into the tray); at the beer fridge, the bottle out and the door shut again.
 */
export const USE = { vending: { press: 0.9, take: 2.3 }, beer: { take: 0.7, shut: 1.4 } };

/** What E on it says: the beer fridge says it's shut until after hours. */
export const machineLabel = (kind: MachineKind, open: boolean) => (kind === 'vending' ? 'Get a snack from the vending machine' : open ? 'Grab a beer' : 'The beer fridge opens after hours');

/** The emoji of what you hold: a beer's is a beer's, though it looks like the fridge's cold brew. */
export const heldEmoji = (h: Extract<Held, { kind: 'snack' }>) => (h.beer ? '🍺' : SNACKS[h.snack].emoji);

/**
 * Why E on it gives you nothing now (said in a passing note), or null when it's yours to use: the beer fridge only
 * after hours (`open`), your hands free, and nobody else at it (`user`, a worker's id, and `userName`, theirs).
 */
export function refusal(kind: MachineKind, o: { held: Held | null; user: string | null; userName?: string | null; open: boolean }): string | null {
  if (kind === 'beer' && !o.open) return '🕔 Not yet: the beer fridge opens after hours';
  if (o.held) return o.held.kind === 'snack' ? `${heldEmoji(o.held)} One at a time: finish that one first (E)` : '🙌 Your hands are full';
  if (o.user !== null && o.user !== PLAYER) return `⏳ ${o.userName || 'Someone'} is using it: one at a time`;
  return null;
}

/** What the vending machine gives you: one of its cans or bars, any of them (`rand` in [0, 1)). */
export const vendFor = (rand: number): SnackId => VEND_SNACKS[Math.min(VEND_SNACKS.length - 1, Math.max(0, Math.floor(rand * VEND_SNACKS.length)))];

/** What ends up in your hands: the snack out of the vending machine, or a beer (the brown bottle, in a few sips). */
export function heldFrom(kind: MachineKind, snack: SnackId, seq: number): Held {
  if (kind === 'beer') return { kind: 'snack', id: `beer-player-${seq}`, snack: BOTTLE, left: BEER.sips, beer: true };
  return { kind: 'snack', id: `snack-player-v${seq}`, snack, left: SNACKS[snack].portions };
}
