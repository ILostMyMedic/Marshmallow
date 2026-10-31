// Adapted from cubefarm client/src/world/toys/pongSim.test.ts (MIT): the match runner's cases, on pongSim.ts's plain
// ball instead of Rapier. Waiting alone, someone leaving mid-game, the table going away, and the player's serve,
// rematch, stepping in and leaving are new.
import { afterEach, describe, expect, it } from 'vitest';
import { finalScore } from './pong';
import { otherEnd, PONG, TABLE } from './pongPhysics';
import { serverOf } from './pongRules';
import { PongRunner, TIMING, type DrillBall } from './pongRunner';
import { SimBall } from './pongSim';
import {
  autopilot,
  claimSeat,
  holdsPaddle,
  joinPong,
  leavePong,
  leaveSeat,
  npcPong,
  paddle,
  paddleAt,
  playerEnd,
  pongClick,
  pongMatch,
  pongPaddle,
  readySeat,
  resetPong,
  seatOf,
  startNpcMatch,
  wantsOpponent,
} from './pongState';

afterEach(() => {
  resetPong();
  autopilot.on = false;
});

/** A small seeded random, so a test plays the same game every time. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** The runner on a ball, stepped as PongMatch.tsx steps it. Workers are taken to be wherever they're sent. */
function table(rand = seeded(1)) {
  const ball = new SimBall();
  const said: [string, string | null][] = [];
  const runner = new PongRunner(ball, { bodyAt: () => null, say: (id, text) => void said.push([id, text]), rand });
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      runner.before();
      ball.step();
      runner.after();
    }
  };
  return { ball, runner, said, step };
}

/** Two workers at their ends, paddles in hand. */
function pair() {
  startNpcMatch('ada', 'west');
  claimSeat('linus');
  readySeat('ada');
  readySeat('linus');
  return pongMatch()!;
}

const SECOND = Math.round(1 / PONG.step);

describe('two workers', () => {
  it('play a whole game to 11, won by 2, with rallies, then both go back', () => {
    const t = table(seeded(11));
    const m = pair();
    for (let i = 0; i < SECOND * 900 && m.phase !== 'over'; i++) t.step();
    expect(m.phase).toBe('over');
    expect(finalScore(m.game.score.west, m.game.score.east)).toBe(true);
    expect(m.longest).toBeGreaterThanOrEqual(3);
    expect(m.last?.why).toBe('game');
    // the winner lifts a trophy and the loser sighs
    const winner = m.last!.winner === 'west' ? 'ada' : 'linus';
    const loser = winner === 'ada' ? 'linus' : 'ada';
    expect(t.said).toContainEqual([winner, '🏆']);
    expect(t.said).toContainEqual([loser, '😩']);
    // a moment to take it in, then they're sent back to their desks
    t.step(SECOND * TIMING.linger - 2 * SECOND);
    expect(seatOf('ada')).toBe('west');
    t.step(3 * SECOND);
    expect(pongMatch()).toBeNull();
    expect(seatOf('ada')).toBeNull();
    expect(npcPong('linus')).toBeNull();
    expect(t.runner.hidden).toBe(true);
  });

  it('serve after a toss, meet the ball with their paddles and keep their feet behind their own ends', () => {
    const t = table(seeded(4));
    const m = pair();
    t.step(2);
    expect(m.phase).toBe('serve');
    expect(t.runner.hidden).toBe(false); // the ball in the server's hand
    for (let i = 0; i < SECOND * 5 && m.phase === 'serve'; i++) t.step();
    expect(m.phase).not.toBe('serve');
    // how close each one's paddle came to the ball
    const nearest = { ada: Infinity, linus: Infinity };
    for (let i = 0; i < SECOND * 20; i++) {
      t.step();
      const b = t.ball.translation();
      for (const [id, end] of [['ada', 'west'], ['linus', 'east']] as const) {
        const x = npcPong(id)?.x ?? NaN;
        expect(end === 'west' ? x < TABLE.x - TABLE.len / 2 : x > TABLE.x + TABLE.len / 2, `${id} at ${x}`).toBe(true);
        const p = pongPaddle(id);
        if (p) nearest[id] = Math.min(nearest[id], Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z));
      }
    }
    expect(nearest.ada).toBeLessThan(0.05);
    expect(nearest.linus).toBeLessThan(0.05);
    expect(holdsPaddle('ada') && holdsPaddle('linus')).toBe(true);
  });
});

