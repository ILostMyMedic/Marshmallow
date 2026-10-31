// Adapted from cubefarm client/src/world/camera/cameraMath.ts (MIT): the overview ("dollhouse") orbit and the flights
// between it and first person; the building view and the follow cam are cut.

// Camera poses for the overview, as plain numbers (Game.tsx puts them on the three.js camera). Pure and allocation-free:
// every function writes into an `out` it's given. Yaw and pitch are Euler 'YXZ', yaw 0 looking north (-Z); an orbit is a
// camera `dist` from a focus point, on bearing `yaw` (0: due south of it, looking north) and `el` radians above it.

import { HALF_D, HALF_W, WALL_H } from './layout';

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Vertical field of view, degrees. */
  fov: number;
  near: number;
}

export const newPose = (): Pose => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 72, near: 0.05 });

export function copyPose(a: Pose, out: Pose) {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  out.yaw = a.yaw;
  out.pitch = a.pitch;
  out.fov = a.fov;
  out.near = a.near;
  return out;
}

export interface Orbit {
  fx: number;
  fy: number;
  fz: number;
  yaw: number;
  el: number;
  dist: number;
  fov: number;
}

export const newOrbit = (): Orbit => ({ fx: 0, fy: 0, fz: 0, yaw: 0, el: 0, dist: 10, fov: 60 });

export function copyOrbit(a: Orbit, out: Orbit) {
  out.fx = a.fx;
  out.fy = a.fy;
  out.fz = a.fz;
  out.yaw = a.yaw;
  out.el = a.el;
  out.dist = a.dist;
  out.fov = a.fov;
  return out;
}

/** The shortest signed turn from angle a to angle b, in (-π, π]. */
export function angleDelta(a: number, b: number) {
  const d = (b - a) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d <= -Math.PI ? d + Math.PI * 2 : d;
}

/** The near plane for a camera this far from what it looks at: as far out as is safe, for depth precision on the rugs. */
export const nearFor = (dist: number) => Math.min(1.5, Math.max(0.05, dist * 0.02));

/** Where an orbit puts the camera, looking at its focus. */
export function orbitPose(o: Orbit, out: Pose) {
  const c = Math.cos(o.el);
  out.x = o.fx + Math.sin(o.yaw) * c * o.dist;
  out.y = o.fy + Math.sin(o.el) * o.dist;
  out.z = o.fz + Math.cos(o.yaw) * c * o.dist;
  out.yaw = o.yaw;
  out.pitch = -o.el;
  out.fov = o.fov;
  out.near = nearFor(o.dist);
  return out;
}

/** Aims a pose at (fx, fy, fz) from where it is. */
export function aimAt(p: Pose, fx: number, fy: number, fz: number) {
  const dx = p.x - fx;
  const dz = p.z - fz;
  p.yaw = Math.atan2(dx, dz);
  p.pitch = Math.atan2(fy - p.y, Math.hypot(dx, dz));
  return p;
}

/** Smooth in and out, 0 to 1. */
export const ease = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
};

/**
 * Part way (t, 0 to 1) from pose a to pose b, the short way round in yaw. The near plane stays close until late, so
 * nothing near the camera is cut off while it's still close to it.
 */
export function blendPose(a: Pose, b: Pose, t: number, out: Pose) {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.yaw = a.yaw + angleDelta(a.yaw, b.yaw) * t;
  out.pitch = a.pitch + (b.pitch - a.pitch) * t;
  out.fov = a.fov + (b.fov - a.fov) * t;
  out.near = b.near > a.near ? a.near + (b.near - a.near) * t ** 4 : a.near + (b.near - a.near) * t;
  return out;
}

/** Eases orbit `cur` toward `goal`: `rate` per second (about 6 is snappy), the short way round. */
export function dampOrbit(cur: Orbit, goal: Orbit, dt: number, rate: number) {
  const k = 1 - Math.exp(-dt * rate);
  cur.fx += (goal.fx - cur.fx) * k;
  cur.fy += (goal.fy - cur.fy) * k;
  cur.fz += (goal.fz - cur.fz) * k;
  cur.yaw += angleDelta(cur.yaw, goal.yaw) * k;
  cur.el += (goal.el - cur.el) * k;
  cur.dist += (goal.dist - cur.dist) * k;
  cur.fov += (goal.fov - cur.fov) * k;
  return cur;
}

// ---------- seeing points on screen ----------

/** Whether every point (x, y, z triples) is on screen from `p`, `margin` (0 to 1) in from the edges. */
export function allInView(p: Pose, aspect: number, points: readonly number[], margin: number) {
  const tanV = Math.tan((p.fov * Math.PI) / 360);
  const tanH = tanV * aspect;
  const cy = Math.cos(p.yaw);
  const sy = Math.sin(p.yaw);
  const cp = Math.cos(p.pitch);
  const sp = Math.sin(p.pitch);
  const lim = 1 - margin;
  for (let i = 0; i < points.length; i += 3) {
    const dx = points[i] - p.x;
    const dy = points[i + 1] - p.y;
    const dz = points[i + 2] - p.z;
    const depth = -sy * cp * dx + sp * dy - cy * cp * dz;
    if (depth <= 0) return false;
    const right = cy * dx - sy * dz;
    const up = sy * sp * dx + cp * dy + cy * sp * dz;
    if (Math.abs(right / (depth * tanH)) > lim || Math.abs(up / (depth * tanV)) > lim) return false;
  }
  return true;
}

