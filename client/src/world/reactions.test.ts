// Adapted from cubefarm client/src/world/reactions.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import type { Moment } from '../../../shared/types';
import { momentsSince, neighboursOf, newlyErrored, reactionsTo } from './reactions';

const seats = new Map([
  ['ada', { seatX: 0, seatZ: 0 }],
  ['grace', { seatX: 7, seatZ: 0 }],
  ['linus', { seatX: 0, seatZ: 4.6 }],
  ['far', { seatX: 20, seatZ: 0 }],
]);
const passed: Moment = { type: 'qaPassed', at: 1, floorId: 'o/r', prNumber: 5, qaWorkerId: 'grace' };
const merged: Moment = { type: 'merged', at: 2, floorId: 'o/r', prNumber: 5, devWorkerId: 'ada' };

describe('reactions', () => {
  it('finds the desks around someone, nearest first', () => {
    expect(neighboursOf('ada', seats)).toEqual(['linus', 'grace']);
    expect(neighboursOf('nobody', seats)).toEqual([]);
  });

  it("pumps the author's fist at a QA pass and has their neighbours wave at a merge", () => {
    expect(reactionsTo(passed, { 'o/r#5': { devWorkerId: 'ada' } }, seats)).toEqual([{ id: 'ada', fidget: 'fistPump' }]);
    expect(reactionsTo(passed, {}, seats)).toEqual([]);
    expect(reactionsTo(merged, {}, seats)).toEqual([
      { id: 'linus', fidget: 'wave', toward: 'ada' },
      { id: 'grace', fidget: 'wave', toward: 'ada' },
    ]);
  });

  it('notices sessions that just failed', () => {
    expect(newlyErrored({ a: { status: 'working' }, b: { status: 'error' } }, { a: { status: 'error' }, b: { status: 'error' }, c: { status: 'error' } })).toEqual(['a']);
  });

  it('takes only the moments after the last one seen, by identity, so a full list still moves on', () => {
    const list = [passed, merged];
    expect(momentsSince(list, null)).toEqual(list);
    expect(momentsSince(list, passed)).toEqual([merged]);
    expect(momentsSince(list, merged)).toEqual([]);
  });
});
