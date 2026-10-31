// Adapted from cubefarm client/src/ui/footstepRules.test.ts (MIT), with surfaceAt's cases from layout.test.ts.
import { describe, expect, it } from 'vitest';
import { DESK_ROWS, EXEC_DESK, HALF_D, HALF_W, LOBBY_RUG } from '../world/layout';
import { DECKING } from '../world/roof/roofLayout';
import { createStepTracker, surfaceAt, trackSteps, vary } from './footstepRules';

/** Feed the tracker a run of frames, collecting what it asks to play. */
function run(frames: [bobPhase: number, moving: boolean][]) {
  const t = createStepTracker();
  return { t, out: frames.map(([phase, moving]) => trackSteps(t, phase, moving)).filter(Boolean) };
}

describe('trackSteps', () => {
  it('is silent while standing still', () => {
    expect(run([[0, false], [0, false], [0, false]]).out).toEqual([]);
  });

  it('steps once per half bob cycle while moving, feet taking turns', () => {
    const t = createStepTracker();
    const feet: number[] = [];
    for (let phase = 0; phase < 4 * Math.PI; phase += 0.3) if (trackSteps(t, phase, true) === 'step') feet.push(t.foot);
    expect(feet).toEqual([0, 1, 0]); // phase crosses π, 2π and 3π
  });

  it('scuffs once when stopping after walking, then goes quiet', () => {
    const { out } = run([[0, true], [3.2, true], [3.3, false], [3.3, false], [3.3, false]]);
    expect(out).toEqual(['step', 'scuff']);
  });

  it("doesn't scuff after a nudge too short to take a step", () => {
    expect(run([[0, true], [0.4, true], [0.4, false]]).out).toEqual([]);
  });
});

describe('vary', () => {
  it('stays within ±10%', () => {
    expect(vary(0)).toBeCloseTo(0.9);
    expect(vary(0.5)).toBeCloseTo(1);
    expect(vary(0.9999)).toBeLessThan(1.1);
  });
});

describe('surfaceAt', () => {
  it('is wood between the desks and rug under them on an office floor', () => {
    expect(surfaceAt('office', 0, 9)).toBe('wood');
    expect(surfaceAt('office', 0, DESK_ROWS[0] + 0.35)).toBe('rug');
  });

  it("is the lobby's tiles, with its rug in front of the desk", () => {
    expect(surfaceAt('lobby', -12, -9)).toBe('lobby');
    expect(surfaceAt('lobby', (LOBBY_RUG.minX + LOBBY_RUG.maxX) / 2, (LOBBY_RUG.minZ + LOBBY_RUG.maxZ) / 2)).toBe('rug');
  });

  it("has the CEO's rug under their desk", () => {
    expect(surfaceAt('ceo', EXEC_DESK.x, EXEC_DESK.z + 1.5)).toBe('rug');
    expect(surfaceAt('ceo', 8, 9)).toBe('wood');
  });

  it('is paving out on a balcony, and the cabin past the elevator doors, on every floor', () => {
    for (const kind of ['office', 'lobby', 'ceo'] as const) {
      expect(surfaceAt(kind, HALF_W + 1, 0)).toBe('lobby');
      expect(surfaceAt(kind, 0, HALF_D + 1)).toBe('cabin');
    }
    expect(surfaceAt('roof', 0, HALF_D + 1)).toBe('cabin');
  });

  it("is the roof's decking on the east half and paving elsewhere", () => {
    expect(surfaceAt('roof', (DECKING.minX + DECKING.maxX) / 2, (DECKING.minZ + DECKING.maxZ) / 2)).toBe('wood');
    expect(surfaceAt('roof', -9, 1.5)).toBe('lobby');
  });
});
