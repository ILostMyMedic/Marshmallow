// Darts (darts.ts): the board's scoring, a throw's flight and how the charge moves it, sticking, and a worker's aim.
import { describe, expect, it } from 'vitest';
import {
  aimVelocity,
  BOARD,
  boardNormal,
  bullAt,
  dartHit,
  dartLabel,
  dartSpeed,
  DART_THROW,
  fromBoard,
  landDart,
  npcDart,
  OCHE,
  onBoard,
  scoreAt,
  segmentAt,
  sticks,
  throwDart,
  turnTotal,
  type BoardPlace,
} from './darts';

const NORTH: BoardPlace = { x: 7.2, z: -12, rotY: 0 }; // on the north wall, facing south
const WEST: BoardPlace = { x: -16, z: 4.8, rotY: Math.PI / 2 }; // on the west wall, facing east

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

/** Where someone at the oche throws from: their hand, a little right of their middle and at shoulder height. */
const ocheHand = (b: BoardPlace) => fromBoard(b, 0.15, 1.5 - BOARD.y, OCHE);

describe('the board', () => {
  it('has the numbers clockwise from 20 at the top', () => {
    expect(segmentAt(0, 0.1)).toBe(20);
    expect(segmentAt(0.1, 0)).toBe(6); // 3 o'clock
    expect(segmentAt(0, -0.1)).toBe(3); // 6 o'clock
    expect(segmentAt(-0.1, 0)).toBe(11); // 9 o'clock
    expect(segmentAt(0.02, 0.1)).toBe(1); // just right of the 20
  });

  it('scores the bulls, trebles, doubles and singles', () => {
    expect(scoreAt(0, 0)).toEqual({ points: 50, ring: 'bull', segment: 0 });
    expect(scoreAt(0.01, 0)).toMatchObject({ points: 25, ring: 'outer-bull' });
    expect(scoreAt(0, 0.103)).toEqual({ points: 60, ring: 'treble', segment: 20 });
    expect(scoreAt(0, -0.166)).toEqual({ points: 6, ring: 'double', segment: 3 });
    expect(scoreAt(0, 0.05)).toEqual({ points: 20, ring: 'single', segment: 20 });
    expect(scoreAt(0, 0.13)).toEqual({ points: 20, ring: 'single', segment: 20 });
    expect(scoreAt(0, 0.2)).toEqual({ points: 0, ring: 'board', segment: 0 });
    expect(scoreAt(0.3, 0.1)).toEqual({ points: 0, ring: 'miss', segment: 0 });
  });

  it('reads darts and turns as players say them', () => {
    expect([scoreAt(0, 0.103), scoreAt(0, -0.166), scoreAt(0, 0.05), scoreAt(0, 0), scoreAt(0.01, 0), scoreAt(0.3, 0)].map(dartLabel)).toEqual(['T20', 'D3', '20', 'Bull', '25', 'Miss']);
    const t20 = scoreAt(0, 0.103);
    expect(turnTotal([t20, t20, t20])).toEqual({ points: 180, line: '180! T20, T20, T20' });
    expect(turnTotal([t20, scoreAt(0, 0.05), scoreAt(0.3, 0)])).toEqual({ points: 80, line: '80: T20, 20, Miss' });
  });

  it('turns between the room and the face of a board on any wall', () => {
    for (const b of [NORTH, WEST]) {
      const p = fromBoard(b, 0.07, -0.04, 1.2);
      const q = onBoard(b, p);
      expect(q.u).toBeCloseTo(0.07);
      expect(q.v).toBeCloseTo(-0.04);
      expect(q.w).toBeCloseTo(1.2);
      expect(bullAt(b).y).toBe(BOARD.y);
    }
    // the north wall's board faces south: a step out from it is +z, and its right (as you face it, looking north) is east
    expect(fromBoard(NORTH, 0, 0, 1).z).toBeCloseTo(-12 + BOARD.depth + 1);
    expect(fromBoard(NORTH, 0.1, 0, 0).x).toBeGreaterThan(7.2);
  });
});

