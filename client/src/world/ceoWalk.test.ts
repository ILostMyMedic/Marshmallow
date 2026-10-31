import { beforeEach, describe, expect, it } from 'vitest';
import { CEO_WALK, ceoWalks, nextWalkGap, tickWalkClock, walkDue, walkHours, walkStarted } from './ceoWalk';

describe("the CEO's walks", () => {
  beforeEach(() => {
    ceoWalks.watched = 0;
    ceoWalks.at = -1;
  });

  it('comes a while after you start watching, then every so often after each walk', () => {
    tickWalkClock(0, () => 0);
    expect(ceoWalks.at).toBe(CEO_WALK.first[0]);
    tickWalkClock(CEO_WALK.first[0] - 1);
    expect(walkDue(10)).toBe(false);
    tickWalkClock(1);
    expect(walkDue(10)).toBe(true);
    walkStarted(() => 1);
    expect(ceoWalks.at).toBe(CEO_WALK.first[0] + CEO_WALK.gap[1]);
    expect(walkDue(10)).toBe(false);
  });

  it('only in office hours', () => {
    expect(walkHours(7.9)).toBe(false);
    expect(walkHours(8)).toBe(true);
    expect(walkHours(21)).toBe(false);
    tickWalkClock(1000, () => 0);
    expect(walkDue(22)).toBe(false);
  });

  it('spaces the walks out', () => {
    expect(nextWalkGap(0)).toBe(CEO_WALK.gap[0]);
    expect(nextWalkGap(0.5, true)).toBe((CEO_WALK.first[0] + CEO_WALK.first[1]) / 2);
  });
});
