// The match's seats (pongState.ts, adapted from cubefarm's toys/pongState.ts, MIT): two workers taking the ends, the
// paddles they pick up, and what's left when they go.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bothReady,
  claimSeat,
  holdsPaddle,
  leaveSeat,
  npcPong,
  paddleTaken,
  pongMatch,
  pongPaddle,
  readySeat,
  resetPong,
  seatOf,
  setNpcPong,
  startNpcMatch,
  subscribePong,
  tableFree,
  wantsOpponent,
} from './pongState';

afterEach(resetPong);

const move = { x: 1, z: 2, heading: 0, speed: 2, gesture: 'paddle' as const, paddle: { x: 1, y: 1, z: 2 } };

describe('taking the ends', () => {
  it('a starter takes the free table, and the other end waits for someone', () => {
    expect(tableFree()).toBe(true);
    expect(wantsOpponent()).toBeNull();
    expect(startNpcMatch('ada', 'east')).toBe('east');
    expect(tableFree()).toBe(false);
    expect(seatOf('ada')).toBe('east');
    expect(wantsOpponent()).toBe('west');
    // the table is taken: nobody else starts a game at it
    expect(startNpcMatch('grace', 'west')).toBeNull();
  });

  it('one worker answers, and then nobody else can', () => {
    startNpcMatch('ada', 'west');
    expect(claimSeat('linus')).toBe('east');
    expect(seatOf('linus')).toBe('east');
    expect(wantsOpponent()).toBeNull();
    expect(claimSeat('grace')).toBeNull();
    expect(seatOf('grace')).toBeNull();
  });

  it('nobody answers a table nobody is at', () => {
    expect(claimSeat('linus')).toBeNull();
    expect(pongMatch()).toBeNull();
  });

  it('every game is a new match', () => {
    startNpcMatch('ada', 'west');
    const first = pongMatch()!.id;
    leaveSeat('ada');
    startNpcMatch('ada', 'west');
    expect(pongMatch()!.id).toBeGreaterThan(first);
  });
});

describe('the paddles', () => {
  it('are picked up as each one gets to their end, and the game can start once both have', () => {
    startNpcMatch('ada', 'west');
    claimSeat('linus');
    expect(holdsPaddle('ada')).toBe(false);
    expect(paddleTaken('west')).toBe(false);
    readySeat('ada');
    expect(holdsPaddle('ada')).toBe(true);
    expect(paddleTaken('west')).toBe(true);
    expect(paddleTaken('east')).toBe(false);
    expect(bothReady(pongMatch()!)).toBe(false);
    readySeat('linus');
    expect(bothReady(pongMatch()!)).toBe(true);
  });

  it("someone who isn't at the table holds none", () => {
    startNpcMatch('ada', 'west');
    readySeat('grace');
    expect(holdsPaddle('grace')).toBe(false);
  });

  it('go where the runner puts them, and only while it does', () => {
    startNpcMatch('ada', 'west');
    expect(pongPaddle('ada')).toBeNull();
    setNpcPong('ada', move);
    expect(npcPong('ada')).toEqual(move);
    expect(pongPaddle('ada')).toEqual(move.paddle);
    setNpcPong('ada', { ...move, gesture: 'cheer', paddle: null });
    expect(pongPaddle('ada')).toBeNull();
    setNpcPong('ada', null);
    expect(npcPong('ada')).toBeNull();
  });
});

describe('leaving', () => {
  it('mid-game stops it: the score starts again and the end is free for someone else', () => {
    startNpcMatch('ada', 'west');
    claimSeat('linus');
    readySeat('ada');
    readySeat('linus');
    const m = pongMatch()!;
    m.phase = 'rally';
    m.game.score.west = 4;
    setNpcPong('linus', move);
    leaveSeat('linus');
    expect(m.phase).toBe('waiting');
    expect(m.game.score).toEqual({ west: 0, east: 0 });
    expect(npcPong('linus')).toBeNull();
    expect(paddleTaken('east')).toBe(false);
    expect(wantsOpponent()).toBe('east');
  });

  it('after the game keeps it over, so nobody comes for a new one', () => {
    startNpcMatch('ada', 'west');
    claimSeat('linus');
    const m = pongMatch()!;
    m.phase = 'over';
    leaveSeat('linus');
    expect(m.phase).toBe('over');
    expect(wantsOpponent()).toBeNull();
  });

  it('by the last one clears the table', () => {
    startNpcMatch('ada', 'west');
    claimSeat('linus');
    leaveSeat('ada');
    expect(tableFree()).toBe(false);
    leaveSeat('linus');
    expect(tableFree()).toBe(true);
    expect(pongMatch()).toBeNull();
  });

  it('when the table goes away, nobody plays there any more', () => {
    startNpcMatch('ada', 'west');
    claimSeat('linus');
    setNpcPong('ada', move);
    resetPong();
    expect(pongMatch()).toBeNull();
    expect(seatOf('ada')).toBeNull();
    expect(npcPong('ada')).toBeNull();
  });
});

describe('listening', () => {
  it('hears every change to the seats, once each, until it stops', () => {
    const fn = vi.fn();
    const off = subscribePong(fn);
    startNpcMatch('ada', 'west');
    claimSeat('linus');
    readySeat('ada');
    readySeat('ada'); // already there: nothing changed
    leaveSeat('linus');
    expect(fn).toHaveBeenCalledTimes(4);
    off();
    leaveSeat('ada');
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("doesn't hear the runner moving people", () => {
    const fn = vi.fn();
    startNpcMatch('ada', 'west');
    const off = subscribePong(fn);
    setNpcPong('ada', move);
    expect(fn).not.toHaveBeenCalled();
    off();
  });
});
