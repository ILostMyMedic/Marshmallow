// A fire engine racing down the street beside the office near the middle of the road, red with a white band, a ladder
// on its back and two firefighters in yellow helmets up front, its lights flashing red and blue, its siren wailing
// (higher as it comes, lower as it goes) and its horn blaring at the junctions; the cars ahead of it pull over to the
// kerb, and the ones at the junctions wait (streetTraffic.ts).
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { loop, placeAt, play, type Loop } from '../../../ui/eventSfx';
import { listenerAt } from '../../../ui/sfx';
import { CITY, CORRIDOR_HALF } from '../../cityLayout';
import { seeded } from '../../../../../shared/worldEvents';
import { inOut, type SceneProps } from '../kit';
import { ball, box, cyl, glowing, groundSquare, model, painted, part, shadowMaterial, spinWheels, wheelGeometry, type V3 } from '../streetKit';
import { ROAD_Y, routeAt, streetRoute, STREET_SIZE, type Pose } from '../streetPath';
import { holdOf, holdStreet, type Hold } from '../streetTraffic';

const { w: W, len: L } = STREET_SIZE.firetruck;
const WHEEL_R = 0.52;
const WHEELS: V3[] = [-1, 1].flatMap((x) => [3.1, -2.35, -3.5].map((z): V3 => [x * 1.1, WHEEL_R, z]));
const RED = '#d62828';
const GLASS = '#1d2a3f';
/** The junctions either end of the office's block: it blares its horn coming up to them. */
const JUNCTIONS = [-1, 1].map((s) => s * (CITY.homeHalfZ + CORRIDOR_HALF));
const SOUND = 343;

function engineModel(): THREE.BufferGeometry {
  const chrome = '#dee2e6';
  return model([
    part(box(W, 2.0, 2.6), RED, { at: [0, 1.5, 3.4] }),
    part(box(W, 2.1, 6.8), RED, { at: [0, 1.55, -1.3] }),
    part(box(W + 0.02, 0.18, L + 0.02), '#f1faee', { at: [0, 1.05, 0] }),
    part(box(2.2, 0.8, 0.05), GLASS, { at: [0, 2.0, 4.71] }),
    ...[-1, 1].map((x) => part(box(0.05, 0.7, 1.6), GLASS, { at: [x * 1.26, 2.0, 3.5] })),
    part(box(1.4, 0.6, 0.05), '#adb5bd', { at: [0, 1.0, 4.72] }),
    part(box(2.6, 0.3, 0.32), chrome, { at: [0, 0.52, 4.78] }),
    part(box(2.6, 0.3, 0.3), '#6c757d', { at: [0, 0.52, -4.78] }),
    // the lockers along its sides, a hose reel at the back
    ...[-1, 1].flatMap((x) => [-3.8, -2.3, -0.8, 0.7].map((z) => part(box(0.03, 1.1, 1.3), '#b51f1f', { at: [x * 1.262, 1.65, z] }))),
    ...[-1, 1].map((x) => part(cyl(0.34, 0.34, 0.22, 14), '#ffd23f', { at: [x * 1.36, 1.7, -4.05], rot: [0, 0, Math.PI / 2] })),
    // the ladder on its back
    ...[-1, 1].map((x) => part(box(0.08, 0.1, 7.6), chrome, { at: [x * 0.45, 2.78, -0.8] })),
    ...Array.from({ length: 16 }, (_, i) => part(box(0.9, 0.05, 0.06), chrome, { at: [0, 2.78, -4.4 + i * 0.47] })),
    ...[-3.6, 1.8].flatMap((z) => [-1, 1].map((x) => part(box(0.1, 0.2, 0.1), '#6c757d', { at: [x * 0.45, 2.68, z] }))),
    // the light bar's housing, and the crew in the cab
    part(box(1.9, 0.14, 0.36), '#333333', { at: [0, 2.56, 3.6] }),
    ...[-1, 1].flatMap((x) => [part(ball(0.17, 10, 8), '#e0ac69', { at: [x * 0.52, 1.92, 3.75] }), part(ball(0.2, 10, 6), '#ffd23f', { at: [x * 0.52, 2.02, 3.72], scale: [1, 0.75, 1.15] })]),
  ]);
}

const lampsModel = () =>
  model([
    ...[-1, 1].map((x) => part(box(0.36, 0.22, 0.04), '#fff3c4', { at: [x * 0.85, 0.92, 4.75] })),
    ...[-1, 1].map((x) => part(box(0.28, 0.3, 0.04), '#ff2d2d', { at: [x * 1.0, 1.0, -4.76] })),
  ]);

