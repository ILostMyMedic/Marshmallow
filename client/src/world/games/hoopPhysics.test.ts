// The hoop's numbers (hoopPhysics.ts): the basket rule (adapted from cubefarm client/src/world/toys/hoopScore.test.ts, MIT),
// its frame in the room, the ball's flight off the board and rim, the arcade shot and a worker's casual aim.
import { describe, expect, it } from 'vitest';
import {
  aimHoop,
  chargePower,
  courtIn,
  CHARGE,
  dirToLocal,
  flyShot,
  HOLD,
  holdPoint,
  HOOP,
  hoopRim,
  hoopShot,
  hoopSquare,
  idealPower,
  LOCAL_RIM,
  newBall,
  newTrack,
  npcHoldPoint,
  npcShot,
  RIM_OUT,
  stepBall,
  stepHoop,
  toLocal,
  toWorld,
  BALL_STEP,
  type BallHit,
  type HoopPlace,
  type Rim,
  type Vec3,
} from './hoopPhysics';

const rim: Rim = { x: 0, y: 2.7, z: 0, r: 0.23 };

/** Run a path of ball centres through a fresh track; returns how many baskets it scored. */
function baskets(path: Vec3[], track = newTrack()) {
  let n = 0;
  for (const p of path) if (stepHoop(track, p, rim)) n++;
  return n;
}

/** Points from a to b in `steps` even steps (both ends included). */
function line(a: Vec3, b: Vec3, steps = 20): Vec3[] {
  return Array.from({ length: steps + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps, z: a.z + ((b.z - a.z) * i) / steps }));
}

