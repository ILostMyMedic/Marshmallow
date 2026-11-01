// The CEO's office's furniture as four merged, vertex-coloured geometries (CeoFurniture.tsx draws them), so the whole
// room costs a handful of draw calls however much is in it: what stands on the floor (inked, casting shadows), its small
// trim (no ink: drawer fronts, the things on the tables, the fish tank's insides), what hangs on the walls (cut away
// with them in the overview) and the rugs. Each piece is built round its own origin with its front facing -z, then
// turned and moved to where layout.ts puts it. Pure three.js, so it's tested. New in Marshmallow.
import * as THREE from 'three';
import {
  cafeChairs,
  chessChairs,
  EXEC_ARMCHAIRS,
  EXEC_ART,
  EXEC_BAR,
  EXEC_CAFE,
  EXEC_CHESS,
  EXEC_CLOCK,
  EXEC_COAT_STAND,
  EXEC_COFFEE,
  EXEC_CREDENZA,
  EXEC_GLOBE,
  EXEC_GOLF_BAG,
  EXEC_GREEN,
  EXEC_GUESTS,
  EXEC_HOLE,
  EXEC_LAMPS,
  EXEC_MEETING,
  EXEC_NOOK,
  EXEC_NOOK_STOOL,
  EXEC_NOOK_TABLE,
  EXEC_PLANTS,
  EXEC_POOL,
  EXEC_RUGS,
  EXEC_SCOPE,
  EXEC_SHELVES,
  EXEC_SIDE_TABLE,
  EXEC_SOFA,
  EXEC_STATUE,
  EXEC_STOOLS,
  EXEC_TALL_PLANTS,
  EXEC_TANK,
  EXEC_WEEK,
  EXEC_WINDOW_SEAT,
  HALF_D,
  HALF_W,
  meetingChairs,
  PICTURE_ASPECT,
  type Rect,
  type Wall,
} from './layout';
import { shade } from './materials';
import { merged } from './shapes';
import { paint } from './trophyModels';

type V3 = [number, number, number];
type G = THREE.BufferGeometry;

const WALNUT = '#6b4226';
const WALNUT_DARK = '#4a2c19';
const WALNUT_LIGHT = '#8a5a36';
const LEATHER = '#3b2a24';
const COGNAC = '#a0522d';
const VELVET = '#2d6a4f';
const NAVY = '#2b2d42';
const BRASS = '#d4a017';
const CHROME = '#c9ced6';
const STEEL = '#6c757d';
const CREAM = '#fff3c4';
const MARBLE = '#f1f3f5';
const INK = '#1f1d2b';
const WINE = '#7b2c3a';
const MALLOW = '#fff8f0';
const BOOKS = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#264653', '#9b5de5', '#e9c46a', '#1d3557', '#ef476f', '#06d6a0', '#8d99ae', '#bc6c25'];
const LEAVES = ['#52b788', '#40916c', '#74c69d', '#2d6a4f'];

// ---------- building blocks ----------

const box = (size: V3, color: string, at: V3, rot?: V3): G => paint(new THREE.BoxGeometry(...size), color, at, rot);
const cyl = (r: number, h: number, color: string, at: V3, rTop = r, seg = 16, rot?: V3): G => paint(new THREE.CylinderGeometry(rTop, r, h, seg), color, at, rot);
function ball(r: number, color: string, at: V3, scale?: V3, seg = 14): G {
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7)));
  if (scale) g.scale(...scale);
  return paint(g, color, at);
}
/** A flat disc or rect lying on the floor, `y` up (the rugs). */
const flat = (g: THREE.BufferGeometry, color: string, x: number, y: number, z: number) => paint(g, color, [x, y, z], [-Math.PI / 2, 0, 0]);

/** A racetrack outline w long (x) and d wide: straight sides and round ends. */
function stadium(w: number, d: number): THREE.Shape {
  const r = d / 2;
  const a = w / 2 - r;
  const s = new THREE.Shape();
  s.moveTo(-a, -r);
  s.lineTo(a, -r);
  s.absarc(a, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-a, r);
  s.absarc(-a, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  return s;
}

/** A racetrack slab `thick` thick lying flat, the middle of its underside at `at`. */
const slab = (w: number, d: number, thick: number, color: string, at: V3) => paint(new THREE.ExtrudeGeometry(stadium(w, d), { depth: thick, bevelEnabled: false, curveSegments: 14 }), color, at, [-Math.PI / 2, 0, 0]);

/** Moves parts built round their own origin to (x, z), turned `yaw` (and grown `scale`, lifted `y`). */
function put(parts: G[], x: number, z: number, yaw = 0, scale = 1, y = 0): G[] {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(scale, scale, scale));
  for (const p of parts) p.applyMatrix4(m);
  return parts;
}

/** A small seeded random number source (mulberry32), so the bookcases fill the same way every time. */
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

/** The company's sign on the wall behind the desk: its middle's height. */
export const SIGN_Y = 2.25;

/** Each picture's wall, place and size (its height from PICTURE_ASPECT). */
export const pictures = () => EXEC_ART.map((a) => ({ ...a, h: a.w / PICTURE_ASPECT }));

/**
 * The pictures' faces, one plane each a hair in front of its frame's mat, all in one geometry: each shows its own cell
 * of ceoArt.ts's canvas (`cols` by `rows` cells, in EXEC_ART's order).
 */
export function picturesGeometry(cols: number, rows: number): G {
  return merged(
    pictures().map(({ wall, at, y, w, h }, i) => {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      const col = i % cols;
      const row = Math.floor(i / cols);
      for (let j = 0; j < uv.count; j++) uv.setXY(j, (col + uv.getX(j)) / cols, 1 - (row + 1 - uv.getY(j)) / rows);
      g.translate(0, 0, 0.06);
      return hang([g], wall, at, y + h / 2)[0];
    }),
  );
}

/** The room being built: inked parts, un-inked trim, what hangs on the walls and the rugs. */
interface Kit {
  solid: G[];
  trim: G[];
  wall: G[];
  rugs: G[];
}

type Build = (solid: G[], trim: G[]) => void;

/** Builds a piece round its own origin, then puts it at (x, z) turned `yaw` (grown `scale`). */
function piece(k: Kit, x: number, z: number, yaw: number, build: Build, scale = 1) {
  const solid: G[] = [];
  const trim: G[] = [];
  build(solid, trim);
  k.solid.push(...put(solid, x, z, yaw, scale));
  k.trim.push(...put(trim, x, z, yaw, scale));
}

/** Where something hung on `wall` goes: `at` along it, `y` up and its middle `out` from the wall, turned to face the room. */
export function onWall(wall: Wall, at: number, y: number, out: number): { pos: V3; yaw: number } {
  switch (wall) {
    case 'north':
      return { pos: [at, y, -HALF_D + out], yaw: 0 };
    case 'south':
      return { pos: [at, y, HALF_D - out], yaw: Math.PI };
    case 'west':
      return { pos: [-HALF_W + out, y, at], yaw: Math.PI / 2 };
    case 'east':
      return { pos: [HALF_W - out, y, at], yaw: -Math.PI / 2 };
  }
}

