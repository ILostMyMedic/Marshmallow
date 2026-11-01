// The rock bus: a band's tour bus, painted purple with flames and "THE TOASTED MALLOWS", rolling slowly down the street
// beside the office with the band playing on its open roof deck: a guitarist singing at a mic, a bassist and a drummer
// behind his kit on a riser, all bouncing to the beat, the stage lights flashing, music notes rising off the speakers
// and sparks spraying from the deck's corners now and then, a riff and drums blasting out of it. It honks as it slows
// to pass. The cars behind it wait (streetTraffic.ts).
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { loop, placeAt, play, type Loop } from '../../../ui/eventSfx';
import { SANS } from '../../draw';
import { EVENT_HAZE, hazed, TOON_RAMP } from '../../haze';
import { seeded } from '../../../../../shared/worldEvents';
import { glowOut, inOut, type SceneProps } from '../kit';
import { ball, box, capsule, cone, cyl, glowing, groundSquare, model, Notes, painted, part, shadowMaterial, signTexture, Sparks, spinWheels, wheelGeometry, type V3 } from '../streetKit';
import { ROAD_Y, routeAt, streetRoute, STREET_SIZE, type Pose } from '../streetPath';
import { holdOf, holdStreet, type Hold } from '../streetTraffic';

const { w: W, len: L } = STREET_SIZE.rockbus;
const BODY = { y0: 0.42, h: 2.6 };
const DECK = BODY.y0 + BODY.h;
const WHEEL_R = 0.5;
const WHEELS: V3[] = [-1, 1].flatMap((x) => [3.6, -2.5, -3.75].map((z): V3 => [x * 1.12, WHEEL_R, z]));
const BPM = 140;
const LIGHTS = [-0.8, -0.27, 0.27, 0.8];
const LIGHT_COLORS = ['#ff006e', '#8338ec', '#3a86ff', '#ffbe0b', '#fb5607'].map((c) => new THREE.Color(c));
const SPEAKERS: V3[] = [
  [-0.85, DECK + 1.0, 4.6],
  [0.85, DECK + 1.0, 4.6],
  [-0.85, DECK + 1.3, -4.7],
  [0.85, DECK + 1.3, -4.7],
];

