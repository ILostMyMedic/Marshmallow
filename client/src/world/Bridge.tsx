// The bay beyond the city's western shore and the red bridge across it (bridgeLayout.ts): two merged meshes, two draw
// calls. The water and the headlands fade into the haze with the city; the bridge and its hills fade less, so the red
// towers still read from 650 m out. Drawn in the city's frame (City.tsx), so it rides up and down with your floor.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { bayMesh, bridgeLayout, bridgeMesh, type MeshData } from './bridgeLayout';
import { BRIDGE_HAZE, CITY_HAZE, hazedToon } from './haze';

/** The plain numbers as a geometry, its colours turned into the renderer's linear ones. */
function geometry(data: MeshData) {
  const g = new THREE.BufferGeometry();
  const c = new THREE.Color();
  const colors = new Float32Array(data.colors.length * 3);
  data.colors.forEach((hex, i) => {
    c.setHex(hex);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  });
  g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeBoundingSphere();
  return g;
}

export function Bridge() {
  const geo = useMemo(() => ({ bay: geometry(bayMesh()), bridge: geometry(bridgeMesh(bridgeLayout())) }), []);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  return (
    <group>
      <mesh geometry={geo.bay} material={hazedToon('#ffffff', CITY_HAZE, { vertexColors: true })} />
      {/* both sides: the cables and suspenders are single strips */}
      <mesh geometry={geo.bridge} material={hazedToon('#ffffff', BRIDGE_HAZE, { vertexColors: true, side: THREE.DoubleSide })} />
    </group>
  );
}
