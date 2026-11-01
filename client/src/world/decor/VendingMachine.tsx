// A floor's vending machine (bought in the shop, Decor.tsx puts it in its big spot): a toon cabinet in the floor's
// colour, a lit glass front with rows of cans, bars and crisps, a keypad and coin slot, and the tray. Workers on a trip
// to it (vendingErrand.ts) press the buttons and what they chose is pushed off its shelf, drops and lands in the tray
// until they take it; E on it does the same for you (playerMachines.ts), into your hands. The goods and the back of the
// display brighten as the room darkens (parts.ts machinesGlow). Draws: the cabinet and its ink, the goods, the lit back,
// the glass, and the drop while one falls. New in Marshmallow.
import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SnackId } from '../fridge';
import { useInteractable } from '../interact';
import { glass } from '../materials';
import { INK, Outlines } from '../Outlines';
import { SnackLook } from '../SnackLook';
import { machineLabel } from './machineRules';
import { dropIn, mountMachine, type Drop } from './machines';
import { vendingBodyModel, vendingGoodsModel, VENDING } from './models';
import { panelLit, vertexLit, vertexToon } from './parts';

/** Which shelf each of the machine's goods comes off (VENDING.shelves), and where along it. */
const SHELF_OF: Partial<Record<SnackId, number>> = { sparkling: 0, protein: 1, overclock: 3, chocolate: 4 };
/** Seconds pushed forward off the shelf, then falling to the tray. */
const PUSH = 0.7;
const FALL = 0.35;
/** A drop left in the tray this long (s) is cleared away. */
const LEFT = 30;

export function VendingMachine({ spot, color }: { spot: string; color: string }) {
  const root = useRef<THREE.Group>(null);
  const item = useRef<THREE.Group>(null);
  const [snack, setSnack] = useState<SnackId | null>(null);
  const seen = useRef<Drop | null>(null);
  const { d, glass: g, shelves, row, tray } = VENDING;
  const hit = useInteractable<THREE.Group>({ id: `vending:${spot}`, label: machineLabel('vending', true), action: { kind: 'vending', spot } }, 3);

  useEffect(() => {
    const r = root.current;
    if (!r) return;
    r.updateWorldMatrix(true, false);
    const f = r.localToWorld(new THREE.Vector3(g.x, 0, d / 2));
    return mountMachine('vending', { spot, x: f.x, z: f.z });
  }, [spot, d, g.x]);

  useFrame(() => {
    const it = item.current;
    if (!it) return;
    const drop = dropIn(spot);
    if (drop !== seen.current) {
      seen.current = drop ?? null;
      if (drop) setSnack(drop.snack);
    }
    const t = drop ? (performance.now() - drop.at) / 1000 : Infinity;
    if (!drop || drop.taken || t > LEFT) {
      it.visible = false;
      return;
    }
    it.visible = true;
    const shelf = shelves[SHELF_OF[drop.snack] ?? 2];
    const x = row.xs[2];
    if (t < PUSH) {
      it.position.set(x, shelf + 0.07, row.z + (t / PUSH) * 0.14);
      it.rotation.set(0, 0, 0);
    } else if (t < PUSH + FALL) {
      const k = (t - PUSH) / FALL;
      it.position.set(x + (tray.x - x) * k, shelf + 0.07 - (shelf + 0.07 - tray.y) * k * k, row.z + 0.14 + k * 0.1);
      it.rotation.set(k * 1.2, 0, k * 0.6);
    } else {
      // in the tray, poking out over the flap
      it.position.set(tray.x, tray.y - 0.03, d / 2 + 0.035);
      it.rotation.set(Math.PI / 2, 0, 0.4);
    }
  });

  return (
    <group ref={root}>
      <group ref={hit}>
        <mesh geometry={vendingBodyModel(color)} material={vertexToon} castShadow receiveShadow>
          <Outlines thickness={0.016} color={INK} />
        </mesh>
        <mesh geometry={vendingGoodsModel()} material={vertexLit} />
        {/* the lit back of the display, just behind the goods, so the dark of the cabinet doesn't show round it */}
        <mesh position={[g.x, g.y, row.z - 0.07]} material={panelLit}>
          <planeGeometry args={[g.w, g.h]} />
        </mesh>
        <mesh position={[g.x, g.y, d / 2 - 0.012]} material={glass}>
          <planeGeometry args={[g.w, g.h]} />
        </mesh>
        <group ref={item} visible={false}>
          {snack && <SnackLook snack={snack} />}
        </group>
      </group>
    </group>
  );
}