/** Parts built facing +z (out of a wall), moved onto `wall`. */
function hang(parts: G[], wall: Wall, at: number, y: number): G[] {
  const { pos, yaw } = onWall(wall, at, y, 0);
  return put(parts, pos[0], pos[2], yaw, 1, pos[1]);
}

// ---------- seats ----------

/** A leather armchair (seat top 0.42 m), a wingback when `wings`. */
const armchair =
  (color: string, wings = false): Build =>
  (s, t) => {
    const dark = shade(color, -0.07);
    s.push(box([0.85, 0.4, 0.8], color, [0, 0.22, 0]));
    if (wings) {
      s.push(box([0.85, 0.85, 0.18], dark, [0, 0.8, 0.32]));
      for (const dx of [-0.37, 0.37]) s.push(box([0.12, 0.36, 0.32], dark, [dx, 1.0, 0.16]));
    } else s.push(box([0.85, 0.55, 0.18], dark, [0, 0.65, 0.32]));
    for (const dx of [-0.4, 0.4]) s.push(box([0.14, 0.3, 0.8], dark, [dx, 0.52, 0]));
    t.push(box([0.6, 0.02, 0.58], shade(color, 0.06), [0, 0.43, -0.06]));
    for (const dx of [-0.34, 0.34]) for (const dz of [-0.3, 0.3]) t.push(cyl(0.03, 0.04, WALNUT_DARK, [dx, 0.01, dz], 0.03, 8));
  };

/** The long sofa (the size of Props.tsx's couch: 3 m between the arms, seat top 0.46 m), cushions on it. */
const sofa: Build = (s, t) => {
  const dark = shade(LEATHER, -0.06);
  s.push(box([3, 0.42, 1], LEATHER, [0, 0.25, 0]));
  s.push(box([3, 0.6, 0.25], dark, [0, 0.7, 0.38]));
  for (const dx of [-1.5, 1.5]) s.push(box([0.25, 0.55, 1], dark, [dx, 0.45, 0]));
  s.push(box([0.5, 0.4, 0.14], '#e9c46a', [-0.95, 0.64, 0.2], [-0.15, 0.2, 0]));
  s.push(box([0.5, 0.4, 0.14], '#2a9d8f', [0.95, 0.64, 0.2], [-0.15, -0.2, 0]));
  for (const dx of [-0.5, 0.5]) t.push(box([0.02, 0.012, 0.86], shade(LEATHER, -0.14), [dx, 0.466, -0.04]));
  for (const dx of [-1.4, 1.4]) for (const dz of [-0.4, 0.4]) t.push(cyl(0.035, 0.05, BRASS, [dx, 0.02, dz], 0.035, 8));
};

/** A side chair in cognac leather on walnut legs (seat top 0.48 m). */
const guestChair: Build = (s) => {
  s.push(box([0.52, 0.1, 0.5], COGNAC, [0, 0.43, 0]));
  s.push(box([0.52, 0.52, 0.08], COGNAC, [0, 0.77, 0.22], [-0.1, 0, 0]));
  for (const dx of [-0.21, 0.21]) for (const dz of [-0.2, 0.2]) s.push(box([0.05, 0.38, 0.05], WALNUT, [dx, 0.19, dz]));
};

/** A meeting chair: navy seat and back on a chrome stem (seat top 0.5 m), its arms inside the seat's width. */
const meetingChair: Build = (s, t) => {
  s.push(box([0.48, 0.08, 0.46], NAVY, [0, 0.46, 0]));
  s.push(box([0.46, 0.52, 0.07], NAVY, [0, 0.79, 0.21], [-0.08, 0, 0]));
  for (const dx of [-0.22, 0.22]) {
    s.push(box([0.04, 0.035, 0.32], CHROME, [dx, 0.66, 0.02]));
    t.push(box([0.03, 0.16, 0.03], CHROME, [dx, 0.57, 0.1]));
  }
  t.push(cyl(0.03, 0.4, CHROME, [0, 0.22, 0]));
  t.push(cyl(0.23, 0.03, STEEL, [0, 0.03, 0], 0.23, 5));
};

/** A bar stool: a red leather seat (top 0.74 m) on a chrome pole with a foot ring. */
const stool: Build = (s, t) => {
  s.push(cyl(0.2, 0.07, '#e63946', [0, 0.705, 0], 0.2, 18));
  s.push(cyl(0.03, 0.66, CHROME, [0, 0.35, 0], 0.03, 10));
  s.push(paint(new THREE.TorusGeometry(0.15, 0.012, 6, 18), CHROME, [0, 0.28, 0], [Math.PI / 2, 0, 0]));
  t.push(cyl(0.21, 0.03, CHROME, [0, 0.015, 0], 0.21, 18));
};

/** A bistro chair: a round teal seat (top 0.47 m), thin legs and a hoop back. */
const bistroChair: Build = (s, t) => {
  s.push(cyl(0.22, 0.05, '#2a9d8f', [0, 0.445, 0], 0.22, 18));
  s.push(paint(new THREE.TorusGeometry(0.19, 0.02, 6, 16, Math.PI), '#2a9d8f', [0, 0.64, 0.17]));
  for (const dx of [-0.19, 0.19]) t.push(cyl(0.015, 0.2, '#2a9d8f', [dx, 0.54, 0.17], 0.015, 6));
  for (const dx of [-0.14, 0.14]) for (const dz of [-0.14, 0.14]) t.push(cyl(0.015, 0.43, NAVY, [dx, 0.215, dz], 0.015, 6));
};

// ---------- tables and lamps ----------

/** The lounge's low table: walnut, a cup, a magazine, a bowl and two books. */
const coffeeTable: Build = (s, t) => {
  s.push(box([1.3, 0.08, 0.8], WALNUT_LIGHT, [0, 0.42, 0]));
  s.push(box([1.1, 0.34, 0.6], WALNUT, [0, 0.21, 0]));
  t.push(cyl(0.05, 0.1, '#ffffff', [0.3, 0.51, 0.1]));
  t.push(box([0.3, 0.02, 0.22], '#4cc9f0', [-0.25, 0.47, -0.05], [0, 0.3, 0]));
  t.push(cyl(0.12, 0.07, '#e76f51', [0.05, 0.495, -0.2], 0.15));
  for (const [i, c] of ['#264653', '#e9c46a'].entries()) t.push(box([0.26, 0.04, 0.18], c, [-0.4, 0.48 + i * 0.04, 0.2], [0, i * 0.25, 0]));
};

