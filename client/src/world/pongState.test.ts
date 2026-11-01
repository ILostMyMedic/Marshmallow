// The match's seats (pongState.ts, adapted from cubefarm's toys/pongState.ts, MIT): workers and the player taking the
// ends, the paddles they pick up, what's left when they go, and the player's paddle and view.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PONG_PLAYER } from './pong';
import { fromOwn, TABLE } from './pongPhysics';
import { serverOf } from './pongRules';
import {
  autopilot,
  bothReady,
  claimSeat,
  holdsPaddle,
  joinPong,
  leavePong,
  leaveSeat,
  npcPong,
  paddle,
  paddleAt,
  paddleSwing,
  paddleTaken,
  playerEnd,
  pongShake,
  pongChanged,
  pongClick,
  pongMatch,
  pongMouse,
  pongPaddle,
  pongView,
  readySeat,
  rematch,
  resetPong,
  seatOf,
  setNpcPong,
  shakeView,
  startNpcMatch,
  subscribePong,
  tableFree,
  tickPaddle,
  wantsOpponent,
} from './pongState';
import { useView } from './view';

afterEach(() => {
  resetPong();
  useView.setState({ held: null });
  autopilot.on = false;
});

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

/** Two workers at their ends, paddles in hand. */
function pair() {
  startNpcMatch('ada', 'west');
  claimSeat('linus');
  readySeat('ada');
  readySeat('linus');
  return pongMatch()!;
}

describe('the player picking up a paddle', () => {
  it('at a free table: that end is theirs, in their hand, and someone is wanted at the other', () => {
    expect(joinPong('west')).toBe('west');
    expect(playerEnd()).toBe('west');
    expect(useView.getState().held).toEqual({ kind: 'paddle', end: 'west' });
    expect(paddleTaken('west')).toBe(true);
    expect(tableFree()).toBe(false);
    expect(wantsOpponent()).toBe('east');
    expect(seatOf(PONG_PLAYER)).toBeNull(); // the player isn't one of the workers
    // a worker answers; the game can start once they're at their end
    expect(claimSeat('ada')).toBe('east');
    expect(bothReady(pongMatch()!)).toBe(false);
    readySeat('ada');
    expect(bothReady(pongMatch()!)).toBe(true);
  });

  it('where a worker waits: they take the other end and the worker stays', () => {
    startNpcMatch('ada', 'west');
    readySeat('ada');
    expect(joinPong('west')).toBe('east');
    expect(seatOf('ada')).toBe('west');
    expect(playerEnd()).toBe('east');
    expect(useView.getState().held).toEqual({ kind: 'paddle', end: 'east' });
    expect(bothReady(pongMatch()!)).toBe(true);
  });

  it('with two workers mid-game: they step in for whoever is at that end, and the game starts again', () => {
    const m = pair();
    m.phase = 'rally';
    m.game.score.west = 3;
    setNpcPong('linus', move);
    expect(joinPong('east')).toBe('east');
    expect(seatOf('linus')).toBeNull();
    expect(holdsPaddle('linus')).toBe(false);
    expect(npcPong('linus')).toBeNull(); // nothing left in their hand
    expect(seatOf('ada')).toBe('west');
    expect(m.phase).toBe('waiting');
    expect(m.game.score).toEqual({ west: 0, east: 0 });
    expect(bothReady(m)).toBe(true);
    // the one replaced walks off: their errand ending doesn't disturb the new game
    leaveSeat('linus');
    expect(playerEnd()).toBe('east');
    expect(pongMatch()).toBe(m);
  });

  it('again while playing changes nothing', () => {
    const m = pair();
    joinPong('west');
    m.phase = 'rally';
    m.game.score.east = 2;
    expect(joinPong('west')).toBe('west');
    expect(joinPong('east')).toBe('west');
    expect(m.phase).toBe('rally');
    expect(m.game.score.east).toBe(2);
    expect(seatOf('linus')).toBe('east');
  });

  it('centres the paddle', () => {
    pongMouse(200, -150);
    joinPong('east');
    expect(paddle.lat).toBe(0);
    expect(paddleAt('east')).toEqual({ ...fromOwn('east', 0.25, 0), y: TABLE.top + 0.2 });
  });
});

