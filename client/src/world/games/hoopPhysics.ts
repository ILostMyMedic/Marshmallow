// The basketball hoop as numbers: where its board, rim and net are, a ball's flight off them (Marshmallow has no physics
// engine, so this small simulation does what Rapier did: gravity, the floor, the wall, the board and a rim of a ring),
// whether a ball went through, the arcade shot that drops a well-judged throw in, where hands hold the ball, and a
// worker's casual aim. Pure (no three.js), so it's tested (hoopPhysics.test.ts) and the hoop on screen (Hoop.tsx) and the
// workers' errand (gameErrands.ts) agree.
// Adapted from cubefarm client/src/world/toys/hoopScore.ts, toys/throwing.ts and toys/npcAim.ts (MIT): the sizes, the
// basket rule, the arcade shot and the casual wobble; the ball's simulation is new, and the hoop hangs in any big spot.

import { WALL_H } from '../layout';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The rim as a horizontal circle: its centre and radius (to the middle of the tube), in metres. */
export interface Rim extends Vec3 {
  r: number;
}

// Sizes in metres, in the hoop's own frame: x across, y up from the floor, z out from the wall into the room. Real rims
// are 0.46 m across and a basketball 0.24 m; the rim is lower than a real one's 3.05 m, under the office's ceiling.
export const HOOP = {
  /** How far the backboard's face stands off the wall. */
  standoff: 0.32,
  board: { w: 1.2, h: 0.62, t: 0.05, bottom: 2.56 },
  /** The painted target square: its bottom edge is level with the rim. */
  square: { w: 0.48, h: 0.36 },
  rim: { y: 2.7, r: 0.23, tube: 0.018, gap: 0.15 },
  net: { h: 0.42, bottomR: 0.14 },
  /** The scoreboard over the board. */
  score: { w: 1.24, h: 0.32, bottom: 3.22 },
  /** How much of the speed into each comes back out. */
  bounce: { board: 0.6, rim: 0.45, floor: 0.72, wall: 0.5 },
  /** The basketball; `throwSpeed` is a fully charged throw in m/s. */
  ball: { r: 0.12, throwSpeed: 9.5 },
};

/** How far the rim's centre sticks out from the wall. */
export const RIM_OUT = HOOP.standoff + HOOP.board.t + HOOP.rim.gap + HOOP.rim.r;

// ---------- where it hangs ----------

/** Where a hoop hangs: the foot of its wall under the board's middle, and the turn (a spot's rotY) that faces it into the room. */
export interface HoopPlace {
  x: number;
  z: number;
  rotY: number;
}

/** A point in the hoop's frame, in the room (written into `out`). */
export function toWorld(h: HoopPlace, l: Vec3, out: Vec3): Vec3 {
  const c = Math.cos(h.rotY);
  const s = Math.sin(h.rotY);
  const x = h.x + l.x * c + l.z * s;
  const z = h.z - l.x * s + l.z * c;
  out.x = x;
  out.y = l.y;
  out.z = z;
  return out;
}

/** A point in the room, in the hoop's frame (written into `out`). */
export function toLocal(h: HoopPlace, w: Vec3, out: Vec3): Vec3 {
  const c = Math.cos(h.rotY);
  const s = Math.sin(h.rotY);
  const dx = w.x - h.x;
  const dz = w.z - h.z;
  out.x = dx * c - dz * s;
  out.y = w.y;
  out.z = dx * s + dz * c;
  return out;
}

/** A direction (a velocity) in the room, in the hoop's frame. */
export const dirToLocal = (h: HoopPlace, w: Vec3, out: Vec3) => toLocal({ x: 0, z: 0, rotY: h.rotY }, w, out);
/** A direction in the hoop's frame, in the room. */
export const dirToWorld = (h: HoopPlace, l: Vec3, out: Vec3) => toWorld({ x: 0, z: 0, rotY: h.rotY }, l, out);

