// The character lab's shared skeleton: its bones, the proportions a design gives them, and the solver that turns a pose
// (poses.ts) into bone rotations. Arms and legs are two-bone IK, so hands land on the keyboard and feet on the floor
// whatever a design's limb lengths, and every design moves the same way. Pure (three.js maths only, no scene).
// Figure space: origin on the floor between the feet, facing -Z, +X their right hand (as Character.tsx).
import * as THREE from 'three';

export const BONES = [
  'root',
  'pelvis',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulderL',
  'upperArmL',
  'forearmL',
  'handL',
  'shoulderR',
  'upperArmR',
  'forearmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
] as const;
export type Bone = (typeof BONES)[number];
export const N_BONES = BONES.length;
export const BI = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<Bone, number>;

const PARENT_OF: Record<Bone, Bone | null> = {
  root: null,
  pelvis: 'root',
  spine: 'pelvis',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  shoulderL: 'chest',
  upperArmL: 'shoulderL',
  forearmL: 'upperArmL',
  handL: 'forearmL',
  shoulderR: 'chest',
  upperArmR: 'shoulderR',
  forearmR: 'upperArmR',
  handR: 'forearmR',
  thighL: 'pelvis',
  shinL: 'thighL',
  footL: 'shinL',
  thighR: 'pelvis',
  shinR: 'thighR',
  footR: 'shinR',
};
/** Each bone's parent index (-1 for the root); parents always come first. */
export const PARENT = BONES.map((b) => (PARENT_OF[b] ? BI[PARENT_OF[b]!] : -1));

/** A design's body measurements (metres), with the look's height already in the upper body. */
export interface Proportions {
  /** Hip joint to knee, knee to ankle, ankle to sole. */
  thigh: number;
  shin: number;
  ankle: number;
  /** Hip joints either side of the pelvis, and below it. */
  hipX: number;
  hipY: number;
  /** Pelvis to waist, waist to chest, chest to the base of the neck, neck to the middle of the head. */
  spine: number;
  chest: number;
  neck: number;
  head: number;
  /** The head's radius, as drawn (today's head is 0.2 at scale 1). */
  headR: number;
  /** The shoulder joints from the chest bone: out to the side and up. */
  shoulderX: number;
  shoulderY: number;
  /** Shoulder to elbow, elbow to wrist (0: one straight piece, like today's arms), wrist to the middle of the palm. */
  upperArm: number;
  forearm: number;
  hand: number;
  /** The pelvis joint above the seat when sat down. */
  seat: number;
  /** How deep the chest is in front of the chest bone (for hands in front of it). */
  chestDepth: number;
  /** How far out a hanging arm leans (the x of its direction, y being -1), so it clears the body. */
  splay: number;
}

export type V3 = readonly [number, number, number];

export const standHeight = (p: Proportions) => p.ankle + p.shin + p.thigh + p.hipY;
export const armLength = (p: Proportions) => p.upperArm + p.forearm;

/** Each bone's offset from its parent with nothing rotated (the bind pose). */
export function bindOffsets(p: Proportions): V3[] {
  const o: Partial<Record<Bone, V3>> = {
    root: [0, 0, 0],
    pelvis: [0, standHeight(p), 0],
    spine: [0, p.spine, 0],
    chest: [0, p.chest, 0],
    neck: [0, p.neck, 0],
    head: [0, p.head, 0],
  };
  for (const [s, m] of [
    ['L', -1],
    ['R', 1],
  ] as const) {
    // the clavicle starts a third of the way out; the arm joint is at its end
    o[`shoulder${s}`] = [m * p.shoulderX * 0.35, p.shoulderY, 0];
    o[`upperArm${s}`] = [m * p.shoulderX * 0.65, 0, 0];
    o[`forearm${s}`] = [0, -p.upperArm, 0];
    o[`hand${s}`] = [0, -p.forearm, 0];
    o[`thigh${s}`] = [m * p.hipX, -p.hipY, 0];
    o[`shin${s}`] = [0, -p.thigh, 0];
    o[`foot${s}`] = [0, -p.shin, 0];
  }
  return BONES.map((b) => o[b]!);
}

