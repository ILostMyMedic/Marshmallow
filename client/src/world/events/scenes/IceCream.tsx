// An ice cream truck: cream and pink with icing dripping down its sides, a giant cone of three scoops turning slowly
// on its roof, "ICE CREAM" along it, its music box jingle tinkling from the horn on its cab (the notes floating off it).
// It rolls down the street beside the office, pulls over at the kerb outside for a while with a ding of its bell, its
// bulbs lit under the awning, and drives off.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { loop, placeAt, play, type Loop } from '../../../ui/eventSfx';
import { SANS } from '../../draw';
import { EVENT_HAZE, hazed, TOON_RAMP } from '../../haze';
import { seeded } from '../../../../../shared/worldEvents';
import { inOut, type SceneProps } from '../kit';
import { ball, box, capsule, cone, cyl, glowing, groundSquare, model, Notes, painted, part, shadowMaterial, signTexture, spinWheels, wheelGeometry, type V3 } from '../streetKit';
import { ROAD_Y, routeAt, streetRoute, STREET_SIZE, type Pose } from '../streetPath';
import { holdOf, holdStreet, type Hold } from '../streetTraffic';

const { w: W, len: L } = STREET_SIZE.icecream;
const WHEEL_R = 0.42;
const WHEELS: V3[] = [-1, 1].flatMap((x) => [2.2, -2.0].map((z): V3 => [x * 1.02, WHEEL_R, z]));
const CREAM = '#fdf6ec';
const PINK = '#ff8fab';
const GLASS = '#1d2a3f';
const HORN: V3 = [0, 2.55, 2.75];
// the serving window is on its right (-x), the kerb's side
const WIN = { y: 1.65, z: -0.9 };

