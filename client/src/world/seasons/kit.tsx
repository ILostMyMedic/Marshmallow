// What the seasonal decorations share (seasons/): one vertex-coloured toon material for everything lit, so a whole
// decoration (a Christmas tree with its baubles and presents, a snowman, a pile of pumpkins) is one merged mesh and one
// draw call; a glow for what lights up at night (the pumpkins' carved faces, a star), brighter as the office's lamps
// come on (sky/lamps.tsx); fairy lights (bulbs and their halos, two draw calls a string); and the shapes themselves,
// built from three's primitives as plain geometry. Materials are made once and kept, like materials.ts's.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CUT_PLANES, type Cut } from '../cutaway';
import { TOON_RAMP } from '../haze';
import { merged } from '../shapes';
import { lampsOn } from '../sky/lamps';
import { glowTexture } from '../roof/textures';

type V3 = [number, number, number];

/** Gives every vertex of `g` the colour `color` (for the painted material) and returns it. */
export function painted(g: THREE.BufferGeometry, color: string | THREE.Color): THREE.BufferGeometry {
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Merges painted parts into one geometry (an empty one when there are none): unindexed, as the extruded shapes are. */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return merged(
    parts.map((p) => {
      if (!p.index) return p;
      const flat = p.toNonIndexed();
      p.dispose();
      return flat;
    }),
  );
}

const paints = new Map<string, THREE.MeshToonMaterial>();
/** The decorations' lit material: cel-shaded like the office, coloured per vertex; `cut` with a wall the overview cuts away. */
export function paintMaterial(cut?: Cut) {
  let m = paints.get(cut ?? '');
  if (!m) {
    m = new THREE.MeshToonMaterial({ color: '#ffffff', vertexColors: true, gradientMap: TOON_RAMP, clippingPlanes: cut ? CUT_PLANES[cut] : null });
    paints.set(cut ?? '', m);
  }
  return m;
}

const GLOW_DAY = new THREE.Color('#9a6a3a');
const GLOW_NIGHT = new THREE.Color('#ffffff');
let glowMat: THREE.MeshBasicMaterial | null = null;
let glowFrame = -1;
/** The decorations' glow (vertex-coloured, unlit): dim by day, full as the lamps come on. */
export const glowMaterial = () => (glowMat ??= new THREE.MeshBasicMaterial({ color: GLOW_DAY.clone(), vertexColors: true, toneMapped: false }));

/** Turns the glow up with the lamps: call it from each decoration's frame loop (only the first call a frame does anything). */
export function tickGlow(frame: number) {
  if (frame === glowFrame) return;
  glowFrame = frame;
  glowMaterial().color.lerpColors(GLOW_DAY, GLOW_NIGHT, 0.25 + 0.75 * lampsOn());
}

// ---------- fairy lights ----------

const BULB_OFF = new THREE.Color('#bdb6a6');
const BULB_ON = new THREE.Color('#ffffff');

export const FESTIVE = ['#ff4d4d', '#ffd166', '#5ad1ff', '#7bed9f', '#ff8fd8', '#fff1c9'];

/**
 * A string of bulbs at `at` (xyz each) in `tints` (in turn): each bulb a little bead, with a halo `halo` across from
 * dusk. `min`: how lit they are by day (indoors a tree's lights are on all day).
 */
export function FairyLights({ at, tints = FESTIVE, size = 0.045, halo = 0.42, min = 0 }: { at: readonly V3[]; tints?: readonly string[]; size?: number; halo?: number; min?: number }) {
  const geo = useMemo(() => {
    const c = new THREE.Color();
    const beads: THREE.BufferGeometry[] = [];
    const pos: number[] = [];
    const col: number[] = [];
    at.forEach(([x, y, z], i) => {
      c.set(tints[i % tints.length]);
      beads.push(painted(new THREE.SphereGeometry(size, 6, 4).scale(1, 1.25, 1).translate(x, y, z), c));
      pos.push(x, y, z);
      col.push(c.r, c.g, c.b);
    });
    const halos = new THREE.BufferGeometry();
    halos.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    halos.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return { beads: mergeParts(beads), halos };
  }, [at, tints, size]);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  // their own materials: each string has its own level and halo size
  const m = useMemo(
    () => ({
      bulb: new THREE.MeshBasicMaterial({ color: BULB_OFF.clone(), vertexColors: true, toneMapped: false }),
      halo: new THREE.PointsMaterial({ size: halo, map: glowTexture(), vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    }),
    [halo],
  );
  useEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m]);
  const halos = useRef<THREE.Points>(null);
  const level = useRef(-1);
  useFrame(({ clock }) => {
    // a slow shimmer on top of the lamps' level, so they read as fairy lights
    const l = Math.min(1, Math.max(min, lampsOn()) * (0.85 + 0.15 * Math.sin(clock.elapsedTime * 2.1)));
    if (Math.abs(l - level.current) < 0.004) return;
    level.current = l;
    m.bulb.color.lerpColors(BULB_OFF, BULB_ON, 0.35 + 0.65 * l);
    m.halo.opacity = l * 0.75;
    if (halos.current) halos.current.visible = l > 0.02;
  });
  return (
    <group>
      <mesh geometry={geo.beads} material={m.bulb} />
      <points ref={halos} geometry={geo.halos} material={m.halo} visible={false} renderOrder={2} />
    </group>
  );
}

