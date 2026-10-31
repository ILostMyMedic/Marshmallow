// The string lights over the decking: festoon bulbs in party colours on wires that sag between six poles, zigzagging
// across and along the lounge. Dull glass by day; from dusk they glow warm with a soft halo each, following the
// office's lamps (DayLights sets their level, sky/lamps.tsx). Four draw calls, the halos hidden by day.
// Adapted from cubefarm client/src/world/roof/StringLights.tsx (MIT): the bulbs are one merged mesh rather than instances.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { toon } from '../materials';
import { merged } from '../shapes';
import { lampsOn } from '../sky/lamps';
import { LIGHT_POLES, POLE } from './roofLayout';
import { glowTexture } from './textures';

/** Which poles each wire runs between (LIGHT_POLES: north and south at each of three x): across in an X, and along. */
const STRANDS: [number, number][] = [
  [0, 3],
  [1, 2],
  [2, 5],
  [3, 4],
  [0, 2],
  [2, 4],
  [1, 3],
  [3, 5],
];
const TOP = POLE.h - 0.12; // where the wires hang from
const SPACING = 0.62; // metres between bulbs
const TINTS = ['#fff1c9', '#ffd166', '#ffb86b', '#ff8fab', '#8ecae6', '#fff1c9', '#b9fbc0'];
/** The bulbs' glass by day (it greys their tints) and lit. */
const OFF = new THREE.Color('#bdb6a6');
const ON = new THREE.Color('#ffffff');

/** Points along a wire from a to b, sagging `sag` in the middle (a parabola is close enough to a catenary here). */
function wire(a: { x: number; z: number }, b: { x: number; z: number }, n: number, sag: number) {
  return Array.from({ length: n + 1 }, (_, k) => {
    const u = k / n;
    return new THREE.Vector3(a.x + (b.x - a.x) * u, TOP - sag * 4 * u * (1 - u), a.z + (b.z - a.z) * u);
  });
}

let mats: { bulb: THREE.MeshBasicMaterial; wire: THREE.LineBasicMaterial; halo: THREE.PointsMaterial } | null = null;
/** Shared, made once and kept like toon()'s. */
const materials = () =>
  (mats ??= {
    bulb: new THREE.MeshBasicMaterial({ color: OFF.clone(), vertexColors: true, toneMapped: false }),
    wire: new THREE.LineBasicMaterial({ color: '#2b2d42' }),
    halo: new THREE.PointsMaterial({ size: 0.55, map: glowTexture(), vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  });

function lightsGeometry() {
  const wires: number[] = [];
  const bulbs: THREE.BufferGeometry[] = [];
  const at: number[] = [];
  const tints: number[] = [];
  const colour = new THREE.Color();
  let k = 0;
  for (const [i, j] of STRANDS) {
    const a = LIGHT_POLES[i];
    const b = LIGHT_POLES[j];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const sag = 0.12 + len * 0.035;
    const pts = wire(a, b, 24, sag);
    for (let m = 0; m < pts.length - 1; m++) wires.push(pts[m].x, pts[m].y, pts[m].z, pts[m + 1].x, pts[m + 1].y, pts[m + 1].z);
    for (const p of wire(a, b, Math.floor(len / SPACING), sag).slice(1, -1)) {
      const g = new THREE.SphereGeometry(0.055, 8, 6).scale(1, 1.3, 1).translate(p.x, p.y - 0.07, p.z);
      colour.set(TINTS[k++ % TINTS.length]);
      const n = g.attributes.position.count;
      g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [colour.r, colour.g, colour.b]).flat(), 3));
      bulbs.push(g);
      at.push(p.x, p.y - 0.07, p.z);
      tints.push(colour.r, colour.g, colour.b);
    }
  }
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
  const halos = new THREE.BufferGeometry();
  halos.setAttribute('position', new THREE.Float32BufferAttribute(at, 3));
  halos.setAttribute('color', new THREE.Float32BufferAttribute(tints, 3));
  const poles = merged(LIGHT_POLES.flatMap((p) => [new THREE.CylinderGeometry(POLE.r, POLE.r * 1.3, POLE.h, 8).translate(p.x, POLE.h / 2, p.z), new THREE.SphereGeometry(POLE.r * 1.6, 8, 6).translate(p.x, POLE.h, p.z)]));
  return { wires: wireGeo, bulbs: merged(bulbs), halos, poles };
}

export function StringLights() {
  const geo = useMemo(lightsGeometry, []);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  const m = materials();
  const halos = useRef<THREE.Points>(null);
  const level = useRef(-1);

  useFrame(() => {
    const l = lampsOn();
    if (Math.abs(l - level.current) < 0.004) return;
    level.current = l;
    m.bulb.color.lerpColors(OFF, ON, l);
    m.halo.opacity = l * 0.65;
    if (halos.current) halos.current.visible = l > 0.02;
  });

  return (
    <group>
      <mesh geometry={geo.poles} material={toon('#3d405b')} castShadow />
      <lineSegments geometry={geo.wires} material={m.wire} />
      <mesh geometry={geo.bulbs} material={m.bulb} />
      <points ref={halos} geometry={geo.halos} material={m.halo} visible={false} renderOrder={2} />
    </group>
  );
}
