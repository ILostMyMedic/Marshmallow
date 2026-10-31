// Adapted from cubefarm client/src/world/meals.test.ts (MIT): lunch only.
import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkerStatus } from '../../../shared/types';
import { errandNamed, type ErrandScript, type ErrandState, type ErrandWorker, type Me } from './errands';
import { lunchWait, meals, resetMeals } from './meals';
import { handFood, saying } from './people';
import { KITCHEN_SPOTS, TABLE_SPOTS, lunchOf } from './ritualSchedule';
import { spot, walkways } from './walkways';

const office = walkways('office');
const lunch = () => errandNamed('lunch')!;
const worker = (id: string, status: WorkerStatus = 'idle'): ErrandWorker => ({ id, status, role: 'worker' });
const state = (over: Partial<ErrandState> = {}): ErrandState => ({ floor: 'office', statusFor: 100, seatedFor: 60, restless: 30, roll: 0.2, home: spot(office, 'desk-0')!, ...over });
const me = (dt: number): Me => ({ id: '', x: 0, z: 0, heading: 0, arrived: true, dt, player: { x: 0, z: 0 } });

/** Goes to lunch the way the director would; null when it won't have them. */
function go(id: string, s = state()) {
  const at = lunch().place!(worker(id), s);
  if (!at || !lunch().claim!(id)) return null;
  return { at, script: lunch().script!(worker(id), 'office')! };
}

/** Ticks a script until it's done (or `max` seconds); the gestures it made. */
function run(script: ErrandScript, max = 60) {
  const gestures = new Set<string>();
  for (let t = 0; t < max; t += 0.1) {
    const act = script.tick(me(0.1));
    if (act.do === 'done') return { gestures, t };
    gestures.add(act.gesture);
  }
  return { gestures, t: Infinity };
}

beforeEach(() => resetMeals());

describe('lunch', () => {
  it('only at lunchtime, only for free people, once each, and in turns', () => {
    expect(lunch().when(worker('a'), state())).toBe(false);
    meals.lunch = true;
    expect(lunch().when(worker('a'), state())).toBe(true);
    expect(lunch().when(worker('a', 'working'), state())).toBe(false);
    expect(lunch().when(worker('a'), state({ seatedFor: lunchWait(0.2) - 1 }))).toBe(false);
    expect(lunch().when(worker('a'), state({ floor: 'lobby' }))).toBe(false);
    meals.ate.add('a');
    expect(lunch().when(worker('a'), state())).toBe(false);
  });

  it('takes a spot at the coffee table or the kitchenette, with their own lunch in hand, and chats with whoever is there', () => {
    meals.lunch = true;
    const a = go('a')!;
    expect([...TABLE_SPOTS, ...KITCHEN_SPOTS].map((s) => s.id)).toContain(a.at.id);
    expect(handFood('a')).toBe(lunchOf('a'));
    expect(meals.ate.has('a')).toBe(true);
    // the next one joins them where they are
    const b = go('b')!;
    const venue = (id: string) => (TABLE_SPOTS.some((s) => s.id === id) ? 'table' : 'kitchen');
    expect(b.at.id).not.toBe(a.at.id);
    expect(venue(b.at.id)).toBe(venue(a.at.id));
    const { gestures, t } = run(a.script);
    expect(gestures).toEqual(new Set(['none', 'sip', 'talk']));
    expect(t).toBeGreaterThan(10);
    expect(t).toBeLessThan(25);
    a.script.end();
    expect(handFood('a')).toBeNull();
    expect(saying('a')).toBeUndefined();
    expect([...meals.spots.keys()]).toEqual(['b']);
  });

  it('no spot left: nobody else goes until one frees up', () => {
    meals.lunch = true;
    const all = [...TABLE_SPOTS, ...KITCHEN_SPOTS];
    all.forEach((_, i) => expect(go(`p${i}`)).not.toBeNull());
    expect(go('late')).toBeNull();
  });
});
