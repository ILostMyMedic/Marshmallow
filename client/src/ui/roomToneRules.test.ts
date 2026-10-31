import { describe, expect, it } from 'vitest';
import { HALF_D, HALF_W } from '../world/layout';
import { CABIN_SHARE, CROWD_RADIUS, crowdNear, indoorShare, murmurLevel, nextRoomSoundIn, pickRoomSound, roomSoundSpot } from './roomToneRules';

describe('indoorShare', () => {
  it('is all of the room inside, on every indoor floor', () => {
    for (const kind of ['office', 'lobby', 'ceo'] as const) {
      expect(indoorShare(kind, 0, 0)).toBe(1);
      expect(indoorShare(kind, -(HALF_W - 1), 5)).toBe(1);
    }
  });

  it('fades as you step out onto a balcony, and is none out there or on the roof', () => {
    expect(indoorShare('office', HALF_W + 0.3, 0)).toBeGreaterThan(0);
    expect(indoorShare('office', HALF_W + 0.3, 0)).toBeLessThan(1);
    expect(indoorShare('office', -(HALF_W + 2), 0)).toBe(0);
    expect(indoorShare('roof', 0, 0)).toBe(0);
  });

  it('comes through the doorway into the elevator cabin', () => {
    expect(indoorShare('office', 0, HALF_D + 1)).toBe(CABIN_SHARE);
    expect(indoorShare('roof', 0, HALF_D + 1)).toBe(0);
  });
});

describe('the murmur', () => {
  it('counts the people near you, the nearer the more, and nobody past the radius', () => {
    expect(crowdNear([])).toBe(0);
    expect(crowdNear([0])).toBe(1);
    expect(crowdNear([CROWD_RADIUS / 2])).toBeCloseTo(0.5);
    expect(crowdNear([CROWD_RADIUS + 1, 40])).toBe(0);
  });

  it('is silent in an empty room, light with someone about, and grows with the crowd and with chats', () => {
    expect(murmurLevel(0, 0)).toBe(0);
    const one = murmurLevel(1, 0);
    expect(one).toBeGreaterThan(0);
    expect(murmurLevel(4, 0)).toBeGreaterThan(one);
    expect(murmurLevel(4, 3)).toBeGreaterThan(murmurLevel(4, 0));
    expect(murmurLevel(50, 20)).toBe(1);
  });
});

describe('small room sounds', () => {
  it('come every so often, a little sooner on a busy floor', () => {
    for (const r of [0, 0.5, 1]) {
      expect(nextRoomSoundIn(r, 0)).toBeGreaterThanOrEqual(14);
      expect(nextRoomSoundIn(r, 0)).toBeLessThanOrEqual(42);
    }
    expect(nextRoomSoundIn(0.5, 10)).toBeLessThan(nextRoomSoundIn(0.5, 0));
  });

  it("are the floor's own, and none on the roof", () => {
    const office = new Set(Array.from({ length: 50 }, (_, i) => pickRoomSound('office', i / 50)));
    expect(office).toEqual(new Set(['door', 'chair', 'phone', 'printer']));
    expect(new Set(Array.from({ length: 50 }, (_, i) => pickRoomSound('lobby', i / 50)))).toEqual(new Set(['door', 'phone']));
    expect(pickRoomSound('office', 1)).not.toBeNull();
    expect(pickRoomSound('roof', 0.5)).toBeNull();
  });

  it('come from somewhere in the room, a few metres away', () => {
    for (let i = 0; i < 40; i++) {
      const at = roomSoundSpot({ x: 0, z: 0 }, i / 40, (i % 7) / 7);
      expect(Math.abs(at.x)).toBeLessThan(HALF_W);
      expect(Math.abs(at.z)).toBeLessThan(HALF_D);
      expect(Math.hypot(at.x, at.z)).toBeGreaterThanOrEqual(4.9);
    }
    const corner = roomSoundSpot({ x: HALF_W - 1, z: HALF_D - 1 }, 0, 1);
    expect(corner.x).toBeLessThanOrEqual(HALF_W - 1);
  });
});