/** A round side table on a stem; `lamp`: a table lamp on it, else a book and a mug. */
const sideTable =
  (r: number, lamp: boolean): Build =>
  (s, t) => {
    s.push(cyl(r, 0.04, WALNUT_LIGHT, [0, 0.58, 0], r, 20));
    s.push(cyl(0.035, 0.56, WALNUT, [0, 0.29, 0], 0.035, 10));
    s.push(cyl(r * 0.7, 0.03, WALNUT, [0, 0.015, 0], r * 0.7, 18));
    if (lamp) {
      s.push(cyl(0.08, 0.06, BRASS, [0, 0.63, 0], 0.06, 14));
      t.push(cyl(0.012, 0.28, BRASS, [0, 0.8, 0], 0.012, 6));
      s.push(cyl(0.16, 0.2, CREAM, [0, 1.0, 0], 0.11, 16));
    } else {
      t.push(box([0.2, 0.04, 0.14], '#9b5de5', [-0.04, 0.62, 0.02], [0, 0.4, 0]));
      t.push(box([0.18, 0.03, 0.13], '#e9c46a', [-0.03, 0.655, 0.02], [0, -0.2, 0]));
      t.push(cyl(0.045, 0.09, '#e63946', [0.1, 0.645, -0.08], 0.045, 12));
    }
  };

/** A tall floor lamp: a brass pole and a cream shade. */
const floorLamp: Build = (s, t) => {
  s.push(cyl(0.18, 0.04, NAVY, [0, 0.02, 0], 0.18, 18));
  t.push(cyl(0.02, 1.6, BRASS, [0, 0.82, 0], 0.02, 8));
  s.push(cyl(0.24, 0.3, CREAM, [0, 1.7, 0], 0.16, 18));
};

/** The reading nook's footstool, in the wingback's green velvet. */
const footstool: Build = (s, t) => {
  const w = EXEC_NOOK_STOOL.w;
  s.push(box([w, 0.3, w], VELVET, [0, 0.21, 0]));
  t.push(box([w - 0.12, 0.012, w - 0.12], shade(VELVET, 0.06), [0, 0.365, 0]));
  for (const dx of [-0.2, 0.2]) for (const dz of [-0.2, 0.2]) t.push(cyl(0.025, 0.06, WALNUT, [dx, 0.03, dz], 0.025, 8));
};

// ---------- the desk's corner ----------

/** The low cabinet behind the desk: door panels with brass pulls, books, an award and a vase on top. */
const credenza: Build = (s, t) => {
  const { w, d } = EXEC_CREDENZA;
  s.push(box([w, 0.8, d], WALNUT, [0, 0.4, 0]));
  s.push(box([w + 0.06, 0.05, d + 0.04], WALNUT_LIGHT, [0, 0.825, 0]));
  for (const dx of [-1.6, -0.55, 0.55, 1.6]) {
    t.push(box([0.9, 0.5, 0.012], WALNUT_DARK, [dx, 0.42, -d / 2 - 0.006]));
    t.push(box([0.14, 0.025, 0.03], BRASS, [dx, 0.6, -d / 2 - 0.02]));
  }
  BOOKS.slice(0, 6).forEach((c, i) => s.push(box([0.07, 0.3 + (i % 3) * 0.04, 0.22], c, [2.1 - i * 0.09, 1.0 + (i % 3) * 0.02, 0])));
  s.push(box([0.2, 0.08, 0.16], NAVY, [-0.4, 0.89, 0]));
  s.push(ball(0.09, BRASS, [-0.4, 1.05, 0], [1, 1, 0.4]));
  s.push(cyl(0.07, 0.32, '#e9ecef', [-1.8, 1.01, 0], 0.11));
  s.push(ball(0.13, '#ef476f', [-1.8, 1.25, 0]));
};

/** The globe on its walnut stand, a brass meridian round it. */
const globe: Build = (s, t) => {
  s.push(cyl(0.22, 0.05, WALNUT, [0, 0.025, 0], 0.22, 18));
  s.push(cyl(0.03, 0.62, WALNUT, [0, 0.36, 0], 0.03, 8));
  s.push(ball(0.3, '#4ea8de', [0, 0.95, 0], undefined, 20));
  t.push(ball(0.16, '#80b918', [0.13, 1.04, -0.16], [1, 0.8, 0.5]));
  t.push(ball(0.12, '#80b918', [-0.17, 0.86, -0.15], [1, 1.2, 0.5]));
  t.push(ball(0.11, '#80b918', [-0.05, 1.12, 0.2], [1.2, 0.7, 0.6]));
  s.push(paint(new THREE.TorusGeometry(0.34, 0.018, 6, 28, Math.PI), BRASS, [0, 0.95, 0], [0, 0, -Math.PI / 2 + 0.35]));
};

// ---------- the library ----------

/** One thing standing on a shelf, about `room` tall at most, its middle `x` along it and its base `y` up. */
function trinket(kind: number, x: number, y: number, z: number, room: number, s: G[], t: G[]) {
  switch (kind % 7) {
    case 0: // a gold cup
      s.push(cyl(0.05, 0.03, NAVY, [x, y + 0.015, z], 0.05, 12));
      t.push(cyl(0.012, 0.07, BRASS, [x, y + 0.065, z], 0.012, 8));
      s.push(cyl(0.035, 0.1, BRASS, [x, y + 0.15, z], 0.07, 14));
      break;
    case 1: // a vase with a flower
      s.push(cyl(0.05, 0.16, '#48cae4', [x, y + 0.08, z], 0.035, 12));
      t.push(cyl(0.006, 0.1, '#2d6a4f', [x, y + 0.2, z], 0.006, 5));
      s.push(ball(0.045, '#ff70a6', [x, y + Math.min(room - 0.06, 0.27), z]));
      break;
    case 2: // a photo in a standing frame
      s.push(box([0.2, 0.16, 0.025], WALNUT_DARK, [x, y + 0.085, z + 0.02], [0.15, 0, 0]));
      t.push(box([0.15, 0.11, 0.004], '#a8dadc', [x, y + 0.087, z + 0.003], [0.15, 0, 0]));
      break;
    case 3: // a little potted plant
      s.push(cyl(0.05, 0.08, '#e07a5f', [x, y + 0.04, z], 0.06, 12));
      s.push(ball(0.08, LEAVES[0], [x, y + 0.14, z]));
      break;
    case 4: // a rocket
      s.push(cyl(0.035, 0.14, '#f8f9fa', [x, y + 0.1, z], 0.035, 12));
      s.push(cyl(0.035, 0.07, '#e63946', [x, y + 0.205, z], 0.001, 12));
      for (const a of [0, 2.1, 4.2]) t.push(box([0.01, 0.06, 0.04], '#e63946', [x + Math.sin(a) * 0.04, y + 0.04, z + Math.cos(a) * 0.04], [0, a, 0]));
      break;
    case 5: // a little marshmallow
      s.push(cyl(0.055, 0.07, MALLOW, [x, y + 0.045, z], 0.055, 14));
      s.push(ball(0.055, MALLOW, [x, y + 0.08, z], [1, 0.3, 1]));
      t.push(ball(0.008, INK, [x - 0.018, y + 0.055, z - 0.054]));
      t.push(ball(0.008, INK, [x + 0.018, y + 0.055, z - 0.054]));
      break;
    default: // a stack of books lying down
      for (let i = 0; i < 3; i++) s.push(box([0.24 - i * 0.02, 0.045, 0.18], BOOKS[(kind + i * 5) % BOOKS.length], [x, y + 0.023 + i * 0.045, z], [0, (i - 1) * 0.15, 0]));
  }
}

