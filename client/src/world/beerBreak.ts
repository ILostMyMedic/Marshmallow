// A beer after hours, as pure decisions: once the office clock says evening or night, a free worker on a floor with a
// beer fridge goes for a bottle (one at its door at a time, never while the player stands at it), opens the glass
// door, takes one out and shuts it, then stands by the fridge; when a second one has joined them, they clink bottles
// for a 🍻, and both drink theirs in a few sips and a chat before heading back. BeerBreak is the errand's actor (errands.ts `act`); the fridge, hands and sounds
// come in through BeerWorld, so it's tested without a scene. beerErrand.ts wires it up. New in Marshmallow.

import type { Gesture } from './body';
import { leaveSeat, pickSeat } from './coffeeBreak';
import { SUNRISE_T, SUNSET_T } from './dayTime';
import type { ActStep, ErrandActor } from './errands';
import type { SnackCue, SnackId } from './fridge';
import type { HeldSnack } from './snackBreak';
import { Eating } from './vendingBreak';

export const BEER = {
  /** A couple at a time: the one who fancied it, and one who comes to join them. */
  max: 2,
  /** The slice of restless moments (fanciesCoffee's number) that fancy a beer, after hours: after the vending machine's. */
  share: [0.62, 0.86] as const,
  /** Waiting for the door this long (s): give up and go back. */
  wait: 30,
  /** Opening the door, taking a bottle, shutting it (s). */
  reach: 0.7,
  pick: 1.0,
  close: 0.6,
  /** How long the first one waits by the fridge for company before starting on theirs (s); a late one still gets a clink. */
  company: 25,
  /** The clink. */
  cheers: 2.2,
  /** Sips in a bottle. */
  sips: 3,
};

/** The bottle in hand: drawn as fridge.ts's brown bottle (SnackLook), with a beer's sounds. */
export const BOTTLE: SnackId = 'coldbrew';
const SOUNDS = { open: 'twist', sip: 'slurp', last: 'glug', after: 'ahh' } as const satisfies Record<string, SnackCue>;

/** Evening or night by the office clock (dayTime.ts t): from sunset until sunrise. 'day' mode never gets there. */
export const afterHours = (t: number) => t >= SUNSET_T || t < SUNRISE_T;

/** Does this person fancy a beer (when it's after hours)? Their restless moment's number falls in its slice. */
export function fanciesBeer(restless: number, share: readonly [number, number] = BEER.share) {
  const f = (restless * 97.31) % 1;
  return f >= share[0] && f < share[1];
}

/** What a beer needs from the world. */
export interface BeerWorld {
  /** The fridge's spots (walkways.ts): its door, where to wait, and the two to stand and drink at, face to face. */
  spots: { front: string; line: readonly string[]; eat: readonly string[] };
  /** The player stands at it: they go first (left out: never). */
  playerBusy?(): boolean;
  /** Takes the door (one at a time; true when it's theirs), and lets go of it. */
  claim(who: string): boolean;
  release(who: string): void;
  isOpen(): boolean;
  open(who: string): void;
  close(who: string): void;
  /** A bottle comes off the shelf. */
  take(who: string): void;
  hold(who: string, snack: HeldSnack | null): void;
  sound(who: string, cue: SnackCue): void;
  say(who: string, text: string | null): void;
  /** Who waits where and who stands where (spot → who), and who's at their spot with a bottle, ready to clink. */
  line: Map<string, string>;
  seats: Map<string, string>;
  ready: Set<string>;
}

export type BeerStage = 'wait' | 'door' | 'pick' | 'close' | 'gather' | 'cheers' | 'drink' | 'done';

/** One person's beer, from the place to wait by the fridge (the errand's spot) until they set off home. */
export class BeerBreak implements ErrandActor {
  stage: BeerStage = 'wait';
  held: HeldSnack | null = null;
  private busy: { until: number; gesture: Gesture; then: () => void } | null = null;
  private waitAt: number | null = null;
  private gatherAt: number | null = null;
  private drinking: Eating | null = null;
  private cheered = false;
  private target: string;
  private there = false;

  constructor(
    readonly id: string,
    private world: BeerWorld,
    private rand: () => number = Math.random,
  ) {
    this.target = world.spots.line[0];
  }

  get carry(): Gesture {
    return this.held ? 'hold' : 'none';
  }

  /** Whoever else is at the other spot with a bottle. */
  get buddy(): string | null {
    for (const id of this.world.ready) if (id !== this.id) return id;
    return null;
  }

  private walk(spot: string): ActStep {
    if (!this.world.spots.line.includes(spot)) leaveSeat(this.world.line, this.id);
    if (spot !== this.target) this.there = false;
    this.target = spot;
    return { walk: spot, gesture: this.held ? 'hold' : 'none' };
  }

