// How the lab's designs are built: every part of a body merged into one skinned geometry with vertex colours, so a
// figure's body is one draw call (and one for its ink), whatever it's made of. Parts are rigid on a bone (limbs, hands,
// shoes) or skinned across several by height (the torso, so it bends at the waist without a crack). Also the shapes
// the designs share: tapered capsules, rounded boxes, and a torso surface the outfits are laid on.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BI, bindPositions, type Bone, type Proportions, type V3 } from './rig';

// ---------- shapes ----------

type Xf = { at?: V3; rot?: V3; scale?: V3 };
const m4 = new THREE.Matrix4();
const qq = new THREE.Quaternion();
const ee = new THREE.Euler();

/** Bakes a transform into a geometry: scale, then rotate (XYZ), then move. */
export function xf<G extends THREE.BufferGeometry>(g: G, { at = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] }: Xf): G {
  qq.setFromEuler(ee.set(rot[0], rot[1], rot[2]));
  g.applyMatrix4(m4.compose(new THREE.Vector3(...at), qq, new THREE.Vector3(...scale)));
  return g;
}

/** A capsule hanging down -Y from the origin: radius r1 round the top joint, r2 round the bottom one, `len` apart. */
export function taper(r1: number, r2: number, len: number, radial = 10, cap = 4) {
  const sinPhi = Math.max(-0.95, Math.min(0.95, (r1 - r2) / len));
  const phi = Math.asin(sinPhi);
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= cap; i++) {
    const t = -Math.PI / 2 + ((phi + Math.PI / 2) * i) / cap;
    pts.push(new THREE.Vector2(Math.max(0, r2 * Math.cos(t)), -len + r2 * Math.sin(t)));
  }
  for (let i = 0; i <= cap; i++) {
    const t = phi + ((Math.PI / 2 - phi) * i) / cap;
    pts.push(new THREE.Vector2(Math.max(0, r1 * Math.cos(t)), r1 * Math.sin(t)));
  }
  return new THREE.LatheGeometry(pts, radial);
}

export const ball = (r: number, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
export const blob = (rx: number, ry: number, rz: number, w = 12, h = 8) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
/** A box with rounded edges (smooth normals all round, so its ink shell has no gaps). */
export const rbox = (w: number, h: number, d: number, r: number, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
/**
 * A smooth closed shape along z, like a shoe or its sole: from `back` to `front` (front < back, toes to -z), its
 * half-width w(s) and its top top(s) at each point along it (s: 0 at the back to 1 at the front), widest at height
 * base(s) and `under` deep below it. Its cross-section is a superellipse of squareness n (2 round, 4 nearly flat-sided),
 * its ends rounded by m the same way. One smooth surface, so its ink shell has no gaps.
 */
export function loaf(back: number, front: number, w: (s: number) => number, top: (s: number) => number, base: number | ((s: number) => number), under: number, { n = 2, m = 2, seg = 20, rings = 14 } = {}) {
  const baseAt = typeof base === 'number' ? () => base : base;
  let g: THREE.BufferGeometry = new THREE.SphereGeometry(1, seg, rings).rotateX(Math.PI / 2);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const r = Math.hypot(x, y);
    const rr = r ** (2 / m);
    const s = (1 - spow(p.getZ(i), 2 / m)) / 2;
    const cx = r ? rr * spow(x / r, 2 / n) : 0;
    const cy = r ? rr * spow(y / r, 2 / n) : 0;
    const b = baseAt(s);
    p.setXYZ(i, cx * w(s), b + cy * (cy > 0 ? top(s) - b : under), back + (front - back) * s);
  }
  g.computeVertexNormals();
  return g;
}

/** A closed ring of tube through points. */
export function ring(points: THREE.Vector3[], r: number, radial = 6) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), points.length * 2, r, radial, true);
}

// ---------- the torso surface ----------

/**
 * A torso as a surface: at height parameter θ (0 bottom to PI top) its cross-section is a superellipse of half-width rx
 * and half-depth rz (squareness n: 2 round, 6 boxy), pushed forward by dz; the vertical profile is rounded by m the same
 * way, so the ends close smoothly. Outfits are laid on it by angle (0 at the front, PI/2 their right side) and height.
 */
export interface TorsoShape {
  cy: number;
  hy: number;
  m: number;
  rx(th: number): number;
  rz(th: number): number;
  n(th: number): number;
  dz?(th: number): number;
}

const spow = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** e;

export function surfacePoint(s: TorsoShape, a: number, th: number, out: THREE.Vector3) {
  const ev = 2 / s.m;
  const k = Math.abs(Math.sin(th)) ** ev;
  const eh = 2 / s.n(th);
  return out.set(s.rx(th) * k * spow(Math.sin(a), eh), s.cy - s.hy * spow(Math.cos(th), ev), -s.rz(th) * k * spow(Math.cos(a), eh) + (s.dz?.(th) ?? 0));
}