/** Every bone's position in figure space in the bind pose. */
export function bindPositions(p: Proportions): V3[] {
  const off = bindOffsets(p);
  const out: V3[] = [];
  BONES.forEach((_, i) => {
    const q = PARENT[i] < 0 ? [0, 0, 0] : out[PARENT[i]];
    out.push([q[0] + off[i][0], q[1] + off[i][1], q[2] + off[i][2]]);
  });
  return out;
}

// ---------- poses ----------

/**
 * Where a hand goes: `reach` is a direction from the shoulder in chest space (x > 0 away from the body) and how much of
 * the arm's length it reaches; `root`, `chest` and `head` are points in figure, chest or head space (x > 0 outward);
 * `between` is `k` of the way from one target to another.
 */
export type Target = { reach: V3; ext?: number } | { root: V3 } | { chest: V3 } | { head: V3 } | { between: readonly [Target, Target]; k: number };

/**
 * An arm placed by its wrist (IK): `pole` is where the elbow points, in chest space (x > 0 outward). `twist` turns the
 * forearm about its length: 0 palm to the body when hanging, PI/2 palm down with the arm held out in front.
 * `wrist` bends the hand (Euler, mirrored for the left).
 */
export interface ArmIK {
  to: Target;
  pole: V3;
  twist?: number;
  wrist?: V3;
}
/** An arm by its angles (FK): forward swing and outward lift at the shoulder, the elbow's bend. */
export interface ArmFK {
  swing: number;
  out: number;
  bend: number;
  twist?: number;
  wrist?: V3;
}
export type ArmGoal = ArmIK | ArmFK;

/** A leg placed by its ankle, in figure space (x > 0 outward); the foot's pitch (> 0 toe up) and turn out. */
export interface LegGoal {
  ankle: V3;
  pitch?: number;
  toe?: number;
  /** Where the knee points, in pelvis space (default ahead). */
  pole?: V3;
}

/**
 * A whole pose. Rotations are Euler angles applied Y, X, Z (turn, then nod, then tilt); x > 0 tips a bone back, y > 0
 * turns it to their left. The pelvis is placed in figure space; the shoulders (clavicles) are mirrored for the left.
 */
export interface Pose {
  pelvis: V3;
  hips: V3;
  spine: V3;
  chest: V3;
  neck: V3;
  head: V3;
  clav: { l: V3; r: V3 };
  arm: { l: ArmGoal; r: ArmGoal };
  leg: { l: LegGoal; r: LegGoal };
}

/** A solved pose: each bone's rotation (local, 4 numbers each) and the pelvis's position. */
export interface Solved {
  q: Float32Array;
  pelvis: Float32Array;
}

export function newSolved(): Solved {
  const q = new Float32Array(N_BONES * 4);
  for (let i = 0; i < N_BONES; i++) q[i * 4 + 3] = 1;
  return { q, pelvis: new Float32Array(3) };
}

// scratch, so solving allocates nothing per frame
const wq = Array.from({ length: N_BONES }, () => new THREE.Quaternion());
const wp = Array.from({ length: N_BONES }, () => new THREE.Vector3());
const lq = new THREE.Quaternion();
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const eu = new THREE.Euler(0, 0, 0, 'YXZ');
const va = new THREE.Vector3();
const vb = new THREE.Vector3();
const target = new THREE.Vector3();
const pole = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const offsets = new WeakMap<Proportions, V3[]>();

function offsetsOf(p: Proportions) {
  let o = offsets.get(p);
  if (!o) offsets.set(p, (o = bindOffsets(p)));
  return o;
}

const fromEuler = (e: V3, m: number, out: THREE.Quaternion) => out.setFromEuler(eu.set(e[0], m * e[1], m * e[2], 'YXZ'));

/** Sets bone i's local rotation and works out where it is and how it's turned in figure space. */
function place(s: Solved, off: V3[], i: number, local: THREE.Quaternion) {
  local.toArray(s.q, i * 4);
  const p = PARENT[i];
  wq[i].copy(wq[p]).multiply(local);
  wp[i].set(...off[i]).applyQuaternion(wq[p]).add(wp[p]);
}

