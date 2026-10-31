// Adapted from cubefarm client/src/world/events/scenes/Helicopter.tsx (MIT): its landing on the roof's helipad cut; it
// circles high enough to clear the rooftops round its circle.

// A news helicopter flying in, circling the block a few times just above the rooftops (banked into the turn, its
// rotor a blur and chopping the air), and flying off again.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { loop, placeAt } from '../../../ui/eventSfx';
import { theCity } from '../../cityLayout';
import { seeded } from '../director';
import { ceilingWithin } from '../flight';
import { eyeAbove, inOut, lerp, sign, smooth, toonOut, type SceneProps } from '../kit';

const IN = 8; // seconds flying in, and out at the end
const LAP = 19; // seconds per circle

export default function Helicopter({ run, elevation }: SceneProps) {
  const body = useRef<THREE.Group>(null);
  const rotor = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Mesh>(null);
  const s = sign(run.side);
  const p = useMemo(() => {
    const r = seeded(run.seed);
    const cx = s * (85 + r() * 20);
    const radius = 42 + r() * 10;
    // round the block whose roofs are lowest, near the middle of the view: out of downtown's towers
    const start = (r() - 0.5) * 40;
    const circles = [start, start + 30, start + 60, start - 30].map((z) => ({ z, top: ceilingWithin(theCity(), cx, z, radius + 10) }));
    const { z: cz, top } = circles.reduce((a, b) => (b.top < a.top ? b : a));
    const y = Math.max(eyeAbove(elevation) + 9 + r() * 8, top + 10);
    return { cx, cz, radius, y, dir: r() < 0.5 ? 1 : -1, phase: r() * Math.PI * 2, far: { x: s * 420, z: (r() - 0.5) * 500 }, heading: 0 };
  }, [run.seed, s, elevation]);
  const m = useMemo(() => ({ prev: new THREE.Vector3(), first: true, spin: 0, rotor: null as ReturnType<typeof loop> | null }), []);
  useEffect(() => {
    m.rotor = loop('rotor');
    return () => m.rotor?.stop(1);
  }, [m]);

  useFrame((_, delta) => {
    const t = run.t;
    const g = body.current;
    if (!g) return;
    const a = p.phase + (p.dir * (t * Math.PI * 2)) / LAP;
    let x = p.cx + Math.cos(a) * p.radius;
    let z = p.cz + Math.sin(a) * p.radius;
    let y = p.y;
    // in from far away, out to far away at the end, high over the city both ways
    const arrive = smooth(t / IN);
    const leave = smooth((t - (run.seconds - IN)) / IN);
    x = lerp(p.far.x, x, arrive);
    z = lerp(-p.far.z, z, arrive);
    y += (1 - arrive) * 40;
    x = lerp(x, p.far.x, leave);
    z = lerp(z, p.far.z, leave);
    y += leave * 40;
    if (m.first) m.prev.set(x, y, z);
    m.first = false;
    // nose along the way it's going, banked into the turn
    const dx = x - m.prev.x;
    const dz = z - m.prev.z;
    if (dx * dx + dz * dz > 1e-5) p.heading = Math.atan2(dx, dz);
    g.rotation.y = p.heading;
    g.rotation.z = -p.dir * 0.22 * arrive * (1 - leave);
    g.rotation.x = 0.12;
    g.position.set(x, y, z);
    m.prev.set(x, y, z);
    m.spin += Math.min(delta, 0.1) * 31;
    if (rotor.current) rotor.current.rotation.y = m.spin;
    if (tail.current) tail.current.rotation.x = m.spin * 1.3;
    const heard = placeAt(x, y - elevation, z, 60);
    m.rotor?.set(heard.gain * inOut(t, run.seconds, 2), heard.pan);
  });

  const red = toonOut('#d62828');
  const dark = toonOut('#2b2d42');
  return (
    <group ref={body} scale={1.6}>
      <mesh material={red} scale={[1, 0.95, 1.5]}>
        <sphereGeometry args={[1.6, 14, 10]} />
      </mesh>
      <mesh material={toonOut('#8ecae6')} position={[0, 0.35, 1.25]} scale={[1, 0.7, 0.8]}>
        <sphereGeometry args={[1.05, 12, 8]} />
      </mesh>
      <mesh material={red} position={[0, 0.3, -3.2]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.28, 0.45, 4.2, 8]} />
      </mesh>
      <mesh material={toonOut('#f1faee')} position={[0, 1, -5.1]}>
        <boxGeometry args={[0.15, 1.4, 0.9]} />
      </mesh>
      <mesh ref={tail} material={dark} position={[0.2, 0.9, -5.2]}>
        <boxGeometry args={[0.05, 1.6, 0.18]} />
      </mesh>
      {[-0.9, 0.9].map((x) => (
        <mesh key={x} material={dark} position={[x, -1.55, 0]}>
          <boxGeometry args={[0.12, 0.12, 3.4]} />
        </mesh>
      ))}
      <mesh material={dark} position={[0, 1.55, 0]}>
        <cylinderGeometry args={[0.18, 0.18, 0.5, 8]} />
      </mesh>
      <group ref={rotor} position={[0, 1.85, 0]}>
        <mesh material={dark}>
          <boxGeometry args={[11, 0.06, 0.35]} />
        </mesh>
        <mesh material={dark} rotation-y={Math.PI / 2}>
          <boxGeometry args={[11, 0.06, 0.35]} />
        </mesh>
      </group>
    </group>
  );
}
