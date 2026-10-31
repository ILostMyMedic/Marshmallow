// Adapted from cubefarm client/src/world/toys/pongSim.test.ts (MIT): the match runner's cases, on pongSim.ts's plain
// ball instead of Rapier. The player's drills and the forced rally are cut; waiting alone, someone leaving mid-game
// and the table going away are new.
import { afterEach, describe, expect, it } from 'vitest';
import { finalScore } from './pong';
import { PONG, TABLE } from './pongPhysics';
import { PongRunner, TIMING } from './pongRunner';
import { SimBall } from './pongSim';
import { claimSeat, holdsPaddle, leaveSeat, npcPong, pongMatch, pongPaddle, readySeat, resetPong, seatOf, startNpcMatch, wantsOpponent } from './pongState';

afterEach(resetPong);

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
