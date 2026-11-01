// A food truck: teal with an orange band, a giant burger on its roof and a menu on its side. It pulls over at the kerb
// on the office's side of the street, lifts its striped awning on a lit kitchen with the cook at the griddle (sizzling,
// steam rising from the chimney), dings its bell, and a queue forms on the plaza: people walk up one by one, wait their
// turn, are served with a ding and walk off with their food. Then it shuts up shop and drives off.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { loop, placeAt, play, type Loop } from '../../../ui/eventSfx';
import { seeded } from '../../../../../shared/worldEvents';
import { clamp01, inOut, smooth, toonOut, type SceneProps } from '../kit';
import { ball, box, capsule, Crowd, cyl, glowing, groundSquare, looks, model, painted, part, shadowMaterial, spinWheels, wheelGeometry, type V3 } from '../streetKit';
import { PLAZA, ROAD_Y, routeAt, stopOf, streetRoute, STREET_SIZE, type Pose } from '../streetPath';
import { holdOf, holdStreet, type Hold } from '../streetTraffic';

const { w: W, len: L } = STREET_SIZE.foodtruck;
const WHEEL_R = 0.42;
const WHEELS: V3[] = [-1, 1].flatMap((x) => [2.5, -2.4].map((z): V3 => [x * 1.02, WHEEL_R, z]));
const TEAL = '#2a9d8f';
const ORANGE = '#f4a261';
const GLASS = '#1d2a3f';
/** The hatch on its right side (-x): from y0 to y1 up, along z centred at z, len long. */
const HATCH = { y0: 1.35, y1: 2.35, z: -1.1, len: 2.7 };
/** Fully open, the awning's swung up and out this far (radians about its hinge). */
const OPEN = -1.9;
const PEOPLE = 6;
/** When (seconds after it stops) each customer turns up, and is served. */
const arrives = (k: number) => 1.5 + 3 * k;
const served = (k: number) => 8 + 4.5 * k;
const WALK = 1.3;
/** Across from its right side: where the queue stands, the lane people walk up in, and the one they leave by. */
const QUEUE_X = W / 2 + 0.95;
const IN_X = W / 2 + 1.9;
const OUT_X = W / 2 + 2.9;
/** How far behind the hatch people come from and go to (along the truck). */
const BACK = -11;