  private at(spot: string) {
    return this.there && this.target === spot;
  }

  private act(now: number, seconds: number, gesture: Gesture, then: () => void): ActStep {
    this.busy = { until: now + seconds, gesture, then };
    return { stand: gesture };
  }

  private holding(s: HeldSnack | null) {
    this.held = s;
    this.world.hold(this.id, s);
  }

  private letGo() {
    const w = this.world;
    w.release(this.id);
    w.ready.delete(this.id);
    leaveSeat(w.line, this.id);
    leaveSeat(w.seats, this.id);
  }

  private quit(): ActStep {
    this.letGo();
    this.stage = 'done';
    return 'done';
  }

  private sip() {
    const h = this.held;
    if (!h) return;
    if (h.left <= 1) {
      this.world.sound(this.id, SOUNDS.last);
      this.world.sound(this.id, SOUNDS.after);
      return this.holding(null);
    }
    this.world.sound(this.id, SOUNDS.sip);
    this.holding({ ...h, left: h.left - 1 });
  }

  /** Bottles up with whoever joined them, then drink (opening theirs first unless it's open already). */
  private cheers(now: number, open: boolean): ActStep {
    this.cheered = true;
    this.stage = 'cheers';
    this.world.say(this.id, '🍻');
    if (open) this.world.sound(this.id, SOUNDS.open);
    return this.act(now, BEER.cheers, 'cheer', () => {
      this.stage = 'drink';
    });
  }

  step(now: number, arrived: boolean): ActStep {
    const w = this.world;
    this.there = arrived;
    if (this.busy) {
      if (now < this.busy.until) return { stand: this.busy.gesture };
      const then = this.busy.then;
      this.busy = null;
      then();
    }
    switch (this.stage) {
      case 'wait': {
        this.waitAt ??= now;
        if (!w.playerBusy?.() && w.claim(this.id)) {
          this.stage = 'door';
          return this.walk(w.spots.front);
        }
        if (now - this.waitAt > BEER.wait) return this.quit();
        const spot = pickSeat(w.line, this.id, w.spots.line) ?? w.spots.line[0];
        if (!this.at(spot)) return this.walk(spot);
        return { stand: 'none' };
      }
      case 'door':
        if (!this.at(w.spots.front)) return this.walk(w.spots.front);
        // the player came up meanwhile: they go first
        if (w.playerBusy?.()) {
          w.release(this.id);
          this.stage = 'wait';
          return this.walk(pickSeat(w.line, this.id, w.spots.line) ?? w.spots.line[0]);
        }
        if (w.isOpen()) {
          this.stage = 'pick';
          return this.step(now, true);
        }
        return this.act(now, BEER.reach, 'reach', () => {
          w.open(this.id);
          this.stage = 'pick';
        });
      case 'pick':
        return this.act(now, BEER.pick, 'reach', () => {
          w.take(this.id);
          this.holding({ snack: BOTTLE, left: BEER.sips });
          w.say(this.id, '🍺');
          this.stage = 'close';
        });
      case 'close':
        return this.act(now, BEER.close, 'tap', () => {
          w.close(this.id);
          w.release(this.id);
          this.stage = 'gather';
        });
      case 'gather': {
        const seat = pickSeat(w.seats, this.id, w.spots.eat);
        if (!seat) {
          // both spots taken: have it at the desk
          this.letGo();
          this.stage = 'done';
          return 'done';
        }
        if (!this.at(seat)) return this.walk(seat);
        this.gatherAt ??= now;
        w.ready.add(this.id);
        if (this.buddy) return this.cheers(now, true);
        if (now - this.gatherAt > BEER.company) {
          this.stage = 'drink';
          w.sound(this.id, SOUNDS.open);
          return { stand: 'none' };
        }
        return { stand: 'none' };
      }
      case 'cheers':
        return { stand: 'cheer' };
      case 'drink': {
        if (!this.held && !this.drinking) return this.quit();
        // company came while they'd started on theirs
        if (!this.cheered && this.held && this.buddy) return this.cheers(now, false);
        this.drinking ??= new Eating(this.held!.left, this.rand(), () => this.sip());
        const g = this.drinking.step(now);
        return g ? { stand: g } : this.quit();
      }
      case 'done':
        return this.quit();
    }
  }

  /** Work came in: the bottle comes along, the door shuts behind them. */
  abort() {
    if (this.stage === 'pick' || this.stage === 'close' || this.stage === 'door') this.world.close(this.id);
    this.letGo();
    this.busy = null;
    this.stage = 'done';
  }

  /** Back in their chair (`seated`), or the floor was left: the bottle's gone. */
  end() {
    this.abort();
    if (this.held) this.holding(null);
    this.world.say(this.id, null);
  }
}