/** The rim in the hoop's own frame. */
export const LOCAL_RIM: Rim = { x: 0, y: HOOP.rim.y, z: RIM_OUT, r: HOOP.rim.r };

/** The rim of a hoop hanging at `h`, in the room. */
export const hoopRim = (h: HoopPlace): Rim => ({ ...toWorld(h, LOCAL_RIM, { x: 0, y: 0, z: 0 }), r: HOOP.rim.r });

/** The middle of its painted square, on the board's face, in the room: what a shooter aims at. */
export const hoopSquare = (h: HoopPlace): Vec3 => toWorld(h, { x: 0, y: HOOP.rim.y + HOOP.square.h / 2, z: HOOP.standoff + HOOP.board.t }, { x: 0, y: 0, z: 0 });

// ---------- the basket rule ----------

/** Per-ball memory between steps. */
export interface HoopTrack {
  prev: Vec3 | null;
  /**
   * False right after a basket, or after the ball came up through the net from below, until it has left the column
   * above and below the rim. So a basket counts once, and a ball pushed up through the net can't fall back in for one.
   */
  armed: boolean;
}

export const newTrack = (): HoopTrack => ({ prev: null, armed: true });

/** A jump longer than this (m) in one step is a respawn, not flight. */
const TELEPORT = 1.5;

/** Where the segment a→b crosses the rim's plane is inside the rim circle. */
function crossesInside(a: Vec3, b: Vec3, rim: Rim) {
  const t = (a.y - rim.y) / (a.y - b.y);
  const x = a.x + (b.x - a.x) * t;
  const z = a.z + (b.z - a.z) * t;
  return Math.hypot(x - rim.x, z - rim.z) < rim.r;
}

/**
 * Feed one ball's centre after each step. Returns true when this step was a basket: the centre passed downward through
 * the rim circle. Updates `track` in place.
 */
export function stepHoop(track: HoopTrack, cur: Vec3, rim: Rim): boolean {
  const prev = track.prev;
  track.prev = { x: cur.x, y: cur.y, z: cur.z };
  if (!prev) return false;
  if (Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z) > TELEPORT) {
    track.armed = true;
    return false;
  }
  const falling = prev.y > rim.y && cur.y <= rim.y;
  const rising = prev.y <= rim.y && cur.y > rim.y;
  if ((falling || rising) && crossesInside(prev, cur, rim)) {
    const scored = falling && track.armed;
    track.armed = false;
    return scored;
  }
  if (!track.armed && Math.hypot(cur.x - rim.x, cur.z - rim.z) > rim.r) track.armed = true;
  return false;
}

// ---------- the ball's flight ----------

/** The simulation's step (s): small enough that the fastest throw moves a few centimetres, never through the rim's tube. */
export const BALL_STEP = 1 / 240;
/** Air drag while it flies (Rapier's linear damping, as cubefarm threw it), and after it first touches something. */
export const DAMPING = { flight: 0.05, loose: 0.5 };
/** A ball is done this long after its throw, or after rolling this long on the floor: it goes back on the rack. */
export const BALL_LIFE = { max: 4.5, rolling: 1.2 };

/** A ball in the air (or rolling away), in the hoop's frame. */
export interface Ball {
  p: Vec3;
  v: Vec3;
  /** Seconds since the throw, and since it started rolling on the floor (0 while it's still bouncing). */
  t: number;
  rolling: number;
  /** It has touched the rim, its plate or the board (a basket without is a swish). */
  touched: boolean;
  /** It has landed on something: the air no longer carries it as far. */
  landed: boolean;
  track: HoopTrack;
  /** It went in (once). */
  scored: boolean;
}

export const newBall = (p: Vec3, v: Vec3): Ball => ({ p: { ...p }, v: { ...v }, t: 0, rolling: 0, touched: false, landed: false, track: newTrack(), scored: false });

/** What a step hit, and how hard (the speed into it, m/s): the hoop's sounds. */
export interface BallHit {
  what: 'rim' | 'board' | 'floor' | 'wall' | 'basket';
  speed: number;
}