describe('a throw', () => {
  it('reaches a point on an arc, the flatter one, or says it cannot', () => {
    const from = { x: 0, y: 1.5, z: 0 };
    const to = { x: 0, y: 1.73, z: -2.37 };
    const v = aimVelocity(from, to, 9, { x: 0, y: 0, z: 0 })!;
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(9);
    expect(v.y).toBeGreaterThan(0); // up a little, to come down on it
    expect(v.y).toBeLessThan(3);
    expect(aimVelocity(from, { x: 0, y: 1.5, z: -30 }, 9, { x: 0, y: 0, z: 0 })).toBeNull();
  });

  it('lands where it is aimed at the ideal charge, low when soft and high when hard, on either wall', () => {
    for (const b of [NORTH, WEST]) {
      const from = ocheHand(b);
      const aim = fromBoard(b, 0, 0.103); // the treble 20
      const at = (power: number) => {
        const v = throwDart(from, aim, power, [0, 0], { x: 0, y: 0, z: 0 });
        return landDart(b, from, v);
      };
      const ideal = at(DART_THROW.ideal);
      expect(ideal.stuck && ideal.score.points).toBe(60);
      const soft = at(DART_THROW.ideal - 0.15);
      const hard = at(DART_THROW.ideal + 0.15);
      expect(soft.stuck && soft.v).toBeLessThan(0.103 - 0.02);
      expect(hard.stuck && hard.v).toBeGreaterThan(0.103 + 0.02);
    }
  });

  it('spreads with a steady hand by about a centimetre, more from further away', () => {
    const from = ocheHand(NORTH);
    const aim = fromBoard(NORTH, 0, 0);
    const near = landDart(NORTH, from, throwDart(from, aim, DART_THROW.ideal, [1, 0], { x: 0, y: 0, z: 0 }));
    const far = fromBoard(NORTH, 0.15, 1.5 - BOARD.y, OCHE * 2);
    const away = landDart(NORTH, far, throwDart(far, aim, DART_THROW.ideal, [1, 0], { x: 0, y: 0, z: 0 }));
    expect(near.stuck && Math.abs(near.u)).toBeCloseTo(DART_THROW.wobble, 3);
    expect(away.stuck && Math.abs(away.u)).toBeGreaterThan(DART_THROW.wobble * 1.5);
  });

  it('flies at the speed its charge says', () => {
    expect(dartSpeed(0)).toBe(DART_THROW.slow);
    expect(dartSpeed(1)).toBe(DART_THROW.fast);
    expect(dartSpeed(2)).toBe(DART_THROW.fast);
  });

  it("never reaches a board it's thrown away from, and sticks only square and fast", () => {
    const from = ocheHand(NORTH);
    expect(dartHit(NORTH, from, { x: 0, y: 1, z: 6 })).toBeNull(); // thrown away from the wall
    const n = boardNormal(NORTH);
    expect(sticks({ x: 0, y: -1, z: -9 }, n)).toBe(true);
    expect(sticks({ x: 9, y: 0, z: -1 }, n)).toBe(false); // glancing
    expect(sticks({ x: 0, y: 0, z: -2 }, n)).toBe(false); // too slow
    // off the board altogether: it doesn't stick, it drops
    const wide = landDart(NORTH, from, throwDart(from, fromBoard(NORTH, 0.6, 0), DART_THROW.ideal, [0, 0], { x: 0, y: 0, z: 0 }));
    expect(wide.stuck).toBe(false);
    expect(wide.at).not.toBeNull();
  });
});

describe("a worker's darts", () => {
  it('mostly land on the board, now and then in a treble, rarely a bull, and average a casual score', () => {
    const rand = seeded(3);
    let onBoardCount = 0;
    let trebles = 0;
    let total = 0;
    const N = 600;
    for (let i = 0; i < N; i++) {
      const d = npcDart(rand);
      const s = scoreAt(d.u, d.v);
      if (s.ring !== 'miss') onBoardCount++;
      if (s.ring === 'treble') trebles++;
      total += s.points;
    }
    expect(onBoardCount / N).toBeGreaterThan(0.95);
    expect(trebles / N).toBeGreaterThan(0.02);
    expect(trebles / N).toBeLessThan(0.25);
    expect(total / N).toBeGreaterThan(5);
    expect(total / N).toBeLessThan(25);
  });
});