/** The bookcases: a walnut carcass in bays with a blue back, and every shelf filled with books and a few trinkets. */
const bookcases: Build = (s, t) => {
  const { w, d, h, bays } = EXEC_SHELVES;
  const panel = 0.05;
  const tops = [0.12, 0.6, 1.08, 1.56, h - 0.06]; // the plinth's top, each shelf's, then under the top board
  s.push(box([w, h, 0.02], '#3d5a80', [0, h / 2, d / 2 - 0.01]));
  for (let i = 0; i <= bays; i++) s.push(box([panel, h, d], WALNUT, [-w / 2 + panel / 2 + (i * (w - panel)) / bays, h / 2, 0]));
  s.push(box([w + 0.04, 0.06, d + 0.03], WALNUT_LIGHT, [0, h - 0.03, 0]));
  s.push(box([w, 0.12, d], WALNUT_DARK, [0, 0.06, 0]));
  for (const y of tops.slice(1, -1)) s.push(box([w - 0.02, 0.035, d - 0.02], WALNUT, [0, y - 0.0175, 0]));
  const rand = seeded(21);
  const bayW = (w - panel) / bays - panel;
  let kind = 0;
  for (let b = 0; b < bays; b++) {
    const x0 = -w / 2 + panel + (b * (w - panel)) / bays;
    for (let l = 0; l < 4; l++) {
      const y = tops[l];
      const room = tops[l + 1] - 0.035 - y;
      // a trinket at one end of most shelves (every other at the left), books for the rest
      const odd = rand();
      const withTrinket = odd < 0.7;
      const left = withTrinket && rand() < 0.5;
      const span = withTrinket ? bayW - 0.34 : bayW - 0.06;
      if (withTrinket) trinket(kind++, left ? x0 + 0.17 : x0 + bayW - 0.17, y, 0.0, room, s, t);
      let x = (left ? x0 + 0.34 : x0) + 0.03;
      const end = x + span;
      while (x < end - 0.04) {
        const bw = 0.035 + rand() * 0.04;
        const bh = Math.min(room - 0.05, 0.24 + rand() * 0.13);
        const bd = 0.19 + rand() * 0.07;
        const c = BOOKS[Math.floor(rand() * BOOKS.length)];
        if (x + bw > end) break;
        // now and then one leans over at the end of a row
        if (end - x < 0.2 && rand() < 0.35) {
          s.push(box([bw, bh, bd], c, [x + bh * 0.25, y + bh * 0.48, d / 2 - 0.03 - bd / 2], [0, 0, -0.45]));
          break;
        }
        s.push(box([bw, bh, bd], c, [x + bw / 2, y + bh / 2, d / 2 - 0.03 - bd / 2]));
        x += bw + 0.004;
      }
    }
  }
};

// ---------- the putting green, the mascot and the coat stand ----------

/** The putting green (built along x): its fringe, the green, the hole and its flag, and two balls. */
const puttingGreen: Build = (s, t) => {
  const { w, d } = EXEC_GREEN;
  const hole = EXEC_HOLE.x - EXEC_GREEN.x;
  s.push(slab(w + 0.18, d + 0.18, 0.016, '#3a7d44', [0, 0, 0]));
  s.push(slab(w, d, 0.03, '#6ab04c', [0, 0, 0]));
  t.push(cyl(0.065, 0.004, INK, [hole, 0.031, 0], 0.065, 20));
  s.push(cyl(0.012, 1.1, '#f8f9fa', [hole, 0.58, 0], 0.012, 8));
  const flag = new THREE.Shape();
  flag.moveTo(0, 0);
  flag.lineTo(0.34, -0.1);
  flag.lineTo(0, -0.2);
  flag.lineTo(0, 0);
  s.push(paint(new THREE.ExtrudeGeometry(flag, { depth: 0.012, bevelEnabled: false }), '#e63946', [hole + 0.01, 1.12, -0.006]));
  t.push(ball(0.032, '#ffffff', [w / 2 - 0.5, 0.062, 0.18], undefined, 10));
  t.push(ball(0.032, '#ffffff', [hole + 0.55, 0.062, -0.22], undefined, 10));
  t.push(cyl(0.06, 0.004, '#f8f9fa', [w / 2 - 0.45, 0.031, 0], 0.06, 16));
};

/** The golf bag in the corner, three clubs in it. */
const golfBag: Build = (s, t) => {
  s.push(cyl(0.17, 0.8, '#1d3557', [0, 0.42, 0], 0.17, 16));
  t.push(cyl(0.175, 0.05, '#e9c46a', [0, 0.72, 0], 0.175, 16));
  t.push(cyl(0.175, 0.05, '#e9c46a', [0, 0.15, 0], 0.175, 16));
  s.push(box([0.08, 0.4, 0.06], '#e63946', [0, 0.45, -0.18]));
  for (const [i, [dx, dz]] of [
    [-0.07, 0.04],
    [0.06, 0.06],
    [0, -0.07],
  ].entries()) {
    t.push(cyl(0.012, 0.42, '#adb5bd', [dx, 0.98, dz], 0.012, 6));
    if (i === 0) s.push(ball(0.06, WALNUT_DARK, [dx, 1.2, dz], [1, 0.8, 1.2]));
    else s.push(box([0.05, 0.08, 0.1], '#adb5bd', [dx, 1.2, dz]));
  }
};

/** The company's mascot: a puffy marshmallow with a face, on a marble plinth with a brass plaque. */
const statue: Build = (s, t) => {
  s.push(cyl(0.44, 0.8, '#e9ecef', [0, 0.4, 0], 0.36, 24));
  s.push(cyl(0.42, 0.06, '#ced4da', [0, 0.83, 0], 0.42, 24));
  // on the plinth's slope (it narrows from 0.44 to 0.36 going up)
  t.push(box([0.3, 0.12, 0.02], BRASS, [0, 0.6, -0.388], [0.1, 0, 0]));
  const y = 0.86 + 0.08;
  s.push(cyl(0.3, 0.38, MALLOW, [0, y + 0.19, 0], 0.3, 28));
  s.push(ball(0.3, MALLOW, [0, y, 0], [1, 0.27, 1], 24));
  s.push(ball(0.3, MALLOW, [0, y + 0.38, 0], [1, 0.27, 1], 24));
  for (const dx of [-0.1, 0.1]) t.push(ball(0.035, INK, [dx, y + 0.25, -0.285], undefined, 10));
  for (const dx of [-0.18, 0.18]) t.push(ball(0.045, '#ffadc6', [dx, y + 0.17, -0.265], [1, 0.6, 0.4], 10));
  t.push(paint(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI), INK, [0, y + 0.17, -0.296], [0, 0, Math.PI]));
};