/** The room round the hoop, in its frame: across (x) and how far out (z) a ball may go before it meets a wall. */
export interface Court {
  minX: number;
  maxX: number;
  maxZ: number;
  ceiling: number;
}

export const OPEN_COURT: Court = { minX: -Infinity, maxX: Infinity, maxZ: Infinity, ceiling: WALL_H };

/** The room (`halfW` by `halfD` either side of the middle) as the court round a hoop hanging at `h` on one of its walls. */
export function courtIn(h: HoopPlace, halfW: number, halfD: number, ceiling = WALL_H): Court {
  const xs: number[] = [];
  const zs: number[] = [];
  const p = { x: 0, y: 0, z: 0 };
  for (const [x, z] of [
    [-halfW, -halfD],
    [halfW, -halfD],
    [-halfW, halfD],
    [halfW, halfD],
  ]) {
    toLocal(h, { x, y: 0, z }, p);
    xs.push(p.x);
    zs.push(p.z);
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), maxZ: Math.max(...zs), ceiling };
}

const n = { x: 0, y: 0, z: 0 };

/** Bounces the ball off a surface with outward normal `n` (unit) that it's moving into: `e` of the speed into it comes back, the slide along it a little slowed. */
function bounce(b: Ball, e: number, slide = 0.9): number {
  const vn = b.v.x * n.x + b.v.y * n.y + b.v.z * n.z;
  if (vn >= 0) return 0;
  b.v.x -= vn * n.x;
  b.v.y -= vn * n.y;
  b.v.z -= vn * n.z;
  b.v.x = b.v.x * slide - e * vn * n.x;
  b.v.y = b.v.y * slide - e * vn * n.y;
  b.v.z = b.v.z * slide - e * vn * n.z;
  return -vn;
}

/** Pushes the ball out of a box (min and max corners) it overlaps, bouncing it off the face it came through. */
function offBox(b: Ball, min: Vec3, max: Vec3, e: number): number {
  const r = HOOP.ball.r;
  const qx = Math.max(min.x, Math.min(max.x, b.p.x));
  const qy = Math.max(min.y, Math.min(max.y, b.p.y));
  const qz = Math.max(min.z, Math.min(max.z, b.p.z));
  const dx = b.p.x - qx;
  const dy = b.p.y - qy;
  const dz = b.p.z - qz;
  const d = Math.hypot(dx, dy, dz);
  if (d >= r) return 0;
  if (d > 1e-9) {
    n.x = dx / d;
    n.y = dy / d;
    n.z = dz / d;
  } else {
    // the centre got inside: out the front, into the room
    n.x = 0;
    n.y = 0;
    n.z = 1;
  }
  b.p.x = qx + n.x * r;
  b.p.y = qy + n.y * r;
  b.p.z = (d > 1e-9 ? qz : max.z) + n.z * r;
  return bounce(b, e);
}

const BOARD_MIN: Vec3 = { x: -HOOP.board.w / 2, y: HOOP.board.bottom, z: 0 };
// the board is solid back to the wall (nothing lodges behind it), the scoreboard on top
const BOARD_MAX: Vec3 = { x: HOOP.board.w / 2, y: HOOP.score.bottom + HOOP.score.h, z: HOOP.standoff + HOOP.board.t };
const PLATE_MIN: Vec3 = { x: -0.07, y: HOOP.rim.y - 0.013, z: HOOP.standoff + HOOP.board.t };
const PLATE_MAX: Vec3 = { x: 0.07, y: HOOP.rim.y + 0.013, z: HOOP.standoff + HOOP.board.t + HOOP.rim.gap };

