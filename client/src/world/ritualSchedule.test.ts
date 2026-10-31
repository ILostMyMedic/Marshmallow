// Adapted from cubefarm client/src/world/ritualSchedule.test.ts (MIT): lunch and the stand-up.
import { describe, expect, it } from 'vitest';
import { CYCLE_MS } from './dayTime';
import { BOARD } from './layout';
import {
  KITCHEN_SPOTS,
  PRESENTER,
  STANDUP,
  STANDUP_SPOTS,
  TABLE_SPOTS,
  fileIssues,
  freeSpot,
  isLunch,
  lunchOf,
  newRitualState,
  officeClock,
  parseRitualParam,
  schedule,
  semicircle,
  standupDue,
  type Decision,
  type Facts,
  type OfficeClock,
  type RitualState,
} from './ritualSchedule';
import { findPath, spot, standable, walkways } from './walkways';

const office = walkways('office');
const at = (hour: number, weekday = 3, day = 'd1'): OfficeClock => ({ hour, weekday, day, dayStart: 0 });

/** The facts of a quiet afternoon, with `over` changed. */
const facts = (over: Partial<Facts> = {}): Facts => ({ now: 1000, clock: at(14), standupOn: false, ...over });

const kinds = (ds: Decision[]) => ds.map((d) => d.do);

describe('the ritual param', () => {
  it('forces one of the rituals by name, nothing else', () => {
    expect(parseRitualParam('?ritual=standup')).toBe('standup');
    expect(parseRitualParam('?stats&ritual=lunch')).toBe('lunch');
    expect(parseRitualParam('?ritual=pizza')).toBeNull();
    expect(parseRitualParam('')).toBeNull();
  });
});

describe('the office clock', () => {
  it('takes the hour from the day phase and the weekday from the calendar', () => {
    const fri = new Date(2026, 9, 2, 10, 30).getTime(); // a Friday
    const c = officeClock(fri, 0.5, 'clock');
    expect(c.hour).toBe(12);
    expect(c.weekday).toBe(5);
    expect(c.day).toBe('2026-10-02');
    expect(c.dayStart).toBe(new Date(2026, 9, 2).getTime());
  });

  it('makes every 30-minute cycle a day of its own', () => {
    const a = officeClock(5 * CYCLE_MS + 1000, 0.3, 'cycle');
    const b = officeClock(6 * CYCLE_MS + 1000, 0.3, 'cycle');
    expect(a.day).not.toBe(b.day);
    expect(a.dayStart).toBe(5 * CYCLE_MS);
    expect(a.hour).toBeCloseTo(7.2);
  });
});

describe('lunch', () => {
  it('is noon to one', () => {
    expect([11.9, 12, 12.5, 12.99, 13].map(isLunch)).toEqual([false, true, true, true, false]);
  });

  it('everyone has their own, the same every day', () => {
    expect(lunchOf('ada')).toBe(lunchOf('ada'));
    const foods = new Set(['ada', 'linus', 'grace', 'alan', 'margaret', 'ken', 'barbara'].map(lunchOf));
    expect(foods.size).toBeGreaterThan(1);
    expect([...foods].every((k) => ['lunchbox', 'sandwich', 'noodles'].includes(k))).toBe(true);
  });
});

describe('the stand-up', () => {
  it('counts each filed issue once, from when it was reported', () => {
    const s = newRitualState();
    fileIssues(s, [7, 8], 100);
    fileIssues(s, [8, 9], 105);
    expect(s.fresh).toEqual([
      { n: 7, at: 100 },
      { n: 8, at: 100 },
      { n: 9, at: 105 },
    ]);
  });

  it('needs a burst: at least two new issues, the last a few seconds old, and not straight after another', () => {
    const one = [{ n: 7, at: 100 }];
    const two = [...one, { n: 8, at: 102 }];
    expect(standupDue(one, 200, -Infinity)).toBe(false);
    expect(standupDue(two, 102 + STANDUP.settle - 1, -Infinity)).toBe(false); // the CEO may still be filing
    expect(standupDue(two, 102 + STANDUP.settle, -Infinity)).toBe(true);
    expect(standupDue(two, 110, 110 - STANDUP.gap + 1)).toBe(false);
    expect(standupDue(two, 100 + STANDUP.window + 1, -Infinity)).toBe(false); // too long ago to be a burst
  });

  it('three issues filed in a burst start one, with their stickies in order', () => {
    const s = newRitualState();
    fileIssues(s, [14, 12], 990);
    fileIssues(s, [13], 991);
    const d = schedule(s, facts());
    expect(d).toEqual([{ do: 'standup', issues: [12, 13, 14] }]);
    expect(s.fresh).toEqual([]);
    expect(s.standupAt).toBe(1000);
  });

  it('waits for a stand-up already under way', () => {
    const s = newRitualState();
    fileIssues(s, [1, 2], 990);
    expect(kinds(schedule(s, facts({ standupOn: true })))).toEqual([]);
    expect(s.fresh).toHaveLength(2);
    expect(kinds(schedule(s, facts()))).toEqual(['standup']);
  });

  it('puts up at most a handful of stickies', () => {
    const s = newRitualState();
    fileIssues(
      s,
      Array.from({ length: 10 }, (_, i) => i + 1),
      990,
    );
    const d = schedule(s, facts())[0] as Extract<Decision, { do: 'standup' }>;
    expect(d.issues).toHaveLength(STANDUP.stickies);
  });

  it('forgets issues filed too long ago to be part of a burst', () => {
    const s = newRitualState();
    fileIssues(s, [1], 0);
    fileIssues(s, [2], STANDUP.window + 10);
    expect(kinds(schedule(s, facts({ now: STANDUP.window + 20 })))).toEqual([]);
    expect(s.fresh.map((f) => f.n)).toEqual([2]);
  });
});