function paintSign(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 96);
  ctx.strokeStyle = PINK;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 502, 86);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 60px ${SANS}, sans-serif`;
  ctx.fillStyle = '#e5386d';
  ctx.fillText('ICE CREAM', 256, 52);
}

/** The truck, facing +z: its box body with the window and the striped awning, the cab, the horn on the cab's roof. */
function truckModel(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    part(box(2.3, 2.3, 4.6), CREAM, { at: [0, 1.6, -1.0] }),
    part(box(2.32, 0.5, 4.62), PINK, { at: [0, 0.72, -1.0] }),
    part(box(2.34, 0.22, 4.64), PINK, { at: [0, 2.66, -1.0] }),
    // icing dripping down from the band along the top
    ...[-1, 1].flatMap((x) => Array.from({ length: 10 }, (_, i) => part(capsule(0.07, 0.12 + (i % 3) * 0.08), PINK, { at: [x * 1.168, 2.48 - (i % 3) * 0.04, -3.1 + i * 0.47] }))),
    part(box(2.2, 1.6, 2.0), CREAM, { at: [0, 1.25, 2.3] }),
    part(box(2.22, 0.36, 2.02), PINK, { at: [0, 0.68, 2.3] }),
    part(box(1.9, 0.7, 0.05), GLASS, { at: [0, 1.65, 3.31] }),
    ...[-1, 1].map((x) => part(box(0.05, 0.6, 1.0), GLASS, { at: [x * 1.105, 1.65, 2.4] })),
    part(box(1.2, 0.35, 0.05), '#c0c0c8', { at: [0, 0.9, 3.31] }),
    ...[1, -1].map((z) => part(box(2.32, 0.22, 0.25), '#9a9aa5', { at: [0, 0.5, z * 3.32] })),
    part(box(1.9, 0.7, 0.05), GLASS, { at: [0, 1.9, -3.32] }),
    // the serving window and its counter, and the awning over them, striped
    part(box(0.04, 0.8, 1.8), '#3b2f2f', { at: [-1.16, WIN.y, WIN.z] }),
    part(box(0.32, 0.06, 1.9), PINK, { at: [-1.3, WIN.y - 0.42, WIN.z] }),
    ...Array.from({ length: 6 }, (_, k) => part(box(0.75, 0.04, 0.32), k % 2 ? '#ffffff' : '#ff4d6d', { at: [-1.5, WIN.y + 0.62, WIN.z - 0.8 + k * 0.32], rot: [0, 0, 0.3] })),
    // the horn its jingle plays from
    part(cyl(0.04, 0.04, 0.3, 6), '#9a9aa5', { at: [0, 2.2, 2.75] }),
    part(cone(0.2, 0.42, 12), '#c0c0c8', { at: [0, 2.4, 2.9], rot: [-Math.PI / 2, 0, 0] }),
  ];
  return model(parts);
}

/** The cone on the roof: a waffle cone, strawberry, mint and chocolate scoops and a cherry; its axis at the origin. */
const coneModel = () =>
  model([
    part(cone(0.45, 1.1, 12), '#e9b872', { at: [0, 0.55, 0], rot: [Math.PI, 0, 0] }),
    part(ball(0.47, 14, 10), PINK, { at: [0, 1.18, 0] }),
    part(ball(0.42, 14, 10), '#b5e48c', { at: [0.05, 1.72, 0.02] }),
    part(ball(0.37, 14, 10), '#7b4b2a', { at: [-0.03, 2.2, -0.02] }),
    part(ball(0.12, 8, 6), '#d62828', { at: [0, 2.6, 0] }),
  ]);

const lampsModel = () =>
  model([
    ...[-1, 1].map((x) => part(box(0.32, 0.2, 0.04), '#fff3c4', { at: [x * 0.75, 0.95, 3.34] })),
    ...[-1, 1].map((x) => part(box(0.26, 0.26, 0.04), '#ff2d2d', { at: [x * 0.95, 0.95, -3.35] })),
    ...Array.from({ length: 6 }, (_, k) => part(ball(0.06, 6, 4), ['#ffd23f', '#4cc9f0', '#ff4d6d'][k % 3], { at: [-1.86, WIN.y + 0.5, WIN.z - 0.8 + k * 0.32] })),
  ]);

/** The sign along its left side (the window and the awning are on its right) and over the cab. */
function signGeometry(): THREE.BufferGeometry {
  return model([
    part(new THREE.PlaneGeometry(3.6, 0.68).rotateY(Math.PI / 2), '#ffffff', { at: [1.158, 2.0, -1.0] }),
    part(new THREE.PlaneGeometry(1.9, 0.36), '#ffffff', { at: [0, 2.38, 1.31] }),
  ]);
}

export default function IceCream({ run, elevation }: SceneProps) {
  const camera = useThree((s) => s.camera);
  const truck = useRef<THREE.Group>(null);
  const scoops = useRef<THREE.Mesh>(null);
  const wheels = useRef<THREE.InstancedMesh>(null);
  const r = useMemo(() => streetRoute('icecream', run.side, seeded(run.seed)()), [run.seed, run.side]);
  const parts = useMemo(() => {
    const map = signTexture(512, 96, paintSign);
    return {
      body: truckModel(),
      cone: coneModel(),
      lamps: lampsModel(),
      wheel: wheelGeometry(WHEEL_R, 0.3),
      sign: { geo: signGeometry(), map, mat: hazed(new THREE.MeshToonMaterial({ map, gradientMap: TOON_RAMP }), EVENT_HAZE) },
      notes: new Notes(8, 2.6),
      emit: [new THREE.Vector3()],
    };
  }, []);
  useEffect(
    () => () => {
      for (const g of [parts.body, parts.cone, parts.lamps, parts.wheel, parts.sign.geo]) g.dispose();
      parts.sign.map.dispose();
      parts.sign.mat.dispose();
      parts.notes.dispose();
    },
    [parts],
  );
  const state = useMemo(() => ({ pose: { x: 0, z: 0, yaw: 0, speed: 0, u: 0 } as Pose, hold: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } as Hold, jingle: null as Loop | null, diesel: null as Loop | null, stopped: false }), []);
  useEffect(() => {
    state.jingle = loop('jingle');
    state.diesel = loop('diesel');
    return () => {
      state.jingle?.stop(1);
      state.diesel?.stop(1);
      holdStreet(run.key, null);
    };
  }, [state, run.key]);

  useFrame(() => {
    const g = truck.current;
    if (!g) return;
    const t = run.t;
    const on = t < r.drive.seconds;
    g.visible = on;
    parts.notes.mesh.visible = on;
    holdStreet(run.key, on ? holdOf('icecream', r, t, state.hold) : null);
    const p = routeAt(r, t, state.pose);
    g.position.set(p.x, ROAD_Y, p.z);
    g.rotation.y = p.yaw;
    g.updateMatrix();
    if (wheels.current) spinWheels(wheels.current, WHEELS, p.u / WHEEL_R);
    if (scoops.current) scoops.current.rotation.y = t * 0.9;
    parts.emit[0].set(HORN[0], HORN[1] + 0.1, HORN[2] + 0.4).applyMatrix4(g.matrix);
    parts.notes.update(t, parts.emit, camera.quaternion, on ? 0.7 : 0);

    const heard = placeAt(p.x, ROAD_Y + 2.5 - elevation, p.z, 35);
    const fade = inOut(t, run.seconds, 3) * (on ? 1 : 0);
    state.jingle?.set(heard.gain * fade, heard.pan);
    state.diesel?.set(heard.gain * fade * (0.35 + Math.min(1, p.speed / 7) * 0.45), heard.pan, 0.85 + p.speed / 14);
    // a ding of the bell as it pulls up
    const parked = on && p.speed === 0 && t > 1;
    if (parked && !state.stopped) {
      play('bell', { gain: heard.gain, pan: heard.pan });
      play('bell', { gain: heard.gain, pan: heard.pan, delay: 0.35 });
    }
    state.stopped = parked;
  });

  const mat = painted();
  return (
    <group>
      <group ref={truck} matrixAutoUpdate={false}>
        <mesh geometry={parts.body} material={mat} />
        <mesh geometry={parts.sign.geo} material={parts.sign.mat} />
        <mesh ref={scoops} geometry={parts.cone} material={mat} position={[0, 2.77, -1.0]} />
        <mesh geometry={parts.lamps} material={glowing()} />
        <instancedMesh ref={wheels} args={[parts.wheel, mat, WHEELS.length]} frustumCulled={false} />
        <mesh geometry={groundSquare()} material={shadowMaterial()} position={[0, 0.02, 0]} scale={[W + 0.8, 1, L + 1]} />
      </group>
      <primitive object={parts.notes.mesh} />
    </group>
  );
}
