// Cheap toon models for what the shop sells: primitives with a colour each, merged into one geometry with vertex
// colours, so a whole model costs one draw call (and one for its ink). Made once per key and kept for the session.
// Adapted from cubefarm client/src/world/decor/parts.ts (MIT): the lit and cut-away materials are new.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CUT_PLANES } from '../cutaway';

type V3 = [number, number, number];

export interface Part {
  geo: THREE.BufferGeometry;
  color: string;
  at?: V3;
  rot?: V3;
  scale?: V3;
}

export const box = (w: number, h: number, d: number, color: string, at?: V3, rot?: V3): Part => ({ geo: new THREE.BoxGeometry(w, h, d), color, at, rot });
export const cyl = (rTop: number, rBottom: number, h: number, color: string, at?: V3, rot?: V3, seg = 14): Part => ({ geo: new THREE.CylinderGeometry(rTop, rBottom, h, seg), color, at, rot });
export const ball = (r: number, color: string, at?: V3, scale?: V3, seg = 12): Part => ({ geo: new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7))), color, at, scale });
export const cone = (r: number, h: number, color: string, at?: V3, rot?: V3, seg = 10): Part => ({ geo: new THREE.ConeGeometry(r, h, seg), color, at, rot });
export const torus = (r: number, tube: number, color: string, at?: V3, rot?: V3): Part => ({ geo: new THREE.TorusGeometry(r, tube, 6, 18), color, at, rot });
/** A flat disc facing +z (a dial, a light). */
export const disc = (r: number, color: string, at?: V3, rot?: V3, seg = 16): Part => ({ geo: new THREE.CircleGeometry(r, seg), color, at, rot });

/** One geometry from the parts, each part's colour baked into its vertices. */
export function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  const geos = parts.map((p) => {
    const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()) as THREE.BufferGeometry;
    p.geo.dispose();
    q.setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0])));
    m.compose(new THREE.Vector3(...(p.at ?? [0, 0, 0])), q, new THREE.Vector3(...(p.scale ?? [1, 1, 1])));
    g.applyMatrix4(m);
    c.set(p.color); // in the working (linear) colour space, as vertex colours are read
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.deleteAttribute('uv');
    return g;
  });
  const out = (geos.length && mergeGeometries(geos, false)) || new THREE.BufferGeometry();
  for (const g of geos) g.dispose();
  out.computeBoundingSphere();
  return out;
}

const cache = new Map<string, THREE.BufferGeometry>();

/** A merged model, built the first time `key` is asked for and kept for the session (they're small, and few). */
export function model(key: string, build: () => Part[]): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = mergeParts(build());
    cache.set(key, g);
  }
  return g;
}

// The same three-step ramp as materials.ts, for vertex-coloured toon shading.
const ramp = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
ramp.minFilter = THREE.NearestFilter;
ramp.magFilter = THREE.NearestFilter;
ramp.generateMipmaps = false;
ramp.needsUpdate = true;

/** Toon shading in each vertex's own colour. */
export const vertexToon = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp });
/** The same, for what hangs on a wall: cut away with it in the overview (cutaway.ts). */
export const vertexToonCut = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp, clippingPlanes: CUT_PLANES.room });

/**
 * Lit from inside (a vending machine's shelves, the beer fridge's bottles): unlit vertex colours, a little dimmer by
 * day so they glow once the room darkens. machinesGlow sets how bright, from the office clock.
 */
export const vertexLit = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
/** A machine's lit back panel, brightening at night the same way. */
export const panelLit = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });

const DAY = new THREE.Color('#c9ccd6');
const NIGHT = new THREE.Color('#ffffff');
const PANEL_DAY = new THREE.Color('#d8e6ef');
const PANEL_NIGHT = new THREE.Color('#fff4d0');

/** Sets the lit materials for night factor `night` (0 by day, 1 at night: sky nightFactor). */
export function machinesGlow(night: number) {
  vertexLit.color.copy(DAY).lerp(NIGHT, night);
  panelLit.color.copy(PANEL_DAY).lerp(PANEL_NIGHT, night);
}
machinesGlow(0);
