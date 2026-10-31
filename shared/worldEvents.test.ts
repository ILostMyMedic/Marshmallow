// Adapted from cubefarm client/src/world/events/director.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import { EVENT_IDS, EVENTS, FIRST, GAP, newDirector, parseEventId, parseEventParam, pickEvent, RETRY_SECONDS, roll, seeded, startRunning, stepDirector, type Director, type EventId } from './worldEvents.ts';

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
    // never two big ones at once
    expect(d.running.filter((r) => r.big).length).toBeLessThanOrEqual(1);
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
