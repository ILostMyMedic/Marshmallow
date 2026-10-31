// Adapted from cubefarm client/src/world/toys/pongSim.ts (MIT): rewritten over a plain ball, since Marshmallow has no
// physics engine (cubefarm's ran a bare Rapier world).

// The ping-pong ball's world, pure: gravity over the step's substeps (exactly as pongPhysics flightStep integrates it),
// the floor and the net, the ball's restitution and friction against theirs averaged as Rapier combines them. The
// table top isn't here: the match runner bounces the ball off it itself (pongPhysics tableBounce), so what the players
// forecast is what happens. The runner moves the ball through PongBody (the rigid-body calls cubefarm's runner used)
// and adds the air's pull before each step; the table's wiring calls runner.before(), ball.step(), runner.after().

import { airStep, netBox, PONG, type BallState, type V3 } from './pongPhysics';

/** The ball as the runner moves it: the few rigid-body calls it needs. */
export interface PongBody {
  translation(): V3;
  linvel(): V3;
  setTranslation(p: V3, wake: boolean): void;
  setLinvel(v: V3, wake: boolean): void;
  setAngvel(w: V3, wake: boolean): void;
  setGravityScale(scale: number, wake: boolean): void;
}

/** The floor's material (cubefarm's sim floor), and below this speed into a surface (m/s) the ball stops bouncing. */
const FLOOR = { restitution: 0.5, friction: 0.8 };
const SETTLE = 0.3;
/** How fast a ball rolling on the floor slows (1/s), so it comes to rest instead of crossing the room. */
const ROLL_DRAG = 0.8;

const R = PONG.ball.r;
const NET = (() => {
  const { half, at } = netBox();
  return { min: { x: at[0] - half[0], y: at[1] - half[1], z: at[2] - half[2] }, max: { x: at[0] + half[0], y: at[1] + half[1], z: at[2] + half[2] } };
})();

/**
 * Bounces `v` off a surface with outward normal `n` (in place): `e` of the speed into it comes back (none below SETTLE),
 * and friction `mu` takes its share off the slide along it.
 */
function bounce(v: V3, n: V3, e: number, mu: number) {
  const vn = v.x * n.x + v.y * n.y + v.z * n.z;
  if (vn >= 0) return;
  const tx = v.x - vn * n.x;
  const ty = v.y - vn * n.y;
  const tz = v.z - vn * n.z;
  const slide = Math.hypot(tx, ty, tz);
  const k = slide > 1e-9 ? Math.max(0, 1 - (mu * (1 + e) * -vn) / slide) : 0;
  const out = -vn < SETTLE ? 0 : -vn * e;
  v.x = tx * k + n.x * out;
  v.y = ty * k + n.y * out;
  v.z = tz * k + n.z * out;
}

const mix = (a: number, b: number) => (a + b) / 2;

/** One ball, its own little world. */
export class SimBall implements PongBody {
  p: V3;
  v: V3 = { x: 0, y: 0, z: 0 };
  w: V3 = { x: 0, y: 0, z: 0 };
  gravityScale = 1;

  constructor(at: V3 = { x: 0, y: -1, z: 0 }) {
    this.p = { ...at };
  }

  translation(): V3 {
    return { ...this.p };
  }

  linvel(): V3 {
    return { ...this.v };
  }

  setTranslation(p: V3) {
    this.p = { ...p };
  }

  setLinvel(v: V3) {
    this.v = { ...v };
  }

  setAngvel(w: V3) {
    this.w = { ...w };
  }

  setGravityScale(scale: number) {
    this.gravityScale = scale;
  }

  /** On the floor and not bouncing any more. */
  get resting() {
    return this.p.y <= R + 1e-6 && Math.abs(this.v.y) < 1e-6;
  }

  /**
   * One physics step: gravity substep by substep, meeting the floor and the net on the way. A ball without gravity is
   * held (in a hand, or parked out of sight) and meets nothing.
   */
  step(dt = PONG.step) {
    const n = PONG.substeps;
    const h = dt / n;
    const g = PONG.gravity * this.gravityScale;
    const { p, v } = this;
    if (g === 0) {
      p.x += v.x * dt;
      p.y += v.y * dt;
      p.z += v.z * dt;
      return;
    }
    for (let i = 0; i < n; i++) {
      if (!this.resting) v.y -= g * h;
      p.x += v.x * h;
      p.y += v.y * h;
      p.z += v.z * h;
      this.floor();
      this.net();
    }
    if (this.resting) {
      const keep = Math.exp(-ROLL_DRAG * dt);
      v.x *= keep;
      v.z *= keep;
    }
  }

  private floor() {
    if (this.p.y >= R || this.v.y > 0) return;
    this.p.y = R;
    bounce(this.v, { x: 0, y: 1, z: 0 }, mix(PONG.body.restitution, FLOOR.restitution), mix(PONG.body.friction, FLOOR.friction));
  }

  private net() {
    const { p } = this;
    const qx = Math.min(NET.max.x, Math.max(NET.min.x, p.x));
    const qy = Math.min(NET.max.y, Math.max(NET.min.y, p.y));
    const qz = Math.min(NET.max.z, Math.max(NET.min.z, p.z));
    let nx = p.x - qx;
    let ny = p.y - qy;
    let nz = p.z - qz;
    let d = Math.hypot(nx, ny, nz);
    if (d >= R) return;
    if (d < 1e-9) {
      // the centre got inside: out the way it came, across the net
      nx = this.v.x > 0 ? -1 : 1;
      ny = nz = 0;
      d = 0;
      p.x = nx < 0 ? NET.min.x - R : NET.max.x + R;
    } else {
      nx /= d;
      ny /= d;
      nz /= d;
      p.x = qx + nx * R;
      p.y = qy + ny * R;
      p.z = qz + nz * R;
    }
    bounce(this.v, { x: nx, y: ny, z: nz }, mix(PONG.body.restitution, PONG.netBody.restitution), mix(PONG.body.friction, PONG.netBody.friction));
  }
}

/**
 * Flies a ball from `b` for `seconds`, adding the air's pull before every step as the runner does (no table bounce of
 * its own: for the flight alone). Returns where it was after each step.
 */
export function flyBall(b: BallState, seconds: number): V3[] {
  const ball = new SimBall(b.p);
  ball.setLinvel(b.v);
  const s: BallState = { p: { ...b.p }, v: { ...b.v }, w: { ...b.w } };
  const out: V3[] = [];
  for (let t = 0; t < seconds; t += PONG.step) {
    s.v = ball.linvel();
    airStep(s, PONG.step); // as the runner's rally does
    ball.setLinvel(s.v);
    ball.step();
    out.push(ball.translation());
  }
  return out;
}
