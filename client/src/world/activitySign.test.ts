import { describe, expect, it } from 'vitest';
import { BUBBLE, SIGN_HEIGHT, signHeight } from './activitySign';

describe('signHeight', () => {
  it('floats over the head seated and over the name tag standing', () => {
    expect(signHeight(1, false)).toBe(SIGN_HEIGHT.seated);
    expect(signHeight(0, false)).toBe(SIGN_HEIGHT.standing);
    expect(signHeight(0.5, false)).toBeCloseTo((SIGN_HEIGHT.seated + SIGN_HEIGHT.standing) / 2);
  });

  it('moves up out of a standing speaker’s bubble, and stays put over a seated one', () => {
    expect(signHeight(0, true)).toBe(BUBBLE.clear);
    expect(signHeight(1, true)).toBe(SIGN_HEIGHT.seated);
  });
});
