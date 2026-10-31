// Adapted from cubefarm client/src/world/Props.tsx, CoffeeMachine.tsx, KitchenFridge.tsx and toys/mugLook.tsx (MIT):
// the floor's furniture as it stands still. The coffee machine, the mug stack and the fridge keep cubefarm's places on
// the counter (the errands' spots are measured from them); their live parts (brewing, mugs taken, the door opening)
// come with the coffee runs and snacks.
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { glow, shade, toon } from './materials';
import { Ball, Box, Cyl } from './Toon';

type P = [number, number, number];

export function Plant({ position, scale = 1, pot = '#e07a5f' }: { position: P; scale?: number; pot?: string }) {
  return (
    <group position={position} scale={scale}>
      <Cyl r={0.22} rTop={0.28} h={0.5} position={[0, 0.25, 0]} color={pot} outline />
      <Ball r={0.36} position={[0, 0.8, 0]} color="#52b788" outline />
      <Ball r={0.28} position={[0.2, 1.05, 0.08]} color="#40916c" outline />
      <Ball r={0.25} position={[-0.18, 1.12, -0.05]} color="#74c69d" outline />
      <Ball r={0.2} position={[0.02, 1.35, 0]} color="#52b788" outline />
    </group>
  );
}

export function WaterCooler({ position }: { position: P }) {
  return (
    <group position={position}>
      <Box size={[0.45, 1.0, 0.45]} position={[0, 0.5, 0]} color="#f1f3f5" outline />
      <Cyl r={0.18} h={0.5} position={[0, 1.25, 0]} color="#8ecae6" outline />
      <Box size={[0.08, 0.06, 0.06]} position={[0, 0.8, -0.24]} color="#457b9d" />
    </group>
  );
}

export function Couch({ position, rotationY = 0, color = '#6c63ff' }: { position: P; rotationY?: number; color?: string }) {
  const dark = shade(color, -0.12);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[3, 0.42, 1]} position={[0, 0.25, 0]} color={color} outline />
      <Box size={[3, 0.6, 0.25]} position={[0, 0.7, 0.38]} color={dark} outline />
      <Box size={[0.25, 0.55, 1]} position={[-1.5, 0.45, 0]} color={dark} outline />
      <Box size={[0.25, 0.55, 1]} position={[1.5, 0.45, 0]} color={dark} outline />
      <Box size={[0.5, 0.4, 0.14]} position={[-0.9, 0.62, 0.22]} color="#ffd166" outline />
      <Box size={[0.5, 0.4, 0.14]} position={[0.9, 0.62, 0.22]} color="#ef476f" outline />
    </group>
  );
}

export function CoffeeTable({ position, rotationY = 0 }: { position: P; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[1.3, 0.08, 0.8]} position={[0, 0.42, 0]} color="#f1d19b" outline />
      <Box size={[1.1, 0.38, 0.6]} position={[0, 0.2, 0]} color="#c9a26b" />
      <Cyl r={0.05} h={0.1} position={[0.3, 0.51, 0.1]} color="#ffffff" outline />
      <Box size={[0.3, 0.04, 0.22]} position={[-0.25, 0.48, -0.05]} color="#4cc9f0" outline />
    </group>
  );
}

// ---------- the kitchenette ----------

/** Where the coffee machine's mug slot is, and its spout's height (CoffeeMachine.tsx). */
const SLOT = { x: -0.25, tray: 0.02 };
const SPOUT_Y = 0.21;
export const MUG_SIZE = { r: 0.055, rBase: 0.05, h: 0.12 };
const MUG_COLORS = ['#ef476f', '#118ab2', '#ffd166'];

