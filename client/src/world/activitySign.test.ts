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

  it('moves with a body style’s heads, bubble and all', () => {
    const lift = { standing: 0.2, seated: 0.1 };
    expect(signHeight(1, false, lift)).toBeCloseTo(SIGN_HEIGHT.seated + 0.1);
    expect(signHeight(0, false, lift)).toBeCloseTo(SIGN_HEIGHT.standing + 0.2);
    expect(signHeight(0, true, lift)).toBeCloseTo(BUBBLE.clear + 0.2);
    expect(signHeight(0, true, { standing: -0.4, seated: 0 })).toBeCloseTo(BUBBLE.clear - 0.4);
  });
});