/** The coat stand: a walnut pole with brass pegs, a coat, a scarf and a hat on it. */
const coatStand: Build = (s, t) => {
  s.push(cyl(0.22, 0.04, WALNUT_DARK, [0, 0.02, 0], 0.25, 20));
  s.push(cyl(0.03, 1.75, WALNUT, [0, 0.9, 0], 0.03, 10));
  s.push(ball(0.05, WALNUT_LIGHT, [0, 1.8, 0]));
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    t.push(box([0.14, 0.02, 0.02], BRASS, [Math.cos(a) * 0.07, 1.66, -Math.sin(a) * 0.07], [0, a, 0]));
    t.push(ball(0.018, BRASS, [Math.cos(a) * 0.14, 1.67, -Math.sin(a) * 0.14], undefined, 8));
  }
  s.push(box([0.34, 0.72, 0.14], '#264653', [0.15, 1.27, 0], [0, 0, 0.06]));
  s.push(box([0.2, 0.1, 0.16], shade('#264653', -0.08), [0.11, 1.6, 0], [0, 0, 0.06]));
  s.push(box([0.09, 0.55, 0.03], '#e63946', [-0.13, 1.36, 0.02]));
  s.push(cyl(0.15, 0.015, NAVY, [0, 1.71, -0.13], 0.15, 18));
  s.push(cyl(0.09, 0.12, NAVY, [0, 1.78, -0.13], 0.085, 16));
  t.push(cyl(0.092, 0.025, '#e63946', [0, 1.735, -0.13], 0.092, 16));
};

// ---------- the meeting table and the week's whiteboard ----------

/** The racetrack table: a walnut top with a lighter inlay on two pedestals; a laptop, notepads, a carafe and glasses on it. */
const meetingTable: Build = (s, t) => {
  const { w, d } = EXEC_MEETING;
  s.push(slab(w, d, 0.06, '#5e3a22', [0, 0.72, 0]));
  t.push(slab(w - 0.5, d - 0.5, 0.004, WALNUT_LIGHT, [0, 0.78, 0]));
  for (const dx of [-w / 4, w / 4]) {
    s.push(cyl(0.12, 0.66, WALNUT_DARK, [dx, 0.39, 0], 0.1, 14));
    s.push(box([0.18, 0.06, d * 0.7], WALNUT_DARK, [dx, 0.03, 0]));
  }
  const top = 0.784;
  const spot = (w - d) / 2;
  // a laptop open at the north-west place, notepads and pens at two others
  t.push(box([0.32, 0.015, 0.22], '#adb5bd', [-spot, top + 0.008, -d / 2 + 0.25]));
  t.push(box([0.32, 0.2, 0.012], '#adb5bd', [-spot, top + 0.1, -d / 2 + 0.36], [-0.25, 0, 0]));
  t.push(box([0.28, 0.17, 0.004], '#4cc9f0', [-spot, top + 0.1, -d / 2 + 0.353], [-0.25, 0, 0]));
  for (const [x, z] of [
    [spot, d / 2 - 0.25],
    [0, -d / 2 + 0.25],
  ]) {
    t.push(box([0.21, 0.01, 0.28], '#fdfdfd', [x, top + 0.005, z], [0, 0.15, 0]));
    t.push(cyl(0.006, 0.15, '#e63946', [x + 0.13, top + 0.008, z], 0.006, 6, [0, 0.4, Math.PI / 2]));
  }
  t.push(cyl(0.06, 0.24, '#bde0fe', [0.25, top + 0.12, 0], 0.05, 14));
  for (const dx of [0.45, 0.55]) t.push(cyl(0.03, 0.09, '#e3f2fd', [dx, top + 0.045, 0.08], 0.035, 10));
  t.push(cyl(0.1, 0.03, NAVY, [-0.3, top + 0.015, 0], 0.08, 18));
};

/** The rolling whiteboard's stand, built facing -z (the board's face is CeoWeekBoard.tsx's): frame, posts, feet on wheels and a marker tray. */
const weekStand: Build = (s, t) => {
  const { w, h, y } = EXEC_WEEK;
  const post = w / 2 + 0.07;
  s.push(box([w + 0.08, h + 0.08, 0.035], '#adb5bd', [0, y + h / 2, 0]));
  for (const dx of [-post, post]) {
    s.push(cyl(0.025, y + h + 0.15, STEEL, [dx, (y + h + 0.15) / 2, 0], 0.025, 8));
    s.push(box([0.05, 0.05, 0.6], STEEL, [dx, 0.08, 0]));
    for (const dz of [-0.26, 0.26]) t.push(ball(0.045, INK, [dx, 0.045, dz], undefined, 10));
  }
  s.push(box([w * 0.6, 0.03, 0.08], '#adb5bd', [0, y - 0.02, -0.05]));
  ['#1d4ed8', '#e63946', '#2a9d8f'].forEach((c, i) => t.push(cyl(0.012, 0.13, c, [-0.25 + i * 0.18, y + 0.008, -0.06], 0.012, 8, [0, 0, Math.PI / 2])));
};

// ---------- the coffee corner and the fish tank ----------

/** The coffee bar, built along x facing -z: a walnut counter with a marble top and brass foot rail, the espresso machine at +x, bottles, glasses and fruit. */
const coffeeBar: Build = (s, t) => {
  const { l, d, h } = EXEC_BAR;
  s.push(box([l, h - 0.05, d], WALNUT_DARK, [0, (h - 0.05) / 2, 0]));
  s.push(box([l + 0.06, 0.05, d + 0.06], MARBLE, [0, h - 0.025, -0.01]));
  for (let i = 0; i < 4; i++) t.push(box([l / 4 - 0.1, h - 0.3, 0.012], '#5e3a22', [(i - 1.5) * (l / 4), (h - 0.05) / 2, -d / 2 - 0.006]));
  s.push(cyl(0.02, l - 0.1, BRASS, [0, 0.18, -d / 2 - 0.12], 0.02, 10, [0, 0, Math.PI / 2]));
  for (const dx of [-l / 2 + 0.2, l / 2 - 0.2]) t.push(box([0.025, 0.025, 0.13], BRASS, [dx, 0.18, -d / 2 - 0.06]));
  // the espresso machine, 0.55 m in from the counter's north end (where layout.ts's bar spot stands)
  const mx = l / 2 - 0.55;
  s.push(box([0.5, 0.42, 0.38], CHROME, [mx, h + 0.21, 0.04]));
  s.push(box([0.52, 0.03, 0.4], STEEL, [mx, h + 0.435, 0.04]));
  s.push(box([0.5, 0.06, 0.04], '#e63946', [mx, h + 0.36, -0.15]));
  for (const dx of [-0.12, 0.12]) {
    t.push(cyl(0.04, 0.06, STEEL, [mx + dx, h + 0.15, -0.18], 0.04, 12));
    t.push(box([0.03, 0.03, 0.14], INK, [mx + dx, h + 0.11, -0.25]));
  }
  t.push(box([0.44, 0.025, 0.12], STEEL, [mx, h + 0.0125, -0.22]));
  for (const dx of [-0.15, 0, 0.15]) t.push(cyl(0.035, 0.06, '#ffffff', [mx + dx, h + 0.48, 0.06], 0.04, 10));
  // bottles at the far end, glasses and a fruit bowl between
  ['#2d6a4f', '#9d0208', '#e9c46a', '#bde0fe'].forEach((c, i) => {
    const bx = -l / 2 + 0.35 + i * 0.22;
    s.push(cyl(0.045, 0.24, c, [bx, h + 0.12, 0.1], 0.045, 12));
    s.push(cyl(0.016, 0.09, c, [bx, h + 0.285, 0.1], 0.016, 8));
  });
  for (const dx of [-0.1, 0.02, 0.14]) t.push(cyl(0.035, 0.09, '#e3f2fd', [dx, h + 0.045, -0.14], 0.042, 10));
  t.push(cyl(0.14, 0.07, '#f4a261', [0.42, h + 0.035, 0.05], 0.17, 16));
  ['#e63946', '#ffd166', '#80ed99'].forEach((c, i) => t.push(ball(0.06, c, [0.38 + i * 0.05, h + 0.1, 0.02 + (i % 2) * 0.07], undefined, 10)));
};

