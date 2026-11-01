import { describe, expect, it } from 'vitest';
import { better, GAP_MS, mayCue, messageCue, momentCue, RANK, type Cue } from './notifyRules';

describe('momentCue and messageCue', () => {
  it('gives every moment a cue', () => {
    expect(momentCue('merged')).toBe('merged');
    expect(momentCue('prOpened')).toBe('opened');
    expect(momentCue('qaPassed')).toBe('passed');
    expect(momentCue('qaFailed')).toBe('failed');
    expect(momentCue('issuesFiled')).toBe('issues');
    expect(momentCue('hired')).toBe('joined');
    expect(momentCue('left')).toBe('notice');
    expect(momentCue('earned')).toBe('coins');
  });

  it("lets a merge's chime win over the coins it earned, arriving together", () => {
    expect(better('coins', 'merged')).toBe('merged');
  });

  it("rings the phone for the CEO's replies and the office's notices, not for your own messages", () => {
    expect(messageCue('ceo')).toBe('message');
    expect(messageCue('office')).toBe('notice');
    expect(messageCue('manager')).toBeNull();
  });
});

describe('which cue plays', () => {
  it('puts trouble and questions first, then a merge, then the small news', () => {
    const order: Cue[] = ['trouble', 'question', 'merged', 'message', 'failed', 'passed', 'opened', 'issues'];
    for (let i = 1; i < order.length; i++) expect(RANK[order[i - 1]]).toBeGreaterThanOrEqual(RANK[order[i]]);
  });

  it('keeps the most important of news arriving together', () => {
    expect(better(null, 'opened')).toBe('opened');
    expect(better('opened', 'merged')).toBe('merged');
    expect(better('trouble', 'merged')).toBe('trouble');
    expect(better('passed', 'notice')).toBe('passed'); // a tie keeps the first
  });

  it('spaces cues out, letting through only something more important inside the gap', () => {
    expect(mayCue(GAP_MS, RANK.merged, RANK.opened)).toBe(true);
    expect(mayCue(GAP_MS - 100, RANK.merged, RANK.opened)).toBe(false);
    expect(mayCue(100, RANK.opened, RANK.trouble)).toBe(true);
    expect(mayCue(100, RANK.merged, RANK.merged)).toBe(false);
  });
});
