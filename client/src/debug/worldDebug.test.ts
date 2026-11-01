import { describe, expect, it } from 'vitest';
import { EVENT_IDS, EVENTS } from '../../../shared/worldEvents';
import { eventGroups, eventHint, labelOf, logLine, nextPick, span, timeLeft } from './worldDebug';

const NOW = 1_800_000_000_000;

describe('the debug page’s world events', () => {
  it('lists every event once, in its group', () => {
    const groups = eventGroups();
    expect(groups.map((g) => g.title)).toEqual(['Everyday', 'Big', 'Street']);
    expect(groups.flatMap((g) => g.events.map((e) => e.id)).sort()).toEqual([...EVENT_IDS].sort());
    expect(groups[0].events.map((e) => e.id)).toContain('plane');
    expect(groups[1].events.map((e) => e.id)).toContain('duck');
    expect(groups[2].events.map((e) => e.id)).toEqual(['rockbus', 'icecream', 'firetruck', 'foodtruck', 'parade']);
    expect(eventHint(EVENTS.parade)).toBe('weird, draws a crowd, with a note · 95 s');
    expect(eventHint(EVENTS.plane)).toBe('everyday · 70 s');
  });

  it('counts down what’s on, and says when the director picks next', () => {
    expect(span(45.4)).toBe('45 s');
    expect(span(185)).toBe('3 min 05 s');
    expect(timeLeft({ startedAt: NOW - 30_000, seconds: 77 }, NOW)).toBeCloseTo(47);
    expect(timeLeft({ startedAt: NOW - 90_000, seconds: 77 }, NOW)).toBe(0);
    expect(nextPick(NOW + 125_000, NOW)).toBe('in 2 min 05 s');
    expect(nextPick(NOW + 500, NOW)).toBe('any moment now');
    expect(nextPick(0, NOW)).toBe('not scheduled yet');
  });

  it('says what ran, who started it and how it ended', () => {
    const e = { key: 3, id: 'rockbus', side: 'west' as const, forced: true, startedAt: NOW - 120_000, endsAt: NOW - 43_000 };
    expect(logLine(e, NOW)).toBe('A rock band playing on a tour bus · west · on demand · ran 1 min 17 s');
    expect(logLine({ ...e, endsAt: NOW - 100_000, forced: false }, NOW)).toBe('A rock band playing on a tour bus · west · the director · ended early after 20 s');
    expect(logLine({ ...e, endsAt: NOW + 5000 }, NOW)).toContain('still on');
    expect(labelOf('kaiju')).toBe('kaiju');
  });
});
