// What the street events' scenes share (scenes/RockBus.tsx and the rest): models built from low-poly parts merged
// into one vertex-coloured mesh each (a toon material that takes each vertex's colour, so a whole truck is a draw call
// or two), their wheels, a soft shadow under them, a crowd of little people drawn instanced (a few draw calls for the
// lot), and the music notes and sparks that fly off a band. Materials and the shared geometries are cached and never
// disposed, like kit.ts's; what a scene builds for itself it disposes of.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EVENT_HAZE, hazedToon } from '../haze';
import { glowOut, toonOut } from './kit';

export type V3 = [number, number, number];
export interface Place {
  at?: V3;
  rot?: V3;
  scale?: V3;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v = new THREE.Vector3();
const sv = new THREE.Vector3();
const col = new THREE.Color();

/** A part of a model: a primitive placed (scaled, turned, then moved) and painted one colour. */
export function part(g: THREE.BufferGeometry, color: string, { at = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] }: Place = {}): THREE.BufferGeometry {
  const p = g.index ? g.toNonIndexed() : g;
  if (p !== g) g.dispose();
  p.applyMatrix4(m4.compose(v.set(...at), q.setFromEuler(e.set(...rot)), sv.set(...scale)));
  col.set(color);
  const n = p.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = col.r;
    c[i * 3 + 1] = col.g;
    c[i * 3 + 2] = col.b;
  }
  p.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return p;
}

/** Parts merged into one geometry (one draw call); the parts are used up. */
export function model(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!g) throw new Error('could not merge a street event model');
  g.computeBoundingSphere();
  return g;
}

// primitives, for the parts
export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rTop: number, rBottom: number, h: number, seg = 12) => new THREE.CylinderGeometry(rTop, rBottom, h, seg);
export const ball = (r: number, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h);
export const cone = (r: number, h: number, seg = 12) => new THREE.ConeGeometry(r, h, seg);
export const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 3, 10);

/** The toon material models are drawn with: white, taking each vertex's colour, hazed and dimmed at night like the rest. */
export const painted = () => hazedToon('#ffffff', EVENT_HAZE, { vertexColors: true });

let lit: THREE.MeshBasicMaterial | null = null;
/** For a model's lamps: each vertex's colour, never shaded, dimmed or hazed. */
export function glowing(): THREE.MeshBasicMaterial {
  lit ??= new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
  return lit;
}

// ---------- wheels ----------

/** A wheel on its side (its axle along x): a dark tyre, and a grey hub with a bar across so it's seen turning. */
export function wheelGeometry(r: number, w: number): THREE.BufferGeometry {
  return model([
    part(cyl(r, r, w, 14), '#24252d', { rot: [0, 0, Math.PI / 2] }),
    part(cyl(r * 0.55, r * 0.55, w + 0.02, 10), '#c3c7cf', { rot: [0, 0, Math.PI / 2] }),
    part(box(w + 0.04, r * 0.9, r * 0.2), '#7a7f8a'),
  ]);
}

/** Instanced wheels at their places in a vehicle's frame, turned `angle` (distance over radius) about their axles. */
export function spinWheels(mesh: THREE.InstancedMesh, at: readonly V3[], angle: number) {
  q.setFromAxisAngle(v.set(1, 0, 0), angle);
  for (let i = 0; i < at.length; i++) mesh.setMatrixAt(i, m4.compose(v.set(...at[i]), q, sv.set(1, 1, 1)));
  mesh.instanceMatrix.needsUpdate = true;
}

// ---------- a soft shadow on the ground ----------

let shadowMat: THREE.MeshBasicMaterial | null = null;
/** A soft dark patch on the ground (a blurred rectangle), for under a vehicle or a person. */
export function shadowMaterial(): THREE.MeshBasicMaterial {
  if (shadowMat) return shadowMat;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.filter = 'blur(7px)';
  ctx.fillStyle = '#000';
  ctx.fillRect(12, 12, 40, 40);
  const map = new THREE.CanvasTexture(c);
  shadowMat = new THREE.MeshBasicMaterial({ map, color: '#000000', transparent: true, opacity: 0.4, depthWrite: false, fog: false, toneMapped: false });
  return shadowMat;
}

