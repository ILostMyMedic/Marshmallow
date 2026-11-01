// New in Marshmallow.
import { describe, expect, it } from 'vitest';
import { BEER, BOTTLE, BeerBreak, afterHours, fanciesBeer, type BeerWorld } from './beerBreak';
import { AFTERNOON_T, SUNRISE_T, SUNSET_T } from './dayTime';
import { slotSpotIds } from './decor/spots';
import type { SnackCue } from './fridge';
import type { HeldSnack } from './snackBreak';
import { fanciesVending } from './vendingBreak';

function fridge() {
  const f = {
    open: false,
    user: null as string | null,
    log: [] as string[],
    said: [] as string[],
    hands: new Map<string, HeldSnack | null>(),
    sounds: [] as SnackCue[],
  };
  const world: BeerWorld = {
    spots: slotSpotIds('big-2'),
    claim(who) {
      if (f.user !== null && f.user !== who) return false;
      f.user = who;
      return true;
    },
    release(who) {
      if (f.user === who) f.user = null;
    },
    isOpen: () => f.open,
    open(who) {
      if (!f.open) f.log.push(`${who} open`);
      f.open = true;
    },
    close(who) {
      if (f.open) f.log.push(`${who} close`);
      f.open = false;
    },
    take: (who) => void f.log.push(`${who} take`),
    hold: (who, s) => void f.hands.set(who, s),
    sound: (_, cue) => void f.sounds.push(cue),
    say: (who, text) => void (text && f.said.push(`${who} ${text}`)),
    line: new Map(),
    seats: new Map(),
    ready: new Set(),
  };
  return { f, world };
}

/** Steps several people at once: each walk arrives a second after it's asked for. */
function crowd(breaks: BeerBreak[]) {
  const since = new Map<string, number>();
  const walking = new Map<string, string>();
  const done = new Set<string>();
  return (now: number) => {
    for (const b of breaks) {
      if (done.has(b.id)) continue;
      const s = b.step(now, now - (since.get(b.id) ?? 0) >= 1);
      if (s === 'done') done.add(b.id);
      else if ('walk' in s && s.walk !== walking.get(b.id)) {
        walking.set(b.id, s.walk);
        since.set(b.id, now);
      }
    }
    return done.size === breaks.length;
  };
}

describe('after hours', () => {
  it('is from sunset to sunrise, and never in the day mode’s afternoon', () => {
    expect(afterHours(0.9)).toBe(true);
    expect(afterHours(SUNSET_T)).toBe(true);
    expect(afterHours(0.1)).toBe(true);
    expect(afterHours(SUNRISE_T)).toBe(false);
    expect(afterHours(0.5)).toBe(false);
    expect(afterHours(AFTERNOON_T)).toBe(false);
  });

  it('fancies a beer in a slice of its own, after the vending machine’s', () => {
    let n = 0;
    for (let i = 0; i < 2000; i++) {
      const restless = 25 + (i / 2000) * 45;
      if (!fanciesBeer(restless)) continue;
      n++;
      expect(fanciesVending(restless)).toBe(false);
    }
    expect(n / 2000).toBeGreaterThan(0.18);
    expect(n / 2000).toBeLessThan(0.3);
  });
});

describe('a beer', () => {
  it('opens the door, takes a bottle, shuts it, and two clink bottles before drinking up', () => {
    const { f, world } = fridge();
    const a = new BeerBreak('ada', world, () => 0.3);
    const b = new BeerBreak('grace', world, () => 0.6);
    const tick = crowd([a, b]);
    let t = 0;
    for (; t < 120 && !tick(t); t += 0.1);
    expect(f.log.filter((l) => l.endsWith('take'))).toHaveLength(2);
    expect(f.log.filter((l) => l.endsWith('open'))).toHaveLength(2);
    expect(f.open).toBe(false);
    expect(f.said).toContain('ada 🍻');
    expect(f.said).toContain('grace 🍻');
    expect(f.sounds).toContain('glug');
    expect(f.hands.get('ada')).toBeNull();
    expect(world.ready.size).toBe(0);
    expect(world.seats.size).toBe(0);
    expect(f.user).toBeNull();
  });

  it('still clinks bottles with someone who turns up after they’ve started on theirs', () => {
    const { f, world } = fridge();
    const a = new BeerBreak('ada', world, () => 0.3);
    const b = new BeerBreak('grace', world, () => 0.6);
    const early = crowd([a]);
    let t = 0;
    for (; t < 60 && a.stage !== 'drink'; t += 0.1) early(t);
    expect(a.stage).toBe('drink');
    const both = crowd([a, b]);
    for (; t < 200 && !both(t); t += 0.1);
    expect(f.said).toContain('ada 🍻');
    expect(f.said).toContain('grace 🍻');
  });

  it('has it alone when nobody comes, after waiting a while for company', () => {
    const { f, world } = fridge();
    const a = new BeerBreak('ada', world, () => 0.3);
    const tick = crowd([a]);
    let t = 0;
    let held = false;
    for (; t < 120 && !tick(t); t += 0.1) if (a.held?.snack === BOTTLE) held = true;
    expect(held).toBe(true);
    expect(t).toBeGreaterThan(BEER.company);
    expect(f.said).not.toContain('ada 🍻');
    expect(f.hands.get('ada')).toBeNull();
  });

  it('shuts the door behind them when work calls, bottle in hand', () => {
    const { f, world } = fridge();
    const a = new BeerBreak('ada', world, () => 0.3);
    const tick = crowd([a]);
    for (let t = 0; t < 30 && a.stage !== 'close'; t += 0.1) tick(t);
    expect(f.open).toBe(true);
    a.abort();
    expect(f.open).toBe(false);
    expect(f.user).toBeNull();
    a.end();
    expect(f.hands.get('ada') ?? null).toBeNull();
  });

  it('waits while the player stands at the fridge, and steps back if they come up first', () => {
    const { f, world } = fridge();
    let player = true;
    world.playerBusy = () => player;
    const a = new BeerBreak('ada', world, () => 0.3);
    const tick = crowd([a]);
    let t = 0;
    for (; t < 10; t += 0.1) tick(t);
    expect(a.stage).toBe('wait');
    expect(f.user).toBeNull();
    player = false;
    for (; t < 20 && a.stage !== 'door'; t += 0.1) tick(t);
    expect(a.stage).toBe('door');
    // the player walks up before they've reached the door: back in line, the door theirs to take
    player = true;
    for (; t < 30 && a.stage === 'door'; t += 0.1) tick(t);
    expect(a.stage).toBe('wait');
    expect(f.user).toBeNull();
    expect(f.log).toEqual([]);
    player = false;
    for (; t < 120 && !tick(t); t += 0.1);
    expect(f.log).toContain('ada take');
  });
});
