// Adapted from cubefarm client/src/world/Rituals.tsx's DeskLamps (MIT): lit by the clock's lamps (lamps.tsx) rather
// than the evening's wind-down, which is cut along with going home; the lamp leans over the desk from its back corner.

// A lamp on every occupied desk, in the back corner on the mug's side with its shade over the desk: a dull bulb by day,
// and after dusk a warm bulb and a pool of light on the desk. Three draw calls for the whole floor (the pools hidden by
// day), updated only when the desks or the lamps' level change.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Worker } from '../../../../shared/types';
import { deskPosition, deskRotation, SEATS } from '../layout';
import { toon } from '../materials';
import { merged } from '../shapes';
import { lampsOn } from './lamps';

/** The lamp's foot on the desk (desk space), and how far its arm turns from leaning along −x to over the desk. */
const FOOT = { x: 0.78, y: 0.77, z: -0.32 };
const TURN = 0.93;

const lampSpace = (g: THREE.BufferGeometry) => g.rotateY(TURN).translate(FOOT.x, FOOT.y, FOOT.z);
// lamp space: its foot on the desk, the shade leaning towards −x
const lampGeometry = lampSpace(
  merged([
    new THREE.CylinderGeometry(0.065, 0.08, 0.025, 16).translate(0, 0.0125, 0),
    new THREE.CylinderGeometry(0.012, 0.012, 0.36, 8).translate(0, 0.2, 0),
    new THREE.CylinderGeometry(0.01, 0.01, 0.17, 8).rotateZ(Math.PI / 2).translate(-0.085, 0.375, 0),
    new THREE.CylinderGeometry(0.04, 0.09, 0.11, 16).translate(-0.17, 0.33, 0),
  ]),
);
const bulbGeometry = lampSpace(new THREE.SphereGeometry(0.035, 12, 8).translate(-0.17, 0.27, 0));
// the warm pool on the desktop under the shade (desk space), clear of the desk's edges
const poolGeometry = new THREE.PlaneGeometry(0.72, 0.6).rotateX(-Math.PI / 2).translate(0.55, FOOT.y + 0.006, 0.02);

const BULB_OFF = new THREE.Color('#d6d0c2');
const BULB_ON = new THREE.Color('#fff1c1');

function poolTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let mats: { bulb: THREE.MeshBasicMaterial; pool: THREE.MeshBasicMaterial } | null = null;
/** Shared, made once and kept like toon()'s. */
const materials = () =>
  (mats ??= {
    bulb: new THREE.MeshBasicMaterial({ color: BULB_OFF.clone(), toneMapped: false }),
    pool: new THREE.MeshBasicMaterial({ map: poolTexture(), color: '#ffd89a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  });

/** The lamps on the desks of `workers` (an office floor's). */
export function DeskLamps({ workers }: { workers: Worker[] }) {
  const lamps = useRef<THREE.InstancedMesh>(null);
  const bulbs = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);
  const key = [...new Set(workers.map((w) => w.desk % SEATS))].sort((a, b) => a - b).join(',');
  const slots = useMemo(() => (key ? key.split(',').map(Number) : []), [key]);
  const seen = useRef(-1);
  const m = materials();

  useLayoutEffect(() => {
    const meshes = [lamps.current, bulbs.current, pools.current];
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const at = new THREE.Vector3();
    for (const mesh of meshes) {
      if (!mesh) continue;
      slots.forEach((s, i) => {
        const d = deskPosition(s);
        mesh.setMatrixAt(i, mat.compose(at.set(d.x, 0, d.z), q.setFromAxisAngle(up, deskRotation(s)), one));
      });
      mesh.count = slots.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, [slots]);

  useFrame(() => {
    const level = lampsOn();
    if (Math.abs(level - seen.current) < 0.004) return;
    seen.current = level;
    m.bulb.color.lerpColors(BULB_OFF, BULB_ON, level);
    m.pool.opacity = level * 0.5;
    if (pools.current) pools.current.visible = level > 0.01;
  });

  return (
    <group>
      <instancedMesh ref={lamps} args={[lampGeometry, toon('#3d5a80'), SEATS]} castShadow frustumCulled={false} />
      <instancedMesh ref={bulbs} args={[bulbGeometry, m.bulb, SEATS]} frustumCulled={false} />
      <instancedMesh ref={pools} args={[poolGeometry, m.pool, SEATS]} visible={false} frustumCulled={false} renderOrder={1} />
    </group>
  );
}
