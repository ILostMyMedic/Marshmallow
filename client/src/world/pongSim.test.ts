// Adapted from cubefarm client/src/world/toys/pongSim.test.ts (MIT): the ball's flight against the forecast, on the
// plain ball instead of Rapier; plus the floor and the net, which Rapier did for cubefarm. The match runner's cases
// (two workers playing a game) are in pongRunner.test.ts.
import { describe, expect, it } from 'vitest';
import { forecast, fromOwn, netBox, PONG, spinFor, TABLE, type BallState, type V3 } from './pongPhysics';
import { flyBall, SimBall } from './pongSim';

const R = PONG.ball.r;

/** Steps a ball for `seconds`, returning where it was after each step. */
function run(ball: SimBall, seconds: number) {
  const out: V3[] = [];
  for (let t = 0; t < seconds; t += PONG.step) {
    ball.step();
    out.push(ball.translation());
  }
  return out;
}

describe('the ball in flight', () => {
  // high over the table, so nothing but the air touches it
  const from = { ...fromOwn('west', 0.2, 0), y: TABLE.top + 0.7 };

  it('flies as the forecast says, spin and all', () => {
    const b: BallState = { p: from, v: { x: 6, y: 0.6, z: 0 }, w: spinFor({ x: 1, z: 0 }, 250, 200) };
    const real = flyBall(b, 0.35);
    const predicted: V3[] = [];
    forecast(b, (s) => void predicted.push({ ...s.p }), 0.35);
    expect(real.length).toBeGreaterThan(15);
    for (let i = 0; i < Math.min(real.length, predicted.length); i++) {
      expect(Math.hypot(real[i].x - predicted[i].x, real[i].y - predicted[i].y, real[i].z - predicted[i].z), `step ${i}`).toBeLessThan(0.01);
    }
  });

  it('curves with sidespin and dips with topspin, visibly', () => {
    const v = { x: 6, y: 0.6, z: 0 };
    const flat = flyBall({ p: from, v, w: { x: 0, y: 0, z: 0 } }, 0.35);
    const side = flyBall({ p: from, v, w: spinFor({ x: 1, z: 0 }, 0, 250) }, 0.35);
    const top = flyBall({ p: from, v, w: spinFor({ x: 1, z: 0 }, 350, 0) }, 0.35);
    const back = flyBall({ p: from, v, w: spinFor({ x: 1, z: 0 }, -300, 0) }, 0.35);
    const last = flat.length - 1;
    // to the hitter's right (+z, looking +x) and down by well over the ball's width; backspin holds it up
    expect(side[last].z - flat[last].z).toBeGreaterThan(0.12);
    expect(flat[last].y - top[last].y).toBeGreaterThan(0.12);
    expect(back[last].y - flat[last].y).toBeGreaterThan(0.08);
  });
});

describe('the floor', () => {
  it('a dropped ball bounces lower each time, never sinks into it, and comes to rest', () => {
    const ball = new SimBall({ x: 0, y: 1, z: 0 });
    const path = run(ball, 6);
    expect(Math.min(...path.map((p) => p.y))).toBeGreaterThanOrEqual(R - 1e-9);
    // the tops of its bounces
    const peaks = path.filter((p, i) => i > 0 && i < path.length - 1 && p.y > path[i - 1].y && p.y >= path[i + 1].y && p.y > R + 0.005).map((p) => p.y);
    expect(peaks.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]).toBeLessThan(peaks[i - 1]);
    expect(peaks[0]).toBeLessThan(1);
    expect(ball.resting).toBe(true);
  });

  it('a ball rolling on it slows to a stop', () => {
    const ball = new SimBall({ x: 0, y: R, z: 0 });
    ball.setLinvel({ x: 2, y: 0, z: 0 });
    run(ball, 10);
    expect(Math.abs(ball.linvel().x)).toBeLessThan(0.01);
    expect(ball.translation().y).toBeCloseTo(R);
  });

  it('a held ball (no gravity) stays where it is put', () => {
    const ball = new SimBall({ x: TABLE.x, y: -1, z: TABLE.z });
    ball.setGravityScale(0);
    run(ball, 1);
    expect(ball.translation()).toEqual({ x: TABLE.x, y: -1, z: TABLE.z });
  });
});

describe('the net', () => {
  const net = netBox();
  const top = net.at[1] + net.half[1];

  it('stops a ball driven into it, however fast, and sends it back its own side', () => {
    for (const speed of [3, 8, 14]) {
      const ball = new SimBall({ x: TABLE.x - 0.2, y: TABLE.top + 0.1, z: TABLE.z });
      ball.setLinvel({ x: speed, y: 0, z: 0 });
      const path = run(ball, 0.15);
      expect(Math.max(...path.map((p) => p.x)), `${speed} m/s`).toBeLessThan(TABLE.x);
      expect(ball.linvel().x, `${speed} m/s`).toBeLessThanOrEqual(0);
    }
  });

  it('lets a ball over it pass', () => {
    const ball = new SimBall({ x: TABLE.x - 0.5, y: top + 0.15, z: TABLE.z });
    ball.setLinvel({ x: 6, y: 0.5, z: 0 });
    run(ball, 0.2);
    expect(ball.translation().x).toBeGreaterThan(TABLE.x + 0.3);
  });

  it('lets a ball past its end go by', () => {
    const ball = new SimBall({ x: TABLE.x - 0.5, y: TABLE.top + 0.07, z: net.at[2] + net.half[2] + 0.2 });
    ball.setLinvel({ x: 6, y: 0, z: 0 });
    run(ball, 0.2);
    expect(ball.translation().x).toBeGreaterThan(TABLE.x + 0.3);
  });
});