/** Soft glows at `at` in `color`, `size` across, coming up with the lamps (a jack-o'-lantern's candle): one draw call. */
export function GlowHalos({ at, color, size }: { at: readonly V3[]; color: string; size: number }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(at.flat(), 3));
    return g;
  }, [at]);
  const mat = useMemo(() => new THREE.PointsMaterial({ size, color, map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), [size, color]);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  const ref = useRef<THREE.Points>(null);
  useFrame(({ clock }) => {
    // a candle's flicker
    const l = lampsOn() * (0.8 + 0.12 * Math.sin(clock.elapsedTime * 9.3) + 0.08 * Math.sin(clock.elapsedTime * 23.1));
    mat.opacity = l * 0.85;
    if (ref.current) ref.current.visible = l > 0.02;
  });
  return <points ref={ref} geometry={geo} material={mat} visible={false} renderOrder={2} />;
}

/** `n` points along a line from a to b, sagging `sag` in the middle (a string of lights hung between two points). */
export function strand(a: V3, b: V3, n: number, sag = 0): V3[] {
  return Array.from({ length: n }, (_, k) => {
    const u = (k + 0.5) / n;
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - sag * 4 * u * (1 - u), a[2] + (b[2] - a[2]) * u];
  });
}

// ---------- shapes ----------

/** Parts of a decoration: lit (painted) and glowing geometry, to merge into one mesh each. */
export interface Parts {
  lit: THREE.BufferGeometry[];
  glow: THREE.BufferGeometry[];
}

export const newParts = (): Parts => ({ lit: [], glow: [] });

/** A pumpkin of radius `r` standing at (x, y, z) facing `yaw` (0: +z): ribbed, with a stem and, carved, a glowing face. */
export function pumpkin(p: Parts, [x, y, z]: V3, r: number, yaw = 0, carved = true) {
  const squash = 0.78;
  const body = new THREE.SphereGeometry(r, 18, 12);
  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vz = pos.getZ(i);
    const a = Math.atan2(vz, vx);
    const k = 1 - 0.07 * (0.5 + 0.5 * Math.cos(a * 10));
    pos.setXYZ(i, vx * k, pos.getY(i) * squash, vz * k);
  }
  body.computeVertexNormals();
  const place = (g: THREE.BufferGeometry) => g.rotateY(yaw).translate(x, y + r * squash, z);
  p.lit.push(place(painted(body, '#f28c28')));
  p.lit.push(place(painted(new THREE.CylinderGeometry(r * 0.08, r * 0.12, r * 0.35, 6).translate(0.02 * r, r * squash + r * 0.12, 0).rotateZ(-0.15), '#5b7a2e')));
  if (!carved) return;
  // the face, a hair in front of the skin: two triangle eyes, a nose and a grin with teeth
  const surface = (fx: number, fy: number) => r * 0.93 * Math.sqrt(Math.max(0, 1 - (fx / r) ** 2 - (fy / (r * squash)) ** 2)) + r * 0.03;
  const face = (shape: THREE.Shape) => {
    const g = new THREE.ShapeGeometry(shape);
    const v = g.attributes.position;
    for (let i = 0; i < v.count; i++) v.setZ(i, surface(v.getX(i), v.getY(i)));
    g.computeVertexNormals();
    return place(painted(g, '#ffb238'));
  };
  const tri = (cx: number, cy: number, w: number, h: number) => {
    const s = new THREE.Shape();
    s.moveTo(cx - w / 2, cy - h / 2);
    s.lineTo(cx + w / 2, cy - h / 2);
    s.lineTo(cx, cy + h / 2);
    s.closePath();
    return s;
  };
  for (const side of [-1, 1]) p.glow.push(face(tri(side * r * 0.36, r * 0.16, r * 0.3, r * 0.26)));
  p.glow.push(face(tri(0, -r * 0.04, r * 0.14, r * 0.13)));
  const grin = new THREE.Shape();
  const w = r * 0.62;
  const top = -r * 0.2;
  grin.moveTo(-w / 2, top);
  for (let k = 1; k <= 4; k++) grin.lineTo(-w / 2 + (k * w) / 4 - w / 8, top - (k % 2 ? r * 0.07 : 0));
  grin.lineTo(w / 2, top);
  grin.quadraticCurveTo(0, top - r * 0.36, -w / 2, top);
  p.glow.push(face(grin));
}