describe('the scheduler over a day', () => {
  /** Runs the scheduler through `hours` (a look a minute). */
  function day(s: RitualState, hours: number[]) {
    const out: [number, Decision][] = [];
    for (const hour of hours) for (const d of schedule(s, facts({ clock: at(hour) }))) out.push([hour, d]);
    return out;
  }
  const hours = Array.from({ length: 29 * 4 }, (_, i) => (8 + i / 4) % 24); // 8 am to 1 pm the next day

  it('lunch goes on at noon and off at one, every day', () => {
    const events = day(newRitualState(), hours).map(([h, d]) => `${h}:${d.do}${'on' in d ? (d.on ? '+' : '-') : ''}`);
    expect(events).toEqual(['12:lunch+', '13:lunch-', '12:lunch+']);
  });
});

describe('where everyone stands', () => {
  it('the stand-up: the CEO by the Backlog column, the team in an arc facing them, all on the floor and reachable', () => {
    const backlog = spot(office, 'board-backlog')!;
    expect(Math.abs(PRESENTER.x - backlog.x)).toBeLessThan(2);
    expect(PRESENTER.z).toBeGreaterThan(BOARD.z + 0.5);
    expect(standable(office, PRESENTER.x, PRESENTER.z)).toBe(true);
    const arc = semicircle(PRESENTER, STANDUP_SPOTS);
    expect(new Set(arc.map((s) => s.id)).size).toBe(STANDUP_SPOTS);
    for (const s of arc) {
      expect(standable(office, s.x, s.z), s.id).toBe(true);
      expect(s.z).toBeGreaterThan(PRESENTER.z); // out from the board
      expect(Math.hypot(s.x - PRESENTER.x, s.z - PRESENTER.z)).toBeCloseTo(2.3);
      // facing the presenter (walkways.ts facings: along (cos, sin))
      const fx = Math.cos(s.facing);
      const fz = Math.sin(s.facing);
      expect(fx * (PRESENTER.x - s.x) + fz * (PRESENTER.z - s.z)).toBeGreaterThan(2.2);
      expect(findPath(office, spot(office, 'desk-0')!, s), s.id).not.toBeNull();
    }
    // nobody stands too close to the next
    for (let i = 1; i < arc.length; i++) expect(Math.hypot(arc[i].x - arc[i - 1].x, arc[i].z - arc[i - 1].z)).toBeGreaterThan(0.75);
    expect(findPath(office, spot(office, 'elevator')!, PRESENTER)).not.toBeNull();
  });

  it('the lunch spots are all clear and reachable from the desks', () => {
    for (const s of [...TABLE_SPOTS, ...KITCHEN_SPOTS]) {
      expect(standable(office, s.x, s.z), s.id).toBe(true);
      expect(findPath(office, spot(office, 'desk-5')!, s), s.id).not.toBeNull();
    }
  });

  it('the nearest free spot', () => {
    const taken = new Set([TABLE_SPOTS[0].id]);
    expect(freeSpot(TABLE_SPOTS, taken, TABLE_SPOTS[0])?.id).toBe(TABLE_SPOTS[1].id);
    expect(freeSpot(TABLE_SPOTS, new Set(TABLE_SPOTS.map((s) => s.id)), { x: 0, z: 0 })).toBeNull();
  });
});