const tb = { d: new THREE.Vector3(), pp: new THREE.Vector3(), u: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), m: new THREE.Matrix4() };

/**
 * Two-bone IK from a joint at `root` to `goal`, bones a then b long, the middle joint bending toward `poleDir`. Writes
 * the first bone's rotation in figure space to `out` (its length along -Y, local +Z toward the pole for an arm, away
 * from it for a leg, so a straight limb isn't turned) and returns the middle joint's bend (radians, 0 straight).
 */
export function twoBone(root: THREE.Vector3, goal: THREE.Vector3, poleDir: THREE.Vector3, a: number, b: number, leg: boolean, out: THREE.Quaternion): number {
  const { d, pp, u, x, y, z, m } = tb;
  d.subVectors(goal, root);
  let dist = d.length();
  if (dist < 1e-6) d.set(0, -1, 0);
  else d.divideScalar(dist);
  pp.copy(poleDir).addScaledVector(d, -poleDir.dot(d));
  if (pp.lengthSq() < 1e-10) pp.crossVectors(d, Math.abs(d.x) < 0.9 ? X : Z);
  pp.normalize();
  let bend = 0;
  if (b < 1e-6) {
    u.copy(d); // one straight piece: point at it
  } else {
    dist = Math.min(Math.max(dist, Math.abs(a - b) + 1e-4), (a + b) * 0.9999);
    const cosA = Math.min(1, Math.max(-1, (a * a + dist * dist - b * b) / (2 * a * dist)));
    u.copy(d).multiplyScalar(cosA).addScaledVector(pp, Math.sqrt(1 - cosA * cosA));
    const cosG = Math.min(1, Math.max(-1, (a * a + b * b - dist * dist) / (2 * a * b)));
    bend = Math.PI - Math.acos(cosG);
  }
  y.copy(u).negate();
  z.copy(pp).addScaledVector(u, -pp.dot(u));
  if (z.lengthSq() < 1e-10) z.crossVectors(Y, u);
  z.normalize();
  if (leg) z.negate();
  x.crossVectors(y, z);
  out.setFromRotationMatrix(m.makeBasis(x, y, z));
  return bend;
}

const mid = new THREE.Vector3();

/** Where a hand target is, in figure space. */
function resolve(t: Target, m: number, shoulder: THREE.Vector3, reach: number, out: THREE.Vector3): THREE.Vector3 {
  if ('between' in t) {
    resolve(t.between[0], m, shoulder, reach, out);
    const ax = out.x;
    const ay = out.y;
    const az = out.z;
    resolve(t.between[1], m, shoulder, reach, mid);
    return out.set(ax, ay, az).lerp(mid, t.k);
  }
  if ('reach' in t) {
    out.set(m * t.reach[0], t.reach[1], t.reach[2]).normalize().applyQuaternion(wq[BI.chest]);
    return out.multiplyScalar(reach * (t.ext ?? 0.97)).add(shoulder);
  }
  if ('root' in t) return out.set(m * t.root[0], t.root[1], t.root[2]);
  const [v, at] = 'chest' in t ? [t.chest, BI.chest] : [t.head, BI.head];
  return out.set(m * v[0], v[1], v[2]).applyQuaternion(wq[at]).add(wp[at]);
}

const SIDES = [
  ['l', 'L', -1],
  ['r', 'R', 1],
] as const;