describe('waiting', () => {
  it('a worker alone at the table is left to wait: no ball, and the match moves nobody', () => {
    const t = table();
    startNpcMatch('ada', 'west');
    readySeat('ada');
    t.step(SECOND * 3);
    expect(pongMatch()!.phase).toBe('waiting');
    expect(npcPong('ada')).toBeNull();
    expect(t.runner.hidden).toBe(true);
    // someone's on the way: ada gets ready, but nobody serves till they're there
    claimSeat('linus');
    t.step(SECOND);
    expect(npcPong('ada')).not.toBeNull();
    expect(npcPong('linus')).toBeNull();
    expect(pongMatch()!.phase).toBe('waiting');
    readySeat('linus');
    t.step();
    expect(pongMatch()!.phase).toBe('serve');
  });

  it('someone leaving mid-game stops it: the ball goes, the score starts again, and the other waits', () => {
    const t = table(seeded(9));
    const m = pair();
    for (let i = 0; i < SECOND * 120 && m.game.score.west + m.game.score.east < 2; i++) t.step();
    expect(m.game.score.west + m.game.score.east).toBeGreaterThanOrEqual(2);
    leaveSeat('linus');
    t.step();
    expect(m.phase).toBe('waiting');
    expect(m.game.score).toEqual({ west: 0, east: 0 });
    expect(t.runner.hidden).toBe(true);
    expect(npcPong('ada')).toBeNull();
    expect(wantsOpponent()).toBe('east');
  });
});

describe('the table going away', () => {
  it('stops the ball and lets go of everyone', () => {
    const t = table(seeded(2));
    const m = pair();
    for (let i = 0; i < SECOND * 10 && m.phase !== 'rally'; i++) t.step();
    expect(m.phase).toBe('rally');
    t.runner.stop();
    expect(t.runner.hidden).toBe(true);
    expect(npcPong('ada')).toBeNull();
    expect(npcPong('linus')).toBeNull();
    expect(t.ball.translation().y).toBeLessThan(0);
  });
});

/** Feeds `queue` at the player and waits for the last return to play out; the drill's results. */
function drill(t: ReturnType<typeof table>, queue: DrillBall[]) {
  expect(t.runner.drill(queue)).toBe(true);
  for (let i = 0; i < SECOND * 120 && t.runner.liveView().drill?.left !== 0; i++) t.step();
  t.step(SECOND * 4);
  return t.runner.liveView().drill!.results;
}

describe("the player's returns", () => {
  it('land on the far half across a range of incoming balls', () => {
    const t = table(seeded(7));
    joinPong('west');
    autopilot.on = true;
    autopilot.swing = { forward: 1.2, right: 0 };
    const queue: DrillBall[] = [];
    for (const speed of [4.2, 6, 8]) for (const top of [-220, 0, 280]) for (const lat of [-0.5, 0.1, 0.55]) queue.push({ speed, top, side: lat > 0.3 ? -120 : 90, lat, depth: 0.55 + Math.abs(lat) * 0.6 });
    const results = drill(t, queue);
    expect(results).toHaveLength(queue.length);
    const missed = results.map((r, i) => ({ ...r, ball: queue[i] })).filter((r) => !r.landed);
    expect(missed).toEqual([]);
    expect(t.runner.liveView().returns).toEqual({ tried: queue.length, landed: queue.length });
  });

  it('with a swing still land, and a forward swing puts topspin on', () => {
    const t = table(seeded(3));
    joinPong('east');
    autopilot.on = true;
    autopilot.swing = { forward: 2.5, right: 0.8 };
    const results = drill(t, [
      { speed: 5, top: 100, side: 0, lat: 0, depth: 0.9 },
      { speed: 6, top: -150, side: 60, lat: -0.4, depth: 1.0 },
      { speed: 4.2, top: 0, side: 0, lat: 0.4, depth: 0.7 },
    ]);
    expect(results.every((r) => r.landed)).toBe(true);
    expect(t.runner.liveView().lastShot!.top).toBeGreaterThan(100);
  });

  it("come off a still paddle in the ball's way: it rises and falls to meet the ball by itself", () => {
    const t = table(seeded(2));
    joinPong('west');
    const ys: number[] = [];
    expect(t.runner.drill([{ speed: 5, top: 0, side: 0, lat: 0, depth: 0.8 }])).toBe(true);
    for (let i = 0; i < SECOND * 2 && t.runner.liveView().returns.tried === 0; i++) {
      t.step();
      ys.push(paddle.y);
    }
    expect(t.runner.liveView().returns.tried).toBe(1);
    expect(t.runner.liveView().lastShot!.by).toBe('west');
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.01);
  });

  it('miss when the paddle is nowhere near', () => {
    const t = table(seeded(2));
    joinPong('west');
    paddle.lat = 1;
    const results = drill(t, [{ speed: 5, top: 0, side: 0, lat: -0.4, depth: 0.8 }]);
    expect(results).toEqual([{ landed: false, why: 'missed' }]);
    expect(t.runner.liveView().returns.tried).toBe(0);
  });
});

