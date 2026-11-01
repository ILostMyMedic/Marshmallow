// A floor's beer fridge (bought in the shop, Decor.tsx puts it in its big spot): a dark cabinet with a header in the
// floor's colour, wire shelves of bottles lit from inside behind a glass door hinged on its right. Workers having a beer
// after hours (beerErrand.ts) open the door, take a bottle and shut it, and so does E on it (playerMachines.ts), which
// says it's shut in the daytime; the door swings on machines.ts's state, in the frame loop, so it never re-renders.
// Draws: the cabinet and its ink, the bottles, the lit liner, the door's frame and its glass. New in Marshmallow.
import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { afterHours } from '../beerBreak';
import { dayTime } from '../dayTime';
import { useInteractable } from '../interact';
import { glass } from '../materials';
import { INK, Outlines } from '../Outlines';
import { machineLabel } from './machineRules';
import { doorOpenIn, mountMachine } from './machines';
import { beerBodyModel, beerDoorModel, beerGoodsModel, BEER_FRIDGE } from './models';
import { panelLit, vertexLit, vertexToon } from './parts';

const OPEN = 1.9; // radians the door swings out
const SWING = 6; // how quickly it gets there

/** Whether it's after hours by the office clock, looked at every few seconds (E's label changes with it). */
function useAfterHours() {
  const [open, setOpen] = useState(() => afterHours(dayTime.t));
  useEffect(() => {
    const t = setInterval(() => setOpen(afterHours(dayTime.t)), 2000);
    return () => clearInterval(t);
  }, []);
  return open;
}

export function BeerFridge({ spot, color }: { spot: string; color: string }) {
  const root = useRef<THREE.Group>(null);
  const door = useRef<THREE.Group>(null);
  const { w, d, y0, y1 } = BEER_FRIDGE;
  const hit = useInteractable<THREE.Group>({ id: `beer:${spot}`, label: machineLabel('beer', useAfterHours()), action: { kind: 'beer', spot } }, 3);

  useEffect(() => {
    const r = root.current;
    if (!r) return;
    r.updateWorldMatrix(true, false);
    const f = r.localToWorld(new THREE.Vector3(0, 0, d / 2));
    return mountMachine('beer', { spot, x: f.x, z: f.z });
  }, [spot, d]);

  useFrame((_, delta) => {
    const g = door.current;
    if (!g) return;
    const want = doorOpenIn(spot) ? OPEN : 0;
    const k = 1 - Math.exp(-SWING * Math.min(delta, 0.1));
    g.rotation.y += (want - g.rotation.y) * k;
  });

  return (
    <group ref={root}>
      <group ref={hit}>
        <mesh geometry={beerBodyModel(color)} material={vertexToon} castShadow receiveShadow>
          <Outlines thickness={0.016} color={INK} />
        </mesh>
        <mesh geometry={beerGoodsModel()} material={vertexLit} />
        <mesh position={[0, (y0 + y1) / 2, -d / 2 + 0.052]} material={panelLit}>
          <planeGeometry args={[w - 0.1, y1 - y0]} />
        </mesh>
        <group ref={door} position={[w / 2 - 0.01, 0, d / 2]}>
          <mesh geometry={beerDoorModel()} material={vertexToon} castShadow />
          <mesh position={[-(w - 0.02) / 2, (y0 + y1) / 2, 0.02]} material={glass}>
            <planeGeometry args={[w - 0.1, y1 - y0 - 0.08]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
