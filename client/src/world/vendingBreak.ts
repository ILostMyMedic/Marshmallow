// A trip to the vending machine, as pure decisions: a free, restless worker on a floor that bought one waits their turn
// (one at the machine at a time, never while the player stands at it), presses the buttons, watches their can or bar
// drop, stoops for it at the tray, then has it by the machine in a few sips or bites, or takes it back to their desk.
// VendBreak is the errand's actor (errands.ts `act`); the machine, hands and sounds come in through VendWorld, so it's
// tested without a scene. vendingErrand.ts wires it to the machine on screen. New in Marshmallow, after snackBreak.ts.

import type { Gesture } from './body';
import { leaveSeat, pickSeat } from './coffeeBreak';
import type { ActStep, ErrandActor } from './errands';
import { SNACKS, type SnackCue, type SnackId } from './fridge';
import { eatPlan, type EatStep, type HeldSnack } from './snackBreak';

export const VEND = {
  /** At most this many on a trip to the machine per floor at once (one at it, one waiting). */
  max: 2,
  /**
   * The slice of restless moments (the number fanciesCoffee and fanciesSnack read) that go to the machine: the top of
   * the fridge's slice (0.25-0.47) and the next after it, so a floor with a machine goes to the fridge a little less.
   */
  share: [0.38, 0.62] as const,
  /** Waiting for the machine this long (s): give up and go back. */
  wait: 30,
  /** Pressing the buttons, watching it drop, and stooping to the tray (s). */
  press: 1.4,
  drop: 1.1,
  take: 0.9,
  /** The share who have it by the machine; the rest take it back to their desk. */
  stay: 0.55,
};

/** What the machine sells (fridge.ts's snacks, so they're held and eaten the same way). */
export const VEND_SNACKS: readonly SnackId[] = ['overclock', 'sparkling', 'chocolate', 'protein'];

