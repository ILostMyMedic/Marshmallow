// The elevator in the middle of the south wall: its doors slide open for anyone near them on foot (you, someone new
// stepping out, a leaver with their box, the CEO coming up for a stand-up) and stay shut while a ride is under way;
// the cabin behind them, its panel and the call button beside the doors (E on either: choose a floor, ui/ElevatorPanel),
// and the floor's name lit over the doors. It steps the ride (elevatorRide.ts) and all of it goes with the room's
// walls in the overview's cutaway. The doors rumble open and shut, and ding when someone steps out of the cabin.
// Adapted from cubefarm client/src/world/Elevator.tsx (MIT): the reduced-motion doors are cut.
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { ding, elevatorDoors } from '../ui/sfx';
import { useCanvasTexture } from './canvasTexture';
import { drawSign } from './draw';
import { doors, doorsHeldShut, tickRide } from './elevatorRide';
import { floorLabel } from './floors';
import { useInteractable } from './interact';
import { ELEVATOR, HALF_D, WALL_H } from './layout';
import { glow, toon, toonMap } from './materials';
import { bodies } from './people';
import { playerAt, rigOwnsCamera } from './rig';
import { useView } from './view';

const ROOM = { cut: 'room' } as const;
const METAL = '#b9c2cf';
const CHOOSE = { id: 'elevator', label: 'Choose a floor', action: { kind: 'elevator' } } as const;

/** The floor's name, lit over the doors. */
function Indicator({ y }: { y: number }) {
  const floor = useView((s) => s.floor);
  const text = useStore((s) => (floor === null ? '' : floorLabel(floor, s.floors)));
  const tex = useCanvasTexture(512, 128, (ctx) => drawSign(ctx, 512, 128, [{ text, size: 52, color: '#7CFFB2' }], '#15151f'), [text]);
  return (
    <mesh position={[0, y, HALF_D - 0.03]} rotation={[0, Math.PI, 0]} material={toonMap(`elevator-sign:${text}`, tex, 'room')}>
      <planeGeometry args={[1.6, 0.4]} />
    </mesh>
  );
}

/** `zDoor` is where the doors stand: in the wall's thickness, on the doorway. */
export function Elevator({ zDoor, accent }: { zDoor: number; accent: string }) {
  const left = useRef<THREE.Mesh>(null);
  const right = useRef<THREE.Mesh>(null);
  const { doorHalf, cabinHalf, depth, doorHeight } = ELEVATOR;
  const call = useInteractable<THREE.Group>(CHOOSE, 2.6);
  const panel = useInteractable<THREE.Group>(CHOOSE, 2.4);
  // whether the doors were wanted open last frame (null until the first: a floor coming into view makes no sound)
  const wanted = useRef<number | null>(null);

  useFrame((_, delta) => {
    tickRide();
    let near = false;
    let arriving = false;
    for (const b of bodies()) {
      if (b.stage === 'seated' || Math.abs(b.x) >= doorHalf + 0.6 || Math.abs(b.z - zDoor) >= 2) continue;
      near = true;
      if (b.z > zDoor + 0.3) arriving = true; // in the cabin: they've come up or down in it
    }
    // you, on foot in front of the doors or in the cabin
    if (!rigOwnsCamera() && Math.abs(playerAt.x) < doorHalf + 0.8 && playerAt.z > zDoor - 2.4) near = true;
    const want = near && !doorsHeldShut() ? 1 : 0;
    if (wanted.current !== null && want !== wanted.current) {
      const at = { x: 0, y: 1.3, z: zDoor };
      elevatorDoors(at, want === 1);
      if (want && arriving) ding(at);
    }
    wanted.current = want;
    doors.open += (want - doors.open) * (1 - Math.exp(-Math.min(delta, 0.1) * 5));
    const slide = doors.open * doorHalf * 0.98;
    if (left.current) left.current.position.x = -doorHalf / 2 - slide;
    if (right.current) right.current.position.x = doorHalf / 2 + slide;
  });

  const door = toon('#c9ced6', ROOM);
  const side = toon('#c8ced8', ROOM);
  const metal = toon(METAL, ROOM);
  return (
    <group>
      <mesh ref={left} position={[-doorHalf / 2, doorHeight / 2, zDoor]} material={door} castShadow>
        <boxGeometry args={[doorHalf, doorHeight, 0.08]} />
      </mesh>
      <mesh ref={right} position={[doorHalf / 2, doorHeight / 2, zDoor]} material={door} castShadow>
        <boxGeometry args={[doorHalf, doorHeight, 0.08]} />
      </mesh>
      <Indicator y={doorHeight + 0.42} />
      {/* the call button beside the doors */}
      <group ref={call} position={[doorHalf + 0.55, 1.2, HALF_D - 0.03]} rotation={[0, Math.PI, 0]}>
        <mesh material={metal}>
          <boxGeometry args={[0.22, 0.4, 0.04]} />
        </mesh>
        <mesh position={[0, 0.08, 0.025]} material={glow(accent, 'room')}>
          <circleGeometry args={[0.05, 20]} />
        </mesh>
        <mesh position={[0, -0.08, 0.025]} material={glow('#ffffff', 'room')}>
          <circleGeometry args={[0.05, 20]} />
        </mesh>
      </group>
      {/* the cabin: floor, ceiling and its light, sides, back, a handrail and the panel */}
      <group position={[0, 0, HALF_D]}>
        <mesh position={[0, 0.01, depth / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={toon('#8d7b68', ROOM)}>
          <planeGeometry args={[cabinHalf * 2, depth]} />
        </mesh>
        <mesh position={[0, doorHeight + 0.2, depth / 2]} rotation={[Math.PI / 2, 0, 0]} material={toon('#f1f3f5', ROOM)}>
          <planeGeometry args={[cabinHalf * 2, depth]} />
        </mesh>
        <mesh position={[0, doorHeight + 0.18, depth / 2]} rotation={[Math.PI / 2, 0, 0]} material={glow('#fff6d6', 'room')}>
          <circleGeometry args={[0.45, 32]} />
        </mesh>
        {/* the sides start inside the wall, not on its face, which would flicker beside the doorway */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (cabinHalf + 0.05), WALL_H / 2, (depth + 0.05) / 2]} material={side}>
            <boxGeometry args={[0.1, WALL_H, depth - 0.05]} />
          </mesh>
        ))}
        <mesh position={[0, WALL_H / 2, depth + 0.05]} material={side}>
          <boxGeometry args={[cabinHalf * 2 + 0.2, WALL_H, 0.1]} />
        </mesh>
        <mesh position={[0, 0.95, depth - 0.05]} material={toon('#e9c46a', ROOM)}>
          <boxGeometry args={[cabinHalf * 2 - 0.2, 0.05, 0.08]} />
        </mesh>
        <group ref={panel} position={[cabinHalf - 0.02, 1.25, 0.9]} rotation={[0, -Math.PI / 2, 0]}>
          <mesh material={metal}>
            <boxGeometry args={[0.36, 0.7, 0.04]} />
          </mesh>
          {[0.22, 0.08, -0.06, -0.2].map((y, i) => (
            <mesh key={y} position={[0, y, 0.025]} material={glow(i === 0 ? accent : '#fdfdfd', 'room')}>
              <circleGeometry args={[0.04, 16]} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}
