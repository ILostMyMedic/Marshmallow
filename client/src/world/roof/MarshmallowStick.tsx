// A marshmallow on a toasting stick, drawn from the hand that holds it along -Z: a thin wooden stick, the marshmallow
// skewered on its tip in the colour its toast has reached (marshmallow.ts toastColour), a little flame on it while it's
// alight, and, as it's eaten, sliding back up the stick to the mouth. Yours (Me.tsx, in your hand or held out in view)
// and a worker's by the fire (RoofPeople.tsx) read their state every frame through `live`, so a stick toasts without a
// re-render. New in Marshmallow.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { glow, toon } from '../materials';
import { INK, Outlines } from '../Outlines';
import { toastColour } from './marshmallow';

/** What a stick shows this frame: its toast and flame (marshmallow.ts), whether it's been eaten, how far it's come up to the mouth (0-1). */
export interface StickState {
  toast: number;
  flame: number;
  eaten?: boolean;
  lift?: number;
}

/** The marshmallow's size (a fat cartoon one) and how far in from the stick's end it's skewered. */
const MALLOW = { r: 0.034, h: 0.05, in: 0.035 };
/** A flame's outline, turned round its middle: a teardrop 1 tall (Fireplace.tsx's, smaller). */
const FLAME: [number, number][] = [
  [0, 0],
  [0.22, 0.1],
  [0.28, 0.27],
  [0.21, 0.53],
  [0.11, 0.78],
  [0, 1],
];
let flameGeo: THREE.LatheGeometry | null = null;
const flameGeometry = () =>
  (flameGeo ??= new THREE.LatheGeometry(
    FLAME.map(([x, y]) => new THREE.Vector2(x, y)),
    8,
  ));

/** A marshmallow on a stick `length` long from the hand (the origin) out along -Z. */
export function MarshmallowStick({ live, length = 1.2, shadow = true }: { live: () => StickState; length?: number; shadow?: boolean }) {
  const mallow = useRef<THREE.Group>(null);
  const flame = useRef<THREE.Group>(null);
  // its own material, as its colour changes by the frame (toon()'s are shared by colour)
  const mat = useMemo(() => (toon('#fbf6ec') as THREE.MeshToonMaterial).clone(), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const colour = useRef('');
  useFrame(({ clock }) => {
    const s = live();
    const g = mallow.current;
    if (!g) return;
    g.visible = !s.eaten;
    // eating: it slides back along the stick to your mouth
    g.position.z = -THREE.MathUtils.lerp(length - MALLOW.in, 0.1, s.lift ?? 0);
    const c = toastColour(s.toast);
    if (c !== colour.current) {
      // a little of its own colour glows, so it reads by the fire at night
      mat.color.set(c);
      mat.emissive.set(c).multiplyScalar(0.3);
      colour.current = c;
    }
    const f = flame.current;
    if (f) {
      f.visible = s.flame > 0 && !s.eaten;
      if (f.visible) {
        const t = clock.elapsedTime;
        const lick = Math.sin(t * 17) * 0.18 + Math.sin(t * 29) * 0.08;
        f.scale.set(0.09 * (1 - lick * 0.4), 0.13 * (1 + lick), 0.09 * (1 - lick * 0.4));
        f.rotation.z = Math.sin(t * 7) * 0.15;
      }
    }
  });
  return (
    <group>
      <mesh position={[0, 0, -length / 2]} rotation={[Math.PI / 2, 0, 0]} material={toon('#b08154')} castShadow={shadow}>
        <cylinderGeometry args={[0.0055, 0.008, length, 6]} />
      </mesh>
      <group ref={mallow} position={[0, 0, -(length - MALLOW.in)]}>
        {/* skewered across: its flat ends face along the stick */}
        <mesh rotation={[Math.PI / 2, 0, 0]} material={mat} castShadow={shadow}>
          <cylinderGeometry args={[MALLOW.r, MALLOW.r, MALLOW.h, 14]} />
          <Outlines thickness={0.006} color={INK} />
        </mesh>
        <group ref={flame} position={[0, MALLOW.r * 0.5, 0]} visible={false}>
          <mesh geometry={flameGeometry()} material={glow('#ff8a1f')} />
          <mesh geometry={flameGeometry()} material={glow('#ffd166')} scale={[0.55, 0.6, 0.55]} position={[0, 0.02, 0]} />
        </group>
      </group>
    </group>
  );
}