/** The café table: a marble top on a dark stem, two cups and a flower. */
const cafeTable: Build = (s, t) => {
  const r = EXEC_CAFE.r;
  s.push(cyl(r, 0.04, MARBLE, [0, 0.74, 0], r, 24));
  s.push(cyl(0.035, 0.7, NAVY, [0, 0.37, 0], 0.035, 10));
  s.push(cyl(0.25, 0.03, NAVY, [0, 0.015, 0], 0.25, 18));
  for (const dx of [-0.2, 0.2]) {
    t.push(cyl(0.06, 0.008, '#ffffff', [dx, 0.764, 0], 0.06, 14));
    t.push(cyl(0.035, 0.06, '#ffffff', [dx, 0.798, 0], 0.04, 12));
  }
  t.push(cyl(0.03, 0.12, '#48cae4', [0, 0.82, -0.12], 0.02, 10));
  t.push(ball(0.04, '#ff70a6', [0, 0.92, -0.12], undefined, 10));
};

/** The fish tank's cabinet and frame, and its sand, rocks, weed and castle (the water and the fish are CeoFurniture.tsx's). */
const fishTank: Build = (s, t) => {
  const { w, d, base, h } = EXEC_TANK;
  s.push(box([w, base, d], WALNUT, [0, base / 2, 0]));
  for (const dx of [-w / 3, 0, w / 3]) {
    t.push(box([w / 3 - 0.08, base - 0.16, 0.012], WALNUT_DARK, [dx, base / 2, -d / 2 - 0.006]));
    t.push(ball(0.02, BRASS, [dx + w / 6 - 0.1, base / 2, -d / 2 - 0.02], undefined, 8));
  }
  for (const dx of [-w / 2 + 0.02, w / 2 - 0.02]) for (const dz of [-d / 2 + 0.02, d / 2 - 0.02]) s.push(box([0.04, h, 0.04], NAVY, [dx, base + h / 2, dz]));
  s.push(box([w, 0.05, d], NAVY, [0, base + 0.025, 0]));
  s.push(box([w + 0.03, 0.06, d + 0.03], NAVY, [0, base + h + 0.03, 0]));
  t.push(box([w - 0.08, 0.07, d - 0.08], '#f2d49b', [0, base + 0.085, 0]));
  for (const [dx, sc] of [
    [-0.75, 1],
    [-0.5, 0.7],
    [0.2, 0.85],
  ])
    t.push(ball(0.08 * sc, '#8d99ae', [dx, base + 0.13, 0.06], [1.3, 0.7, 1]));
  for (const [i, [dx, dz, hh]] of [
    [-0.95, 0.12, 0.42],
    [-0.88, -0.05, 0.3],
    [-0.2, 0.15, 0.48],
    [0.95, 0.1, 0.38],
    [0.9, -0.08, 0.26],
  ].entries())
    t.push(cyl(0.035, hh, LEAVES[i % LEAVES.length], [dx, base + 0.12 + hh / 2, dz], 0.004, 6));
  // a pink castle
  t.push(box([0.2, 0.18, 0.16], '#ff99c8', [0.5, base + 0.21, 0.06]));
  for (const dx of [-0.1, 0.1]) {
    t.push(cyl(0.04, 0.12, '#ff99c8', [0.5 + dx, 0.08 + base + 0.25, 0.06], 0.04, 10));
    t.push(cyl(0.05, 0.07, '#9b5de5', [0.5 + dx, base + 0.425, 0.06], 0.001, 10));
  }
};

// ---------- the games and the window seat ----------

/** The pool table, built along x: chunky walnut legs, green cloth inside brass-capped rails, six pockets, the balls racked and two cues lying across it. */
const poolTable: Build = (s, t) => {
  const { w, d, h } = EXEC_POOL;
  const cloth = h - 0.06;
  for (const dx of [-w / 2 + 0.16, w / 2 - 0.16]) for (const dz of [-d / 2 + 0.16, d / 2 - 0.16]) s.push(box([0.16, cloth - 0.18, 0.16], WALNUT_DARK, [dx, (cloth - 0.18) / 2, dz]));
  s.push(box([w - 0.06, 0.18, d - 0.06], WALNUT, [0, cloth - 0.09, 0]));
  s.push(box([w - 0.24, 0.02, d - 0.24], '#1b7f4b', [0, cloth + 0.01, 0]));
  for (const sz of [-1, 1]) s.push(box([w, 0.08, 0.13], WALNUT_LIGHT, [0, h - 0.04, (sz * (d - 0.13)) / 2]));
  for (const sx of [-1, 1]) s.push(box([0.13, 0.08, d - 0.26], WALNUT_LIGHT, [(sx * (w - 0.13)) / 2, h - 0.04, 0]));
  for (const dx of [-w / 2 + 0.08, 0, w / 2 - 0.08]) for (const dz of [-d / 2 + 0.08, d / 2 - 0.08]) t.push(cyl(0.06, 0.012, INK, [dx, h + 0.006, dz], 0.06, 14));
  // the rack of ten at the west end, the cue ball at the east
  const colors = ['#ffd166', '#1d4ed8', '#e63946', '#9b5de5', '#f77f00', '#2a9d8f', '#9d0208', INK, '#ffd166', '#1d4ed8'];
  let n = 0;
  for (let row = 0; row < 4; row++)
    for (let i = 0; i <= row; i++) t.push(ball(0.03, colors[n++ % colors.length], [-0.55 - row * 0.052, cloth + 0.05, (i - row / 2) * 0.061], undefined, 10));
  t.push(ball(0.03, '#ffffff', [0.62, cloth + 0.05, 0.05], undefined, 10));
  for (const [dz, yaw] of [
    [-0.28, 0.12],
    [0.3, -0.08],
  ])
    s.push(cyl(0.012, 1.45, '#d4a373', [0.1, cloth + 0.035, dz], 0.008, 8, [0, yaw, Math.PI / 2]));
};