function truckModel(): THREE.BufferGeometry {
  const z = HATCH.z;
  const wallZ = 5.0;
  return model([
    part(box(2.3, 0.08, wallZ), '#3b3b3b', { at: [0, 0.49, z] }),
    part(box(2.36, 0.1, wallZ + 0.06), '#264653', { at: [0, 2.9, z] }),
    part(box(0.06, 2.4, wallZ), TEAL, { at: [1.12, 1.65, z] }),
    // the right wall round the hatch
    part(box(0.06, HATCH.y0 - 0.45, wallZ), TEAL, { at: [-1.12, (HATCH.y0 + 0.45) / 2, z] }),
    part(box(0.06, 2.85 - HATCH.y1, wallZ), TEAL, { at: [-1.12, (HATCH.y1 + 2.85) / 2, z] }),
    ...[-1, 1].map((s) => part(box(0.06, HATCH.y1 - HATCH.y0, (wallZ - HATCH.len) / 2), TEAL, { at: [-1.12, (HATCH.y0 + HATCH.y1) / 2, z + s * (HATCH.len / 2 + (wallZ - HATCH.len) / 4)] })),
    ...[1, -1].map((s) => part(box(2.3, 2.4, 0.06), TEAL, { at: [0, 1.65, z + (s * wallZ) / 2 - s * 0.03] })),
    ...[-1, 1].map((x) => part(box(0.02, 0.3, wallZ), ORANGE, { at: [x * 1.16, 0.85, z] })),
    // inside: the griddle along the far wall; outside: the counter, its sauces, the menu
    part(box(0.5, 0.9, 2.6), '#adb5bd', { at: [0.85, 0.95, z] }),
    part(box(0.48, 0.03, 2.5), '#343a40', { at: [0.85, 1.41, z] }),
    part(box(0.36, 0.07, HATCH.len + 0.1), '#e9c46a', { at: [-1.3, HATCH.y0 - 0.02, z] }),
    part(cyl(0.045, 0.045, 0.2, 8), '#d62828', { at: [-1.35, HATCH.y0 + 0.11, z - 1.0] }),
    part(cyl(0.045, 0.045, 0.2, 8), '#ffd166', { at: [-1.35, HATCH.y0 + 0.11, z - 0.86] }),
    part(box(0.03, 0.85, 0.95), '#1d1d1d', { at: [-1.165, 1.85, z + HATCH.len / 2 + 0.6] }),
    part(box(0.01, 0.08, 0.7), ORANGE, { at: [-1.183, 2.16, z + HATCH.len / 2 + 0.6] }),
    ...[0, 1, 2, 3].map((i) => part(box(0.01, 0.04, 0.6 - (i % 2) * 0.15), '#f8f9fa', { at: [-1.183, 2.0 - i * 0.14, z + HATCH.len / 2 + 0.6] })),
    // the cab
    part(box(2.2, 1.7, 2.2), TEAL, { at: [0, 1.3, 2.5] }),
    part(box(2.22, 0.3, 2.22), ORANGE, { at: [0, 0.85, 2.5] }),
    part(box(1.9, 0.7, 0.05), GLASS, { at: [0, 1.75, 3.61] }),
    ...[-1, 1].map((x) => part(box(0.05, 0.6, 1.0), GLASS, { at: [x * 1.105, 1.75, 2.6] })),
    part(box(1.2, 0.35, 0.05), '#c0c0c8', { at: [0, 0.95, 3.61] }),
    ...[1, -1].map((s) => part(box(2.32, 0.22, 0.25), '#6c757d', { at: [0, 0.5, s * 3.62] })),
    // the burger on the roof, on its post, and the chimney
    part(cyl(0.05, 0.05, 0.3, 6), '#6c757d', { at: [0, 3.1, z] }),
    part(cyl(0.62, 0.56, 0.22, 14), '#e9a65d', { at: [0, 3.36, z] }),
    part(cyl(0.66, 0.66, 0.16, 14), '#5a3825', { at: [0, 3.55, z] }),
    part(box(1.15, 0.04, 1.15), '#ffd166', { at: [0, 3.65, z], rot: [0, Math.PI / 4, 0] }),
    part(cyl(0.7, 0.7, 0.06, 14), '#80b918', { at: [0, 3.69, z] }),
    part(new THREE.SphereGeometry(0.64, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#e9a65d', { at: [0, 3.72, z], scale: [1, 0.62, 1] }),
    ...Array.from({ length: 7 }, (_, i) => part(ball(0.04, 5, 4), '#fff8e7', { at: [Math.cos(i * 0.9) * 0.35, 4.08 - (i % 2) * 0.03, z + Math.sin(i * 0.9) * 0.35] })),
    part(cyl(0.1, 0.1, 0.5, 8), '#6c757d', { at: [0.65, 3.15, -3.0] }),
  ]);
}

const lampsModel = () =>
  model([
    ...[-1, 1].map((x) => part(box(0.32, 0.2, 0.04), '#fff3c4', { at: [x * 0.75, 1.0, 3.64] })),
    ...[-1, 1].map((x) => part(box(0.26, 0.26, 0.04), '#ff2d2d', { at: [x * 0.95, 1.0, -3.64] })),
    // the lit kitchen seen through the hatch
    part(box(0.01, HATCH.y1 - HATCH.y0, HATCH.len), '#f2d29b', { at: [1.085, (HATCH.y0 + HATCH.y1) / 2, HATCH.z] }),
  ]);

/** The awning: a striped panel hanging from its hinge (the origin), swung up about z to open. */
const awningModel = () => model(Array.from({ length: 5 }, (_, i) => part(box(0.05, 1.08, HATCH.len / 5 + 0.02), i % 2 ? '#fefae0' : ORANGE, { at: [-0.03, -0.54, -HATCH.len / 2 + (HATCH.len / 5) * (i + 0.5)] })));

/** The cook (origin at the truck's floor), facing +z, an apron on and a spatula out in front. */
const cookModel = () =>
  model([
    part(capsule(0.21, 0.38), '#f8f9fa', { at: [0, 1.0, 0], scale: [1, 1, 0.85] }),
    part(box(0.32, 0.5, 0.02), '#e63946', { at: [0, 0.95, 0.19] }),
    part(ball(0.19, 12, 8), '#e0ac69', { at: [0, 1.5, 0] }),
    part(cyl(0.16, 0.15, 0.22, 10), '#ffffff', { at: [0, 1.75, 0] }),
    part(ball(0.2, 10, 6), '#ffffff', { at: [0, 1.88, 0], scale: [1, 0.6, 1] }),
    part(capsule(0.06, 0.36), '#f8f9fa', { at: [0.22, 1.02, 0.2], rot: [-1.0, 0, 0] }),
    part(box(0.12, 0.02, 0.22), '#adb5bd', { at: [0.24, 1.14, 0.44] }),
  ]);

/** A point along a path of corners, `s` metres from its start (held at its end); returns whether it's still on its way. */
function along(path: readonly (readonly [number, number])[], s: number, out: { x: number; z: number; heading: number }): boolean {
  let left = s;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    out.heading = Math.atan2(bx - ax, bz - az);
    if (left <= len) {
      out.x = ax + ((bx - ax) * left) / len;
      out.z = az + ((bz - az) * left) / len;
      return true;
    }
    left -= len;
  }
  const [x, z] = path[path.length - 1];
  out.x = x;
  out.z = z;
  return false;
}

const m = new THREE.Matrix4();
const hand = new THREE.Matrix4().makeTranslation(0.3, 1.0, 0.24);
const zero = new THREE.Matrix4().makeScale(0, 0, 0);

export default function FoodTruck({ run, elevation }: SceneProps) {
  const truck = useRef<THREE.Group>(null);
  const awning = useRef<THREE.Mesh>(null);
  const cook = useRef<THREE.Mesh>(null);
  const wheels = useRef<THREE.InstancedMesh>(null);
  const r = useMemo(() => streetRoute('foodtruck', run.side, seeded(run.seed)()), [run.seed, run.side]);
  const plan = useMemo(() => {
    const [s0, s1] = stopOf(r.drive) ?? [r.drive.seconds / 2, r.drive.seconds / 2];
    const at = routeAt(r, (s0 + s1) / 2, { x: 0, z: 0, yaw: 0, speed: 0, u: 0 });
    // the truck's frame where it parks: forward along it, and out to its right, where the queue is
    const fwd = { x: Math.sin(at.yaw), z: Math.cos(at.yaw) };
    const right = { x: -Math.cos(at.yaw), z: Math.sin(at.yaw) };
    const world = (across: number, ahead: number) => [at.x + right.x * across + fwd.x * ahead, at.z + right.z * across + fwd.z * ahead] as const;
    return { s0, s1, world, faceTruck: Math.atan2(-right.x, -right.z), faceFront: Math.atan2(fwd.x, fwd.z) };
  }, [r]);
  const parts = useMemo(() => {
    const crowd = new Crowd(PEOPLE, looks(PEOPLE, seeded(run.seed + 1)));
    const food = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.13, 0.2), toonOut(ORANGE), PEOPLE);
    const steam = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), toonOut('#f4f4f4', { opacity: 0.7 }), 8);
    for (const x of [food, steam]) x.frustumCulled = false;
    return { body: truckModel(), lamps: lampsModel(), awning: awningModel(), cook: cookModel(), wheel: wheelGeometry(WHEEL_R, 0.3), crowd, food, steam };
  }, [run.seed]);
  useEffect(
    () => () => {
      for (const g of [parts.body, parts.lamps, parts.awning, parts.cook, parts.wheel, parts.food.geometry, parts.steam.geometry]) g.dispose();
      parts.crowd.dispose();
      parts.food.dispose();
      parts.steam.dispose();
    },
    [parts],
  );
  const state = useMemo(
    () => ({ pose: { x: 0, z: 0, yaw: 0, speed: 0, u: 0 } as Pose, hold: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } as Hold, diesel: null as Loop | null, sizzle: null as Loop | null, rung: -1, at: { x: 0, z: 0, heading: 0 } }),
    [],
  );
  useEffect(() => {
    state.diesel = loop('diesel');
    state.sizzle = loop('sizzle');
    return () => {
      state.diesel?.stop(1);
      state.sizzle?.stop(1);
      holdStreet(run.key, null);
    };
  }, [state, run.key]);

  useFrame(() => {
    const g = truck.current;
    if (!g) return;
    const t = run.t;
    const on = t < r.drive.seconds;
    g.visible = on;
    holdStreet(run.key, on ? holdOf('foodtruck', r, t, state.hold) : null);
    const p = routeAt(r, t, state.pose);
    g.position.set(p.x, ROAD_Y, p.z);
    g.rotation.y = p.yaw;
    if (wheels.current) spinWheels(wheels.current, WHEELS, p.u / WHEEL_R);
    const since = t - plan.s0;
    // open a second after it stops, shut a few seconds before it goes
    const open = smooth(clamp01((since - 1) / 1.5)) * (1 - smooth(clamp01((t - (plan.s1 - 3.5)) / 1.5)));
    if (awning.current) awning.current.rotation.z = OPEN * open;
    if (cook.current) {
      cook.current.visible = open > 0.02;
      cook.current.position.y = 0.5 + Math.abs(Math.sin(t * 3)) * 0.04;
      cook.current.rotation.y = -Math.PI / 2 + Math.sin(t * 1.3) * 0.25;
    }
    // steam from the chimney while the griddle's on
    for (let i = 0; i < 8; i++) {
      const k = (t / 2.4 + i / 8) % 1;
      const s = open * (0.16 + k * 0.4) * (1 - k * k);
      parts.steam.setMatrixAt(i, m.makeScale(s, s, s).setPosition(0.65 + Math.sin(t + i) * 0.15, 3.45 + k * 2.2, -3.0 - k * 0.7));
    }
    parts.steam.instanceMatrix.needsUpdate = true;
    // the queue
    const crowd = parts.crowd;
    for (let k = 0; k < PEOPLE; k++) {
      const a = arrives(k);
      if (!on || since < a) {
        crowd.hide(k);
        parts.food.setMatrixAt(k, zero);
        continue;
      }
      // how many ahead of them are still waiting (sliding up a place over 0.8 s as each is served)
      let ahead = 0;
      let shuffling = false;
      for (let j = 0; j < k; j++) {
        const done = clamp01((since - served(j)) / 0.8);
        ahead += 1 - done;
        if (done > 0 && done < 1) shuffling = true;
      }
      const slot = -1.1 - 0.85 * ahead;
      const at = state.at;
      let walking: boolean;
      let face: number;
      let scale = Math.min(1, (since - a) / 0.5);
      const fed = since > served(k) + 0.6;
      if (!fed) {
        walking = along([plan.world(IN_X, BACK), plan.world(IN_X, slot), plan.world(QUEUE_X, slot)], (since - a) * WALK, at) || shuffling;
        face = walking ? at.heading : ahead < 0.5 ? plan.faceTruck : plan.faceFront;
      } else {
        const out = [plan.world(QUEUE_X, -1.1), plan.world(OUT_X, -1.1), plan.world(OUT_X, BACK)] as const;
        walking = along(out, (since - served(k) - 0.6) * WALK, at);
        face = at.heading;
        const total = (OUT_X - QUEUE_X) + (BACK + 1.1) * -1;
        scale = Math.min(scale, clamp01((total - (since - served(k) - 0.6) * WALK) / 0.8));
      }
      if (scale <= 0) {
        crowd.hide(k);
        parts.food.setMatrixAt(k, zero);
        continue;
      }
      const step = t * 9 + k * 1.7;
      const y = Math.abs(at.x) < PLAZA.x && Math.abs(at.z) < PLAZA.z ? PLAZA.y : ROAD_Y - 0.02;
      crowd.set(k, at.x, y, at.z, face + (walking ? 0 : Math.sin(t * 0.6 + k) * 0.15), walking ? Math.sin(step) * 0.5 : 0, walking ? Math.abs(Math.sin(step)) * 0.04 : 0, scale);
      parts.food.setMatrixAt(k, fed ? m.multiplyMatrices(crowd.frameOf(k, m), hand) : zero);
    }
    crowd.commit();
    parts.food.instanceMatrix.needsUpdate = true;

    const heard = placeAt(p.x, ROAD_Y + 1.8 - elevation, p.z, 30);
    const fade = inOut(t, run.seconds, 3) * (on ? 1 : 0);
    state.diesel?.set(heard.gain * fade * (p.speed > 0 ? 0.35 + Math.min(1, p.speed / 7) * 0.5 : 0.15), heard.pan, 0.85 + p.speed / 14);
    state.sizzle?.set(heard.gain * fade * open, heard.pan);
    // a ding as it opens, and as each customer is served
    let ding = -1;
    if (since > 1.2 && on) for (ding = 0; ding < PEOPLE && since >= served(ding); ) ding++;
    if (ding > state.rung) play('bell', { gain: heard.gain, pan: heard.pan, pitch: ding ? 1 : 1.2 });
    state.rung = ding;
  });

  const mat = painted();
  return (
    <group>
      <group ref={truck}>
        <mesh geometry={parts.body} material={mat} />
        <mesh geometry={parts.lamps} material={glowing()} />
        <mesh ref={awning} geometry={parts.awning} material={mat} position={[-1.15, HATCH.y1 + 0.02, HATCH.z]} />
        <mesh ref={cook} geometry={parts.cook} material={mat} position={[-0.55, 0.5, HATCH.z]} visible={false} />
        <instancedMesh ref={wheels} args={[parts.wheel, mat, WHEELS.length]} frustumCulled={false} />
        <mesh geometry={groundSquare()} material={shadowMaterial()} position={[0, 0.02, 0]} scale={[W + 0.8, 1, L + 1]} />
        <primitive object={parts.steam} />
      </group>
      <primitive object={parts.crowd.group} />
      <primitive object={parts.food} />
    </group>
  );
}
