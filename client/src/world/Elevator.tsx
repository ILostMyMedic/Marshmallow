// The elevator in the middle of the south wall: its doors, which slide open for anyone on foot near them (someone new
// stepping out, a leaver with their box, the CEO coming up for a stand-up), and the cabin behind them. It all goes with
// the room's walls in the overview's cutaway.
// Adapted from cubefarm client/src/world/Elevator.tsx (MIT): riding it (E, the floor indicator and the panels) and the
// reduced-motion doors are cut.
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ELEVATOR, HALF_D, WALL_H } from './layout';
import { glow, toon } from './materials';
import { bodies } from './people';

const ROOM = { cut: 'room' } as const;

/** `zDoor` is where the doors stand: in the wall's thickness, on the doorway. */
export function Elevator({ zDoor }: { zDoor: number }) {
  const left = useRef<THREE.Mesh>(null);
  const right = useRef<THREE.Mesh>(null);
  const open = useRef(0);
  const { doorHalf, cabinHalf, depth, doorHeight } = ELEVATOR;

  useFrame((_, delta) => {
    let near = false;
    for (const b of bodies()) if (b.stage !== 'seated' && Math.abs(b.x) < doorHalf + 0.6 && Math.abs(b.z - zDoor) < 2) near = true;
    open.current += ((near ? 1 : 0) - open.current) * (1 - Math.exp(-Math.min(delta, 0.1) * 5));
    const slide = open.current * doorHalf * 0.98;
    if (left.current) left.current.position.x = -doorHalf / 2 - slide;
    if (right.current) right.current.position.x = doorHalf / 2 + slide;
  });

  const door = toon('#c9ced6', ROOM);
  const side = toon('#c8ced8', ROOM);
  return (
    <group>
      <mesh ref={left} position={[-doorHalf / 2, doorHeight / 2, zDoor]} material={door} castShadow>
        <boxGeometry args={[doorHalf, doorHeight, 0.08]} />
      </mesh>
      <mesh ref={right} position={[doorHalf / 2, doorHeight / 2, zDoor]} material={door} castShadow>
        <boxGeometry args={[doorHalf, doorHeight, 0.08]} />
      </mesh>
      {/* the cabin: floor, ceiling and its light, sides, back and a handrail */}
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
      </group>
    </group>
  );
}