const pA = new THREE.Vector3();
const pB = new THREE.Vector3();
const pC = new THREE.Vector3();
const pD = new THREE.Vector3();

/** The surface's outward normal at (a, θ), by finite differences (straight up or down at the poles). */
export function surfaceNormal(s: TorsoShape, a: number, th: number, out: THREE.Vector3) {
  const e = 1e-3;
  surfacePoint(s, a, Math.min(Math.PI, th + e), pA).sub(surfacePoint(s, a, Math.max(0, th - e), pB));
  surfacePoint(s, a + e, th, pC).sub(surfacePoint(s, a - e, th, pD));
  out.crossVectors(pA, pC);
  if (out.lengthSq() < 1e-14) return out.set(0, th < Math.PI / 2 ? -1 : 1, 0);
  return out.normalize();
}

/** The height parameter θ at which the surface reaches height y. */
export function thetaAt(s: TorsoShape, y: number) {
  let lo = 0;
  let hi = Math.PI;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (surfacePoint(s, 0, mid, pA).y < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const nrm = new THREE.Vector3();
const pos = new THREE.Vector3();

/**
 * A patch of the surface, `lift` out from it, as an indexed grid: `map(u, v)` (each 0 to 1) gives the angle and the
 * height parameter θ of each grid point. A full ring is u over 0..2PI.
 */
export function surfacePatch(s: TorsoShape, map: (u: number, v: number) => [number, number], lift: number, segU: number, segV: number) {
  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= segV; j++) {
    for (let i = 0; i <= segU; i++) {
      const [a, th] = map(i / segU, j / segV);
      surfacePoint(s, a, th, pos);
      surfaceNormal(s, a, th, nrm);
      pos.addScaledVector(nrm, lift);
      positions.push(pos.x, pos.y, pos.z);
      normals.push(nrm.x, nrm.y, nrm.z);
    }
  }
  const row = segU + 1;
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setIndex(index);
  return g;
}

/** The band of the surface between heights y0 and y1 (all the way round), `lift` out. */
export const band = (s: TorsoShape, y0: number, y1: number, lift: number, segU = 32, segV = 2) => {
  const t0 = thetaAt(s, y0);
  const t1 = thetaAt(s, y1);
  return surfacePatch(s, (u, v) => [u * Math.PI * 2, t0 + (t1 - t0) * v], lift, segU, segV);
};

/** A patch between angles a0..a1 and heights y0..y1. */
export const panel = (s: TorsoShape, a0: number, a1: number, y0: number, y1: number, lift: number, segU = 6, segV = 6) => {
  const t0 = thetaAt(s, y0);
  const t1 = thetaAt(s, y1);
  return surfacePatch(s, (u, v) => [a0 + (a1 - a0) * u, t0 + (t1 - t0) * v], lift, segU, segV);
};

/** A diamond on the surface centred at angle a and height y, `w` wide (radians) and `h` tall (metres). */
export const diamond = (s: TorsoShape, a: number, y: number, w: number, h: number, lift: number) => {
  const ty = (yy: number) => thetaAt(s, yy);
  return surfacePatch(
    s,
    (u, v) => {
      const p = u - 0.5;
      const q = v - 0.5;
      return [a + (p - q) * w * 0.7, ty(y + (p + q) * h * 0.7)];
    },
    lift,
    2,
    2,
  );
};

/** A ring round the surface at height y, `lift` out, of tube radius r. */
export function collarRing(s: TorsoShape, y: number, lift: number, r: number, from = 0, to = Math.PI * 2, closed = true) {
  const th = thetaAt(s, y);
  const pts: THREE.Vector3[] = [];
  const n = 20;
  for (let i = 0; i < (closed ? n : n + 1); i++) {
    const a = from + ((to - from) * i) / n;
    surfacePoint(s, a, th, pos);
    surfaceNormal(s, a, th, nrm);
    pts.push(pos.clone().addScaledVector(nrm, lift));
  }
  if (closed) return ring(pts, r);
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false), n * 2, r, 6, false);
}

// ---------- the skinned body ----------

/** Up to two bones and their weights for a point at height y: [bone, weight, bone, weight]. */
export type Weigh = (y: number) => readonly [number, number, number, number];