describe('the player against a worker', () => {
  /** The player at `end`, a worker (ada) at the other, ready. */
  function vs(end: 'west' | 'east' = 'west') {
    joinPong(end);
    claimSeat('ada');
    readySeat('ada');
    return pongMatch()!;
  }

  it('serves first, tossing and hitting when they click, with the ball over their paddle till then', () => {
    const t = table(seeded(5));
    const m = vs('west');
    t.step(2);
    expect(m.phase).toBe('serve');
    expect(serverOf(m.game)).toBe('west');
    t.step(SECOND * 3);
    expect(m.phase).toBe('serve');
    const b = t.ball.translation();
    const p = paddleAt('west');
    expect(Math.hypot(b.x - p.x, b.z - p.z)).toBeLessThan(1e-9);
    pongClick();
    for (let i = 0; i < SECOND * 2 && m.phase === 'serve'; i++) t.step();
    expect(m.phase).toBe('rally');
    expect(t.runner.liveView().lastShot!.by).toBe('west');
    expect(npcPong('ada')?.gesture).toBe('paddle'); // the match moves her: she's got someone to play
  });

  it('with a forced rally, keep it going', () => {
    const t = table(seeded(5));
    const m = vs('west');
    autopilot.on = true;
    t.step(); // the runner takes up the match (a new one clears any forcing)
    t.runner.forced = 20;
    for (let i = 0; i < SECOND * 60 && t.runner.forced > 0; i++) t.step();
    expect(t.runner.forced).toBe(0);
    expect(m.game.score).toEqual({ west: 0, east: 0 });
    expect(m.rally).toBe(39); // ada's 20 clean returns, and the player's 19 in between (the serve isn't one)
  });

  it('play a whole game; a click asks for a rematch, the loser serving first', () => {
    const t = table(seeded(8));
    const m = vs('east');
    autopilot.on = true; // it serves and plays for them
    for (let i = 0; i < SECOND * 900 && m.phase !== 'over'; i++) t.step();
    expect(m.phase).toBe('over');
    expect(finalScore(m.game.score.west, m.game.score.east)).toBe(true);
    const loser = otherEnd(m.last!.winner);
    // the worker stays on for a rematch longer than two workers linger
    t.step(SECOND * (TIMING.linger + 1));
    expect(seatOf('ada')).toBe('west');
    pongClick();
    t.step(2);
    expect(m.phase).toBe('serve');
    expect(m.game.score).toEqual({ west: 0, east: 0 });
    expect(serverOf(m.game)).toBe(loser);
  });

  it('after a game with no rematch, the worker goes back; a click then brings someone new', () => {
    const t = table(seeded(8));
    const m = vs('east');
    m.phase = 'over';
    m.last = { winner: 'west', why: 'game' };
    t.step(SECOND * (TIMING.rematch + 1));
    expect(seatOf('ada')).toBeNull();
    expect(playerEnd()).toBe('east');
    expect(wantsOpponent()).toBeNull();
    pongClick();
    t.step();
    expect(m.phase).toBe('waiting');
    expect(wantsOpponent()).toBe('west');
  });

  it('stepping in for a worker mid-game starts a fresh one, the player serving', () => {
    const t = table(seeded(4));
    const m = pair();
    for (let i = 0; i < SECOND * 30 && m.game.score.west + m.game.score.east < 1; i++) t.step();
    expect(joinPong('east')).toBe('east');
    expect(npcPong('linus')).toBeNull();
    t.step(2);
    expect(m.phase).toBe('serve');
    expect(m.game.score).toEqual({ west: 0, east: 0 });
    expect(serverOf(m.game)).toBe('east');
    expect(npcPong('ada')).not.toBeNull();
  });

  it('leaving mid-rally stops it: the ball goes and the worker waits on their own', () => {
    const t = table(seeded(6));
    const m = vs('west');
    autopilot.on = true;
    for (let i = 0; i < SECOND * 10 && m.phase !== 'rally'; i++) t.step();
    expect(m.phase).toBe('rally');
    leavePong();
    t.step();
    expect(m.phase).toBe('waiting');
    expect(t.runner.hidden).toBe(true);
    expect(npcPong('ada')).toBeNull();
    expect(wantsOpponent()).toBe('west');
    expect(autopilot.on).toBe(false);
  });
});