/** Solves `pose` for a body of proportions `p` into `out` (local rotations, the pelvis's position). */
export function solve(pose: Pose, p: Proportions, out: Solved): Solved {
  const off = offsetsOf(p);
  wq[0].identity();
  wp[0].set(0, 0, 0);
  out.q.set([0, 0, 0, 1], 0);
  out.pelvis.set(pose.pelvis);
  // the pelvis is placed, not offset
  fromEuler(pose.hips, 1, lq).toArray(out.q, BI.pelvis * 4);
  wq[BI.pelvis].copy(lq);
  wp[BI.pelvis].set(...pose.pelvis);
  place(out, off, BI.spine, fromEuler(pose.spine, 1, lq));
  place(out, off, BI.chest, fromEuler(pose.chest, 1, lq));
  place(out, off, BI.neck, fromEuler(pose.neck, 1, lq));
  place(out, off, BI.head, fromEuler(pose.head, 1, lq));

  for (const [s, S, m] of SIDES) {
    const sh = BI[`shoulder${S}`];
    const ua = BI[`upperArm${S}`];
    const fa = BI[`forearm${S}`];
    const hd = BI[`hand${S}`];
    place(out, off, sh, fromEuler(pose.clav[s], m, lq));
    const goal = pose.arm[s];
    const joint = va.set(...off[ua]).applyQuaternion(wq[sh]).add(wp[sh]);
    let bend: number;
    if ('swing' in goal) {
      lq.setFromAxisAngle(X, goal.swing).multiply(qa.setFromAxisAngle(Z, m * goal.out));
      bend = goal.bend;
    } else {
      resolve(goal.to, m, joint, armLength(p), target);
      pole.set(m * goal.pole[0], goal.pole[1], goal.pole[2]).applyQuaternion(wq[BI.chest]);
      bend = twoBone(joint, target, pole, p.upperArm, p.forearm, false, qb);
      lq.copy(wq[sh]).invert().multiply(qb);
    }
    place(out, off, ua, lq);
    place(out, off, fa, lq.setFromAxisAngle(X, bend).multiply(qa.setFromAxisAngle(Y, m * (goal.twist ?? 0))));
    place(out, off, hd, fromEuler(goal.wrist ?? [0, 0, 0], m, lq));
  }

  for (const [s, S, m] of SIDES) {
    const th = BI[`thigh${S}`];
    const sn = BI[`shin${S}`];
    const ft = BI[`foot${S}`];
    const goal = pose.leg[s];
    const joint = vb.set(...off[th]).applyQuaternion(wq[BI.pelvis]).add(wp[BI.pelvis]);
    target.set(m * goal.ankle[0], goal.ankle[1], goal.ankle[2]);
    const k = goal.pole ?? [0.12, 0, -1];
    pole.set(m * k[0], k[1], k[2]).applyQuaternion(wq[BI.pelvis]);
    const bend = twoBone(joint, target, pole, p.thigh, p.shin, true, qb);
    place(out, off, th, lq.copy(wq[BI.pelvis]).invert().multiply(qb));
    place(out, off, sn, lq.setFromAxisAngle(X, -bend));
    // the foot keeps its own heading in figure space: flat on the floor unless pitched
    qa.setFromAxisAngle(Y, -m * (goal.toe ?? 0)).multiply(qb.setFromAxisAngle(X, goal.pitch ?? 0));
    place(out, off, ft, lq.copy(wq[sn]).invert().multiply(qa));
  }
  return out;
}

/** Blends two solved poses: w = 0 gives a, 1 gives b. */
export function blendSolved(a: Solved, b: Solved, w: number, out: Solved): Solved {
  const [o, x, y] = [out.q, a.q, b.q] as unknown as number[][];
  for (let i = 0; i < N_BONES; i++) THREE.Quaternion.slerpFlat(o, i * 4, x, i * 4, y, i * 4, w);
  for (let k = 0; k < 3; k++) out.pelvis[k] = a.pelvis[k] + (b.pelvis[k] - a.pelvis[k]) * w;
  return out;
}

/** Every bone's position (3 each) and rotation (4 each) in figure space, from a solved pose. */
export function worldOf(s: Solved, p: Proportions, pos: Float32Array, rot: Float32Array) {
  const off = offsetsOf(p);
  wq[0].identity();
  wp[0].set(0, 0, 0);
  for (let i = 1; i < N_BONES; i++) {
    lq.fromArray(s.q, i * 4);
    if (i === BI.pelvis) {
      wq[i].copy(lq);
      wp[i].fromArray(s.pelvis);
    } else {
      const q = PARENT[i];
      wq[i].copy(wq[q]).multiply(lq);
      wp[i].set(...off[i]).applyQuaternion(wq[q]).add(wp[q]);
    }
  }
  for (let i = 0; i < N_BONES; i++) {
    wp[i].toArray(pos, i * 3);
    wq[i].toArray(rot, i * 4);
  }
}