/** The chess table: a walnut pedestal, a board of 64 squares and a game halfway through. */
const chessTable: Build = (s, t) => {
  const w = EXEC_CHESS.w;
  s.push(box([w, 0.05, w], WALNUT_LIGHT, [0, 0.695, 0]));
  s.push(cyl(0.05, 0.64, WALNUT, [0, 0.35, 0], 0.04, 10));
  s.push(cyl(0.24, 0.04, WALNUT_DARK, [0, 0.02, 0], 0.24, 16));
  const sq = 0.055;
  const top = 0.72;
  t.push(box([sq * 8 + 0.03, 0.008, sq * 8 + 0.03], WALNUT_DARK, [0, top + 0.004, 0]));
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) t.push(box([sq, 0.004, sq], (i + j) % 2 ? '#6b4226' : '#f1e3c8', [(i - 3.5) * sq, top + 0.01, (j - 3.5) * sq]));
  const at = (i: number, j: number, y: number): V3 => [(i - 3.5) * sq, top + 0.012 + y, (j - 3.5) * sq];
  const pieces: [number, number, string, 'pawn' | 'tall'][] = [
    [1, 1, '#f8f9fa', 'pawn'],
    [3, 2, '#f8f9fa', 'pawn'],
    [4, 3, '#f8f9fa', 'pawn'],
    [6, 1, '#f8f9fa', 'pawn'],
    [4, 0, '#f8f9fa', 'tall'],
    [2, 2, '#f8f9fa', 'tall'],
    [1, 6, INK, 'pawn'],
    [3, 4, INK, 'pawn'],
    [5, 5, INK, 'pawn'],
    [6, 6, INK, 'pawn'],
    [4, 7, INK, 'tall'],
    [5, 6, INK, 'tall'],
  ];
  for (const [i, j, c, kind] of pieces) {
    const h = kind === 'pawn' ? 0.035 : 0.06;
    t.push(cyl(0.017, h, c, at(i, j, h / 2), 0.011, 10));
    t.push(ball(kind === 'pawn' ? 0.013 : 0.015, c, at(i, j, h + 0.008), undefined, 8));
  }
};

/** The window seat, built along x facing -z: a walnut box, a long cushion and two pillows against the window. */
const windowSeat: Build = (s, t) => {
  const { l, d, h } = EXEC_WINDOW_SEAT;
  s.push(box([l, h - 0.08, d], WALNUT, [0, (h - 0.08) / 2, 0]));
  s.push(box([l - 0.06, 0.1, d - 0.04], '#98c1d9', [0, h - 0.05, 0]));
  s.push(box([0.5, 0.36, 0.13], '#ef476f', [-0.75, h + 0.17, d / 2 - 0.1], [-0.2, 0.15, 0]));
  s.push(box([0.5, 0.36, 0.13], '#ffd166', [0.75, h + 0.17, d / 2 - 0.1], [-0.2, -0.15, 0]));
  for (const dx of [-l / 4, l / 4]) t.push(box([l / 2 - 0.12, h - 0.26, 0.012], WALNUT_DARK, [dx, (h - 0.08) / 2, -d / 2 - 0.006]));
};

/** A brass telescope on a walnut tripod, looking out of the window to the east (built facing -z: it looks that way). */
const telescope: Build = (s, t) => {
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    s.push(cyl(0.018, 1.15, WALNUT, [Math.sin(a) * 0.17, 0.56, Math.cos(a) * 0.17], 0.014, 6, [-Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3]));
  }
  t.push(ball(0.05, BRASS, [0, 1.12, 0], undefined, 10));
  s.push(cyl(0.05, 0.7, BRASS, [0, 1.24, -0.08], 0.07, 14, [-1.25, 0, 0]));
  t.push(cyl(0.075, 0.05, NAVY, [0, 1.36, -0.42], 0.075, 14, [-1.25, 0, 0]));
};

// ---------- plants ----------

/** A bushy plant in a pot (Props.tsx's Plant). */
const bushyPlant: Build = (s) => {
  s.push(cyl(0.22, 0.5, '#3d405b', [0, 0.25, 0], 0.28, 16));
  s.push(ball(0.36, LEAVES[0], [0, 0.8, 0]));
  s.push(ball(0.28, LEAVES[1], [0.2, 1.05, 0.08]));
  s.push(ball(0.25, LEAVES[2], [-0.18, 1.12, -0.05]));
  s.push(ball(0.2, LEAVES[0], [0.02, 1.35, 0]));
};

/** A tall fig in a white pot with a coral band: a trunk and a crown of leaves. */
const tallPlant: Build = (s, t) => {
  s.push(cyl(0.25, 0.55, '#f8f9fa', [0, 0.275, 0], 0.3, 18));
  t.push(cyl(0.29, 0.07, '#e07a5f', [0, 0.47, 0], 0.295, 18));
  s.push(cyl(0.035, 1.2, '#7f5539', [0, 1.05, 0], 0.03, 8));
  for (const [r, c, at] of [
    [0.32, 0, [0.05, 1.6, 0]],
    [0.28, 1, [-0.22, 1.38, 0.1]],
    [0.26, 2, [0.2, 1.9, -0.08]],
    [0.24, 3, [-0.12, 2.0, 0.12]],
    [0.22, 0, [0.24, 1.3, 0.15]],
    [0.2, 2, [0, 2.2, 0]],
  ] as [number, number, V3][])
    s.push(ball(r, LEAVES[c], at));
};

// ---------- on the walls ----------

/** A picture's frame (its face is CeoArt.tsx's), built facing +z on its wall. */
function frame(w: number, h: number, color: string): G[] {
  return [box([w + 0.14, h + 0.14, 0.05], color, [0, 0, 0.025]), box([w + 0.02, h + 0.02, 0.01], '#f8f9fa', [0, 0, 0.052])];
}

/** The pictures' frame colours, in EXEC_ART's order. */
const FRAMES = [BRASS, WALNUT, NAVY, '#f8f9fa'];

/** The shelves over the coffee bar, built facing +z: two boards on brackets with small bottles, glasses and mugs, shallow enough to go with their wall in the cutaway. */
function barShelves(): G[] {
  const out: G[] = [];
  const l = EXEC_BAR.l - 0.6;
  const deep = 0.13;
  ['#2d6a4f', '#9d0208', '#e9c46a', '#264653', '#f4a261', '#bde0fe', '#e63946'].forEach((c, i) => {
    const y = i < 4 ? 0 : 0.45;
    const x = -l / 2 + 0.2 + (i < 4 ? i : i - 4) * 0.36;
    out.push(cyl(0.032, 0.17, c, [x, y + 0.105, deep / 2], 0.032, 10));
    out.push(cyl(0.012, 0.06, c, [x, y + 0.22, deep / 2], 0.012, 6));
  });
  for (const y of [0, 0.45]) {
    out.push(box([l, 0.035, deep], WALNUT_LIGHT, [0, y, deep / 2]));
    for (const dx of [-l / 2 + 0.15, l / 2 - 0.15]) out.push(box([0.03, 0.12, 0.03], BRASS, [dx, y - 0.075, 0.03]));
  }
  for (const dx of [0.45, 0.62, 0.79]) out.push(cyl(0.035, 0.08, '#ffffff', [dx, 0.45 + 0.058, deep / 2], 0.038, 10));
  return out;
}

// ---------- the rugs ----------

