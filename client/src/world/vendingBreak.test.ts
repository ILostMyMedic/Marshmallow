// New in Marshmallow, after snackBreak.test.ts.
import { describe, expect, it } from 'vitest';
import { BREAK, fanciesCoffee } from './coffeeBreak';
import { slotSpotIds } from './decor/spots';
import type { ActStep } from './errands';
import { SNACKS, type SnackCue } from './fridge';
import { fanciesSnack, type HeldSnack } from './snackBreak';
import { Eating, VEND, VEND_SNACKS, VendBreak, fanciesVending, vendPick, type VendWorld } from './vendingBreak';
import { spot, walkways } from './walkways';

/** The machine as a trip to it sees it, with a log of what happened. */
function machine() {
  const m = {
    playerNear: false,
    user: null as string | null,
    log: [] as string[],
    hands: new Map<string, HeldSnack | null>(),
    sounds: [] as { who: string; cue: SnackCue }[],
  };
  const world: VendWorld = {
    spots: slotSpotIds('big-1'),
    playerBusy: () => m.playerNear,
    claim(who) {
      if (m.user !== null && m.user !== who) return false;
      m.user = who;
      return true;
    },
    release(who) {
      if (m.user === who) m.user = null;
    },
    press: (who) => void m.log.push(`${who} press`),
    vend: (who, snack) => void m.log.push(`${who} vend ${snack}`),
    take: (who) => void m.log.push(`${who} take`),
    hold: (who, s) => void m.hands.set(who, s),
    sound: (who, cue) => void m.sounds.push({ who, cue }),
    say: () => undefined,
    line: new Map(),
    seats: new Map(),
  };
  return { m, world };
}

/** Walks someone through: a walk arrives `walkSeconds` after it's asked for. */
function runner(b: VendBreak, first: string, walkSeconds = 1) {
  let walking: string | null = first;
  let since = 0;
  const visits: string[] = [];
  return {
    visits,
    step(now: number): ActStep {
      const last = b.step(now, now - since >= walkSeconds);
      if (typeof last === 'object' && 'walk' in last && last.walk !== walking) {
        walking = last.walk;
        since = now;
        visits.push(last.walk);
      }
      return last;
    },
  };
}

const DT = 0.1;
const run = (r: ReturnType<typeof runner>, until = 120, each?: (t: number) => void) => {
  let t = 0;
  for (; t < until; t += DT) {
    each?.(t);
    if (r.step(t) === 'done') break;
  }
  return t;
};

describe('fancying the vending machine', () => {
  it('takes its own slice of restless moments: the top of the fridge’s and the next, never a coffee’s', () => {
    let vend = 0;
    let both = 0;
    for (let i = 0; i < 2000; i++) {
      const restless = 25 + (i / 2000) * 45;
      if (fanciesVending(restless)) {
        vend++;
        expect(fanciesCoffee(restless)).toBe(false);
        if (fanciesSnack(restless)) both++;
      }
    }
    expect(vend / 2000).toBeGreaterThan(0.18);
    expect(vend / 2000).toBeLessThan(0.3);
    // the overlap with the fridge's slice is the part the machine takes over (fridgeErrand.ts leaves it to it)
    expect(both).toBeGreaterThan(0);
    expect(VEND.share[0]).toBeGreaterThan(BREAK.chance);
  });

  it('gets their usual most times, sometimes something else, always something the machine sells', () => {
    const usual = vendPick('ada', 0.1);
    expect(vendPick('ada', 0.5)).toBe(usual);
    const others = new Set([0.71, 0.8, 0.9, 0.99].map((r) => vendPick('ada', r)));
    expect(others.has(usual)).toBe(false);
    for (const r of [0, 0.3, 0.7, 0.85, 0.999]) expect(VEND_SNACKS).toContain(vendPick('grace', r));
  });
});

describe('a trip to the machine', () => {
  it('presses the buttons, waits for the drop, stoops for it and has it by the machine', () => {
    const { m, world } = machine();
    const b = new VendBreak('ada', world, () => 0.1);
    const r = runner(b, world.spots.line[0]);
    const gestures = new Set<string>();
    for (let t = 0; t < 120; t += DT) {
      const s = r.step(t);
      if (s === 'done') break;
      if ('stand' in s) gestures.add(s.stand);
    }
    expect(m.log.map((l) => l.split(' ')[1])).toEqual(['press', 'vend', 'take']);
    expect(r.visits[0]).toBe(world.spots.front);
    expect(r.visits).toContain('big-1-sip-1'); // the far place first
    for (const g of ['tap', 'stoop', 'sip']) expect(gestures.has(g), g).toBe(true);
    // all gone, with the sounds of having it
    const snack = vendPick('ada', 0.1);
    expect(m.hands.get('ada')).toBeNull();
    expect(m.sounds.map((s) => s.cue)).toContain(SNACKS[snack].last);
    expect(m.user).toBeNull();
    expect(world.seats.size).toBe(0);
  });

  it('takes it back to the desk the rest of the time', () => {
    const { m, world } = machine();
    const b = new VendBreak('ada', world, () => 0.95);
    run(runner(b, world.spots.line[0]));
    expect(b.held).not.toBeNull();
    expect(b.carry).toBe('hold');
    expect(m.log).toHaveLength(3);
  });

  it('waits in line while someone else is at the machine, and gives up after a while', () => {
    const { m, world } = machine();
    m.user = 'grace';
    const b = new VendBreak('ada', world, () => 0.1);
    const t = run(runner(b, world.spots.line[0]));
    expect(t).toBeGreaterThan(VEND.wait);
    expect(m.log).toEqual([]);
    expect(world.line.size).toBe(0);
  });

  it('lets the player go first', () => {
    const { m, world } = machine();
    m.playerNear = true;
    const b = new VendBreak('ada', world, () => 0.1);
    const r = runner(b, world.spots.line[0]);
    for (let t = 0; t < 10; t += DT) r.step(t);
    expect(m.log).toEqual([]);
    m.playerNear = false;
    run(r, 120);
    expect(m.log[0]).toBe('ada press');
  });

  it('lets go of the machine when work calls, and drops what it was holding once seated', () => {
    const { m, world } = machine();
    const b = new VendBreak('ada', world, () => 0.1);
    const r = runner(b, world.spots.line[0]);
    for (let t = 0; t < 8 && !b.held; t += DT) r.step(t);
    b.abort();
    expect(m.user).toBeNull();
    b.end();
    expect(m.hands.get('ada') ?? null).toBeNull();
  });

  it('stands at the machine’s spots on an office floor', () => {
    const w = walkways('office');
    for (const id of [...slotSpotIds('big-3').line, slotSpotIds('big-3').front, ...slotSpotIds('big-3').eat]) expect(spot(w, id), id).toBeDefined();
  });
});

describe('eating where they stand', () => {
  it('takes every sip or bite off, one per bite step, and ends after a pause', () => {
    let bites = 0;
    let starts = 0;
    const e = new Eating(
      3,
      0.4,
      () => bites++,
      () => starts++,
    );
    let t = 0;
    while (e.step(t) !== null && t < 60) t += DT;
    expect(bites).toBe(3);
    expect(starts).toBe(3);
    expect(t).toBeGreaterThan(3);
  });
});
