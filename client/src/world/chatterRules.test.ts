// Adapted from cubefarm client/src/ui/babbleRules.test.ts (MIT): the bubbles' and speakers' cases.
import { describe, expect, it } from 'vitest';
import { DROP_NEW, EVENT_GAP, MAX_SPEAKERS, PACE, PLAY, admitSpeaker, bubbleSeconds, mayTalk } from './chatterRules';

describe('bubbleSeconds', () => {
  it('stays up long enough to read, but not forever', () => {
    expect(bubbleSeconds('Hi!')).toBe(2.4);
    expect(bubbleSeconds('Ugh, a merge conflict in store.ts')).toBeGreaterThan(3);
    expect(bubbleSeconds('x'.repeat(200))).toBe(5.5);
  });
});

describe('admitSpeaker', () => {
  it('lets anyone speak while there is room', () => {
    expect(admitSpeaker([], 10)).toBe(PLAY);
    expect(admitSpeaker([{ d: 1 }, { d: 2 }], 30)).toBe(PLAY);
  });

  it(`at ${MAX_SPEAKERS} voices, the nearest win: a nearer one cuts the farthest off, a farther one waits`, () => {
    const three = [{ d: 4 }, { d: 9 }, { d: 2 }];
    expect(admitSpeaker(three, 3)).toBe(1);
    expect(admitSpeaker(three, 9)).toBe(DROP_NEW);
    expect(admitSpeaker(three, 12)).toBe(DROP_NEW);
  });
});

describe('mayTalk', () => {
  const quiet = PACE.quiet;
  it('always lets a greeting or a chat line through', () => {
    expect(mayTalk('greet', quiet, 10, 9.9, 9.9)).toBe(true);
    expect(mayTalk('chat', quiet, 10, 9.9, 9.9)).toBe(true);
  });

  it('spaces news out across the floor and per person', () => {
    expect(mayTalk('event', quiet, 10, -Infinity, 10 - quiet.floorGap + 0.1)).toBe(false);
    expect(mayTalk('event', quiet, 10, -Infinity, 10 - quiet.floorGap)).toBe(true);
    expect(mayTalk('event', quiet, 10, 10 - EVENT_GAP + 0.1, -Infinity)).toBe(false);
    expect(mayTalk('event', quiet, 10, 10 - EVENT_GAP, -Infinity)).toBe(true);
  });

  it('keeps small talk about work rarer than news', () => {
    const lively = PACE.lively;
    expect(mayTalk('ambient', lively, 100, 100 - lively.workerGap + 1, -Infinity)).toBe(false);
    expect(mayTalk('ambient', lively, 100, 100 - lively.workerGap, -Infinity)).toBe(true);
    expect(mayTalk('ambient', lively, 100, -Infinity, 100 - lively.floorGap)).toBe(false);
  });

  it('is livelier when lively: shorter gaps, and small talk about work', () => {
    expect(PACE.lively.floorGap).toBeLessThan(PACE.quiet.floorGap);
    expect(PACE.lively.workerGap).toBeLessThan(PACE.quiet.workerGap);
    expect(PACE.quiet.ambient).toBeNull();
    expect(PACE.lively.ambient).not.toBeNull();
  });
});