/** Off the rim, a ring of tube round LOCAL_RIM: pushed out from the nearest point of the ring's middle circle. */
function offRim(b: Ball): number {
  const reach = HOOP.ball.r + HOOP.rim.tube;
  const dx = b.p.x - LOCAL_RIM.x;
  const dz = b.p.z - LOCAL_RIM.z;
  const across = Math.hypot(dx, dz);
  const ux = across > 1e-9 ? dx / across : 1;
  const uz = across > 1e-9 ? dz / across : 0;
  const qx = LOCAL_RIM.x + ux * LOCAL_RIM.r;
  const qz = LOCAL_RIM.z + uz * LOCAL_RIM.r;
  const ex = b.p.x - qx;
  const ey = b.p.y - LOCAL_RIM.y;
  const ez = b.p.z - qz;
  const d = Math.hypot(ex, ey, ez);
  if (d >= reach || d < 1e-9) return 0;
  n.x = ex / d;
  n.y = ey / d;
  n.z = ez / d;
  b.p.x = qx + n.x * reach;
  b.p.y = LOCAL_RIM.y + n.y * reach;
  b.p.z = qz + n.z * reach;
  return bounce(b, HOOP.bounce.rim, 0.85);
}

/**
 * One step (`dt`, BALL_STEP) of the ball's flight in the hoop's frame: gravity and the air, then the floor, the ceiling,
 * the wall behind the board and the room's other walls (`court`), the board, the rim's plate and the rim. Hits (and a
 * basket) are pushed onto `hits`. Returns whether it's done (gone back on the rack).
 */
export function stepBall(b: Ball, dt: number, court: Court = OPEN_COURT, hits?: BallHit[]): boolean {
  const r = HOOP.ball.r;
  b.t += dt;
  b.v.y -= 9.81 * dt;
  const keep = 1 / (1 + dt * (b.landed ? DAMPING.loose : DAMPING.flight));
  b.v.x *= keep;
  b.v.y *= keep;
  b.v.z *= keep;
  b.p.x += b.v.x * dt;
  b.p.y += b.v.y * dt;
  b.p.z += b.v.z * dt;
  const hit = (what: BallHit['what'], speed: number) => {
    if (speed <= 0) return;
    b.landed = true;
    if (what === 'rim' || what === 'board') b.touched = true;
    if (speed > 0.6 || what === 'rim') hits?.push({ what, speed });
  };
  // the floor: a bounce, and once the bounces die away it rolls to a stop
  if (b.p.y < r) {
    b.p.y = r;
    n.x = 0;
    n.y = 1;
    n.z = 0;
    hit('floor', bounce(b, HOOP.bounce.floor, 0.86));
    if (Math.abs(b.v.y) < 0.35) b.v.y = 0;
  }
  if (b.p.y <= r + 1e-6 && b.v.y === 0) {
    const roll = Math.exp(-1.6 * dt);
    b.v.x *= roll;
    b.v.z *= roll;
    b.rolling += dt;
  }
  if (b.p.y > court.ceiling - r) {
    b.p.y = court.ceiling - r;
    n.x = 0;
    n.y = -1;
    n.z = 0;
    hit('wall', bounce(b, HOOP.bounce.wall));
  }
  // the hoop's wall, and the room's walls either side and across
  const walls: [number, number, number, number][] = [
    [b.p.z - r, 0, 0, 1],
    [court.maxZ - r - b.p.z, 0, 0, -1],
    [b.p.x - r - court.minX, 1, 0, 0],
    [court.maxX - r - b.p.x, -1, 0, 0],
  ];
  for (const [gap, nx, , nz] of walls) {
    if (gap >= 0) continue;
    b.p.x += nx * -gap;
    b.p.z += nz * -gap;
    n.x = nx;
    n.y = 0;
    n.z = nz;
    hit('wall', bounce(b, HOOP.bounce.wall));
  }
  hit('board', offBox(b, BOARD_MIN, BOARD_MAX, HOOP.bounce.board));
  hit('board', offBox(b, PLATE_MIN, PLATE_MAX, HOOP.bounce.rim));
  hit('rim', offRim(b));
  if (stepHoop(b.track, b.p, LOCAL_RIM) && !b.scored) {
    b.scored = true;
    hits?.push({ what: 'basket', speed: Math.hypot(b.v.x, b.v.y, b.v.z) });
  }
  return b.t > BALL_LIFE.max || b.rolling > BALL_LIFE.rolling;
}