/** A Christmas tree `h` tall at (x, y, z): tiers of boughs on a trunk in a pot, baubles, and a star. Returns where its fairy lights go. */
export function christmasTree(p: Parts, [x, y, z]: V3, h: number, seed = 1): V3[] {
  const s = h / 3;
  const rnd = mulberry(seed);
  const at = (g: THREE.BufferGeometry) => g.translate(x, y, z);
  p.lit.push(at(painted(new THREE.CylinderGeometry(0.36 * s, 0.3 * s, 0.38 * s, 16).translate(0, 0.19 * s, 0), '#c0392b')));
  p.lit.push(at(painted(new THREE.CylinderGeometry(0.38 * s, 0.38 * s, 0.05 * s, 16).translate(0, 0.38 * s, 0), '#f4d35e')));
  p.lit.push(at(painted(new THREE.CylinderGeometry(0.1 * s, 0.13 * s, 0.5 * s, 8).translate(0, 0.6 * s, 0), '#7a5a3c')));
  const tiers: [number, number, number][] = [
    [1.2, 1.05, 0.7],
    [0.98, 0.95, 1.25],
    [0.74, 0.85, 1.78],
    [0.48, 0.78, 2.27],
  ];
  const lights: V3[] = [];
  tiers.forEach(([r, th, base], i) => {
    p.lit.push(at(painted(new THREE.ConeGeometry(r * s, th * s, 18).translate(0, (base + th / 2) * s, 0), i % 2 ? '#2d8a4e' : '#2f9e55')));
    // baubles round the tier's hem, and a ring of lights a little higher up
    const n = Math.round(6 + r * 7);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + i * 0.7 + rnd() * 0.3;
      const rr = r * s * 0.9;
      const by = (base + 0.12) * s;
      const colour = ['#e63946', '#ffd166', '#3a86ff', '#f1faee', '#ff70a6'][Math.floor(rnd() * 5)];
      p.lit.push(at(painted(new THREE.SphereGeometry(0.065 * s, 10, 8).translate(Math.cos(a) * rr, by - 0.06 * s, Math.sin(a) * rr), colour)));
    }
    const m = Math.round(8 + r * 10);
    for (let k = 0; k < m; k++) {
      const a = (k / m) * Math.PI * 2 + i * 1.3;
      const u = 0.45 + 0.1 * Math.sin(k * 1.7);
      const rr = r * s * (1 - u) + 0.02;
      lights.push([x + Math.cos(a) * rr, y + (base + th * u) * s, z + Math.sin(a) * rr]);
    }
  });
  // the star on top: a flat five-pointed star, glowing
  const star = new THREE.Shape();
  for (let k = 0; k < 10; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 5;
    const rr = (k % 2 ? 0.09 : 0.22) * s;
    if (k === 0) star.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else star.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  star.closePath();
  p.glow.push(at(painted(new THREE.ExtrudeGeometry(star, { depth: 0.05 * s, bevelEnabled: false }).translate(0, 3.12 * s, -0.025 * s), '#ffd23f')));
  return lights;
}

/** A present at (x, y, z), `w` wide, `h` tall, turned `yaw`: wrapped in `paper` with a `ribbon` both ways and a bow. */
export function present(p: Parts, [x, y, z]: V3, w: number, h: number, yaw: number, paper: string, ribbon: string) {
  const at = (g: THREE.BufferGeometry) => g.rotateY(yaw).translate(x, y, z);
  p.lit.push(at(painted(new THREE.BoxGeometry(w, h, w * 0.9).translate(0, h / 2, 0), paper)));
  p.lit.push(at(painted(new THREE.BoxGeometry(w * 0.16, h + 0.004, w * 0.9 + 0.004).translate(0, h / 2, 0), ribbon)));
  p.lit.push(at(painted(new THREE.BoxGeometry(w + 0.004, h + 0.004, w * 0.14).translate(0, h / 2, 0), ribbon)));
  for (const side of [-1, 1]) p.lit.push(at(painted(new THREE.TorusGeometry(w * 0.12, w * 0.04, 6, 10).rotateY((side * Math.PI) / 4).translate(side * w * 0.08, h + w * 0.08, 0), ribbon)));
}