/** Does this person fancy the vending machine now? Their restless moment's number falls in its slice. */
export function fanciesVending(restless: number, share: readonly [number, number] = VEND.share) {
  const f = (restless * 97.31) % 1;
  return f >= share[0] && f < share[1];
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

/** What someone gets: their usual (by their id) most times, something else now and then. `rand` in [0, 1). */
export function vendPick(id: string, rand: number): SnackId {
  const n = VEND_SNACKS.length;
  const usual = hash(id) % n;
  if (rand < 0.7) return VEND_SNACKS[usual];
  return VEND_SNACKS[(usual + 1 + Math.floor(((rand - 0.7) / 0.3) * (n - 1))) % n];
}

/**
 * Having a snack or a drink where they stand: a sip or a bite, a chat, and so on (snackBreak.ts eatPlan), the sip or
 * bite coming off halfway through its step. `bite` takes it off; `starting` hears each bite's step begin.
 */
export class Eating {
  private steps: EatStep[];
  private i = -1;
  private until = 0;
  private biteAt = Infinity;

  constructor(
    left: number,
    rand: number,
    private bite: () => void,
    private starting: () => void = () => undefined,
  ) {
    this.steps = eatPlan(left, rand);
  }

  /** What they do now; null once it's all gone and they've paused after the last. */
  step(now: number): Gesture | null {
    if (now >= this.biteAt) {
      this.biteAt = Infinity;
      this.bite();
    }
    if (this.i >= 0 && now < this.until) return this.steps[this.i].gesture;
    this.i++;
    const s = this.steps[this.i];
    if (!s) return null;
    this.until = now + s.seconds;
    if (s.bite) {
      this.biteAt = now + s.seconds / 2;
      this.starting();
    }
    return s.gesture;
  }
}

/** What a trip to the machine needs from the world. */
export interface VendWorld {
  /** The machine's spots (walkways.ts): in front of it, where to wait, and two to have it at. */
  spots: { front: string; line: readonly string[]; eat: readonly string[] };
  /** The player stands at it: they go first. */
  playerBusy(): boolean;
  /** Takes the machine (one at a time; true when it's theirs), and lets go of it. */
  claim(who: string): boolean;
  release(who: string): void;
  /** The buttons beep; the machine drops `snack` into its tray; it's taken out. */
  press(who: string): void;
  vend(who: string, snack: SnackId): void;
  take(who: string): void;
  /** The snack in their hand (null: empty-handed), one of its sounds from there, and an emoji over their head. */
  hold(who: string, snack: HeldSnack | null): void;
  sound(who: string, cue: SnackCue): void;
  say(who: string, text: string): void;
  /** Who waits where, and who has theirs where (spot → who). */
  line: Map<string, string>;
  seats: Map<string, string>;
}

export type VendStage = 'wait' | 'front' | 'press' | 'drop' | 'take' | 'eat' | 'done';

/** One person's trip to the machine, from the place to wait by it (the errand's spot) until they set off home. */
export class VendBreak implements ErrandActor {
  stage: VendStage = 'wait';
  held: HeldSnack | null = null;
  private busy: { until: number; gesture: Gesture; then: () => void } | null = null;
  private waitAt: number | null = null;
  private snack: SnackId | null = null;
  private eating: Eating | null = null;
  private target: string;
  private there = false;

  constructor(
    readonly id: string,
    private world: VendWorld,
    private rand: () => number = Math.random,
  ) {
    this.target = world.spots.line[0];
  }

  get carry(): Gesture {
    return this.held ? 'hold' : 'none';
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

  private quit(): ActStep {
    const w = this.world;
    w.release(this.id);
    leaveSeat(w.line, this.id);
    leaveSeat(w.seats, this.id);
    this.stage = 'done';
    return 'done';
  }

  /** A sip or bite off it, with its sound: the last one finishes it. */
  private bite() {
    const h = this.held;
    if (!h) return;
    const def = SNACKS[h.snack];
    const last = h.left <= 1;
    this.world.sound(this.id, last ? def.last : def.bite);
    if (!last) return this.holding({ ...h, left: h.left - 1 });
    if (def.done) this.world.sound(this.id, def.done);
    this.holding(null);
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
        if (!w.playerBusy() && w.claim(this.id)) {
          this.stage = 'front';
          return this.walk(w.spots.front);
        }
        if (now - this.waitAt > VEND.wait) return this.quit();
        const spot = pickSeat(w.line, this.id, w.spots.line) ?? w.spots.line[0];
        if (!this.at(spot)) return this.walk(spot);
        return { stand: 'none' };
      }
      case 'front': {
        if (!this.at(w.spots.front)) return this.walk(w.spots.front);
        // the player came up meanwhile: they go first
        if (w.playerBusy()) {
          w.release(this.id);
          this.stage = 'wait';
          return this.walk(pickSeat(w.line, this.id, w.spots.line) ?? w.spots.line[0]);
        }
        this.stage = 'press';
        w.press(this.id);
        return this.act(now, VEND.press, 'tap', () => {
          this.snack = vendPick(this.id, this.rand());
          w.vend(this.id, this.snack);
          this.stage = 'drop';
        });
      }
      case 'press':
        return { stand: 'tap' };
      case 'drop':
        return this.act(now, VEND.drop, 'none', () => {
          this.stage = 'take';
        });
      case 'take':
        return this.act(now, VEND.take, 'stoop', () => {
          const snack = this.snack!;
          w.take(this.id);
          this.holding({ snack, left: SNACKS[snack].portions });
          w.say(this.id, SNACKS[snack].emoji);
          w.release(this.id);
          this.stage = this.rand() < VEND.stay ? 'eat' : 'done';
        });
      case 'eat': {
        const seat = pickSeat(w.seats, this.id, w.spots.eat);
        // nowhere free by the machine: have it at the desk
        if (!seat || (!this.held && !this.eating)) return this.quit();
        if (!this.eating && !this.at(seat)) return this.walk(seat);
        this.eating ??= new Eating(
          this.held!.left,
          this.rand(),
          () => this.bite(),
          () => {
            const h = this.held;
            const def = h && SNACKS[h.snack];
            if (h && def?.open && h.left >= def.portions) w.sound(this.id, def.open);
          },
        );
        const g = this.eating.step(now);
        return g ? { stand: g } : this.quit();
      }
      case 'done':
        return this.quit();
    }
  }

  /** Work came in: let go of the machine and go. What's in hand comes along. */
  abort() {
    this.world.release(this.id);
    leaveSeat(this.world.line, this.id);
    leaveSeat(this.world.seats, this.id);
    this.busy = null;
    this.stage = 'done';
  }

  /** Back in their chair (`seated`), or the floor was left: whatever's left of it is gone. */
  end() {
    this.abort();
    if (this.held) this.holding(null);
  }
}