/** The bus's sides: the band's name over flames and lightning, a row of dark windows along the top. */
function paintSide(ctx: CanvasRenderingContext2D) {
  const [w, h] = [1024, 256];
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#3a0ca3');
  g.addColorStop(0.5, '#7209b7');
  g.addColorStop(1, '#3a0ca3');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#141b2d';
  ctx.fillRect(0, 16, w, 70);
  for (let x = 0; x < w; x += 128) {
    ctx.fillStyle = '#3a0ca3';
    ctx.fillRect(x, 16, 10, 70);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.moveTo(x + 24, 86);
    ctx.lineTo(x + 56, 16);
    ctx.lineTo(x + 72, 16);
    ctx.lineTo(x + 40, 86);
    ctx.fill();
  }
  ctx.fillStyle = '#1b0b3a';
  ctx.fillRect(0, h - 22, w, 22);
  // flames licking up from the skirt at both ends, trailing back
  for (const dir of [1, -1]) {
    const x0 = dir > 0 ? 0 : w;
    for (const [color, k] of [
      ['#e85d04', 1],
      ['#ffba08', 0.55],
    ] as const) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x0, h - 22);
      const n = 8;
      const seg = 300 / n;
      for (let i = 0; i < n; i++) {
        const xa = x0 + dir * i * seg;
        const tall = (115 - i * 10) * k;
        ctx.quadraticCurveTo(xa + dir * seg * 0.1, h - 22 - tall * 0.6, xa + dir * seg * 1.2, h - 22 - tall);
        ctx.quadraticCurveTo(xa + dir * seg * 0.6, h - 22 - tall * 0.4, xa + dir * seg, h - 22);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  const bolt = (x: number, y: number, s: number) => {
    ctx.fillStyle = '#ffd23f';
    ctx.strokeStyle = '#1b0b3a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    [[0, -1.6], [0.7, -1.6], [0.2, -0.3], [0.8, -0.3], [-0.4, 1.6], [0, 0.2], [-0.6, 0.2]].forEach(([a, b], i) => (i ? ctx.lineTo(x + a * s, y + b * s) : ctx.moveTo(x + a * s, y + b * s)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };
  bolt(150, 130, 26);
  bolt(874, 130, 26);
  ctx.fillStyle = '#ffffff';
  for (const [x, y, s] of [[260, 104, 5], [770, 112, 6], [330, 214, 4], [690, 210, 5], [512, 100, 4]]) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const r = i % 2 ? s * 0.45 : s;
      ctx.lineTo(x + Math.cos(a) * r * 2, y + Math.sin(a) * r * 2);
    }
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 58px ${SANS}, sans-serif`;
  ctx.lineWidth = 10;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1b0b3a';
  ctx.strokeText('THE TOASTED MALLOWS', w / 2, 152);
  ctx.fillStyle = '#ffd23f';
  ctx.fillText('THE TOASTED MALLOWS', w / 2, 152);
  ctx.font = `bold 26px ${SANS}, sans-serif`;
  ctx.fillStyle = '#ff9ff3';
  ctx.fillText('★  WORLD TOUR  ★', w / 2, 206);
}

/** A rocker standing on the deck, feet at the origin, facing +z, with a guitar (or a bass) across them. */
function rocker(o: { shirt: string; pants: string; skin: string; hair: string; mohawk?: boolean; body: string; neck: number }): THREE.BufferGeometry {
  const parts = [
    ...[-1, 1].flatMap((x) => [part(box(0.16, 0.82, 0.18), o.pants, { at: [x * 0.11, 0.41, 0] }), part(box(0.18, 0.12, 0.28), '#111111', { at: [x * 0.11, 0.06, 0.04] })]),
    part(capsule(0.22, 0.38), o.shirt, { at: [0, 1.13, 0], scale: [1, 1, 0.8] }),
    part(ball(0.2, 14, 10), o.skin, { at: [0, 1.63, 0] }),
    part(box(0.3, 0.06, 0.05), '#111111', { at: [0, 1.66, 0.18] }),
    // arms: the left hand up the neck, the right across to strum
    part(capsule(0.065, 0.42), o.skin, { at: [-0.3, 1.14, 0.12], rot: [-0.9, 0, -0.35] }),
    part(capsule(0.065, 0.42), o.skin, { at: [0.14, 1.06, 0.2], rot: [-1.2, 0, 1.0] }),
    // the guitar: a body, its neck to the upper left, the headstock
    part(ball(0.22, 12, 8), o.body, { at: [0.06, 0.97, 0.24], scale: [1.2, 1, 0.3] }),
    part(ball(0.16, 12, 8), o.body, { at: [-0.04, 1.12, 0.24], scale: [1.1, 1, 0.3] }),
    part(box(0.12, 0.1, 0.02), '#f1faee', { at: [0.1, 0.95, 0.31] }),
    part(box(o.neck, 0.06, 0.04), '#6b4a33', { at: [-0.12 - o.neck / 2, 1.2, 0.26], rot: [0, 0, 0.38] }),
    part(box(0.14, 0.06, 0.03), '#222222', { at: [-0.14 - o.neck * 0.95, 1.21 + o.neck * 0.37, 0.26], rot: [0, 0, 0.38] }),
  ];
  if (o.mohawk) for (const z of [-0.12, -0.06, 0, 0.06, 0.12]) parts.push(part(cone(0.05, 0.24, 6), o.hair, { at: [0, 1.87, z] }));
  else parts.push(part(ball(0.215, 14, 10), o.hair, { at: [0, 1.69, -0.03], scale: [1, 0.85, 1] }), part(box(0.36, 0.44, 0.12), o.hair, { at: [0, 1.45, -0.14] }));
  return model(parts);
}

/** The drummer, sitting on his stool (the origin), facing +z; his arms are drawn apart, to drum. */
function drummer(): THREE.BufferGeometry {
  const pants = '#22223b';
  return model([
    ...[-1, 1].flatMap((x) => [
      part(box(0.17, 0.17, 0.46), pants, { at: [x * 0.13, 0.05, 0.2] }),
      part(box(0.15, 0.46, 0.16), pants, { at: [x * 0.13, -0.18, 0.42] }),
      part(box(0.17, 0.11, 0.26), '#111111', { at: [x * 0.13, -0.41, 0.47] }),
    ]),
    part(capsule(0.23, 0.36), '#f1faee', { at: [0, 0.47, 0], scale: [1, 1, 0.8] }),
    part(ball(0.2, 14, 10), '#e0ac69', { at: [0, 0.97, 0] }),
    part(box(0.42, 0.06, 0.42), '#e63946', { at: [0, 1.06, 0] }),
    part(box(0.32, 0.03, 0.18), '#e63946', { at: [0, 1.04, 0.24] }),
  ]);
}

/** One of the drummer's arms with its stick, hanging from the shoulder (the origin), reaching forward. */
const drumArm = () =>
  model([
    part(capsule(0.06, 0.4), '#e0ac69', { at: [0, -0.12, 0.18], rot: [1.1, 0, 0] }),
    part(cyl(0.013, 0.013, 0.42, 5), '#f4e3c1', { at: [0, -0.22, 0.52], rot: [1.75, 0, 0] }),
  ]);

/** The bus but for its painted sides: the deck, its railing, speakers, drums, the mic, the amp, the light truss. `os` is the office's side (-1 right, 1 left). */
function busModel(os: number): THREE.BufferGeometry {
  const chrome = '#cfd4dc';
  const dark = '#1b1b22';
  const glass = '#1d2a3f';
  const parts: THREE.BufferGeometry[] = [
    part(box(W - 0.02, BODY.h, L), '#5a189a', { at: [0, BODY.y0 + BODY.h / 2, 0] }),
    part(box(W, 0.06, L), '#2b2d42', { at: [0, DECK + 0.03, 0] }),
    part(box(2.2, 1.15, 0.05), glass, { at: [0, 2.05, L / 2 + 0.02] }),
    part(box(1.8, 0.34, 0.05), '#111111', { at: [0, 2.82, L / 2 + 0.02] }),
    part(box(1.4, 0.45, 0.05), '#3a3d4a', { at: [0, 1.05, L / 2 + 0.02] }),
    part(box(2.0, 0.8, 0.05), glass, { at: [0, 2.3, -L / 2 - 0.02] }),
    ...[1, -1].map((z) => part(box(2.6, 0.28, 0.3), '#2a2b33', { at: [0, 0.55, (z * L) / 2 + z * 0.06] })),
    ...[-1, 1].flatMap((x) => [part(box(0.08, 0.32, 0.2), '#2a2b33', { at: [x * 1.47, 2.25, L / 2 - 0.3] }), part(box(0.26, 0.04, 0.04), '#2a2b33', { at: [x * 1.35, 2.38, L / 2 - 0.3] })]),
    // the railing round the deck
    ...[-1, 1].flatMap((x) => [-5.3, -3.5, -1.75, 0, 1.75, 3.5, 5.3].map((z) => part(cyl(0.035, 0.035, 1, 5), chrome, { at: [x * 1.18, DECK + 0.5, z] }))),
    ...[-1, 1].flatMap((x) => [0.5, 1].map((y) => part(box(0.05, 0.05, 10.6), chrome, { at: [x * 1.18, DECK + y, 0] }))),
    ...[-1, 1].map((z) => part(box(2.36, 0.05, 0.05), chrome, { at: [0, DECK + 1, z * 5.3] })),
    // speakers at the corners, their cones facing out to the street
    ...SPEAKERS.flatMap(([x, , z], i) => {
      const h = i < 2 ? 0.9 : 1.2;
      const r = i < 2 ? 0.2 : 0.25;
      const side = Math.sign(x);
      return [
        part(box(0.7, h, 0.6), dark, { at: [x, DECK + h / 2 + 0.06, z] }),
        ...[0.27, -0.12].slice(0, i < 2 ? 1 : 2).flatMap((dy) => [
          part(cyl(r, r, 0.04, 14), '#55555f', { at: [x + side * 0.36, DECK + h / 2 + 0.06 + dy * (h / 1.2), z], rot: [0, 0, Math.PI / 2] }),
          part(cyl(0.07, 0.07, 0.06, 8), '#9a9aa5', { at: [x + side * 0.38, DECK + h / 2 + 0.06 + dy * (h / 1.2), z], rot: [0, 0, Math.PI / 2] }),
        ]),
      ];
    }),
    // the drum riser and the kit on it, the drummer's stool behind
    part(box(2.0, 0.3, 1.9), '#7209b7', { at: [0, DECK + 0.21, -3.1] }),
    part(cyl(0.34, 0.34, 0.36, 16), '#f1faee', { at: [0, DECK + 0.7, -2.75], rot: [Math.PI / 2, 0, 0] }),
    part(cyl(0.2, 0.2, 0.37, 14), '#e63946', { at: [0, DECK + 0.7, -2.75], rot: [Math.PI / 2, 0, 0] }),
    part(cyl(0.2, 0.2, 0.14, 14), '#e9ecef', { at: [0.42, DECK + 0.98, -3.05] }),
    ...[-0.18, 0.18].map((x) => part(cyl(0.16, 0.16, 0.18, 12), '#e63946', { at: [x, DECK + 1.2, -2.85], rot: [0.4, 0, 0] })),
    part(cyl(0.2, 0.2, 0.36, 12), '#e63946', { at: [-0.52, DECK + 0.6, -3.1] }),
    ...(
      [
        [-0.62, 1.5, -2.7, 0.28],
        [0.68, 1.4, -2.75, 0.26],
        [0.72, 1.2, -3.25, 0.18],
      ] as const
    ).flatMap(([x, y, z, r]) => [part(cyl(r, r, 0.015, 16), '#e9c46a', { at: [x, DECK + y, z], rot: [0, 0, 0.18] }), part(cyl(0.015, 0.015, y - 0.2, 4), '#adb5bd', { at: [x, DECK + 0.3 + (y - 0.4) / 2, z] })]),
    part(cyl(0.18, 0.18, 0.45, 10), '#222222', { at: [0, DECK + 0.58, -3.65] }),
    // the singer's mic, towards the office, and the amp behind him
    part(cyl(0.18, 0.18, 0.03, 12), '#adb5bd', { at: [os * 0.45, DECK + 0.08, 3.0] }),
    part(cyl(0.015, 0.015, 1.45, 5), '#adb5bd', { at: [os * 0.45, DECK + 0.8, 3.0] }),
    part(ball(0.055, 8, 6), '#333333', { at: [os * 0.4, DECK + 1.55, 3.0] }),
    part(box(0.75, 0.65, 0.4), dark, { at: [-os * 0.75, DECK + 0.39, 1.6] }),
    part(box(0.6, 0.45, 0.02), '#4a4a55', { at: [-os * 0.75, DECK + 0.39, 1.81] }),
    part(box(0.6, 0.05, 0.02), '#e9c46a', { at: [-os * 0.75, DECK + 0.66, 1.81] }),
    // the light truss over the front of the deck, its lamps' housings
    ...[-1, 1].map((x) => part(cyl(0.04, 0.04, 1.5, 6), '#555555', { at: [x * 1.12, DECK + 1.75, 5.0] })),
    part(box(2.3, 0.07, 0.07), '#555555', { at: [0, DECK + 2.5, 5.0] }),
    ...LIGHTS.map((x) => part(cyl(0.11, 0.14, 0.22, 8), '#222222', { at: [x, DECK + 2.35, 5.0] })),
  ];
  return model(parts);
}

/** Its lamps: headlights, tail lights, the destination sign and amber markers along the top of its sides. */
const lampsModel = () =>
  model([
    ...[-1, 1].map((x) => part(box(0.38, 0.22, 0.04), '#fff3c4', { at: [x * 0.85, 0.98, L / 2 + 0.05] })),
    ...[-1, 1].map((x) => part(box(0.3, 0.3, 0.04), '#ff2d2d', { at: [x * 1.0, 1.0, -L / 2 - 0.05] })),
    part(box(1.6, 0.22, 0.03), '#ffd23f', { at: [0, 2.82, L / 2 + 0.05] }),
    ...[-1, 1].flatMap((x) => [-4.5, -2.25, 0, 2.25, 4.5].map((z) => part(box(0.04, 0.08, 0.16), '#ff9f1c', { at: [x * (W / 2 + 0.02), DECK - 0.12, z] }))),
  ]);

/** Both painted sides as one geometry, each reading left to right from outside. */
function sidesGeometry(): THREE.BufferGeometry {
  const y = BODY.y0 + BODY.h / 2;
  return model([
    part(new THREE.PlaneGeometry(L, BODY.h).rotateY(Math.PI / 2), '#ffffff', { at: [W / 2 + 0.006, y, 0] }),
    part(new THREE.PlaneGeometry(L, BODY.h).rotateY(-Math.PI / 2), '#ffffff', { at: [-W / 2 - 0.006, y, 0] }),
  ]);
}

const tmp = { c: new THREE.Color(), m: new THREE.Matrix4() };

export default function RockBus({ run, elevation }: SceneProps) {
  const camera = useThree((s) => s.camera);
  const bus = useRef<THREE.Group>(null);
  const guitarist = useRef<THREE.Mesh>(null);
  const bassist = useRef<THREE.Mesh>(null);
  const drums = useRef<THREE.Group>(null);
  const arms = useRef<THREE.Group>(null);
  const r = useMemo(() => streetRoute('rockbus', run.side, seeded(run.seed)()), [run.seed, run.side]);
  // the office is on the right of a bus in the near lane (heading north on the west street), on its left in the far one
  const os = (run.side === 'west') === r.dir < 0 ? -1 : 1;
  const parts = useMemo(() => {
    const map = signTexture(1024, 256, paintSide);
    const sides = { geo: sidesGeometry(), mat: hazed(new THREE.MeshToonMaterial({ map, gradientMap: TOON_RAMP }), EVENT_HAZE) };
    const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), glowOut('#ffffff'), LIGHTS.length);
    LIGHTS.forEach((x, i) => {
      lights.setMatrixAt(i, tmp.m.makeTranslation(x, DECK + 2.22, 5.0));
      lights.setColorAt(i, LIGHT_COLORS[i]);
    });
    return {
      map,
      sides,
      body: busModel(os),
      lamps: lampsModel(),
      wheel: wheelGeometry(WHEEL_R, 0.36),
      guitarist: rocker({ shirt: '#111111', pants: '#22223b', skin: '#f1c27d', hair: '#2b1d0e', body: '#d62828', neck: 0.5 }),
      bassist: rocker({ shirt: '#e63946', pants: '#3d405b', skin: '#c68642', hair: '#ff4d9d', mohawk: true, body: '#3a86ff', neck: 0.66 }),
      drummer: drummer(),
      arm: drumArm(),
      lights,
      notes: new Notes(14),
      sparks: new Sparks(48),
      emit: SPEAKERS.map(() => new THREE.Vector3()),
      fountains: [os, os].map((x, i): V3 => [x * 1.0, DECK + 0.1, i ? -4.9 : 4.9]),
    };
  }, [os]);
  useEffect(
    () => () => {
      parts.map.dispose();
      parts.sides.geo.dispose();
      parts.sides.mat.dispose();
      for (const g of [parts.body, parts.lamps, parts.wheel, parts.guitarist, parts.bassist, parts.drummer, parts.arm]) g.dispose();
      parts.lights.geometry.dispose();
      parts.lights.dispose();
      parts.notes.dispose();
      parts.sparks.dispose();
    },
    [parts],
  );
  const wheels = useRef<THREE.InstancedMesh>(null);
  const state = useMemo(() => ({ pose: { x: 0, z: 0, yaw: 0, speed: 0, u: 0 } as Pose, hold: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } as Hold, music: null as Loop | null, honked: false }), []);
  useEffect(() => {
    state.music = loop('rock');
    return () => {
      state.music?.stop(1.5);
      holdStreet(run.key, null);
    };
  }, [state, run.key]);

  useFrame(() => {
    const g = bus.current;
    if (!g) return;
    const t = run.t;
    const on = t < r.drive.seconds;
    g.visible = on;
    holdStreet(run.key, on ? holdOf('rockbus', r, t, state.hold) : null);
    const p = routeAt(r, t, state.pose);
    const beat = (t * BPM) / 60;
    const bounce = Math.abs(Math.sin(Math.PI * beat));
    g.position.set(p.x, ROAD_Y + bounce * 0.03, p.z);
    g.rotation.y = p.yaw;
    g.updateMatrix();
    if (wheels.current) spinWheels(wheels.current, WHEELS, p.u / WHEEL_R);
    // the band: the singer headbangs, the bassist bobs on the off-beat, the drummer's sticks come down in turn
    const face = (os * Math.PI) / 2;
    if (guitarist.current) {
      guitarist.current.position.set(-os * 0.1, DECK + 0.06 + bounce * 0.12 + (Math.floor(beat) % 16 === 15 ? Math.sin(Math.PI * (beat % 1)) * 0.35 : 0), 3.0);
      guitarist.current.rotation.set(Math.sin(Math.PI * 2 * beat) * 0.14, face * 0.8 + Math.sin(t * 0.7) * 0.25, 0);
    }
    if (bassist.current) {
      bassist.current.position.set(os * 0.15, DECK + 0.06 + Math.abs(Math.sin(Math.PI * (beat + 0.5))) * 0.1, 0.6);
      bassist.current.rotation.set(0.05, face * 0.7 + Math.sin(t * 0.9 + 1) * 0.3, Math.sin(Math.PI * beat) * 0.08);
    }
    if (drums.current) drums.current.position.y = DECK + 0.81 + bounce * 0.03;
    const sticks = arms.current?.children;
    if (sticks)
      for (let i = 0; i < sticks.length; i++) {
        const k = (beat * 2 + i * 0.5) % 1;
        sticks[i].rotation.x = -0.5 + Math.exp(-k * 6) * 0.9;
      }
    const flash = Math.floor(beat);
    LIGHTS.forEach((_, i) => {
      const lit = (flash + i) % 2 === 0;
      parts.lights.setColorAt(i, tmp.c.copy(LIGHT_COLORS[(Math.floor(beat / 2) + i) % LIGHT_COLORS.length]).multiplyScalar(lit ? 1 : 0.18));
    });
    if (parts.lights.instanceColor) parts.lights.instanceColor.needsUpdate = true;
    // notes off the speakers, sparks from the office-side corners for a few beats in every sixteen
    for (let i = 0; i < SPEAKERS.length; i++) parts.emit[i].set(...SPEAKERS[i]).applyMatrix4(g.matrix);
    parts.notes.update(t, parts.emit, camera.quaternion, on ? 1 : 0);
    parts.notes.mesh.visible = on;
    parts.sparks.update(t, parts.fountains, (born) => on && ((born * BPM) / 60) % 16 < 3);

    const heard = placeAt(p.x, ROAD_Y + DECK + 1 - elevation, p.z, 35);
    state.music?.set(heard.gain * inOut(t, run.seconds, 3) * (on ? 1 : 0), heard.pan);
    // a double honk as it slows down to pass
    if (!state.honked && p.u > 110) {
      state.honked = true;
      play('horn', { gain: heard.gain, pan: heard.pan });
      play('horn', { gain: heard.gain, pan: heard.pan, delay: 0.85 });
    }
  });

  const mat = painted();
  return (
    <group>
      <group ref={bus} matrixAutoUpdate={false}>
        <mesh geometry={parts.body} material={mat} />
        <mesh geometry={parts.sides.geo} material={parts.sides.mat} />
        <mesh geometry={parts.lamps} material={glowing()} />
        <instancedMesh ref={wheels} args={[parts.wheel, mat, WHEELS.length]} frustumCulled={false} />
        <mesh geometry={groundSquare()} material={shadowMaterial()} position={[0, 0.02, 0]} scale={[W + 0.9, 1, L + 1.2]} />
        <mesh ref={guitarist} geometry={parts.guitarist} material={mat} />
        <mesh ref={bassist} geometry={parts.bassist} material={mat} />
        <group ref={drums} position={[0, DECK + 0.81, -3.65]}>
          <mesh geometry={parts.drummer} material={mat} />
          <group ref={arms}>
            {[-1, 1].map((x) => (
              <mesh key={x} geometry={parts.arm} material={mat} position={[x * 0.26, 0.66, 0.02]} />
            ))}
          </group>
        </group>
        <primitive object={parts.lights} />
        <primitive object={parts.sparks.mesh} />
      </group>
      <primitive object={parts.notes.mesh} />
    </group>
  );
}