/** A seeded random in [0, 1) (mulberry32). */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hoops on a north wall facing south (big-1's way) and on a south wall facing north (big-2's and big-3's). */
const NORTH_WALL: HoopPlace = { x: 11.4, z: -12, rotY: 0 };
const SOUTH_WALL: HoopPlace = { x: -12.4, z: 12, rotY: Math.PI };

/** The view of someone `dist` m straight out from the rim (and `side` m across), looking at the painted square. */
function viewAt(h: HoopPlace, dist: number, side = 0, eyeY = 1.65) {
  const eye = toWorld(h, { x: side, y: eyeY, z: RIM_OUT + dist }, { x: 0, y: 0, z: 0 });
  const sq = hoopSquare(h);
  const dx = sq.x - eye.x;
  const dz = sq.z - eye.z;
  return { eye, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(sq.y - eye.y, Math.hypot(dx, dz)) };
}

/** The player's shot from `dist` m out at `power`: where the ball leaves the hands, its velocity, and how it went. */
function playerShot(h: HoopPlace, dist: number, power: number, side = 0) {
  const view = viewAt(h, dist, side);
  const from = holdPoint(view, HOOP.ball.r, power * 0.25, { x: 0, y: 0, z: 0 });
  const v = { x: 0, y: 0, z: 0 };
  const assisted = hoopShot(view, from, power, HOOP.ball.throwSpeed, { rim: hoopRim(h), square: hoopSquare(h) }, v);
  return { from, v, assisted, ...flyShot(h, from, v) };
}

describe('stepHoop', () => {
  it('counts a ball falling straight down through the rim exactly once', () => {
    expect(baskets([...line({ x: 0, y: 3.5, z: 0 }, { x: 0, y: 0.12, z: 0 }), ...line({ x: 0, y: 0.12, z: 0 }, { x: 0, y: 1.2, z: 0 }, 5)])).toBe(1);
  });

  it('counts a swish on an arc, and a fast step that jumps over the rim plane', () => {
    expect(baskets(line({ x: 0, y: 3.2, z: -0.6 }, { x: 0, y: 2.2, z: 0.3 }))).toBe(1);
    expect(baskets([{ x: 0.05, y: 2.9, z: 0 }, { x: -0.05, y: 2.4, z: 0.1 }])).toBe(1);
  });

  it("doesn't count rim-outs or backboard misses that fall outside the rim", () => {
    expect(baskets([...line({ x: 0, y: 3.2, z: -1.5 }, { x: 0, y: 2.78, z: -0.3 }, 8), ...line({ x: 0, y: 2.78, z: -0.3 }, { x: 0, y: 0.12, z: -0.6 })])).toBe(0);
    expect(baskets(line({ x: 0.4, y: 3.1, z: 0.3 }, { x: 0.45, y: 0.12, z: -0.2 }))).toBe(0);
  });

  it("doesn't count a ball pushed up through the net from below, or it falling back in", () => {
    const track = newTrack();
    expect(baskets(line({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 3.0, z: 0 }), track)).toBe(0);
    expect(baskets(line({ x: 0, y: 3.0, z: 0 }, { x: 0, y: 1.5, z: 0 }), track)).toBe(0);
  });

  it('scores again once the ball has left the rim and comes back from above', () => {
    const track = newTrack();
    expect(baskets(line({ x: 0, y: 3.2, z: 0 }, { x: 0, y: 2.0, z: 0 }), track)).toBe(1);
    expect(baskets([...line({ x: 0, y: 2.0, z: 0 }, { x: 0, y: 2.9, z: 0 }, 6), ...line({ x: 0, y: 2.9, z: 0 }, { x: 0, y: 2.0, z: 0 }, 6)], track)).toBe(0);
    expect(baskets(line({ x: 0, y: 2.0, z: 0 }, { x: 0, y: 0.12, z: 2 }), track)).toBe(0);
    expect(baskets([...line({ x: 0, y: 1.2, z: 3 }, { x: 0, y: 3.4, z: -0.2 }), ...line({ x: 0, y: 3.4, z: -0.2 }, { x: 0, y: 2.2, z: 0 })], track)).toBe(1);
  });

  it('ignores a respawn that teleports the ball across the rim', () => {
    expect(baskets([{ x: 0, y: 5, z: 0 }, { x: 0, y: 0.12, z: 0 }])).toBe(0);
  });
});

describe('where the hoop hangs', () => {
  it('turns its frame into the room and back', () => {
    for (const h of [NORTH_WALL, SOUTH_WALL, { x: 3, z: -1, rotY: Math.PI / 2 }]) {
      const p = { x: 0.3, y: 1.2, z: 2.1 };
      const back = toLocal(h, toWorld(h, p, { x: 0, y: 0, z: 0 }), { x: 0, y: 0, z: 0 });
      expect(back.x).toBeCloseTo(p.x);
      expect(back.y).toBeCloseTo(p.y);
      expect(back.z).toBeCloseTo(p.z);
    }
  });

  it('hangs the rim at 2.7 m, sticking out into the room from its wall, clear of the board and room for the ball', () => {
    const a = hoopRim(NORTH_WALL);
    expect(a.y).toBeCloseTo(2.7);
    expect(a.z).toBeCloseTo(-12 + RIM_OUT); // out south, into the room
    const b = hoopRim(SOUTH_WALL);
    expect(b.z).toBeCloseTo(12 - RIM_OUT); // out north
    expect(b.x).toBeCloseTo(-12.4);
    expect(RIM_OUT - HOOP.rim.r).toBeGreaterThan(HOOP.standoff + HOOP.board.t);
    expect(HOOP.rim.r).toBeGreaterThan(HOOP.ball.r + HOOP.rim.tube);
    expect(HOOP.score.bottom + HOOP.score.h).toBeLessThan(3.6); // under the ceiling
    expect(hoopSquare(SOUTH_WALL).z).toBeGreaterThan(b.z); // the square is on the board, behind the rim
  });
});

describe("the ball's flight", () => {
  const fly = (p: Vec3, v: Vec3, steps = 2000) => {
    const b = newBall(p, v);
    const hits: BallHit[] = [];
    for (let i = 0; i < steps && !stepBall(b, BALL_STEP, undefined, hits); i++);
    return { b, hits };
  };

  it('drops straight through the middle of the rim: a basket, and a swish (nothing touched)', () => {
    const { b, hits } = fly({ x: 0, y: 3.3, z: RIM_OUT }, { x: 0, y: 0, z: 0 });
    expect(b.scored).toBe(true);
    expect(b.touched).toBe(false);
    expect(hits.filter((h) => h.what === 'basket')).toHaveLength(1);
    expect(hits.some((h) => h.what === 'floor')).toBe(true);
  });

  it('bounces off the front of the rim and out, and off the board, without a basket', () => {
    const front = fly({ x: 0, y: 3.3, z: RIM_OUT + LOCAL_RIM.r + 0.02 }, { x: 0, y: 0, z: 0 });
    expect(front.hits[0].what).toBe('rim');
    expect(front.b.touched).toBe(true);
    // thrown flat at the board above the rim: it comes back off it, into the room
    const board = fly({ x: 0.45, y: 3.1, z: 2 }, { x: 0, y: 0, z: -9 });
    expect(board.hits[0].what).toBe('board');
    expect(board.b.scored).toBe(false);
    expect(board.b.p.z).toBeGreaterThan(1);
  });

  it('settles on the floor and is done, never through the floor or the wall', () => {
    const { b } = fly({ x: 1, y: 2, z: 1 }, { x: 0.5, y: 1, z: -3 }, 5000);
    expect(b.p.y).toBeGreaterThanOrEqual(HOOP.ball.r - 1e-9);
    expect(b.p.z).toBeGreaterThanOrEqual(HOOP.ball.r - 1e-9);
    expect(b.rolling > 1 || b.t > 4).toBe(true);
  });

  it('makes the room the court round a hoop on its north or south wall', () => {
    const north = courtIn(NORTH_WALL, 16, 12);
    expect(north).toMatchObject({ maxZ: 24 });
    expect(north.minX).toBeCloseTo(-16 - 11.4);
    expect(north.maxX).toBeCloseTo(16 - 11.4);
    const south = courtIn(SOUTH_WALL, 16, 12);
    expect(south.maxZ).toBeCloseTo(24);
    // facing north, the hoop's own right (+x) is the room's west
    expect(south.minX).toBeCloseTo(-16 - 12.4);
    expect(south.maxX).toBeCloseTo(16 - 12.4);
  });

  it('stays inside the room it is given', () => {
    const b = newBall({ x: 0, y: 1.5, z: 2 }, { x: 9, y: 2, z: 3 });
    for (let i = 0; i < 1500; i++) stepBall(b, BALL_STEP, { minX: -3, maxX: 2, maxZ: 5, ceiling: 3.6 });
    expect(b.p.x).toBeLessThanOrEqual(2 - HOOP.ball.r + 1e-9);
    expect(b.p.z).toBeLessThanOrEqual(5 - HOOP.ball.r + 1e-9);
  });
});

describe('the arcade shot', () => {
  it('drops a well-judged throw in from 2 to 5 m, straight on or from the side, on either wall', () => {
    for (const h of [NORTH_WALL, SOUTH_WALL])
      for (const dist of [2, 2.6, 3.5, 5])
        for (const side of [0, 1.2]) {
          const from = holdPoint(viewAt(h, dist, side), HOOP.ball.r, 0, { x: 0, y: 0, z: 0 });
          const p = idealPower(from, hoopRim(h));
          const shot = playerShot(h, dist, p, side);
          expect(shot.assisted, `${dist} ${side}`).toBe(true);
          expect(shot.scored, `${h.rotY} ${dist} ${side}`).toBe(true);
        }
  });

  it('falls short on a tap and sails long at full power from close in', () => {
    const tap = playerShot(SOUTH_WALL, 3, chargePower(CHARGE.tap));
    expect(tap.scored).toBe(false);
    const full = playerShot(SOUTH_WALL, 2, 1);
    expect(full.scored).toBe(false);
  });

  it('has a window of charge that scores, not a single instant', () => {
    let longest = 0;
    let run = 0;
    for (let ms = 0; ms <= CHARGE.full; ms += 10) {
      run = playerShot(NORTH_WALL, 3, chargePower(ms)).scored ? run + 10 : 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeGreaterThanOrEqual(40);
    expect(longest).toBeLessThan(600);
  });

  it('is an ordinary throw when not aimed at the hoop', () => {
    const view = viewAt(SOUTH_WALL, 3);
    view.yaw += 0.6;
    const from = holdPoint(view, HOOP.ball.r, 0, { x: 0, y: 0, z: 0 });
    expect(hoopShot(view, from, 0.5, HOOP.ball.throwSpeed, { rim: hoopRim(SOUTH_WALL), square: hoopSquare(SOUTH_WALL) }, { x: 0, y: 0, z: 0 })).toBe(false);
  });

  it('holds the ball in front of you, below the crosshair and a little to the right', () => {
    const view = { eye: { x: 0, y: 1.65, z: 0 }, yaw: 0, pitch: 0 };
    const p = holdPoint(view, HOOP.ball.r, 0, { x: 0, y: 0, z: 0 });
    expect(p.z).toBeLessThan(-0.8); // ahead (north)
    expect(p.y).toBeLessThan(1.65 - 0.4);
    expect(p.x).toBeCloseTo(HOLD.side); // looking north, your right is east
  });
});

describe("a worker's shot", () => {
  it('makes some and misses some from the free-throw spot, in either body style', () => {
    for (const tall of [1, 0.72]) {
      const rand = seeded(7);
      let made = 0;
      const N = 120;
      for (let i = 0; i < N; i++) {
        const at = toWorld(SOUTH_WALL, { x: 0, y: 0, z: 3.3 }, { x: 0, y: 0, z: 0 });
        const s = { x: at.x, z: at.z, heading: 0 };
        s.heading = Math.atan2(-(hoopSquare(SOUTH_WALL).x - s.x), -(hoopSquare(SOUTH_WALL).z - s.z));
        const v = npcShot(s, SOUTH_WALL, tall, aimHoop(s, SOUTH_WALL, tall, rand), { x: 0, y: 0, z: 0 });
        const from = npcHoldPoint(s, 'shoot', tall, 0, { x: 0, y: 0, z: 0 });
        if (flyShot(SOUTH_WALL, from, v).scored) made++;
      }
      expect(made / N, `tall ${tall}`).toBeGreaterThan(0.15);
      expect(made / N, `tall ${tall}`).toBeLessThan(0.85);
    }
  });

  it('holds the ball up over a shorter body lower', () => {
    const s = { x: 0, z: 0, heading: 0 };
    expect(npcHoldPoint(s, 'shoot', 0.72, 0, { x: 0, y: 0, z: 0 }).y).toBeLessThan(npcHoldPoint(s, 'shoot', 1, 0, { x: 0, y: 0, z: 0 }).y - 0.3);
    expect(dirToLocal(SOUTH_WALL, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 0 }).z).toBeCloseTo(1); // north is out into the room
  });
});
