// Adapted from cubefarm client/src/world/events/director.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import { clashes, EVENT_IDS, EVENTS, FIRST, GAP, newDirector, parseEventId, parseEventParam, pickEvent, RETRY_SECONDS, roll, seeded, startRunning, stepDirector, type Director, type EventId } from './worldEvents.ts';

/** Runs a director for `minutes`, starting each event it picks; returns what started when. */
function simulate(minutes: number, seed = 1, step = 1, d: Director = newDirector(seed)) {
  const started: { id: EventId; at: number }[] = [];
  let key = 0;
  for (let t = 0; t < minutes * 60; t += step) {
    const id = stepDirector(d, step);
    if (id) {
      started.push({ id, at: d.clock });
      startRunning(d, ++key, id);
    }
    // never two big ones at once, nor two on the street
    expect(d.running.filter((r) => r.big).length).toBeLessThanOrEqual(1);
    expect(d.running.filter((r) => EVENTS[r.id].street).length).toBeLessThanOrEqual(1);
  }
  return started;
}

describe('the catalogue', () => {
  it('has planes, blimps and a few stranger sights, each with its kind', () => {
    for (const id of ['plane', 'blimp', 'helicopter', 'birds', 'balloon', 'skywriting', 'ufo', 'rainbow', 'duck', 'whale']) expect(EVENT_IDS).toContain(id);
    expect(EVENTS.plane.big).toBe(false);
    expect(EVENTS.blimp).toMatchObject({ tier: 'fun', big: true, toast: false });
    expect(EVENTS.duck).toMatchObject({ tier: 'absurd', big: true, toast: true });
    for (const e of Object.values(EVENTS)) expect(e.seconds).toBeGreaterThan(20);
  });

  it('reads ?event= and its aliases', () => {
    expect(parseEventParam('?event=blimp')).toBe('blimp');
    expect(parseEventParam('?event=rubber_duck')).toBe('duck');
    expect(parseEventParam('?event=Airliner')).toBe('plane');
    expect(parseEventParam('?event=kaiju')).toBeNull();
    expect(parseEventId(null)).toBeNull();
    expect(parseEventParam('?event=rock_bus')).toBe('rockbus');
    expect(parseEventParam('?event=ice cream')).toBe('icecream');
    expect(parseEventParam('?event=fire-engine')).toBe('firetruck');
    expect(parseEventParam('?event=marshmallow')).toBe('parade');
  });

  it('has a few events down on the street, the rock bus among them', () => {
    const street = EVENT_IDS.filter((id) => EVENTS[id].street);
    expect(street).toEqual(['rockbus', 'icecream', 'firetruck', 'foodtruck', 'parade']);
    expect(EVENTS.plane.street).toBe(false);
    // the rock bus draws a crowd at the windows; the parade is rare enough for a note too
    expect(EVENTS.rockbus).toMatchObject({ tier: 'fun', big: true, toast: false, street: true });
    expect(EVENTS.parade).toMatchObject({ tier: 'weird', big: true, toast: true, street: true });
    for (const id of ['icecream', 'firetruck', 'foodtruck'] as const) expect(EVENTS[id]).toMatchObject({ tier: 'everyday', big: false, toast: false });
  });

  it('weights the street as the odd surprise, never crowding out the sky', () => {
    const weight = (street: boolean) => Object.values(EVENTS).reduce((a, e) => a + (e.street === street ? e.weight : 0), 0);
    const share = weight(true) / (weight(true) + weight(false));
    expect(share).toBeGreaterThan(0.12);
    expect(share).toBeLessThan(0.3);
    expect(EVENTS.parade.weight).toBeLessThan(EVENTS.rockbus.weight);
    expect(EVENTS.rockbus.weight).toBeLessThanOrEqual(EVENTS.blimp.weight);
  });
});

describe('what happens next', () => {
  it('never picks a second big event while one runs, or one already running', () => {
    for (let i = 0; i < 200; i++) {
      const id = pickEvent([{ id: 'duck', big: true }], i / 200);
      expect(id).not.toBeNull();
      expect(EVENTS[id!].big).toBe(false);
    }
    for (let i = 0; i < 200; i++) expect(pickEvent([{ id: 'plane', big: false }], i / 200)).not.toBe('plane');
    expect(pickEvent(EVENT_IDS.map((id) => ({ id, big: EVENTS[id].big })), 0.5)).toBeNull();
  });

  it('never picks a second street event while one is on the street', () => {
    for (let i = 0; i < 200; i++) {
      const id = pickEvent([{ id: 'icecream', big: false }], i / 200)!;
      expect(EVENTS[id].street, id).toBe(false);
    }
    // the rock bus is big and on the street: neither another big one nor another street one
    for (let i = 0; i < 200; i++) {
      const id = pickEvent([{ id: 'rockbus', big: true }], i / 200)!;
      expect(EVENTS[id].big || EVENTS[id].street, id).toBe(false);
    }
    expect(clashes('firetruck', 'foodtruck')).toBe(true);
    expect(clashes('firetruck', 'plane')).toBe(false);
    expect(clashes('rockbus', 'blimp')).toBe(true);
    expect(clashes('plane', 'birds')).toBe(false);
  });

  it('weights the everyday higher than the rare', () => {
    const counts: Partial<Record<EventId, number>> = {};
    for (let i = 0; i < 2000; i++) {
      const id = pickEvent([], i / 2000)!;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    expect(counts.plane!).toBeGreaterThan(counts.ufo! * 3);
    expect(counts.blimp!).toBeGreaterThan(counts.duck! * 3);
    expect(counts.ufo!).toBeGreaterThan(counts.whale!);
  });
});

describe('the schedule', () => {
  it('starts the first event a minute or two in, then one every few minutes', () => {
    const started = simulate(8 * 60);
    expect(started[0].at).toBeGreaterThanOrEqual(FIRST[0]);
    expect(started[0].at).toBeLessThanOrEqual(FIRST[1] + 1);
    const gaps = started.slice(1).map((s, i) => s.at - started[i].at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(GAP[0] - 1);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(GAP[1] + RETRY_SECONDS * 4);
    // about one every five minutes over eight hours
    expect(started.length).toBeGreaterThan(60);
    expect(started.length).toBeLessThan(170);
  });

  it('sees every kind of event in a long day', () => {
    const seen = new Set(simulate(16 * 60, 3).map((s) => s.id));
    for (const id of EVENT_IDS) expect(seen, id).toContain(id);
  });

  it('is the same for the same seed', () => {
    expect(simulate(120, 42)).toEqual(simulate(120, 42));
    expect(simulate(300, 42)).not.toEqual(simulate(300, 43));
  });

  it("starts on the clock it's given, and carries on the same from a saved state", () => {
    const d = newDirector(7, 1_000_000);
    expect(d.nextAt).toBeGreaterThanOrEqual(1_000_000 + FIRST[0]);
    const whole = simulate(60, 7, 1, newDirector(7));
    const first = newDirector(7);
    const before = simulate(30, 7, 1, first);
    // saved and read back: its clock, schedule and random, as numbers
    const restored: Director = { clock: first.clock, nextAt: first.nextAt, running: first.running.map((r) => ({ ...r })), state: first.state };
    const after = simulate(30, 7, 1, restored);
    expect([...before, ...after].map((s) => s.id)).toEqual(whole.map((s) => s.id));
  });

  it("draws the same numbers as the scenes' seeded random", () => {
    const d = newDirector(99);
    const r = seeded(99);
    r(); // newDirector's own roll, for its first event
    for (let i = 0; i < 5; i++) expect(roll(d)).toBe(r());
  });
});
