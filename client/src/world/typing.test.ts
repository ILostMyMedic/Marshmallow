// Adapted from cubefarm client/src/world/typing.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import { burstLevel, handLift, mouseDip, poseFor, tapSpeed, THINK_AFTER_MS, typingSeed } from './typing';

describe('the rhythm', () => {
  it('keeps the burst, tap and mouse maths', () => {
    for (let t = 0; t < 40; t += 0.137) {
      expect(burstLevel(t)).toBe(Math.sin(t * 0.8) + Math.sin(t * 2.1) * 0.6 > -0.35 ? 1 : 0.15);
      expect(handLift(t, 19, 2.4)).toBe(Math.max(0, Math.sin(t * 19 + 2.4)));
      expect(mouseDip(t)).toBe(Math.sin(t * 5.3) > 0.93 ? 0.04 : 0);
    }
    expect(tapSpeed('working')).toBe(19);
    expect(tapSpeed('preparing')).toBe(10);
  });

  it('gives each person a stable offset', () => {
    expect(typingSeed('ada')).toBe(typingSeed('ada'));
    expect(typingSeed('ada')).not.toBe(typingSeed('bob'));
    expect(typingSeed('ada')).toBeGreaterThanOrEqual(0);
    expect(typingSeed('ada')).toBeLessThan(100);
  });
});

describe('poseFor', () => {
  it('picks the pose from the status, what they are doing and how long their session has been quiet', () => {
    expect(poseFor('preparing', null, 1e9, false)).toBe('typing');
    expect(poseFor('working', 'edit', 0, false)).toBe('typing');
    expect(poseFor('working', 'edit', THINK_AFTER_MS - 1, false)).toBe('typing');
    expect(poseFor('working', 'read', THINK_AFTER_MS + 1, false)).toBe('thinking');
    expect(poseFor('working', 'browse', THINK_AFTER_MS + 1, false)).toBe('browsing');
    expect(poseFor('error', null, 0, false)).toBe('slump');
    expect(poseFor('done', null, 0, true)).toBe('cheer');
    expect(poseFor('idle', 'edit', 0, false)).toBe('relaxed');
  });
});