/** The floor's corners at floor and ceiling height: what the overview fits on screen. */
const FLOOR_BOX = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [0, WALL_H].flatMap((y) => [sx * HALF_W, y, sz * HALF_D])));

/** Where `points` land on screen from `p`: the smallest and largest normalised x and y (-1 to 1 is the view). */
export function screenBounds(p: Pose, aspect: number, points: readonly number[], out = { minX: 0, maxX: 0, minY: 0, maxY: 0 }) {
  const tanV = Math.tan((p.fov * Math.PI) / 360);
  const tanH = tanV * aspect;
  const cy = Math.cos(p.yaw);
  const sy = Math.sin(p.yaw);
  const cp = Math.cos(p.pitch);
  const sp = Math.sin(p.pitch);
  out.minX = out.minY = Infinity;
  out.maxX = out.maxY = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    const dx = points[i] - p.x;
    const dy = points[i + 1] - p.y;
    const dz = points[i + 2] - p.z;
    const depth = Math.max(1e-6, -sy * cp * dx + sp * dy - cy * cp * dz);
    const x = (cy * dx - sy * dz) / (depth * tanH);
    const y = (sy * sp * dx + cp * dy + cy * sp * dz) / (depth * tanV);
    out.minX = Math.min(out.minX, x);
    out.maxX = Math.max(out.maxX, x);
    out.minY = Math.min(out.minY, y);
    out.maxY = Math.max(out.maxY, y);
  }
  return out;
}

// ---------- the overview ("dollhouse") ----------

export const OVERVIEW = {
  /** Looking down at about 36°: low enough to see the city past the floor. */
  el: 0.62,
  fov: 40,
  /** Height of the point it orbits, a little above the floor. */
  fy: 0.8,
  /** Closest zoom, metres; the furthest is maxZoom times the fitted distance. */
  minDist: 9,
  maxZoom: 2.2,
  margin: 0.06,
  /** The floor sits this much (of half the view) above the middle, clear of the floor picker along the bottom. */
  lift: 0.07,
  /** The steepest and shallowest the manager can tilt it. */
  minEl: 0.35,
  maxEl: 1.35,
};

/** The orbit bearing for quarter `q`: the four corners, south-east first. */
export const quadYaw = (q: number) => Math.PI / 4 + q * (Math.PI / 2);

/** The corner view closest to looking along `yaw`. */
export const nearestQuad = (yaw: number) => Math.round(angleDelta(Math.PI / 4, yaw) / (Math.PI / 2));

/** The distance at which the whole floor fits on screen from bearing `yaw` (binary search on a pure projection). */
export function fitDistance(o: Orbit, aspect: number, points: readonly number[] = FLOOR_BOX, margin = OVERVIEW.margin, scratch: Pose = newPose()) {
  const probe = { ...o };
  let lo = 1;
  let hi = 600;
  for (let i = 0; i < 40; i++) {
    probe.dist = (lo + hi) / 2;
    if (allInView(orbitPose(probe, scratch), aspect, points, margin)) hi = probe.dist;
    else lo = probe.dist;
  }
  return hi;
}

/**
 * The overview's starting orbit for a viewer facing `yaw`: the floor fitted to the screen and centred on it, a little
 * high (the near half looms larger, so the focus moves toward it until the floor sits where it should).
 */
export function overviewOrbit(yaw: number, aspect: number, out: Orbit) {
  out.fx = 0;
  out.fy = OVERVIEW.fy;
  out.fz = 0;
  out.yaw = quadYaw(nearestQuad(yaw));
  out.el = OVERVIEW.el;
  out.fov = OVERVIEW.fov;
  const pose = newPose();
  const tanV = Math.tan((out.fov * Math.PI) / 360);
  for (let i = 0; i < 4; i++) {
    out.dist = fitDistance(out, aspect, FLOOR_BOX, OVERVIEW.margin, pose);
    const b = screenBounds(orbitPose(out, pose), aspect, FLOOR_BOX);
    const up = (b.minY + b.maxY) / 2 - OVERVIEW.lift;
    panOrbit(out, ((b.minX + b.maxX) / 2) * out.dist * tanV * aspect, up * out.dist * (tanV / Math.sin(out.el)));
  }
  out.dist = fitDistance(out, aspect, FLOOR_BOX, OVERVIEW.margin, pose);
  return out;
}

/** Keeps a focus point over the floor. */
export function clampFocus(o: Orbit) {
  o.fx = Math.min(HALF_W, Math.max(-HALF_W, o.fx));
  o.fz = Math.min(HALF_D, Math.max(-HALF_D, o.fz));
  return o;
}

/** Moves the focus `right` and `forward` metres as the camera sees the ground. */
export function panOrbit(o: Orbit, right: number, forward: number) {
  const s = Math.sin(o.yaw);
  const c = Math.cos(o.yaw);
  o.fx += c * right - s * forward;
  o.fz += -s * right - c * forward;
  return clampFocus(o);
}

export interface Sides {
  x: number;
  z: number;
}

/** Which walls face a camera on bearing `yaw`: +1 east or south, -1 west or north, 0 neither (the cutaway takes those). */
export function nearSides(yaw: number, out: Sides) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  out.x = s > 0.05 ? 1 : s < -0.05 ? -1 : 0;
  out.z = c > 0.05 ? 1 : c < -0.05 ? -1 : 0;
  return out;
}
