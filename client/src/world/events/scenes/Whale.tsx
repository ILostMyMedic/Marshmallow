// Adapted from cubefarm client/src/world/events/scenes/Whale.tsx (MIT): the whale song and the engines cut; it swims
// up over the skyline.

// A whale-shaped airship swimming slowly through the sky: a big friendly whale with a gondola slung under its belly,
// flukes and flippers waving, propellers turning, and a puff of spray from its blowhole now and then.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { theCity } from '../../cityLayout';
import { seeded } from '../director';
import { along, clearStretch, flightProfile } from '../flight';
import { eyeAbove, lerp, sign, toonOut, type SceneProps } from '../kit';

const SCALE = 12;
const SPRAY = 14;
const REACH = 240;

export default function Whale({ run, elevation }: SceneProps) {
  const whale = useRef<THREE.Group>(null);
  const flukes = useRef<THREE.Group>(null);
  const fins = useRef<(THREE.Mesh | null)[]>([]);
  const props = useRef<THREE.Group>(null);
  const spray = useRef<THREE.InstancedMesh>(null);
  const s = sign(run.side);
  const p = useMemo(() => {
    const r = seeded(run.seed);
    const dir = r() < 0.5 ? 1 : -1;
    const x = s * (150 + r() * 30);
    const base = eyeAbove(elevation) + 22 + r() * 8;
    // it swims towards -dir along z, 30 m long and 13 m from its back to the gondola's keel
    const [a, b] = clearStretch(theCity(), x, REACH, base + 15, 30);
    const [z0, z1] = dir > 0 ? [b, a] : [a, b];
    const profile = flightProfile(theCity(), { x0: x, z0, x1: x, z1 }, { base, margin: 18, pad: 30, slope: 0.25 });
    return { dir, x, z0, z1, profile, puff: 8 + r() * 5, puffAt: -100 };
  }, [run.seed, s, elevation]);
  const m = useMemo(() => ({ mat: new THREE.Matrix4(), v: new THREE.Vector3(), q: new THREE.Quaternion(), sc: new THREE.Vector3(), r: seeded(run.seed + 3) }), [run.seed]);
  const drops = useMemo(() => Array.from({ length: SPRAY }, () => ({ dx: (m.r() - 0.5) * 0.5, dz: (m.r() - 0.5) * 0.5, up: 0.7 + m.r() * 0.6 })), [m]);
  useLayoutEffect(() => {
    const mesh = spray.current;
    if (!mesh) return;
    m.mat.makeScale(0, 0, 0);
    for (let i = 0; i < SPRAY; i++) mesh.setMatrixAt(i, m.mat);
    mesh.instanceMatrix.needsUpdate = true;
  }, [m]);

  useFrame(() => {
    const t = run.t;
    const g = whale.current;
    if (!g) return;
    const k = t / run.seconds;
    const z = lerp(p.z0, p.z1, k);
    const y = along(p.profile, k) + Math.sin(t * 0.3) * 1.2;
    g.position.set(p.x, y, z);
    g.rotation.set(Math.sin(t * 0.45) * 0.04, p.dir > 0 ? Math.PI : 0, Math.sin(t * 0.3) * 0.03);
    if (flukes.current) flukes.current.rotation.x = Math.sin(t * 1.1) * 0.35;
    for (let i = 0; i < 2; i++) {
      const f = fins.current[i];
      if (f) f.rotation.z = (i ? -1 : 1) * (0.5 + Math.sin(t * 1.3) * 0.25);
    }
    const spin = props.current?.children;
    if (spin) for (let i = 0; i < spin.length; i++) spin[i].rotation.z = t * 12;
    if (t >= p.puff) {
      p.puff = t + 10 + Math.random() * 6;
      p.puffAt = t;
    }
    // a spout of spray from the blowhole, rising and fanning out
    const mesh = spray.current;
    if (mesh) {
      const age = t - p.puffAt;
      for (let i = 0; i < SPRAY; i++) {
        const d = drops[i];
        const live = age >= 0 && age < 2.2;
        const kk = live ? age / 2.2 : 0;
        m.v.set(d.dx * kk * 6, 0.95 + d.up * Math.sin(kk * Math.PI * 0.8) * 2.2, 0.9 + d.dz * kk * 6);
        const size = live ? 0.22 * (1 - kk * 0.6) * Math.min(1, age * 6) : 0;
        m.sc.set(size, size, size);
        mesh.setMatrixAt(i, m.mat.compose(m.v, m.q, m.sc));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  const blue = toonOut('#4f6d8f');
  const belly = toonOut('#dfe8f2');
  const ink = toonOut('#1f1d2b');
  return (
    <group ref={whale}>
      <group scale={SCALE}>
        {/* the whale swims towards its +z: head there, flukes at the back */}
        <mesh material={blue} scale={[1, 0.82, 2.4]}>
          <sphereGeometry args={[1, 26, 18]} />
        </mesh>
        <mesh material={belly} position={[0, -0.32, 0.5]} scale={[0.82, 0.55, 1.75]}>
          <sphereGeometry args={[1, 22, 14]} />
        </mesh>
        <group ref={flukes} position={[0, 0.05, -2.3]}>
          <mesh material={blue} position={[0, 0, -0.35]} scale={[0.35, 0.28, 0.7]}>
            <sphereGeometry args={[1, 12, 8]} />
          </mesh>
          {[-1, 1].map((x) => (
            <mesh key={x} material={blue} position={[x * 0.55, 0.05, -0.85]} rotation-y={x * 0.5} scale={[0.75, 0.08, 0.38]}>
              <sphereGeometry args={[1, 12, 8]} />
            </mesh>
          ))}
        </group>
        {[0, 1].map((i) => (
          <mesh key={i} ref={(f) => void (fins.current[i] = f)} material={blue} position={[i ? 0.95 : -0.95, -0.3, 0.7]} scale={[0.6, 0.08, 0.3]}>
            <sphereGeometry args={[1, 12, 8]} />
          </mesh>
        ))}
        {[-1, 1].map((x) => (
          <group key={x}>
            <mesh material={toonOut('#ffffff')} position={[x * 0.62, 0.12, 1.55]}>
              <sphereGeometry args={[0.13, 10, 8]} />
            </mesh>
            <mesh material={ink} position={[x * 0.68, 0.13, 1.6]}>
              <sphereGeometry args={[0.07, 8, 6]} />
            </mesh>
          </group>
        ))}
        <mesh material={ink} position={[0, -0.18, 2.12]} rotation-x={Math.PI / 2} scale={[1, 1, 0.25]}>
          <torusGeometry args={[0.32, 0.03, 6, 16, Math.PI]} />
        </mesh>
        <mesh material={toonOut('#e9c46a')} position={[0, -0.98, 0.3]}>
          <boxGeometry args={[0.5, 0.28, 1.1]} />
        </mesh>
        <group ref={props}>
          {[-0.45, 0.45].map((x) => (
            <mesh key={x} material={ink} position={[x, -0.95, -0.35]}>
              <boxGeometry args={[0.04, 0.42, 0.02]} />
            </mesh>
          ))}
        </group>
        <instancedMesh ref={spray} args={[undefined, undefined, SPRAY]} material={toonOut('#f1faff')} frustumCulled={false}>
          <sphereGeometry args={[1, 8, 6]} />
        </instancedMesh>
      </group>
    </group>
  );
}
