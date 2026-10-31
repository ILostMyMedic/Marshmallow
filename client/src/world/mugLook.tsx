// What a coffee mug looks like, with coffee standing in it and its steam: on the kitchenette's stand, on a desk, in
// someone's hand. Adapted from cubefarm client/src/world/toys/mugLook.tsx and toys/mugs.ts (MIT): the player's mugs,
// the dispenser's pick-up and the physics are cut.
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { INK, Outlines } from './Outlines';
import { shade, toon } from './materials';

const COFFEE = '#6f4518';

/** A mug's size in metres: radius at the rim and at the base, and height. */
export const MUG_SIZE = { r: 0.055, rBase: 0.05, h: 0.12 };
/** A full mug holds this many sips. */
export const MAX_SIPS = 3;

const COLORS = ['#f8f9fa', '#ef476f', '#118ab2', '#ffd166', '#06d6a0'];

const tints = new Map<string, string>();

/** Gives a mug its own colour (a worker's coffee is in their desk mug's colour), wherever it goes after. */
export const tintMug = (id: string, color: string) => void tints.set(id, color);

/** A mug's colour: its tint, or one picked from its id so the same mug keeps its colour wherever it goes. */
export function mugColor(id: string) {
  const tint = tints.get(id);
  if (tint) return tint;
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[n % COLORS.length];
}

const clampSips = (n: number) => (Number.isFinite(n) ? Math.min(MAX_SIPS, Math.max(0, Math.round(n))) : 0);

/** How high the coffee stands, from 0 (empty) to 1 (full). */
export const fillLevel = (sips: number) => clampSips(sips) / MAX_SIPS;

/** How strongly a mug steams, from 0 (empty) to 1 (full): it thins with each sip, and the last sip still shows a little. */
export function steamStrength(sips: number) {
  const s = clampSips(sips);
  return s === 0 ? 0 : 0.3 + (0.7 * (s - 1)) / (MAX_SIPS - 1);
}

// The wall is open at the top, so its inside (and the coffee) shows: a double-sided copy of the toon material.
const walls = new Map<string, THREE.Material>();
function wall(color: string) {
  let m = walls.get(color);
  if (!m) {
    m = toon(color).clone();
    m.side = THREE.DoubleSide;
    walls.set(color, m);
  }
  return m;
}

/** A mug centred on its middle, the handle towards +X, coffee standing `sips` high inside, steaming while there's any. */
export function MugLook({ color, sips, shadow = true, steam = sips > 0 }: { color: string; sips: number; shadow?: boolean; steam?: boolean }) {
  const { r, rBase, h } = MUG_SIZE;
  const level = fillLevel(sips);
  const bottom = -h / 2 + 0.008;
  const coffeeY = bottom + 0.004 + level * (h - 0.026);
  const coffeeR = rBase + (r - rBase) * ((coffeeY + h / 2) / h) - 0.003;
  return (
    <group>
      <mesh castShadow={shadow} receiveShadow material={wall(color)}>
        <cylinderGeometry args={[r, rBase, h, 20, 1, true]} />
        <Outlines thickness={0.006} color={INK} />
      </mesh>
      <mesh position={[0, bottom, 0]} rotation={[-Math.PI / 2, 0, 0]} material={toon(shade(color, -0.18))}>
        <circleGeometry args={[rBase - 0.002, 20]} />
      </mesh>
      <mesh position={[0, -h / 2 + 0.002, 0]} rotation={[Math.PI / 2, 0, 0]} material={toon(color)}>
        <circleGeometry args={[rBase, 20]} />
      </mesh>
      {level > 0 && (
        <mesh position={[0, coffeeY, 0]} rotation={[-Math.PI / 2, 0, 0]} material={toon(COFFEE)}>
          <circleGeometry args={[coffeeR, 20]} />
        </mesh>
      )}
      <mesh position={[r - 0.003, 0.004, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow={shadow} material={toon(color)}>
        <torusGeometry args={[0.032, 0.01, 6, 14, Math.PI]} />
        <Outlines thickness={0.006} color={INK} />
      </mesh>
      {steam && level > 0 && <Steam y={h / 2} sips={sips} />}
    </group>
  );
}

const WISPS = [0, 1, 2];

/** Soft steam rising from y: a few fading puffs, fainter, smaller and lower as the sips run out. */
export function Steam({ y, sips }: { y: number; sips: number }) {
  const g = useRef<THREE.Group>(null);
  const strength = steamStrength(sips);
  useFrame(() => {
    const group = g.current;
    if (!group) return;
    const t = performance.now() / 1000;
    for (let i = 0; i < group.children.length; i++) {
      const c = group.children[i] as THREE.Mesh;
      const k = (t * 0.45 + i / 3) % 1;
      c.position.set(Math.sin(t * 1.3 + i * 2.1) * 0.012, k * 0.14 * (0.5 + 0.5 * strength), 0);
      c.scale.setScalar((0.6 + k * 1.2) * (0.6 + 0.4 * strength));
      (c.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - k) * strength;
    }
  });
  return (
    <group ref={g} position={[0, y, 0]}>
      {WISPS.map((i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.016, 8, 6]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
