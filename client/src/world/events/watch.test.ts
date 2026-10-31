// Adapted from cubefarm client/src/world/events/watch.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import { errandNamed, errands, wanted, type ErrandState } from '../errands';
import { HALF_W } from '../layout';
import { setErrand } from '../people';
import { standable, walkways } from '../walkways';
import { EVENT_IDS } from './director';
import { endEvent, runningEvents, triggerEvent } from './eventsState';
import './watch';
import { watchBeats, watchSpots } from './watchPlan';

const state = (floor: 'office' | 'lobby' = 'office'): ErrandState => ({ floor, statusFor: 0, seatedFor: 0, restless: 1000, roll: 0.5, home: { id: 'desk-0', x: -10.5, z: 4.5, facing: 0 }, others: [] });

describe('where people watch from', () => {
  it('stands them along the windows and at the glass door on the event side, looking out', () => {
    for (const kind of ['office', 'lobby'] as const)
      for (const side of ['west', 'east'] as const) {
        const spots = watchSpots(kind, side);
        expect(spots.length).toBeGreaterThanOrEqual(4);
        expect(new Set(spots.map((s) => s.id)).size).toBe(spots.length);
        for (const s of spots) {
          expect(Math.sign(s.x)).toBe(side === 'west' ? -1 : 1);
          expect(Math.abs(s.x)).toBeGreaterThan(HALF_W - 1.5);
          expect(Math.cos(s.facing)).toBeCloseTo(side === 'west' ? -1 : 1);
        }
        // most are somewhere a person can stand (the rest are in the furniture and skipped)
        const w = walkways(kind);
        expect(spots.filter((s) => standable(w, s.x, s.z)).length).toBeGreaterThanOrEqual(3);
      }
  });

  it('reacts to every event in a dozen or so seconds of looking, pointing, gasping and cheering', () => {
    for (const id of EVENT_IDS)
      for (const roll of [0, 0.5, 0.99]) {
        const beats = watchBeats(id, roll);
        const total = beats.reduce((t, b) => t + b.seconds, 0);
        expect(total).toBeGreaterThan(6);
        expect(total).toBeLessThan(20);
      }
    expect(watchBeats('ufo', 0).map((b) => b.gesture)).toContain('gasp');
    expect(watchBeats('blimp', 0).map((b) => b.gesture)).toContain('cheer');
    expect(watchBeats('duck', 0).map((b) => b.gesture)).toContain('point');
  });
});

describe('the watch errand', () => {
  const watch = errandNamed('watch')!;
  const idle = { id: 'ada', status: 'idle' as const, role: 'worker' };
  const busy = { id: 'linus', status: 'working' as const, role: 'worker' };

  it('is registered with the errand director', () => {
    expect(watch).toBeTruthy();
    expect(errands()).toContain(watch);
  });

  it('only calls free workers, and only while a big event is on', () => {
    expect(watch.when(idle, state())).toBe(false);
    const plane = triggerEvent('plane', 'west');
    plane.t = 10;
    expect(watch.when(idle, state())).toBe(false); // everyday events don't draw a crowd
    const blimp = triggerEvent('blimp', 'west');
    blimp.t = 1;
    expect(watch.when(idle, state())).toBe(false); // a moment for it to get going
    blimp.t = 10;
    expect(watch.when(idle, state())).toBe(true);
    expect(watch.when(busy, state())).toBe(false);
    expect(wanted(errands(), busy, state()).map((e) => e.name)).not.toContain('watch');
    blimp.t = blimp.seconds - 5;
    expect(watch.when(idle, state())).toBe(false); // too late to go
    for (const r of [...runningEvents()]) endEvent(r.key);
  });

  it('sends each watcher to their own spot on the event side', () => {
    const run = triggerEvent('ufo', 'east');
    run.t = 8;
    const a = watch.place!(idle, state());
    expect(a).toBeTruthy();
    setErrand('ada', { name: 'watch', phase: 'leaving', spot: a!.id }); // the director has her on her way
    const b = watch.place!({ ...idle, id: 'grace' }, state());
    expect(b).toBeTruthy();
    expect(b!.id).not.toBe(a!.id);
    expect(a!.x).toBeGreaterThan(0);
    expect(b!.x).toBeGreaterThan(0);
    setErrand('ada', null);
    endEvent(run.key);
  });

  it('has them watch an event once, cheering at the blimp, then head back', () => {
    const run = triggerEvent('blimp', 'west');
    run.t = 10;
    const act = watch.act!('ada');
    let t = 0;
    const gestures: string[] = [];
    for (; t < 30; t += 0.25) {
      const step = act.step(t, true);
      if (step === 'done') break;
      if ('stand' in step) gestures.push(step.stand);
    }
    expect(t).toBeLessThan(30);
    expect(gestures).toContain('cheer');
    act.end(true);
    expect(watch.when(idle, state())).toBe(false); // seen it
    expect(watch.when({ ...idle, id: 'grace' }, state())).toBe(true);
    endEvent(run.key);
  });
});
