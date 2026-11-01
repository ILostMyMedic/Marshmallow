import { describe, expect, it } from 'vitest';
import { DESIGN_OF } from '../lab/designs';
import { BI, bindPositions, standHeight } from '../lab/rig';
import { seededAppearance } from './appearance';
import { BODY_STYLES, DEFAULT_BODY_STYLE, DESK_SEAT, EYE_HEIGHTS, HEAD_LIFT, headMiddle, headTop, headY, parseBodyStyle, playerScale, SEATED_EYES, STYLE_BUILD } from './bodyStyle';

const looks = [0.9, 1, 1.1].map((height, i) => ({ ...seededAppearance({ seed: 40 + i, role: 'worker' }), height }));

describe('the body styles', () => {
  it('are the lab’s chibi and stylized human, the human by default', () => {
    expect([...BODY_STYLES]).toEqual(['chibi', 'human']);
    expect(DEFAULT_BODY_STYLE).toBe('human');
    expect(parseBodyStyle('chibi')).toBe('chibi');
    expect(parseBodyStyle('blocks')).toBe('human');
    expect(parseBodyStyle(undefined)).toBe('human');
  });

  it('know each design’s build: hips, head and seat as the designs make them, for any height', () => {
    for (const style of BODY_STYLES)
      for (const look of looks)
        for (const role of ['worker', 'ceo'] as const) {
          const built = DESIGN_OF[style].build(look, role);
          const p = built.props;
          const head = bindPositions(p)[BI.head][1];
          expect(standHeight(p)).toBeCloseTo(STYLE_BUILD[style].hips, 5);
          expect(head).toBeCloseTo(headMiddle(style, look.height), 5);
          expect(p.headR).toBeCloseTo(STYLE_BUILD[style].headR * look.height, 5);
          expect(p.seat).toBeCloseTo(STYLE_BUILD[style].seat, 5);
          expect(built.headScale).toBeCloseTo(STYLE_BUILD[style].headScale * look.height, 5);
          expect(headTop(style, look.height)).toBeCloseTo(head + p.headR, 5);
        }
  });

  it('stand the chibi a head shorter than the human, and the human a little taller than the old figure', () => {
    expect(headTop('chibi', 1)).toBeLessThan(headTop('human', 1) - 0.4);
    expect(HEAD_LIFT.human.standing).toBeGreaterThan(0);
    expect(HEAD_LIFT.human.standing).toBeLessThan(0.3);
    expect(HEAD_LIFT.chibi.standing).toBeLessThan(-0.3);
    // sat at a desk the two come out about level: the chibi's big head makes up for its short body
    expect(Math.abs(headTop('chibi', 1, DESK_SEAT) - headTop('human', 1, DESK_SEAT))).toBeLessThan(0.15);
  });

  it('put your eyes where the camera is, in your own figure drawn near life size', () => {
    for (const style of BODY_STYLES)
      for (const look of looks) {
        const s = playerScale(style, look.height);
        expect(s).toBeGreaterThan(0.85);
        expect(s).toBeLessThan(1.2);
        const eyes = (headMiddle(style, look.height) + STYLE_BUILD[style].headR * look.height * 0.1) * s;
        expect(eyes).toBeCloseTo(EYE_HEIGHTS[style], 5);
      }
    expect(EYE_HEIGHTS.chibi).toBeLessThan(EYE_HEIGHTS.human);
    expect(SEATED_EYES.chibi).toBeLessThan(SEATED_EYES.human);
  });

  it('say where a head is, sat or standing', () => {
    for (const style of BODY_STYLES) {
      expect(headY(style, 0)).toBeCloseTo(headMiddle(style, 1), 5);
      expect(headY(style, 1)).toBeCloseTo(headMiddle(style, 1, DESK_SEAT), 5);
    }
  });
});