/** A flat unit square lying on the ground (scale it to the patch). */
export const groundSquare = (() => {
  let g: THREE.PlaneGeometry | null = null;
  return () => (g ??= new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
})();

// ---------- a crowd of little people ----------

export interface Look {
  body: string;
  skin: string;
  legs: string;
}

export const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#d4a373'];
export const SHIRTS = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#8e7dbe', '#ffd166', '#06d6a0', '#ef476f', '#118ab2'];
export const TROUSERS = ['#2b2d42', '#3d405b', '#4a4e69', '#22333b', '#5c4033'];

// Person-space: feet at the origin, facing +z, about 1.8 m tall with a big cartoon head.
const HIP = 0.8;
let parts: { body: THREE.BufferGeometry; head: THREE.BufferGeometry; leg: THREE.BufferGeometry } | null = null;
const personParts = () =>
  (parts ??= {
    body: (() => {
      const g = model([
        part(capsule(0.21, 0.42), '#ffffff', { at: [0, 1.12, 0] }),
        part(capsule(0.065, 0.48), '#ffffff', { at: [-0.29, 1.08, 0], rot: [0, 0, -0.12] }),
        part(capsule(0.065, 0.48), '#ffffff', { at: [0.29, 1.08, 0], rot: [0, 0, 0.12] }),
      ]);
      g.deleteAttribute('color');
      return g;
    })(),
    head: new THREE.SphereGeometry(0.19, 12, 9).translate(0, 1.62, 0),
    // pivots at the hip
    leg: new THREE.BoxGeometry(0.15, HIP, 0.17).translate(0, -HIP / 2, 0),
  });

/**
 * People drawn instanced: their bodies (shirts), heads (skin), legs (trousers) and shadows, four draw calls however
 * many there are. set() each one's pose every frame, then commit().
 */
export class Crowd {
  readonly group = new THREE.Group();
  readonly bodies: THREE.InstancedMesh;
  readonly heads: THREE.InstancedMesh;
  readonly legs: THREE.InstancedMesh;
  readonly shadows: THREE.InstancedMesh;
  private readonly base = new THREE.Matrix4();

  constructor(
    readonly count: number,
    looks: readonly Look[],
  ) {
    const g = personParts();
    this.bodies = new THREE.InstancedMesh(g.body, toonOut('#ffffff'), count);
    this.heads = new THREE.InstancedMesh(g.head, toonOut('#ffffff'), count);
    this.legs = new THREE.InstancedMesh(g.leg, toonOut('#ffffff'), count * 2);
    this.shadows = new THREE.InstancedMesh(groundSquare(), shadowMaterial(), count);
    for (let i = 0; i < count; i++) {
      const look = looks[i % looks.length];
      this.bodies.setColorAt(i, col.set(look.body));
      this.heads.setColorAt(i, col.set(look.skin));
      this.legs.setColorAt(i * 2, col.set(look.legs));
      this.legs.setColorAt(i * 2 + 1, col);
    }
    for (const m of [this.bodies, this.heads, this.legs, this.shadows]) {
      m.frustumCulled = false; // they move about: their bounds would go stale
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      this.group.add(m);
    }
    for (let i = 0; i < count; i++) this.hide(i);
  }

  /** Person `i` standing at (x, y, z) facing `yaw`, legs swung by `stride` (radians, + left leg forward), lifted `bob`. */
  set(i: number, x: number, y: number, z: number, yaw: number, stride = 0, bob = 0, scale = 1) {
    q.setFromAxisAngle(v.set(0, 1, 0), yaw);
    this.base.compose(v.set(x, y + bob, z), q, sv.set(scale, scale, scale));
    this.bodies.setMatrixAt(i, this.base);
    this.heads.setMatrixAt(i, this.base);
    for (const k of [0, 1]) {
      const swing = (k === 0 ? 1 : -1) * stride;
      m4.makeRotationX(swing).setPosition((k === 0 ? -0.1 : 0.1), HIP, 0);
      this.legs.setMatrixAt(i * 2 + k, m4.premultiply(this.base));
    }
    this.shadows.setMatrixAt(i, m4.compose(v.set(x, y + 0.01, z), q, sv.set(0.75 * scale, 1, 0.6 * scale)));
  }

  /** Person i's frame (after set()): for placing a hat or an instrument on them. */
  frameOf(i: number, out: THREE.Matrix4): THREE.Matrix4 {
    this.bodies.getMatrixAt(i, out);
    return out;
  }

  hide(i: number) {
    m4.makeScale(0, 0, 0);
    this.bodies.setMatrixAt(i, m4);
    this.heads.setMatrixAt(i, m4);
    this.legs.setMatrixAt(i * 2, m4);
    this.legs.setMatrixAt(i * 2 + 1, m4);
    this.shadows.setMatrixAt(i, m4);
  }

  commit() {
    for (const m of [this.bodies, this.heads, this.legs, this.shadows]) m.instanceMatrix.needsUpdate = true;
  }

  /** The instanced meshes go; the shared geometry and materials stay. */
  dispose() {
    for (const m of [this.bodies, this.heads, this.legs, this.shadows]) m.dispose();
  }
}

/** Looks for a crowd: shirts, skins and trousers picked by `r` (a seeded random). */
export function looks(n: number, r: () => number): Look[] {
  const pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  return Array.from({ length: n }, () => ({ body: pick(SHIRTS), skin: pick(SKIN), legs: pick(TROUSERS) }));
}

// ---------- notes and sparks ----------

let noteMat: THREE.MeshBasicMaterial | null = null;
/** A music note (♪) in white on a clear square, tinted per note. */
function noteMaterial(): THREE.MeshBasicMaterial {
  if (noteMat) return noteMat;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 104px "Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(30, 20, 50, 0.85)';
  ctx.strokeText('♪', 64, 68);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('♪', 64, 68);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  noteMat = new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.08, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
  return noteMat;
}

const NOTE_COLORS = ['#ff4d6d', '#ffd23f', '#4cc9f0', '#80ffdb', '#f72585', '#ffffff'];

/**
 * Music notes rising from a band's speakers, swaying and turning to face you, each growing then fading on its way up:
 * one draw call. update() them every frame with where the speakers are (in the scene's frame).
 */
export class Notes {
  readonly mesh: THREE.InstancedMesh;
  constructor(
    readonly count: number,
    private readonly life = 2.2,
  ) {
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.9), noteMaterial(), count);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, col.set(NOTE_COLORS[i % NOTE_COLORS.length]));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** `on` 0-1 how many are out. */
  update(t: number, from: readonly THREE.Vector3[], facing: THREE.Quaternion, on = 1) {
    for (let i = 0; i < this.count; i++) {
      const phase = (t / this.life + i / this.count) % 1;
      const src = from[i % from.length];
      const seed = (i * 0.618) % 1;
      const out = phase < 1 - on ? 0 : Math.sin(Math.PI * phase);
      const swayX = Math.sin(t * 2 + i) * 0.5 * phase + (seed - 0.5) * 2.4 * phase;
      v.set(src.x + swayX, src.y + 0.3 + phase * 3.2, src.z + Math.cos(t * 1.7 + i * 2) * 0.5 * phase + (seed - 0.5) * 1.6 * phase);
      q.copy(facing).multiply(QTILT.setFromAxisAngle(ZAXIS, Math.sin(t * 3 + i) * 0.35));
      this.mesh.setMatrixAt(i, m4.compose(v, q, sv.setScalar(out * (0.7 + seed * 0.6))));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}
const QTILT = new THREE.Quaternion();
const ZAXIS = new THREE.Vector3(0, 0, 1);

/**
 * Sparks spraying up from fountains and falling back, glowing: one draw call. update() with the fountains (in the
 * mesh's frame) and whether they're spraying; ones already in the air finish their fall.
 */
export class Sparks {
  readonly mesh: THREE.InstancedMesh;
  constructor(
    readonly count: number,
    private readonly life = 0.9,
  ) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), glowOut('#ffffff', { add: true }), count);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, col.set(i % 3 === 0 ? '#fff3b0' : i % 3 === 1 ? '#ffb703' : '#fb8500'));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(t: number, from: readonly V3[], spraying: (born: number) => boolean) {
    for (let i = 0; i < this.count; i++) {
      const cycle = t / this.life + i / this.count;
      const phase = cycle % 1;
      const born = (Math.floor(cycle) - i / this.count) * this.life;
      const src = from[i % from.length];
      if (!spraying(born)) {
        this.mesh.setMatrixAt(i, m4.makeScale(0, 0, 0));
        continue;
      }
      const a = (i * 2.399) % (Math.PI * 2);
      const up = 5.5 + ((i * 0.37) % 1) * 2.5;
      const out = 0.8 + ((i * 0.71) % 1) * 0.9;
      const s = phase * this.life;
      v.set(src[0] + Math.cos(a) * out * s, src[1] + up * s - 4.9 * s * s, src[2] + Math.sin(a) * out * s);
      this.mesh.setMatrixAt(i, m4.makeScale(1 - phase * 0.7, 1 - phase * 0.7, 1 - phase * 0.7).setPosition(v));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

/** A canvas texture for a sign or a side panel: `paint` draws on a w × h canvas. */
export function signTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
