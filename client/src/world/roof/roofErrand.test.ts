// Adapted from cubefarm client/src/world/roof/roofErrand.test.ts (MIT): no ding or store to stub, and the CEO's call
// starts from their own floor.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { errandNamed, type ErrandState, type Me } from '../errands';
import { CEO_FLOOR } from '../floors';
import { isHidden } from '../people';
import { CABIN } from '../socials';
import { useView } from '../view';
import { endVisit, ROOF_BREAK, roofVisit, roofVisits, startVisit } from './roofBreaks';
import { rideUp } from './roofErrand';

const me = (arrived: boolean, dt = 0.1): Me => ({ id: 'kai', x: CABIN.x, z: CABIN.z, heading: 0, arrived, dt, player: { x: 0, z: 0 } });
const restless: Omit<ErrandState, 'floor'> = { statusFor: 100, seatedFor: 100, restless: 30 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  for (const v of roofVisits(0)) endVisit(v.id);
  useStore.setState({ workers: {}, floors: [] });
  vi.useRealTimers();
});

describe('a roof break, downstairs', () => {
  it('walks into the cabin, rides up out of sight, and comes back out after its time up there', () => {
    const script = rideUp('kai', 'break');
    expect(script.tick(me(false))).toMatchObject({ do: 'walk', x: CABIN.x, z: CABIN.z, heading: 0 });
    expect(script.tick(me(true)).do).toBe('stand'); // in, turned to the doors
    expect(roofVisit('kai')).toBeNull();
    for (let i = 0; i < 10; i++) script.tick(me(true)); // the doors close on them
    const v = roofVisit('kai')!;
    expect(v).toMatchObject({ kind: 'break' });
    expect(v.seat).not.toBe('');
    expect(v.arrive).toBe(Date.now() + ROOF_BREAK.ride * 1000);
    expect(isHidden('kai')).toBe(true);
    // while they're up there they stay out of sight
    vi.setSystemTime(v.leave);
    expect(script.tick(me(true)).do).toBe('stand');
    expect(isHidden('kai')).toBe(true);
    // the ride back down: out of the cabin, then home (the errand director walks them)
    vi.setSystemTime(v.leave + ROOF_BREAK.ride * 1000);
    expect(script.tick(me(true)).do).toBe('stand');
    expect(isHidden('kai')).toBe(false);
    expect(roofVisit('kai')).toBeNull();
    let last = 'stand';
    for (let i = 0; i < 20 && last !== 'done'; i++) last = script.tick(me(true)).do;
    expect(last).toBe('done');
  });

  it('steps back out if the roof filled up while they walked over', () => {
    for (let i = 0; i < ROOF_BREAK.max; i++) startVisit({ id: `p${i}`, kind: 'break', seat: `chair-${i}`, arrive: Date.now(), leave: Date.now() + 60_000 });
    const script = rideUp('kai', 'break');
    script.tick(me(true));
    let act = 'stand';
    for (let i = 0; i < 10 && act === 'stand'; i++) act = script.tick(me(true)).do;
    expect(act).toBe('done');
    expect(isHidden('kai')).toBe(false);
  });

  it('is in sight again however it ends, and carries on up top unless work called them back', () => {
    const script = rideUp('kai', 'call');
    script.tick(me(true));
    for (let i = 0; i < 10; i++) script.tick(me(true));
    expect(isHidden('kai')).toBe(true);
    expect(roofVisit('kai')?.kind).toBe('call');
    script.end();
    expect(isHidden('kai')).toBe(false);
    expect(roofVisit('kai')).not.toBeNull(); // up top it carries on: follow them and they're there
    endVisit('kai');

    const busy = rideUp('kai', 'break');
    busy.tick(me(true));
    for (let i = 0; i < 10; i++) busy.tick(me(true));
    useStore.setState({ workers: { kai: { id: 'kai', role: 'worker', status: 'working' } as never } });
    busy.end();
    expect(roofVisit('kai')).toBeNull();
  });

  it('is an errand for the team on office floors and for the CEO on their own floor, rarely', () => {
    const team = errandNamed('roof')!;
    const ceo = errandNamed('roof-call')!;
    expect(team.when({ id: 'kai', role: 'worker', status: 'idle' }, { ...restless, floor: 'office' })).toBe(true);
    expect(team.when({ id: 'kai', role: 'worker', status: 'working' }, { ...restless, floor: 'office' })).toBe(false);
    expect(team.when({ id: 'kai', role: 'worker', status: 'idle' }, { ...restless, seatedFor: 5, floor: 'office' })).toBe(false);
    expect(team.when({ id: 'boss', role: 'ceo', status: 'idle' }, { ...restless, floor: 'lobby' })).toBe(false);
    expect(ceo.when({ id: 'boss', role: 'ceo', status: 'idle' }, { ...restless, floor: 'lobby' })).toBe(false);
    expect(ceo.when({ id: 'boss', role: 'ceo', status: 'idle' }, { ...restless, floor: 'ceo' })).toBe(true);
    expect(team.spot).toEqual(['elevator']);
    expect(team.weight).toBeLessThan(0.5);
  });
});

describe('arriving on a floor', () => {
  it("ends the visits of the people who work there (they're at their desks), and nobody else's", () => {
    useStore.setState({
      floors: [{ id: 'repo-a', floor: 1 }] as never,
      workers: { kai: { id: 'kai', role: 'worker', floorId: 'repo-a' }, mo: { id: 'mo', role: 'worker', floorId: 'repo-b' }, boss: { id: 'boss', role: 'ceo', floorId: '' } } as never,
    });
    const up = (id: string) => startVisit({ id, kind: id === 'boss' ? 'call' : 'break', seat: id === 'boss' ? '' : `seat-${id}`, arrive: Date.now(), leave: Date.now() + 60_000 });
    for (const id of ['kai', 'mo', 'boss']) up(id);
    useView.getState().setFloor(1);
    expect(roofVisits().map((v) => v.id).sort()).toEqual(['boss', 'mo']);
    useView.getState().setFloor(CEO_FLOOR);
    expect(roofVisits().map((v) => v.id)).toEqual(['mo']);
  });
});