// ---------- throwing ----------

/** Holding the throw this long (ms) is still a tap, a gentle lob; by `full` the throw is at full power. */
export const CHARGE = { tap: 150, full: 1000 };

/** 0 for a tap up to 1 for a full charge. */
export const chargePower = (ms: number) => Math.min(1, Math.max(0, (ms - CHARGE.tap) / (CHARGE.full - CHARGE.tap)));

/** Where a held ball sits in front of the view, and how hard throws go: a lob's speed, and the lift a throw gets. */
export const HOLD = { ahead: 1.0, drop: 0.32, dropPerR: 0.9, side: 0.2, pitch: 0.85, minPitch: -0.7, maxPitch: 0.45, windUp: 0.25 };
export const THROW = { lob: 3.2, lift: 1.6, hardLift: 0.9, aim: 12 };

/** The view as the hands see it: the eye, and the camera's pitch and yaw (Euler 'YXZ', as Player.tsx sets them). */
export interface View {
  eye: Vec3;
  pitch: number;
  yaw: number;
}

/**
 * Where the player holds the ball (radius `r`) in front of their view, low enough to keep the crosshair clear, written
 * into `out`, a little to the right; `pull` (0 to HOLD.windUp) draws it back while charging. Looking up or down only
 * counts partly.
 */
export function holdPoint(view: View, r: number, pull: number, out: Vec3): Vec3 {
  const pitch = Math.min(HOLD.maxPitch, Math.max(HOLD.minPitch, view.pitch * HOLD.pitch));
  const ahead = HOLD.ahead + r - pull;
  const y = ahead * Math.sin(pitch) - HOLD.drop - r * HOLD.dropPerR - pull * 0.4;
  const z = -ahead * Math.cos(pitch);
  out.x = view.eye.x + z * Math.sin(view.yaw) + HOLD.side * Math.cos(view.yaw);
  out.y = view.eye.y + y;
  out.z = view.eye.z + z * Math.cos(view.yaw) - HOLD.side * Math.sin(view.yaw);
  return out;
}

/**
 * An ordinary throw (not at the hoop): aimed through a point far along the crosshair, as fast as `power` of the way from
 * a lob to `top`, with a little lift. Written into `out`.
 */
export function throwVelocity(view: View, from: Vec3, power: number, top: number, out: Vec3): Vec3 {
  const cp = Math.cos(view.pitch);
  out.x = view.eye.x - Math.sin(view.yaw) * cp * THROW.aim - from.x;
  out.y = view.eye.y + Math.sin(view.pitch) * THROW.aim - from.y;
  out.z = view.eye.z - Math.cos(view.yaw) * cp * THROW.aim - from.z;
  const len = Math.hypot(out.x, out.y, out.z) || 1;
  const speed = THROW.lob + (top - THROW.lob) * power;
  out.x = (out.x / len) * speed;
  out.y = (out.y / len) * speed + THROW.lift + (THROW.hardLift - THROW.lift) * power;
  out.z = (out.z / len) * speed;
  return out;
}

/**
 * Throwing at the hoop is an arcade shot, not real basketball: aimed within `cone` (radians) of the painted square,
 * `minDist` to `maxDist` metres from the rim, it flies on the highest arc the ceiling allows (its centre peaking at
 * `top`), so it drops into the rim rather than lining it, and through it at the ideal strength. The charge still decides
 * the strength: within `band` of the ideal speed, how far it's off is shrunk to `sweet` / distance (m) of itself, so the
 * charge window that scores is about as wide from near as from far. Beyond the band it adds up again as usual.
 */
export const ASSIST = { cone: 0.12, minDist: 0.8, maxDist: 9, top: WALL_H - 0.25, sweet: 0.45, band: 0.25 };