/** A snowman at (x, y, z) looking along `yaw`: three snowballs, coal eyes and buttons, a carrot, stick arms, a scarf and a hat. */
export function snowman(p: Parts, [x, y, z]: V3, yaw: number) {
  const at = (g: THREE.BufferGeometry) => g.rotateY(yaw).translate(x, y, z);
  const snow = '#f7fbff';
  p.lit.push(at(painted(new THREE.SphereGeometry(0.5, 18, 14).scale(1, 0.92, 1).translate(0, 0.44, 0), snow)));
  p.lit.push(at(painted(new THREE.SphereGeometry(0.36, 18, 14).translate(0, 1.08, 0), snow)));
  p.lit.push(at(painted(new THREE.SphereGeometry(0.26, 16, 12).translate(0, 1.58, 0), snow)));
  for (const dx of [-0.09, 0.09]) p.lit.push(at(painted(new THREE.SphereGeometry(0.032, 8, 6).translate(dx, 1.65, 0.235), '#22223b')));
  for (const [by, bz] of [
    [1.18, 0.335],
    [1.04, 0.36],
    [0.9, 0.335],
  ])
    p.lit.push(at(painted(new THREE.SphereGeometry(0.035, 8, 6).translate(0, by, bz), '#22223b')));
  p.lit.push(at(painted(new THREE.ConeGeometry(0.045, 0.28, 8).rotateX(Math.PI / 2).translate(0, 1.58, 0.38), '#f77f00')));
  for (const side of [-1, 1]) p.lit.push(at(painted(new THREE.CylinderGeometry(0.018, 0.022, 0.75, 5).rotateZ(side * -1.05).translate(side * 0.62, 1.25, 0), '#6b4a33')));
  p.lit.push(at(painted(new THREE.TorusGeometry(0.24, 0.06, 8, 18).rotateX(Math.PI / 2).translate(0, 1.36, 0), '#d62828')));
  p.lit.push(at(painted(new THREE.BoxGeometry(0.1, 0.32, 0.04).translate(0.12, 1.2, 0.27).rotateZ(0.05), '#d62828')));
  p.lit.push(at(painted(new THREE.CylinderGeometry(0.27, 0.27, 0.03, 18).translate(0, 1.78, 0), '#22223b')));
  p.lit.push(at(painted(new THREE.CylinderGeometry(0.17, 0.18, 0.3, 18).translate(0, 1.93, 0), '#22223b')));
  p.lit.push(at(painted(new THREE.CylinderGeometry(0.182, 0.182, 0.06, 18).translate(0, 1.82, 0), '#d62828')));
}

/** A wreath of radius `r` hung at (x, y, z) facing -z (into a room from its south wall): boughs, berries and a bow. */
export function wreath(p: Parts, [x, y, z]: V3, r: number) {
  p.lit.push(painted(new THREE.TorusGeometry(r, r * 0.32, 8, 22).translate(x, y, z - r * 0.25), '#2d6a4f'));
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.3;
    p.lit.push(painted(new THREE.SphereGeometry(r * 0.12, 8, 6).translate(x + Math.cos(a) * r * 1.05, y + Math.sin(a) * r * 1.05, z - r * 0.55), '#d00000'));
  }
  for (const side of [-1, 1]) p.lit.push(painted(new THREE.ConeGeometry(r * 0.24, r * 0.6, 8).rotateZ((side * Math.PI) / 2.4).translate(x + side * r * 0.3, y - r * 1.05, z - r * 0.58), '#d00000'));
  p.lit.push(painted(new THREE.SphereGeometry(r * 0.18, 8, 6).translate(x, y - r * 1.05, z - r * 0.6), '#d00000'));
}

/** A heart balloon on its string at (x, y, z), `top` m up: a puffy heart, and the string down to its weight. */
export function heartBalloon(p: Parts, [x, y, z]: V3, top: number, color: string, tilt = 0) {
  const heart = new THREE.Shape();
  heart.moveTo(0, -0.18);
  heart.bezierCurveTo(-0.3, 0.02, -0.18, 0.24, 0, 0.12);
  heart.bezierCurveTo(0.18, 0.24, 0.3, 0.02, 0, -0.18);
  const g = new THREE.ExtrudeGeometry(heart, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 3, curveSegments: 10 });
  p.lit.push(painted(g.translate(0, 0, -0.04).rotateZ(tilt).translate(x, y + top, z), color));
  p.lit.push(painted(new THREE.CylinderGeometry(0.004, 0.004, top - 0.18, 3).translate(x, y + (top - 0.18) / 2, z), '#f1faee'));
  p.lit.push(painted(new THREE.CylinderGeometry(0.04, 0.05, 0.05, 8).translate(x, y + 0.025, z), '#adb5bd'));
}

/** mulberry32, for the decorations' small randomness (the same every visit). */
export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lit and glowing parts as one mesh each, glowing with the lamps; disposed when it goes. */
export function useParts(build: () => Parts, deps: readonly unknown[]) {
  const geo = useMemo(() => {
    const p = build();
    return { lit: mergeParts(p.lit), glow: mergeParts(p.glow) };
  }, deps);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  useFrame(({ gl }) => tickGlow(gl.info.render.frame));
  return geo;
}