/** Skins the torso by height: the pelvis below its joint, blending through the waist to the chest. */
export function torsoWeights(p: Proportions): Weigh {
  const b = bindPositions(p);
  const yp = b[BI.pelvis][1];
  const ys = b[BI.spine][1];
  const yc = b[BI.chest][1];
  return (y) => {
    if (y <= yp) return [BI.pelvis, 1, BI.spine, 0];
    if (y <= ys) {
      const k = (y - yp) / (ys - yp);
      return [BI.pelvis, 1 - k, BI.spine, k];
    }
    if (y <= yc) {
      const k = (y - ys) / (yc - ys);
      return [BI.spine, 1 - k, BI.chest, k];
    }
    return [BI.chest, 1, BI.spine, 0];
  };
}

const tmpColor = new THREE.Color();

/** Collects a body's parts, each in its colour and bound to its bones, and merges them. */
export class Body {
  private main: THREE.BufferGeometry[] = [];
  private extra: THREE.BufferGeometry[] = [];
  readonly bind: V3[];

  constructor(readonly p: Proportions) {
    this.bind = bindPositions(p);
  }

  private prep(g: THREE.BufferGeometry, color: string, weigh: Weigh, detail: boolean, ink: number) {
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    tmpColor.set(color);
    g.setAttribute('inkScale', new THREE.BufferAttribute(new Float32Array(n).fill(ink), 1));
    const col = new Float32Array(n * 3);
    const idx = new Uint16Array(n * 4);
    const wts = new Float32Array(n * 4);
    const p = g.attributes.position;
    for (let i = 0; i < n; i++) {
      col.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
      const [b0, w0, b1, w1] = weigh(p.getY(i));
      idx[i * 4] = b0;
      idx[i * 4 + 1] = b1;
      wts[i * 4] = w0;
      wts[i * 4 + 1] = w1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(wts, 4));
    (detail ? this.extra : this.main).push(g);
  }

  /**
   * A part rigid on `bone`, made in the bone's own space (origin at the joint, axes as the figure's in the bind pose).
   * `ink` scales its ink line: thinner for small parts, and for what stands on the floor, whose shell can't wrap round
   * underneath and shows as hooks at its ends.
   */
  rigid(bone: Bone, g: THREE.BufferGeometry, color: string, detail = false, ink = 1) {
    const at = this.bind[BI[bone]];
    g.translate(at[0], at[1], at[2]);
    const i = BI[bone];
    this.prep(g, color, () => [i, 1, i, 0], detail, ink);
    return this;
  }

  /** A part on the same bone each side: `make()` builds the right one (in bone space); the left is its mirror. */
  pair(bone: 'upperArm' | 'forearm' | 'hand' | 'thigh' | 'shin' | 'foot' | 'shoulder', make: () => THREE.BufferGeometry, color: string, detail = false, ink = 1) {
    this.rigid(`${bone}R`, make(), color, detail, ink);
    this.rigid(`${bone}L`, mirrorX(make()), color, detail, ink);
    return this;
  }

  /** A part in figure space, skinned by height. */
  skinned(g: THREE.BufferGeometry, color: string, weigh: Weigh, detail = false) {
    this.prep(g, color, weigh, detail, 1);
    return this;
  }

  /** The merged body (inked) and details laid on it (not inked: stripes, pockets, buttons). */
  build(): { body: THREE.BufferGeometry; detail: THREE.BufferGeometry | null } {
    return { body: mergeAll(this.main)!, detail: mergeAll(this.extra) };
  }
}

/** Mirrors a geometry across x = 0, keeping its faces facing out. */
export function mirrorX(g: THREE.BufferGeometry) {
  g.scale(-1, 1, 1);
  const index = g.index;
  if (index) {
    const a = index.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    index.needsUpdate = true;
  } else {
    for (const name of Object.keys(g.attributes)) {
      const attr = g.attributes[name];
      const s = attr.itemSize;
      const arr = attr.array;
      for (let i = 0; i < attr.count; i += 3) {
        for (let k = 0; k < s; k++) {
          const t = arr[(i + 1) * s + k];
          arr[(i + 1) * s + k] = arr[(i + 2) * s + k];
          arr[(i + 2) * s + k] = t;
        }
      }
      attr.needsUpdate = true;
    }
  }
  return g;
}

function mergeAll(parts: THREE.BufferGeometry[]) {
  if (!parts.length) return null;
  // merging needs all parts indexed or none: give the few that aren't (a rounded box) an index of their own, rather than
  // unrolling every other part to three vertices a triangle (three times the skinning work)
  if (parts.some((p) => !p.index)) parts = parts.map((p) => (p.index ? p : p.setIndex(Array.from({ length: p.attributes.position.count }, (_, i) => i))));
  const out = mergeGeometries(parts);
  if (!out) throw new Error('could not merge a lab body');
  parts.forEach((p) => p.dispose());
  out.computeBoundingSphere();
  return out;
}

/** Triangles a geometry draws. */
export const triangles = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