/** The arcade shot's arc from `from` into `rim`: its speed across and up, and the throw speed that makes it (`ideal`). */
export function hoopArc(from: Vec3, rim: Vec3) {
  const reach = Math.hypot(rim.x - from.x, rim.z - from.z);
  const apex = Math.max(ASSIST.top, from.y + 0.05);
  const rise = Math.sqrt(2 * 9.81 * (apex - from.y));
  const t = rise / 9.81 + Math.sqrt((2 * Math.max(0, apex - rim.y)) / 9.81);
  // the little drag of a flight, made up for
  const k = 1 + (DAMPING.flight * t) / 2;
  const across = (reach / t) * k;
  const up = rise * k;
  return { across, up, ideal: Math.hypot(across, up) };
}

/** The charge (0 to 1) that throws at the arcade shot's ideal speed from `from` into `rim`. */
export const idealPower = (from: Vec3, rim: Vec3, top = HOOP.ball.throwSpeed) => Math.min(1, Math.max(0, (hoopArc(from, rim).ideal - THROW.lob) / (top - THROW.lob)));

/**
 * The ball's velocity for a throw at the hoop (see ASSIST), written into `out`; false (and `out` untouched) when the
 * throw isn't aimed at the hoop and should be an ordinary one (throwVelocity).
 */
export function hoopShot(view: View, from: Vec3, power: number, top: number, hoop: { rim: Vec3; square: Vec3 }, out: Vec3): boolean {
  const { eye, pitch, yaw } = view;
  const cp = Math.cos(pitch);
  const tx = hoop.square.x - eye.x;
  const ty = hoop.square.y - eye.y;
  const tz = hoop.square.z - eye.z;
  const along = (-Math.sin(yaw) * cp * tx + Math.sin(pitch) * ty - Math.cos(yaw) * cp * tz) / (Math.hypot(tx, ty, tz) || 1);
  if (along < Math.cos(ASSIST.cone)) return false;
  const dx = hoop.rim.x - from.x;
  const dz = hoop.rim.z - from.z;
  const reach = Math.hypot(dx, dz);
  const away = Math.hypot(hoop.rim.x - eye.x, hoop.rim.z - eye.z);
  if (away < ASSIST.minDist || away > ASSIST.maxDist || reach < 0.1 || from.y >= hoop.rim.y) return false;
  const { across, up, ideal } = hoopArc(from, hoop.rim);
  const off = (THROW.lob + (top - THROW.lob) * power) / ideal - 1;
  const near = Math.min(Math.abs(off), ASSIST.band);
  const s = 1 + Math.sign(off) * (near * Math.min(1, ASSIST.sweet / reach) + Math.abs(off) - near);
  out.x = (dx / reach) * across * s;
  out.y = up * s;
  out.z = (dz / reach) * across * s;
  return true;
}

// ---------- a worker's shot ----------

/** Where someone stands and which way they face (body.ts: heading 0 faces -Z). */
export interface Stance {
  x: number;
  z: number;
  heading: number;
}

/** How a worker holds the ball: carried in front of them, or up over their head to shoot. */
export type NpcPose = 'carry' | 'shoot';

// Each pose's hold point: `ahead` of the body plus `aheadR` ball radii, at height `y` plus `yR` radii, for a body of
// the human style's height (`tall` scales it: the chibi style is shorter).
const POSES: Record<NpcPose, { ahead: number; aheadR: number; y: number; yR: number }> = {
  carry: { ahead: 0.32, aheadR: 1, y: 1.0, yR: 0.3 },
  shoot: { ahead: 0.2, aheadR: 0, y: 1.75, yR: 1 },
};

/** Where someone standing at `s` holds the ball in `pose` (`dip` m lower, winding up), `tall` the share of a human's height. */
export function npcHoldPoint(s: Stance, pose: NpcPose, tall: number, dip: number, out: Vec3): Vec3 {
  const p = POSES[pose];
  const r = HOOP.ball.r;
  const ahead = p.ahead + p.aheadR * r;
  out.x = s.x - Math.sin(s.heading) * ahead;
  out.y = (p.y + p.yR * r) * tall - dip;
  out.z = s.z - Math.cos(s.heading) * ahead;
  return out;
}