describe('the player putting the paddle down', () => {
  it('whatever empties their hands frees the end and stops the game; the worker waits for someone', () => {
    joinPong('west');
    claimSeat('ada');
    readySeat('ada');
    const m = pongMatch()!;
    m.phase = 'rally';
    m.game.score.west = 5;
    useView.getState().setHeld(null);
    expect(playerEnd()).toBeNull();
    expect(paddleTaken('west')).toBe(false);
    expect(m.phase).toBe('waiting');
    expect(m.game.score).toEqual({ west: 0, east: 0 });
    expect(wantsOpponent()).toBe('west');
    expect(seatOf('ada')).toBe('east');
  });

  it('picking something else up puts it down too', () => {
    joinPong('east');
    autopilot.on = true;
    useView.getState().setHeld({ kind: 'mug', id: 'mug-1', sips: 3 });
    expect(playerEnd()).toBeNull();
    expect(pongMatch()).toBeNull();
    expect(autopilot.on).toBe(false);
  });

  it('leavePong empties their hands, and the last one out clears the table', () => {
    joinPong('west');
    leavePong();
    expect(useView.getState().held).toBeNull();
    expect(tableFree()).toBe(true);
  });

  it('the table going away takes it out of their hands', () => {
    joinPong('west');
    resetPong();
    expect(useView.getState().held).toBeNull();
    expect(pongMatch()).toBeNull();
  });
});

describe("the player's paddle", () => {
  it('moves with the mouse: right to their right, up towards the net, within reach', () => {
    joinPong('west');
    pongMouse(100, -50);
    expect(paddle.lat).toBeCloseTo(0.24);
    expect(paddle.back).toBeCloseTo(0.13);
    pongMouse(100, 0, 2); // the look sensitivity scales it
    expect(paddle.lat).toBeCloseTo(0.72);
    pongMouse(10_000, -10_000);
    expect(paddle.lat).toBe(1);
    expect(paddle.back).toBe(-0.45);
    // west looks +x: their right is +z, and towards the net is +x
    const p = paddleAt('west');
    expect(p.z).toBeCloseTo(TABLE.z + 1);
    expect(p.x).toBeCloseTo(TABLE.x - TABLE.len / 2 + 0.45);
  });

  it('swings as fast as it moved: forward is towards the net', () => {
    joinPong('east');
    for (let i = 0; i < 12; i++) {
      pongMouse(0, -20); // 4.8 cm a frame towards the net
      tickPaddle(1 / 60);
    }
    expect(paddleSwing().forward).toBeGreaterThan(2);
    expect(Math.abs(paddleSwing().right)).toBeLessThan(1e-9);
    // held still, it settles
    for (let i = 0; i < 30; i++) tickPaddle(1 / 60);
    expect(Math.abs(paddleSwing().forward)).toBeLessThan(0.01);
  });

  it('swings as the autopilot says while it plays', () => {
    autopilot.on = true;
    autopilot.swing = { forward: 2.5, right: 0.8 };
    expect(paddleSwing()).toEqual({ forward: 2.5, right: 0.8 });
  });
});

describe("the player's view", () => {
  it('stays still until a smash, then shakes for a moment (the view itself: pongCam.test.ts)', () => {
    const still = pongShake(0);
    expect(Math.hypot(still.x, still.y, still.z)).toBe(0);
    shakeView(1);
    const now = performance.now();
    const s = pongShake(now + 50);
    expect(Math.hypot(s.x, s.y, s.z)).toBeGreaterThan(0);
    const after = pongShake(now + 400);
    expect(Math.hypot(after.x, after.y, after.z)).toBe(0);
  });
});

describe("the player's clicks", () => {
  it('serve on their serve, ask for a rematch after a game, and do nothing otherwise', () => {
    joinPong('west');
    claimSeat('ada');
    readySeat('ada');
    const m = pongMatch()!;
    pongClick();
    expect(m.ask).toBeNull(); // waiting: nothing to do
    m.phase = 'serve';
    m.game.first = 'east';
    pongClick();
    expect(m.ask).toBeNull(); // ada's serve
    m.game.first = 'west';
    expect(serverOf(m.game)).toBe('west');
    pongClick();
    expect(m.ask).toBe('serve');
    m.phase = 'over';
    pongClick();
    expect(m.ask).toBe('rematch');
    rematch(m, 'east');
    expect(m.phase).toBe('waiting');
    expect(m.ask).toBeNull();
    expect(serverOf(m.game)).toBe('east');
  });

  it("are nobody's without a paddle", () => {
    const m = pair();
    m.phase = 'over';
    pongClick();
    expect(m.ask).toBeNull();
  });
});

describe('the view a scoreboard shows', () => {
  it('names the ends, says which is yours, and stays the same object until something changes', () => {
    expect(pongView()).toBeNull();
    joinPong('east');
    claimSeat('ada');
    const v = pongView()!;
    expect(v).toMatchObject({ phase: 'waiting', west: 'ada', east: PONG_PLAYER, you: 'east', ready: { west: false, east: true } });
    expect(pongView()).toBe(v);
    readySeat('ada');
    expect(pongView()).not.toBe(v);
    expect(pongView()!.ready.west).toBe(true);
    const w = pongView();
    pongMatch()!.game.score.west = 1;
    pongChanged();
    expect(pongView()).not.toBe(w);
    expect(pongView()!.score.west).toBe(1);
  });
});
