// The kitchenette fridge: a worker on a snack break (fridgeErrand.ts) opens its door, which swings out on the handle
// side, a light comes on inside and the stock shows on its shelves and in the door's bins; it shuts again once nobody
// is at it. 0.8 m square, 2 m tall, standing at `position` (the middle of its foot), its front facing local -x.
// Adapted from cubefarm client/src/world/KitchenFridge.tsx (MIT): the player's E on it, the tupperware and the hum are cut.
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Slice } from './food';
import { SNACK_IDS, swingTo, type SnackId } from './fridge';
import { doorOpen, fridgeVersion, mountFridge, stockOf, subscribeFridge, tickFridge } from './fridgeState';
import { glow, toon } from './materials';
import { DRINK_H, SnackLook } from './SnackLook';
import { Ball, Box, Cyl } from './Toon';

type V3 = [number, number, number];

const W = 0.8;
const H = 2;
const WHITE = '#f1f3f5';
const LINER = '#dfe7ef';
/** The hinge: the front's +z edge (the handle is on the -z side, where the old box had it). */
const HINGE: V3 = [-W / 2, 0, W / 2];
const TICK_MS = 250;

const linerDim = toon(LINER);
const linerLit = toon('#f8fbff', { emissive: '#fff4d6', emissiveIntensity: 0.55 });
const bulbOff = toon('#ced4da');
const bulbOn = glow('#fff3c4');

/** Where each snack's items stand: in the door's bins (hinge frame) or on a shelf (the fridge's frame), one after another. */
interface Slot {
  door: boolean;
  at: V3;
  step: V3;
  /** Turned on the shelf (bars lie front to back). */
  turn?: number;
}

const bar = (z: number, y: number, dz: number): Slot => ({ door: false, at: [-0.02, y, z], step: [0, 0, dz], turn: Math.PI / 2 });
const can = (id: SnackId, z: number, base: number, dz: number): Slot => ({ door: true, at: [0.055, base + DRINK_H[id]! / 2, z], step: [0, 0, dz] });

// Shelves at these heights (their tops), the door's bins at these.
const SHELVES = [0.51, 0.96, 1.41];
const BINS = [0.71, 1.26];

const SLOTS: Record<SnackId, Slot> = {
  overclock: can('overclock', -0.09, BINS[1], -0.075),
  sparkling: can('sparkling', -0.45, BINS[1], -0.07),
  coldbrew: can('coldbrew', -0.09, BINS[0], -0.08),
  mate: can('mate', -0.45, BINS[0], -0.08),
  chocolate: bar(-0.3, SHELVES[2] + 0.007, 0.065),
  protein: bar(0.06, SHELVES[2] + 0.009, 0.06),
  cheese: bar(-0.31, SHELVES[1] + 0.012, 0.035),
  // slices round a plate (drawn apart, below)
  pizza: { door: false, at: [0.03, SHELVES[1] + 0.02, 0.15], step: [0, 0, 0] },
};

/** One snack's items, as many as are in stock. */
function SnackSlot({ snack, count }: { snack: SnackId; count: number }) {
  const s = SLOTS[snack];
  const items = Array.from({ length: count }, (_, i) => i);
  return (
    <group>
      {snack === 'pizza' ? (
        <group position={s.at}>
          <Cyl r={0.17} h={0.012} position={[0, -0.012, 0]} color="#ffffff" shadow={false} />
          {items.map((i) => (
            <group key={i} rotation={[0, (i * Math.PI) / 4 + Math.PI / 2, 0]}>
              <Slice r={0.15} />
            </group>
          ))}
        </group>
      ) : (
        items.map((i) => (
          <group key={i} position={[s.at[0] + s.step[0] * i, s.at[1] + s.step[1] * i, s.at[2] + s.step[2] * i]} rotation={[0, s.turn ?? 0, 0]}>
            <SnackLook snack={snack} />
          </group>
        ))
      )}
    </group>
  );
}