/** A worker's throw: which way they look (as a camera's yaw and pitch) and how hard (0 to 1). */
export interface NpcAim {
  yaw: number;
  pitch: number;
  power: number;
}

/** How much a casual shot wobbles (standard deviations): its power (0-1) and its aim (radians). */
export const WOBBLE = { power: 0.4, aim: 0.02 };

/** A normal sample from two uniform ones in [0, 1). */
export const normal = (u: number, v: number) => Math.sqrt(-2 * Math.log(1 - u)) * Math.cos(2 * Math.PI * v);

/** The eye height a worker's throw is aimed from, for a body `tall` of a human's height. */
export const npcEye = (tall: number) => 1.5 * tall;

/** The camera angles looking from an eye at (x, y, z) to `at`. */
export function lookAt(x: number, y: number, z: number, at: Vec3): { yaw: number; pitch: number } {
  const dx = at.x - x;
  const dz = at.z - z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(at.y - y, Math.hypot(dx, dz)) };
}

/** The body heading that faces the hoop hanging at `h` from (x, z). */
export const headingToHoop = (x: number, z: number, h: HoopPlace) => {
  const sq = hoopSquare(h);
  return Math.atan2(-(sq.x - x), -(sq.z - z));
};

/**
 * A worker's shot from `s` (facing the hoop at `h`): aimed at the painted square, as hard as the arcade shot wants from
 * where the ball is held overhead, then wobbled. `rand` gives uniform numbers in [0, 1).
 */
export function aimHoop(s: Stance, h: HoopPlace, tall: number, rand: () => number): NpcAim {
  const eye = npcEye(tall);
  const { yaw, pitch } = lookAt(s.x, eye, s.z, hoopSquare(h));
  const from = npcHoldPoint(s, 'shoot', tall, 0, { x: 0, y: 0, z: 0 });
  const ideal = idealPower(from, hoopRim(h));
  return {
    yaw: yaw + normal(rand(), rand()) * WOBBLE.aim,
    pitch: pitch + normal(rand(), rand()) * WOBBLE.aim,
    power: Math.min(1, Math.max(0, ideal + normal(rand(), rand()) * WOBBLE.power)),
  };
}

/** The velocity of a worker's shot from `s` with `aim` at the hoop at `h` (the player's own maths), written into `out`. */
export function npcShot(s: Stance, h: HoopPlace, tall: number, aim: NpcAim, out: Vec3): Vec3 {
  const from = npcHoldPoint(s, 'shoot', tall, 0, { x: 0, y: 0, z: 0 });
  const view: View = { eye: { x: s.x, y: npcEye(tall), z: s.z }, yaw: aim.yaw, pitch: aim.pitch };
  if (!hoopShot(view, from, aim.power, HOOP.ball.throwSpeed, { rim: hoopRim(h), square: hoopSquare(h) }, out)) throwVelocity(view, from, aim.power, HOOP.ball.throwSpeed, out);
  return out;
}

/** Throws a ball from `from` with velocity `v` (both in the room) at the hoop at `h`, and follows it to the end: did it go in, cleanly? For tests. */
export function flyShot(h: HoopPlace, from: Vec3, v: Vec3, court: Court = OPEN_COURT): { scored: boolean; swish: boolean; touched: boolean } {
  const b = newBall(toLocal(h, from, { x: 0, y: 0, z: 0 }), dirToLocal(h, v, { x: 0, y: 0, z: 0 }));
  for (let i = 0; i < BALL_LIFE.max / BALL_STEP + 10; i++) {
    if (stepBall(b, BALL_STEP, court)) break;
    if (b.scored) break;
  }
  return { scored: b.scored, swish: b.scored && !b.touched, touched: b.touched };
}
