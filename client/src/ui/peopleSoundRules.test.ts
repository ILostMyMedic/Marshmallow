// Adapted from cubefarm client/src/ui/peopleSoundRules.test.ts (MIT): the chats' and gestures' cases are cut with them.
import { describe, expect, it } from 'vitest';
import type { Stage } from '../world/body';
import { HEAR_RANGE, hearPerson, MAX_WALKERS, newHearing, type Frame, type Hearing, type PersonEvent } from './peopleSoundRules';

const frame = (f: Partial<Frame> = {}): Frame => ({ stage: 'seated', speed: 0, phase: 0, d: 3, ...f });

/** Feed one person a run of frames, collecting everything they ask to play. */
function run(frames: Partial<Frame>[], h = newHearing(), people: Hearing[] = [h]) {
  const out: PersonEvent[] = [];
  for (const f of frames) out.push(...hearPerson(h, frame(f), people));
  return out;
}

/** Walking frames: the walk cycle advancing by `step` radians a frame. */
const walking = (n: number, f: Partial<Frame> = {}, step = 0.8) => Array.from({ length: n }, (_, i) => ({ stage: 'up' as Stage, speed: 1.1, phase: (i * step) % (Math.PI * 2), ...f }));

describe('hearPerson: the chair', () => {
  it('is quiet while someone sits at their desk', () => {
    expect(run([{}, {}, {}])).toEqual([]);
  });

  it('rolls and creaks once as they get up, rolls as they sit and creaks as they settle', () => {
    const stages: Stage[] = ['seated', 'rising', 'rising', 'up', 'up', 'sitting', 'sitting', 'seated', 'seated'];
    expect(run(stages.map((stage) => ({ stage })))).toEqual(['rise', 'sit', 'seated']);
  });

  it('sits back down when they change their mind halfway up', () => {
    expect(run([{ stage: 'seated' }, { stage: 'rising' }, { stage: 'sitting' }, { stage: 'seated' }])).toEqual(['rise', 'sit', 'seated']);
  });
});

describe('hearPerson: footsteps', () => {
  it('steps each half walk cycle, in time with their pace, and scuffs once on stopping', () => {
    const slow = run([...walking(16, {}, 0.6), { stage: 'up', speed: 0, phase: 9.6 % (Math.PI * 2) }]);
    const brisk = run(walking(16, {}, 1.2));
    expect(slow.filter((e) => e === 'step').length).toBe(2); // 0 to 9 rad: the phase crosses π and 2π
    expect(slow.at(-1)).toBe('scuff');
    expect(brisk.filter((e) => e === 'step').length).toBeGreaterThan(slow.filter((e) => e === 'step').length);
  });

  it('is silent past HEAR_RANGE', () => {
    expect(run(walking(16, { d: HEAR_RANGE + 1 }))).toEqual(['rise']); // the chair is left to the mixer's own cut-off
  });

  it(`only the ${MAX_WALKERS} walkers nearest you are heard`, () => {
    const people = Array.from({ length: 6 }, () => newHearing());
    const heard = people.map(() => 0);
    for (const f of walking(20))
      people.forEach((h, n) => {
        heard[n] += hearPerson(h, frame({ ...f, d: 2 + n }), people).filter((e) => e === 'step').length;
      });
    expect(heard.slice(0, MAX_WALKERS).every((n) => n > 0)).toBe(true);
    expect(heard.slice(MAX_WALKERS)).toEqual([0, 0, 0]);
  });

  it("someone standing still doesn't count against the nearest few", () => {
    const idle = Array.from({ length: 4 }, () => newHearing());
    const walker = newHearing();
    const people = [...idle, walker];
    idle.forEach((h) => hearPerson(h, frame({ stage: 'up', d: 1 }), people));
    expect(run(walking(12, { d: 8 }), walker, people)).toContain('step');
  });
});
