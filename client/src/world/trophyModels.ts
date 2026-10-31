// Toon trophies (trophyShelf.ts says which shape, metal and size): a cup with handles, a star, a rocket, a gem or a
// crown, each on a plinth. A whole shelf of them is one geometry painted by vertex colours, so the lobby's cabinet and
// the CEO's shelf draw all theirs in one call (and one for the ink).
import * as THREE from 'three';
import { toon } from './materials';
import { merged } from './shapes';
import type { Metal, TrophyLook, TrophyShape } from './trophyShelf';

type V3 = [number, number, number];

const METAL: Record<Metal, string> = { bronze: '#d08a4a', silver: '#c8d0da', gold: '#f7c548', crystal: '#9be7ff' };
const RED = '#e63946';

/** A part in its colour (`rot` an Euler, then moved to `at`): non-indexed, so every shape merges with every other. */
export function paint(g: THREE.BufferGeometry, color: string, at: V3, rot?: V3): THREE.BufferGeometry {
  if (rot) g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)));
  g.translate(...at);
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  const c = new THREE.Color(color);
  const n = flat.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return flat;
}

function star(outer: number, inner: number, depth: number) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  return g.translate(0, 0, -depth / 2);
}

/** A trophy's parts, standing on y = 0 and facing +z, about 0.3 m tall before its scale. */
function parts(shape: TrophyShape, metal: string): THREE.BufferGeometry[] {
  const stem = (h: number) => paint(new THREE.CylinderGeometry(0.016, 0.022, h, 10), metal, [0, 0.05 + h / 2, 0]);
  switch (shape) {
    case 'cup':
      return [
        stem(0.07),
        paint(new THREE.CylinderGeometry(0.04, 0.04, 0.015, 14), metal, [0, 0.125, 0]),
        paint(new THREE.CylinderGeometry(0.076, 0.03, 0.12, 16), metal, [0, 0.19, 0]),
        ...[-1, 1].map((s) => paint(new THREE.TorusGeometry(0.034, 0.009, 6, 14), metal, [s * 0.074, 0.2, 0])),
      ];
    case 'star':
      return [stem(0.09), paint(star(0.09, 0.04, 0.03), metal, [0, 0.22, 0])];
    case 'rocket':
      return [
        paint(new THREE.CylinderGeometry(0.036, 0.04, 0.15, 14), metal, [0, 0.135, 0]),
        paint(new THREE.CylinderGeometry(0.001, 0.036, 0.08, 14), RED, [0, 0.25, 0]),
        paint(new THREE.CylinderGeometry(0.015, 0.015, 0.012, 12), '#8ecae6', [0, 0.16, 0.035], [Math.PI / 2, 0, 0]),
        ...[0, 1, 2].map((i) => {
          const a = (i * Math.PI * 2) / 3;
          return paint(new THREE.BoxGeometry(0.012, 0.06, 0.04), RED, [Math.sin(a) * 0.045, 0.08, Math.cos(a) * 0.045], [0, a, 0]);
        }),
      ];
    case 'gem':
      return [stem(0.05), paint(new THREE.OctahedronGeometry(0.075).scale(1, 1.35, 1), metal, [0, 0.2, 0])];
    case 'crown':
      return [
        paint(new THREE.CylinderGeometry(0.075, 0.07, 0.06, 16), metal, [0, 0.08, 0]),
        paint(new THREE.SphereGeometry(0.016, 8, 6), RED, [0, 0.08, 0.072]),
        ...[0, 1, 2, 3, 4].flatMap((i) => {
          const a = (i * Math.PI * 2) / 5;
          const x = Math.sin(a) * 0.064;
          const z = Math.cos(a) * 0.064;
          return [paint(new THREE.CylinderGeometry(0.001, 0.02, 0.06, 6), metal, [x, 0.14, z]), paint(new THREE.SphereGeometry(0.011, 6, 4), metal, [x, 0.175, z])];
        }),
      ];
  }
}

/** One trophy to put in a shelf's geometry: its look, its plinth's colour, where it stands and which way it faces. */
export interface Placed {
  look: TrophyLook;
  plinth: string;
  at: V3;
  yaw: number;
}

const matrix = new THREE.Matrix4();
const turn = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const where = new THREE.Vector3();
const size = new THREE.Vector3();

/** Every trophy in `list` as one vertex-coloured geometry (dispose of it when the list changes). */
export function trophiesGeometry(list: readonly Placed[]): THREE.BufferGeometry {
  const out: THREE.BufferGeometry[] = [];
  for (const p of list) {
    matrix.compose(where.set(...p.at), turn.setFromAxisAngle(up, p.yaw), size.setScalar(p.look.scale));
    const ps = [paint(new THREE.BoxGeometry(0.15, 0.05, 0.15), p.plinth, [0, 0.025, 0]), ...parts(p.look.shape, METAL[p.look.metal])];
    for (const g of ps) out.push(g.applyMatrix4(matrix));
  }
  return merged(out);
}

/** The trophies' shared material: white toon, tinted by each vertex's colour. */
export const trophyMaterial: THREE.MeshToonMaterial = (() => {
  const m = toon('#ffffff').clone() as THREE.MeshToonMaterial;
  m.vertexColors = true;
  return m;
})();
