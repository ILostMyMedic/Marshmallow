// Darts as numbers: the board's rings and numbers, what a dart scores where it lands, a throw's flight to the wall (the
// charge sets how hard: too soft drops low, too hard flies high), whether a dart sticks, a worker's casual aim, and a
// turn's three darts added up. Pure, so it's tested (darts.test.ts); the board on the wall (Dartboard.tsx) and the
// workers' errand (gameErrands.ts) use it. New in Marshmallow; `sticks` is adapted from cubefarm
// client/src/world/toys/darts.ts (MIT), its foam darts' rule, for steel tips in a board.

/** A regulation board (metres): the bull's middle hangs `y` up the wall; the rings' outer radii; the numbers round it. */
export const BOARD = {
  y: 1.73,
  bull: 0.00635,
  outerBull: 0.0159,
  treble: { inner: 0.099, outer: 0.107 },
  double: { inner: 0.162, outer: 0.17 },
  /** The ring the numbers sit on, still board (a dart in it scores nothing), and the black surround round that. */
  numbers: 0.2255,
  surround: 0.29,
  /** How far the board's face stands off the wall. */
  depth: 0.045,
};

/** Where you throw from: the oche's distance from the wall below the board. */
export const OCHE = 2.37;

/** The numbers clockwise from the top. */
export const SEGMENTS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5] as const;

export type Ring = 'bull' | 'outer-bull' | 'treble' | 'double' | 'single' | 'board' | 'miss';

export interface DartScore {
  points: number;
  ring: Ring;
  /** The number it landed in (0 for a bull or off the scoring rings). */
  segment: number;
}

/** The number a point `u` m right and `v` m up from the bull lies in. */
export function segmentAt(u: number, v: number): number {
  const deg = ((Math.atan2(u, v) * 180) / Math.PI + 360 + 9) % 360;
  return SEGMENTS[Math.floor(deg / 18) % 20];
}

/** What a dart landing `u` m right and `v` m up from the bull scores (on the board; 'miss' off it altogether). */
export function scoreAt(u: number, v: number): DartScore {
  const r = Math.hypot(u, v);
  if (r <= BOARD.bull) return { points: 50, ring: 'bull', segment: 0 };
  if (r <= BOARD.outerBull) return { points: 25, ring: 'outer-bull', segment: 0 };
  const segment = segmentAt(u, v);
  if (r <= BOARD.treble.inner) return { points: segment, ring: 'single', segment };
  if (r <= BOARD.treble.outer) return { points: segment * 3, ring: 'treble', segment };
  if (r <= BOARD.double.inner) return { points: segment, ring: 'single', segment };
  if (r <= BOARD.double.outer) return { points: segment * 2, ring: 'double', segment };
  if (r <= BOARD.surround) return { points: 0, ring: 'board', segment: 0 };
  return { points: 0, ring: 'miss', segment: 0 };
}

/** How a dart reads: "T20", "D16", "5", "Bull", "25", "Board" or "Miss". */
export function dartLabel(s: DartScore): string {
  switch (s.ring) {
    case 'bull':
      return 'Bull';
    case 'outer-bull':
      return '25';
    case 'treble':
      return `T${s.segment}`;
    case 'double':
      return `D${s.segment}`;
    case 'single':
      return `${s.segment}`;
    case 'board':
      return 'Board';
    default:
      return 'Miss';
  }
}

/** A turn's darts added up, and how it reads ("60: T20, 20, 20", "180!" for the best there is). */
export function turnTotal(darts: readonly DartScore[]): { points: number; line: string } {
  const points = darts.reduce((sum, d) => sum + d.points, 0);
  const each = darts.map(dartLabel).join(', ');
  return { points, line: points === 180 ? `180! ${each}` : `${points}: ${each}` };
}

// ---------- throwing ----------

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Where a board hangs: the point on the wall under its bull, the turn facing it into the room, and the bull's height
 * (BOARD.y, unless something below on the wall lifts it).
 */