const grown = (r: Rect, m: number): Rect => ({ minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m });
function rug(r: Rect, color: string, y: number): G {
  return flat(new THREE.PlaneGeometry(r.maxX - r.minX, r.maxZ - r.minZ), color, (r.minX + r.maxX) / 2, y, (r.minZ + r.maxZ) / 2);
}
/** A rug with a border: the border's colour all over, the middle `inset` in from its edge. */
const bordered = (r: Rect, border: string, middle: string, inset = 0.14): G[] => [rug(r, border, 0.004), rug(grown(r, -inset), middle, 0.007)];

// ---------- the room ----------

export interface CeoRoom {
  /** Everything standing on the floor: inked, casting shadows. */
  solid: G;
  /** Its small trim: no ink, no shadows. */
  trim: G;
  /** What hangs on the walls: inked, cut away with its wall in the overview. */
  wall: G;
  /** The rugs, flat on the floor. */
  rugs: G;
}

/** Builds the CEO's office's furniture (once per visit: dispose of it when the floor goes). */
export function ceoRoom(): CeoRoom {
  const k: Kit = { solid: [], trim: [], wall: [], rugs: [] };
  // the desk's corner: the credenza, two guest chairs, the globe and the plants beside the credenza
  piece(k, EXEC_CREDENZA.x, EXEC_CREDENZA.z, Math.PI, credenza);
  for (const [x, z] of EXEC_GUESTS) piece(k, x, z, 0, guestChair);
  piece(k, EXEC_GLOBE.x, EXEC_GLOBE.z, -0.6, globe);
  for (const [x, z, sc] of EXEC_PLANTS) piece(k, x, z, 0, bushyPlant, sc);
  for (const [x, z, sc] of EXEC_TALL_PLANTS) piece(k, x, z, x * 0.7 + z, tallPlant, sc);
  // the lounge
  piece(k, EXEC_SOFA.x, EXEC_SOFA.z, -Math.PI / 2, sofa);
  for (const [x, z] of EXEC_ARMCHAIRS) piece(k, x, z, Math.PI / 2, armchair(LEATHER));
  piece(k, EXEC_COFFEE.x, EXEC_COFFEE.z, Math.PI / 2, coffeeTable);
  piece(k, EXEC_SIDE_TABLE.x, EXEC_SIDE_TABLE.z, 0, sideTable(EXEC_SIDE_TABLE.r, true));
  for (const [x, z] of EXEC_LAMPS) piece(k, x, z, 0, floorLamp);
  // the library and the reading nook
  piece(k, EXEC_SHELVES.x, EXEC_SHELVES.z, Math.PI, bookcases);
  piece(k, EXEC_NOOK.x, EXEC_NOOK.z, -Math.PI / 2, armchair(VELVET, true));
  piece(k, EXEC_NOOK_STOOL.x, EXEC_NOOK_STOOL.z, 0, footstool);
  piece(k, EXEC_NOOK_TABLE.x, EXEC_NOOK_TABLE.z, 0, sideTable(EXEC_NOOK_TABLE.r, false));
  piece(k, EXEC_CHESS.x, EXEC_CHESS.z, 0.2, chessTable);
  for (const [x, z, yaw] of chessChairs()) piece(k, x, z, yaw, armchair(COGNAC));
  // the putting green, the golf bag, the mascot (looking towards the elevator) and the coat stand
  piece(k, EXEC_GREEN.x, EXEC_GREEN.z, 0, puttingGreen);
  piece(k, EXEC_GOLF_BAG.x, EXEC_GOLF_BAG.z, 0.4, golfBag);
  piece(k, EXEC_STATUE.x, EXEC_STATUE.z, Math.atan2(EXEC_STATUE.x, EXEC_STATUE.z - HALF_D), statue);
  piece(k, EXEC_COAT_STAND.x, EXEC_COAT_STAND.z, 0.3, coatStand);
  // the meeting table and its chairs, and the week's whiteboard facing it from the east
  piece(k, EXEC_MEETING.x, EXEC_MEETING.z, 0, meetingTable);
  for (const [x, z, yaw] of meetingChairs()) piece(k, x, z, yaw, meetingChair);
  piece(k, EXEC_WEEK.x, EXEC_WEEK.z, Math.PI / 2, weekStand);
  // the window seat under the east wall's north window, the telescope beside it looking out
  piece(k, EXEC_WINDOW_SEAT.x, EXEC_WINDOW_SEAT.z, Math.PI / 2, windowSeat);
  piece(k, EXEC_SCOPE.x, EXEC_SCOPE.z, -Math.PI / 2 + 0.25, telescope);
  // the pool table, the coffee corner (the bar's front to the west, its stools, the café table and its chairs), the fish tank
  piece(k, EXEC_POOL.x, EXEC_POOL.z, 0, poolTable);
  piece(k, EXEC_BAR.x, EXEC_BAR.z, Math.PI / 2, coffeeBar);
  for (const [x, z] of EXEC_STOOLS) piece(k, x, z, -Math.PI / 2, stool);
  piece(k, EXEC_CAFE.x, EXEC_CAFE.z, 0, cafeTable);
  for (const [x, z, yaw] of cafeChairs()) piece(k, x, z, yaw, bistroChair);
  piece(k, EXEC_TANK.x, EXEC_TANK.z, 0, fishTank);

  // on the walls: the sign's board, the pictures' frames, the bar's shelves and the clock's rim
  k.wall.push(...hang([box([4.4, 1.15, 0.06], WALNUT, [0, 0, 0.04])], 'north', 0, SIGN_Y));
  pictures().forEach(({ wall, at, y, w, h }, i) => k.wall.push(...hang(frame(w, h, FRAMES[i % FRAMES.length]), wall, at, y + h / 2)));
  k.wall.push(...hang(barShelves(), 'east', EXEC_BAR.z, 1.5));
  k.wall.push(...hang([paint(new THREE.TorusGeometry(0.37, 0.035, 8, 32), NAVY, [0, 0, 0.03])], 'east', EXEC_CLOCK.z, EXEC_CLOCK.y));

  // the rugs: wine with a gold border under the desk and down to the elevator, the lounge's, the meeting table's, the
  // chess table's and a round one in the nook
  const [desk, runner, lounge, meeting, nook, chess] = EXEC_RUGS;
  k.rugs.push(...bordered(desk, BRASS, WINE), ...bordered(runner, BRASS, WINE, 0.12), ...bordered(lounge, '#b08968', '#d8c3a5'), ...bordered(meeting, '#98c1d9', '#3d5a80', 0.16), ...bordered(chess, '#f1e3c8', VELVET));
  const nx = (nook.minX + nook.maxX) / 2;
  const nz = (nook.minZ + nook.maxZ) / 2;
  k.rugs.push(flat(new THREE.CircleGeometry(1.5, 40), '#e76f51', nx, 0.004, nz), flat(new THREE.CircleGeometry(1.34, 40), '#e9c46a', nx, 0.007, nz));

  return { solid: merged(k.solid), trim: merged(k.trim), wall: merged(k.wall), rugs: merged(k.rugs) };
}
