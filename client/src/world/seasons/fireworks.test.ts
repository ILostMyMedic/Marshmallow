import { describe, expect, it } from 'vitest';
import { launchesBetween, showPlan } from './Fireworks';

describe("a fireworks show's plan", () => {
  it('is the same for the same seed, in time order, inside the show, with a finale', () => {
    const plan = showPlan(7, 0, 100, { side: 1, burst: 30, finale: true });
    expect(showPlan(7, 0, 100, { side: 1, burst: 30, finale: true })).toEqual(plan);
    expect(plan.map((l) => l.at)).toEqual([...plan.map((l) => l.at)].sort((a, b) => a - b));
    for (const l of plan) {
      expect(l.at).toBeGreaterThan(0);
      expect(l.at).toBeLessThan(100);
      // over the city on its side, high up
      expect(l.x).toBeGreaterThan(50);
      expect(l.y).toBeGreaterThanOrEqual(30);
    }
    expect(plan.filter((l) => l.at > 88).length).toBeGreaterThanOrEqual(9);
  });

  it("goes up each side in turn when it's all round the building", () => {
    const plan = showPlan(3, 600, 30, { side: 0, burst: 30, finale: false, every: [0.6, 1.6] });
    expect(plan.length).toBeGreaterThan(15);
    const west = plan.filter((l) => l.x < 0).length;
    expect(Math.abs(west - (plan.length - west))).toBeLessThanOrEqual(1);
    for (const l of plan) expect(l.at).toBeGreaterThan(600);
  });

  it('hands out each launch once as its moment comes', () => {
    const plan = showPlan(9, 0, 60, { side: -1, burst: 30, finale: false });
    const seen = [];
    for (let t = 0; t < 60; t += 0.5) seen.push(...launchesBetween(plan, t, t + 0.5));
    expect(seen).toEqual(plan);
  });
});