/** The fridge. `floor` keeps its stock. */
export function Fridge({ position, floor }: { position: V3; floor: number }) {
  useSyncExternalStore(subscribeFridge, fridgeVersion);
  const root = useRef<THREE.Group>(null);
  const door = useRef<THREE.Group>(null);
  const liner = useRef<THREE.Mesh>(null);
  const bulb = useRef<THREE.Mesh>(null);
  const run = useMemo(() => ({ angle: 0, lit: false }), []);

  // On the floor: this floor's stock, the door shut, and its clock running (not in the frame loop: it may stop).
  useEffect(() => {
    const g = root.current;
    if (!g) return;
    g.updateWorldMatrix(true, false);
    const front = g.localToWorld(new THREE.Vector3(-W / 2, 0, 0));
    const unmount = mountFridge(floor, front.x, front.z);
    const timer = setInterval(tickFridge, TICK_MS);
    return () => {
      clearInterval(timer);
      unmount();
    };
  }, [floor]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const isOpen = doorOpen();
    run.angle = swingTo(run.angle, isOpen, dt);
    if (door.current) door.current.rotation.y = run.angle;
    // the light comes on as the seal lets go, and off as it shuts
    const lit = run.angle > 0.05;
    if (lit !== run.lit) {
      run.lit = lit;
      if (liner.current) liner.current.material = lit ? linerLit : linerDim;
      if (bulb.current) bulb.current.material = lit ? bulbOn : bulbOff;
    }
  });

  return (
    <group ref={root} position={position}>
      <group>
        {/* the cabinet: back, sides, top and the kick plate, open at the front */}
        <Box size={[0.04, H, W]} position={[W / 2 - 0.02, H / 2, 0]} color={WHITE} outline />
        <Box size={[W, H, 0.04]} position={[0, H / 2, -W / 2 + 0.02]} color={WHITE} outline />
        <Box size={[W, H, 0.04]} position={[0, H / 2, W / 2 - 0.02]} color={WHITE} outline />
        <Box size={[W, 0.06, W]} position={[0, H - 0.03, 0]} color={WHITE} outline />
        <Box size={[W, 0.12, W]} position={[0, 0.06, 0]} color="#ced4da" outline />
        {/* inside: the liner lights up, the bulb under the top, glass shelves and the crisper drawer */}
        <mesh ref={liner} position={[W / 2 - 0.045, H / 2, 0]} rotation={[0, -Math.PI / 2, 0]} material={linerDim}>
          <planeGeometry args={[W - 0.08, H - 0.2]} />
        </mesh>
        <mesh ref={bulb} position={[0.25, H - 0.1, 0]} material={bulbOff}>
          <sphereGeometry args={[0.035, 10, 8]} />
        </mesh>
        {SHELVES.map((y) => (
          <Box key={y} size={[0.62, 0.02, W - 0.08]} position={[0.05, y - 0.01, 0]} color="#e3f2fd" shadow={false} />
        ))}
        <Box size={[0.6, 0.3, W - 0.1]} position={[0.05, 0.27, 0]} color="#caf0f8" shadow={false} />
        <Box size={[0.02, 0.05, 0.3]} position={[-0.26, 0.36, 0]} color="#90e0ef" shadow={false} />
        {SNACK_IDS.filter((id) => !SLOTS[id].door).map((id) => (
          <SnackSlot key={id} snack={id} count={stockOf(id)} />
        ))}

        {/* the door, hinged on its +z edge: it swings out towards -x */}
        <group ref={door} position={HINGE}>
          <group position={[0, 0, -W / 2]}>
            <Box size={[0.06, H - 0.04, W]} position={[-0.03, H / 2, 0]} color={WHITE} outline />
            {/* the handle, on the far edge from the hinge */}
            <Box size={[0.04, 0.5, 0.05]} position={[-0.085, 1.3, -0.25]} color="#adb5bd" outline />
            {/* on the outside: magnets, and a sticky note held up by one */}
            <Cyl r={0.03} h={0.014} position={[-0.067, 1.62, 0.12]} rotation={[0, 0, Math.PI / 2]} color="#ef476f" shadow={false} />
            <Ball r={0.024} position={[-0.068, 1.15, 0.2]} scale={[0.5, 1, 1]} color="#06d6a0" shadow={false} />
            <Box size={[0.004, 0.15, 0.15]} position={[-0.062, 1.42, 0.08]} rotation={[0.08, 0, 0]} color="#ffd166" shadow={false} />
            {[0.035, 0.005, -0.025].map((y, i) => (
              <Box key={y} size={[0.005, 0.008, 0.1 - i * 0.025]} position={[-0.064, 1.42 + y, 0.075 - i * 0.012]} rotation={[0.08, 0, 0]} color="#3d405b" shadow={false} />
            ))}
            <Cyl r={0.016} h={0.012} position={[-0.067, 1.485, 0.08]} rotation={[0, 0, Math.PI / 2]} color="#118ab2" shadow={false} />
            {/* on the inside: the liner and two bins */}
            <Box size={[0.012, H - 0.3, W - 0.12]} position={[0.006, H / 2, 0]} color={LINER} shadow={false} />
            {BINS.map((y) => (
              <group key={y}>
                <Box size={[0.11, 0.015, W - 0.12]} position={[0.055, y - 0.0075, 0]} color="#e3f2fd" shadow={false} />
                <Box size={[0.012, 0.07, W - 0.12]} position={[0.11, y + 0.03, 0]} color="#bde0fe" shadow={false} />
              </group>
            ))}
          </group>
          {SNACK_IDS.filter((id) => SLOTS[id].door).map((id) => (
            <SnackSlot key={id} snack={id} count={stockOf(id)} />
          ))}
        </group>
      </group>
    </group>
  );
}