export interface BoardPlace {
  x: number;
  z: number;
  rotY: number;
  y?: number;
}

/** The bull in the room. */
export function bullAt(b: BoardPlace): Vec3 {
  return { x: b.x + Math.sin(b.rotY) * BOARD.depth, y: b.y ?? BOARD.y, z: b.z + Math.cos(b.rotY) * BOARD.depth };
}

/** Where a point in the room is on the board's face: `u` right and `v` up from the bull, `w` out in front of the face. */
export function onBoard(b: BoardPlace, p: Vec3): { u: number; v: number; w: number } {
  const c = Math.cos(b.rotY);
  const s = Math.sin(b.rotY);
  const bull = bullAt(b);
  const dx = p.x - bull.x;
  const dz = p.z - bull.z;
  return { u: dx * c - dz * s, v: p.y - bull.y, w: dx * s + dz * c };
}

/** Back from the board's face to the room. */
export function fromBoard(b: BoardPlace, u: number, v: number, w = 0): Vec3 {
  const c = Math.cos(b.rotY);
  const s = Math.sin(b.rotY);
  const bull = bullAt(b);
  return { x: bull.x + u * c + w * s, y: bull.y + v, z: bull.z - u * s + w * c };
}

/**
 * Throwing: the charge (0 to 1) sets the speed, a soft throw `slow` m/s to a hard one `fast`; the dart is aimed so that
 * at `ideal` charge it lands where the crosshair is, softer dropping lower and harder flying higher. `wobble` is the
 * spread of a steady hand (m, one standard deviation, at the oche).
 */
export const DART_THROW = { slow: 6, fast: 13, ideal: 0.55, wobble: 0.008, gravity: 9.81 };

/** A throw's speed (m/s) for a charge. */
export const dartSpeed = (power: number) => DART_THROW.slow + (DART_THROW.fast - DART_THROW.slow) * Math.min(1, Math.max(0, power));

/**
 * The velocity that carries a dart from `from` through `to` at `speed`, on the flatter of the two arcs (written into
 * `out`); null when it can't reach (too slow for the distance).
 */
export function aimVelocity(from: Vec3, to: Vec3, speed: number, out: Vec3): Vec3 | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  const h = to.y - from.y;
  const g = DART_THROW.gravity;
  const v2 = speed * speed;
  const disc = v2 * v2 - g * (g * d * d + 2 * h * v2);
  if (disc < 0 || d < 1e-6) return null;
  const angle = Math.atan2(v2 - Math.sqrt(disc), g * d);
  out.x = (dx / d) * speed * Math.cos(angle);
  out.y = speed * Math.sin(angle);
  out.z = (dz / d) * speed * Math.cos(angle);
  return out;
}

/**
 * The player's dart: from `from` (the hand) towards `aim` (where the crosshair meets the board), as hard as `power`. It's
 * aimed along the arc that reaches `aim` at the ideal charge; thrown softer or harder along the same line it drops or
 * rises. `jitter` (two normal samples) nudges the aim across and up by the steady hand's wobble. Written into `out`.
 */
export function throwDart(from: Vec3, aim: Vec3, power: number, jitter: [number, number], out: Vec3): Vec3 {
  const dist = Math.hypot(aim.x - from.x, aim.z - from.z);
  const spread = DART_THROW.wobble * (dist / OCHE);
  // across the line of the throw, and up
  const ax = aim.z - from.z;
  const az = -(aim.x - from.x);
  const al = Math.hypot(ax, az) || 1;
  const to = { x: aim.x + (ax / al) * jitter[0] * spread, y: aim.y + jitter[1] * spread, z: aim.z + (az / al) * jitter[0] * spread };
  const ideal = dartSpeed(DART_THROW.ideal);
  if (!aimVelocity(from, to, ideal, out)) {
    // too far to reach on any arc at the ideal speed: lob it at 45°
    const d = Math.hypot(to.x - from.x, to.z - from.z) || 1;
    out.x = ((to.x - from.x) / d) * ideal * Math.SQRT1_2;
    out.y = ideal * Math.SQRT1_2;
    out.z = ((to.z - from.z) / d) * ideal * Math.SQRT1_2;
  }
  const k = dartSpeed(power) / ideal;
  out.x *= k;
  out.y *= k;
  out.z *= k;
  return out;
}

