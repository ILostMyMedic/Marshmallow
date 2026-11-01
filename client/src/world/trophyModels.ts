// Toon trophies (trophyShelf.ts says which shape, metal and size): a cup with handles, a star, a rocket, a gem, a
// crown, a medal on its ribbon, a plaque or a rosette, each on a plinth. A whole shelf of them is one geometry painted
// by vertex colours, so the lobby's cabinet and the CEO's shelves draw all theirs in one call (and one for the ink).
import * as THREE from 'three';
import { shade, toon } from './materials';
import { merged } from './shapes';
import type { Metal, TrophyLook, TrophyShape } from './trophyShelf';

type V3 = [number, number, number];

const METAL: Record<Metal, string> = { bronze: '#d08a4a', silver: '#c8d0da', gold: '#f7c548', crystal: '#9be7ff' };
/** A medal's or a rosette's ribbon, by its metal: red for gold, as a first place's is. */
const RIBBON: Record<Metal, string> = { bronze: '#f4a261', silver: '#4895ef', gold: '#e63946', crystal: '#9b5de5' };
const RED = '#e63946';
const DARK = '#3d405b';
const WOOD = '#6b4226';
/** Turned to face +z: a disc's flat side towards you. */
const FACE: V3 = [Math.PI / 2, 0, 0];

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
function parts(shape: TrophyShape, kind: Metal): THREE.BufferGeometry[] {
  const metal = METAL[kind];
  const ribbon = RIBBON[kind];
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
    case 'medal':
      // hung on its ribbon from a little stand: a post, a bar across its top, the ribbon's V and the disc
      return [
        paint(new THREE.CylinderGeometry(0.008, 0.01, 0.27, 8), DARK, [0, 0.185, -0.03]),
        paint(new THREE.BoxGeometry(0.13, 0.014, 0.014), DARK, [0, 0.315, -0.03]),
        ...[-1, 1].map((s) => paint(new THREE.BoxGeometry(0.03, 0.15, 0.006), s < 0 ? ribbon : shade(ribbon, -0.18), [s * 0.026, 0.245, -0.012], [0, 0, s * 0.42])),
        paint(new THREE.CylinderGeometry(0.058, 0.058, 0.014, 20), metal, [0, 0.14, 0], FACE),
        paint(new THREE.TorusGeometry(0.044, 0.006, 6, 20), shade(metal, -0.16), [0, 0.14, 0.009]),
        paint(star(0.026, 0.012, 0.008), shade(metal, 0.12), [0, 0.14, 0.01]),
      ];
    case 'plaque':
      // a walnut board standing on the plinth, its metal plate and an emblem under it
      return [
        paint(new THREE.BoxGeometry(0.18, 0.24, 0.028), WOOD, [0, 0.17, -0.01]),
        paint(new THREE.BoxGeometry(0.15, 0.03, 0.03), shade(WOOD, -0.15), [0, 0.065, -0.01]),
        paint(new THREE.BoxGeometry(0.13, 0.085, 0.008), metal, [0, 0.215, 0.008]),
        paint(new THREE.CylinderGeometry(0.026, 0.026, 0.01, 16), metal, [0, 0.12, 0.007], FACE),
        paint(star(0.018, 0.008, 0.006), shade(metal, 0.15), [0, 0.12, 0.014]),
      ];
    case 'rosette':
      // a ribbon rosette on a stick: two tails, the pleated ring, a lighter ring of pleats and the metal button
      return [
        paint(new THREE.CylinderGeometry(0.007, 0.009, 0.15, 8), DARK, [0, 0.125, -0.02]),
        ...[-1, 1].map((s) => paint(new THREE.BoxGeometry(0.032, 0.11, 0.006), ribbon, [s * 0.03, 0.14, -0.006], [0, 0, s * 0.3])),
        paint(new THREE.CylinderGeometry(0.078, 0.078, 0.014, 18), ribbon, [0, 0.22, 0], FACE),
        paint(new THREE.TorusGeometry(0.06, 0.012, 6, 18), shade(ribbon, 0.25), [0, 0.22, 0.008]),
        paint(new THREE.CylinderGeometry(0.036, 0.036, 0.02, 16), metal, [0, 0.22, 0.012], FACE),
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
    const ps = [paint(new THREE.BoxGeometry(0.15, 0.05, 0.15), p.plinth, [0, 0.025, 0]), ...parts(p.look.shape, p.look.metal)];
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
