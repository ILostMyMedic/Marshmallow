// The marshmallows by the roof's fire: a crate on its open side with a bag of them, a few spilled, and a can of toasting
// sticks. E takes one on a stick (hands free); held out over the flames it toasts (toasting.ts, moved along here every
// frame from where you are and which way you face), E eats it, G drops it, and there's always another. New in
// Marshmallow.
import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { onAction } from '../actions';
import { useInteractable } from '../interact';
import { playerAt, rigOwnsCamera } from '../rig';
import { Box, Cyl } from '../Toon';
import { useView } from '../view';
import { MARSHMALLOW_CRATE as CRATE } from './roofLayout';
import { newMarshmallow, tickToast } from './toasting';

/** E on the crate: a marshmallow on a stick for empty hands. */
function take() {
  const view = useView.getState();
  if (view.held?.kind === 'marshmallow') return view.showToast('🍡 One at a time: eat that one first (E)');
  if (view.held) return view.showToast('🙌 Your hands are full');
  view.setHeld(newMarshmallow());
  view.showToast('🍡 Hold it out over the flames to toast it');
}

/** The sticks in their can, leaning every which way: their lean (x, z) and length. */
const STICKS: [number, number, number][] = [
  [0.12, 0.05, 0.62],
  [-0.08, 0.1, 0.58],
  [0.04, -0.12, 0.66],
  [-0.1, -0.06, 0.6],
];

export function Marshmallows() {
  const held = useView((s) => s.held?.kind ?? null);
  // reachable from the benches round the fire as well as standing at it
  const ref = useInteractable<THREE.Group>(held === 'marshmallow' ? null : { id: 'marshmallows', label: 'Take a marshmallow', action: { kind: 'marshmallow' } }, 4.4);
  useEffect(() => onAction('marshmallow', take), []);
  useFrame(({ camera }, delta) => {
    const view = useView.getState();
    if (view.held?.kind !== 'marshmallow') return;
    // in first person it's held out where you look; otherwise where your body faces
    const eyes = !rigOwnsCamera() && view.person === 'first';
    tickToast(Math.min(delta, 0.1), eyes ? camera.position.x : playerAt.x, eyes ? camera.position.z : playerAt.z, eyes ? camera.rotation.y : playerAt.yaw);
  });
  const top = CRATE.h;
  return (
    <group ref={ref} position={[CRATE.x, 0, CRATE.z]}>
      <Box size={[CRATE.w, CRATE.h, CRATE.d]} position={[0, CRATE.h / 2, 0]} color="#b5835a" outline />
      {[0.12, 0.3].map((y) => (
        <Box key={y} size={[CRATE.w + 0.01, 0.035, CRATE.d + 0.01]} position={[0, y, 0]} color="#8a5a32" shadow={false} />
      ))}
      {/* the bag: puffy, with a pink band and a twist at the top */}
      <Box size={[0.24, 0.2, 0.14]} position={[-0.09, top + 0.1, 0.02]} rotation={[0, 0.25, 0]} color="#fdfbf7" outline />
      <Box size={[0.245, 0.06, 0.145]} position={[-0.09, top + 0.1, 0.02]} rotation={[0, 0.25, 0]} color="#ff8fab" shadow={false} />
      <Cyl r={0.025} rTop={0.045} h={0.06} position={[-0.09, top + 0.23, 0.02]} color="#fdfbf7" outline />
      {/* a couple spilled */}
      <Cyl r={0.028} h={0.04} position={[0.05, top + 0.02, 0.13]} rotation={[0, 0, Math.PI / 2]} color="#fdfbf7" outline />
      <Cyl r={0.028} h={0.04} position={[0.11, top + 0.02, 0.1]} color="#fdfbf7" outline />
      {/* the can of sticks */}
      <Cyl r={0.055} h={0.16} position={[0.13, top + 0.08, -0.08]} color="#adb5bd" outline />
      {STICKS.map(([lx, lz, len], i) => (
        <group key={i} position={[0.13, top + 0.05, -0.08]} rotation={[lz, 0, -lx]}>
          <Cyl r={0.006} h={len} position={[0, len / 2, 0]} color="#b08154" shadow={false} seg={6} />
        </group>
      ))}
      {/* an easier target than the little things on it */}
      <mesh visible={false} position={[0, 0.45, 0]}>
        <boxGeometry args={[0.7, 0.9, 0.62]} />
      </mesh>
    </group>
  );
}