/** One colour's flashers: two on the light bar, one at a back corner, one in the grille. */
const flashers = (color: string, x: number) =>
  model([
    part(box(0.4, 0.14, 0.32), color, { at: [x * 0.65, 2.68, 3.6] }),
    part(box(0.4, 0.14, 0.32), color, { at: [-x * 0.15, 2.68, 3.6] }),
    part(box(0.18, 0.18, 0.12), color, { at: [x * 1.1, 2.72, -4.65] }),
    part(box(0.2, 0.12, 0.05), color, { at: [x * 0.55, 1.0, 4.75] }),
  ]);

export default function FireTruck({ run, elevation }: SceneProps) {
  const engine = useRef<THREE.Group>(null);
  const red = useRef<THREE.Mesh>(null);
  const blue = useRef<THREE.Mesh>(null);
  const wheels = useRef<THREE.InstancedMesh>(null);
  const r = useMemo(() => streetRoute('firetruck', run.side, seeded(run.seed)()), [run.seed, run.side]);
  const parts = useMemo(() => ({ body: engineModel(), lamps: lampsModel(), red: flashers('#ff1f3d', -1), blue: flashers('#2f6bff', 1), wheel: wheelGeometry(WHEEL_R, 0.38) }), []);
  useEffect(() => () => Object.values(parts).forEach((g) => g.dispose()), [parts]);
  const state = useMemo(
    () => ({ pose: { x: 0, z: 0, yaw: 0, speed: 0, u: 0 } as Pose, hold: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } as Hold, siren: null as Loop | null, diesel: null as Loop | null, honked: new Set<number>(), dist: -1, pitch: 1 }),
    [],
  );
  useEffect(() => {
    state.siren = loop('siren');
    state.diesel = loop('diesel');
    return () => {
      state.siren?.stop(0.8);
      state.diesel?.stop(0.8);
      holdStreet(run.key, null);
    };
  }, [state, run.key]);

  useFrame((_, delta) => {
    const g = engine.current;
    if (!g) return;
    const t = run.t;
    const on = t < r.drive.seconds;
    g.visible = on;
    holdStreet(run.key, on ? holdOf('firetruck', r, t, state.hold) : null);
    const p = routeAt(r, t, state.pose);
    g.position.set(p.x, ROAD_Y, p.z);
    g.rotation.y = p.yaw;
    if (wheels.current) spinWheels(wheels.current, WHEELS, p.u / WHEEL_R);
    // wig-wag: two red flashes, then two blue
    const phase = (t * 1.6) % 1;
    const blink = (phase * 4) % 1 < 0.55;
    if (red.current) red.current.visible = phase < 0.5 && blink;
    if (blue.current) blue.current.visible = phase >= 0.5 && blink;

    const y = ROAD_Y + 2.5 - elevation;
    const heard = placeAt(p.x, y, p.z, 40);
    // the siren higher coming towards you, lower going away (how fast it's closing, smoothed)
    const ear = listenerAt();
    const dist = Math.hypot(p.x - ear.x, y - ear.y, p.z - ear.z);
    if (state.dist >= 0 && delta > 0) {
      const closing = (state.dist - dist) / Math.min(delta, 0.1);
      const want = Math.min(1.12, Math.max(0.88, SOUND / (SOUND - closing)));
      state.pitch += (want - state.pitch) * Math.min(1, delta * 6);
    }
    state.dist = dist;
    const fade = inOut(t, run.seconds, 2) * (on ? 1 : 0);
    state.siren?.set(heard.gain * fade, heard.pan, state.pitch);
    state.diesel?.set(heard.gain * fade * 0.8, heard.pan, 1.5);
    for (const j of JUNCTIONS) {
      const ahead = (j - p.z) * r.dir;
      if (on && ahead > 0 && ahead < 30 && !state.honked.has(j)) {
        state.honked.add(j);
        play('horn', { gain: heard.gain, pan: heard.pan });
        play('horn', { gain: heard.gain, pan: heard.pan, delay: 0.6 });
      }
    }
  });

  const mat = painted();
  return (
    <group ref={engine}>
      <mesh geometry={parts.body} material={mat} />
      <mesh geometry={parts.lamps} material={glowing()} />
      <mesh ref={red} geometry={parts.red} material={glowing()} />
      <mesh ref={blue} geometry={parts.blue} material={glowing()} />
      <instancedMesh ref={wheels} args={[parts.wheel, mat, WHEELS.length]} frustumCulled={false} />
      <mesh geometry={groundSquare()} material={shadowMaterial()} position={[0, 0.02, 0]} scale={[W + 0.8, 1, L + 1]} />
    </group>
  );
}