/** Where a dart thrown from `from` at velocity `v` meets the board's wall: the point on the face, the velocity there and the time; null if it never gets there. */
export function dartHit(b: BoardPlace, from: Vec3, v: Vec3): { at: Vec3; v: Vec3; t: number } | null {
  const start = onBoard(b, from);
  // how fast it closes on the face (w shrinking)
  const vw = v.x * Math.sin(b.rotY) + v.z * Math.cos(b.rotY);
  if (vw >= -1e-6 || start.w <= 0) return null;
  const t = -start.w / vw;
  const g = DART_THROW.gravity;
  const at = { x: from.x + v.x * t, y: from.y + v.y * t - (g * t * t) / 2, z: from.z + v.z * t };
  return { at, v: { x: v.x, y: v.y - g * t, z: v.z }, t };
}

/** A hit counts as square enough within this angle of the board's face's normal, and only from a dart this fast (m/s). */
export const STICK = { maxAngle: (62 * Math.PI) / 180, minSpeed: 3 };

/**
 * Does a dart flying at velocity `v` stick in a flat surface with outward normal `n` (unit length)? Only a hit square
 * enough and fast enough; anything glancing bounces off. Adapted from cubefarm toys/darts.ts sticks (MIT).
 */
export function sticks(v: Vec3, n: Vec3): boolean {
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed < STICK.minSpeed) return false;
  const into = -(v.x * n.x + v.y * n.y + v.z * n.z) / speed;
  return into >= Math.cos(STICK.maxAngle);
}

/** The outward normal of a board's face (into the room). */
export const boardNormal = (b: BoardPlace): Vec3 => ({ x: Math.sin(b.rotY), y: 0, z: Math.cos(b.rotY) });

/** Where a thrown dart ends up: stuck in the board at (u, v) with what it scores, or off the board (it drops). */
export type DartLanding = { stuck: true; u: number; v: number; score: DartScore; at: Vec3; t: number } | { stuck: false; at: Vec3 | null; t: number };

/** Follows a dart from `from` at `v` to the board hanging at `b`. */
export function landDart(b: BoardPlace, from: Vec3, v: Vec3): DartLanding {
  const hit = dartHit(b, from, v);
  if (!hit) return { stuck: false, at: null, t: 1 };
  const p = onBoard(b, hit.at);
  const score = scoreAt(p.u, p.v);
  if (score.ring === 'miss' || !sticks(hit.v, boardNormal(b))) return { stuck: false, at: hit.at, t: hit.t };
  return { stuck: true, u: p.u, v: p.v, score, at: hit.at, t: hit.t };
}

// ---------- a worker's throw ----------

/** How a worker aims: mostly at the treble 20, now and then at the bull; and how much their darts spread (m, at the oche). */
export const NPC_DARTS = { bullShare: 0.3, spread: 0.035 };

/** A normal sample from two uniform ones in [0, 1). */
export const normal = (u: number, v: number) => Math.sqrt(-2 * Math.log(1 - u)) * Math.cos(2 * Math.PI * v);

/**
 * Where a worker's dart lands on the face (u right, v up from the bull), aiming at the treble 20 or the bull with a
 * casual spread. `rand` gives uniform numbers in [0, 1).
 */
export function npcDart(rand: () => number): { u: number; v: number; aim: 'T20' | 'Bull' } {
  const bull = rand() < NPC_DARTS.bullShare;
  const target = bull ? { u: 0, v: 0 } : { u: 0, v: (BOARD.treble.inner + BOARD.treble.outer) / 2 };
  return { u: target.u + normal(rand(), rand()) * NPC_DARTS.spread, v: target.v + normal(rand(), rand()) * NPC_DARTS.spread, aim: bull ? 'Bull' : 'T20' };
}