/** The coffee machine on the counter, its front (and mug slot) facing local -x. */
function CoffeeMachine({ position }: { position: P }) {
  return (
    <group position={position}>
      <Box size={[0.45, 0.55, 0.4]} position={[0.05, 0.28, 0]} color="#343a40" outline />
      {/* head over the drip tray, and its spout */}
      <Box size={[0.22, 0.1, 0.28]} position={[SLOT.x + 0.01, SPOUT_Y + 0.07, 0]} color="#495057" outline />
      <Cyl r={0.018} h={0.03} position={[SLOT.x, SPOUT_Y + 0.005, 0]} color="#adb5bd" />
      {/* power light, and the brew button */}
      <mesh position={[-0.2, 0.39, 0.13]} rotation={[0, -Math.PI / 2, 0]} material={glow('#ff6b6b')}>
        <circleGeometry args={[0.02, 12]} />
      </mesh>
      <group position={[-0.18, 0.42, -0.06]}>
        <Cyl r={0.045} h={0.02} rotation={[0, 0, Math.PI / 2]} color="#212529" />
        <mesh position={[-0.012, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={toon('#495057')}>
          <cylinderGeometry args={[0.032, 0.034, 0.018, 18]} />
        </mesh>
      </group>
      {/* the drip tray */}
      <Box size={[0.2, SLOT.tray, 0.26]} position={[SLOT.x, SLOT.tray / 2, 0]} color="#6c757d" outline />
    </group>
  );
}

/** An empty mug, upright, its handle towards +x. */
function Mug({ color }: { color: string }) {
  const { r, rBase, h } = MUG_SIZE;
  return (
    <group>
      <Cyl r={rBase} rTop={r} h={h} color={color} outline />
      <mesh position={[r - 0.003, 0.004, 0]} rotation={[0, 0, -Math.PI / 2]} material={toon(color)}>
        <torusGeometry args={[0.032, 0.01, 6, 14, Math.PI]} />
      </mesh>
    </group>
  );
}

/** Three mugs stacked rim-down on a little stand round a pole, beside the coffee machine. */
function MugStack({ position }: { position: P }) {
  const { h } = MUG_SIZE;
  return (
    <group position={position}>
      <Cyl r={0.1} h={0.03} position={[0, 0.015, 0]} color="#adb5bd" outline />
      <Cyl r={0.012} h={0.42} position={[0, 0.24, 0]} color="#6c757d" />
      {MUG_COLORS.map((c, i) => (
        <group key={c} position={[0, 0.03 + h / 2 + i * (h + 0.002), 0]} rotation={[Math.PI, (i * 2.4) % (Math.PI * 2), 0]}>
          <Mug color={c} />
        </group>
      ))}
      <Box size={[0.04, 0.05, 0.05]} position={[0, 0.47, 0]} color="#6c757d" shadow={false} />
    </group>
  );
}

const FRIDGE = { w: 0.8, h: 2, white: '#f1f3f5' };

/** The fridge at the counter's end, shut, its door (hinged on the +z edge) facing local -x. */
function Fridge({ position }: { position: P }) {
  const { w: W, h: H, white } = FRIDGE;
  return (
    <group position={position}>
      <Box size={[W, H, W]} position={[0, H / 2, 0]} color={white} outline />
      <Box size={[W, 0.12, W]} position={[0, 0.06, 0]} color="#ced4da" outline />
      <group position={[-W / 2, 0, 0]}>
        <Box size={[0.06, H - 0.04, W]} position={[-0.03, H / 2, 0]} color={white} outline />
        {/* the handle, on the far edge from the hinge */}
        <Box size={[0.04, 0.5, 0.05]} position={[-0.085, 1.3, -0.25]} color="#adb5bd" outline />
        {/* magnets, and a sticky note held up by one */}
        <Cyl r={0.03} h={0.014} position={[-0.067, 1.62, 0.12]} rotation={[0, 0, Math.PI / 2]} color="#ef476f" shadow={false} />
        <Ball r={0.024} position={[-0.068, 1.15, 0.2]} scale={[0.5, 1, 1]} color="#06d6a0" shadow={false} />
        <Box size={[0.004, 0.15, 0.15]} position={[-0.062, 1.42, 0.08]} rotation={[0.08, 0, 0]} color="#ffd166" shadow={false} />
        <Cyl r={0.016} h={0.012} position={[-0.067, 1.485, 0.08]} rotation={[0, 0, Math.PI / 2]} color="#118ab2" shadow={false} />
      </group>
    </group>
  );
}

/** The kitchenette counter along the east wall, its front facing local -x: the coffee machine, mugs, fruit, a kettle and the fridge. */
export function Kitchenette({ position }: { position: P }) {
  return (
    <group position={position}>
      {/* counter runs along z */}
      <Box size={[0.8, 0.9, 4]} position={[0, 0.45, 0]} color="#8ecae6" outline />
      <Box size={[0.9, 0.06, 4.1]} position={[-0.02, 0.93, 0]} color="#f8f9fa" outline />
      <CoffeeMachine position={[0, 0.96, -1.1]} />
      <MugStack position={[0, 0.96, -0.45]} />
      {/* fruit bowl + kettle */}
      <Cyl r={0.2} rTop={0.24} h={0.1} position={[0, 1.01, 0.6]} color="#f4a261" outline />
      <Ball r={0.07} position={[0.05, 1.1, 0.55]} color="#e63946" />
      <Ball r={0.07} position={[-0.06, 1.1, 0.66]} color="#ffd166" />
      <Ball r={0.07} position={[0.07, 1.1, 0.7]} color="#80ed99" />
      <Cyl r={0.1} rTop={0.07} h={0.25} position={[0, 1.08, 1.4]} color="#ced4da" outline />
      <Fridge position={[0, 0, 2.45]} />
    </group>
  );
}

// ---------- on the walls ----------

/** The wall clock, telling the real time. Hung on the north wall it's cut away with it (cutaway.ts). */
export function WallClock({ position, rotationY = 0 }: { position: P; rotationY?: number }) {
  const hour = useRef<THREE.Group>(null);
  const minute = useRef<THREE.Group>(null);
  useFrame(() => {
    const d = new Date();
    const m = d.getMinutes() + d.getSeconds() / 60;
    const h = (d.getHours() % 12) + m / 60;
    if (minute.current) minute.current.rotation.z = -(m / 60) * Math.PI * 2;
    if (hour.current) hour.current.rotation.z = -(h / 12) * Math.PI * 2;
  });
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={toon('#ffffff', { cut: 'room' })}>
        <cylinderGeometry args={[0.36, 0.36, 0.06, 32]} />
      </mesh>
      <group ref={hour} position={[0, 0, 0.04]}>
        <mesh position={[0, 0.1, 0]} material={toon('#1f1d2b', { cut: 'room' })}>
          <boxGeometry args={[0.035, 0.2, 0.01]} />
        </mesh>
      </group>
      <group ref={minute} position={[0, 0, 0.045]}>
        <mesh position={[0, 0.14, 0]} material={toon('#e63946', { cut: 'room' })}>
          <boxGeometry args={[0.025, 0.28, 0.01]} />
        </mesh>
      </group>
    </group>
  );
}
