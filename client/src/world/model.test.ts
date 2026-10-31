import { describe, expect, it } from 'vitest';
import type { Moment } from '../../../shared/types';
import { CHEER_MS, lifeOf, PROUD_MS } from './model';

const T = 1_000_000;
const opened = (workerId: string, at: number): Moment => ({ type: 'prOpened', at, floorId: 'o/r', prNumber: 5, workerId, issueNumber: 1 });
const merged = (devWorkerId: string | null, at: number): Moment => ({ type: 'merged', at, floorId: 'o/r', prNumber: 5, devWorkerId });

describe('lifeOf', () => {
  it('works while their session runs or their desk is set up, and idles otherwise', () => {
    expect(lifeOf({ id: 'ada', status: 'working' }, [], T).state).toBe('working');
    expect(lifeOf({ id: 'ada', status: 'preparing' }, [], T).state).toBe('working');
    for (const status of ['idle', 'done', 'error', 'stopped'] as const) expect(lifeOf({ id: 'ada', status }, [], T).state).toBe('idle');
  });

  it('cheers for a while when their PR opens, then settles', () => {
    const ms = [opened('ada', T)];
    expect(lifeOf({ id: 'ada', status: 'done' }, ms, T + 1000)).toEqual({ state: 'celebrating', cheering: true, justMerged: false });
    expect(lifeOf({ id: 'ada', status: 'done' }, ms, T + CHEER_MS).state).toBe('idle');
    expect(lifeOf({ id: 'grace', status: 'done' }, ms, T + 1000).cheering).toBe(false); // someone else's PR
  });

  it('cheers a merge and stays proud of it after, but a new task comes first', () => {
    const ms = [merged('ada', T)];
    expect(lifeOf({ id: 'ada', status: 'idle' }, ms, T + 1000)).toEqual({ state: 'celebrating', cheering: true, justMerged: true });
    expect(lifeOf({ id: 'ada', status: 'idle' }, ms, T + CHEER_MS + 1)).toEqual({ state: 'idle', cheering: false, justMerged: true });
    expect(lifeOf({ id: 'ada', status: 'idle' }, ms, T + PROUD_MS).justMerged).toBe(false);
    expect(lifeOf({ id: 'ada', status: 'working' }, ms, T + 1000)).toMatchObject({ state: 'working', cheering: false });
    expect(lifeOf({ id: 'ada', status: 'idle' }, [merged(null, T)], T + 1000).cheering).toBe(false);
  });
});
