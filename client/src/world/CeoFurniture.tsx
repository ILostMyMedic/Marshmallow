// The CEO's office's furniture (ceoRoom.ts builds it): one mesh for everything standing on the floor, one for its
// trim, one for what hangs on the walls (cut away with them in the overview) and one for the rugs; the pictures' faces
// from one canvas (ceoArt.ts); the fish tank's water and its fish (one instanced mesh, swimming); the wall clock and the
// week's whiteboard (CeoWeekBoard.tsx). About 15 draw calls for the whole room, ink and shadows included. New in
// Marshmallow.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCanvasTexture } from './canvasTexture';
import { paintPictures, PICTURES_TEX } from './ceoArt';
import { ceoRoom, picturesGeometry } from './ceoRoom';
import { CeoWeekBoard } from './CeoWeekBoard';
import { CUT_PLANES } from './cutaway';
import { EXEC_CLOCK, EXEC_TANK, HALF_W } from './layout';
import { toon } from './materials';
import { INK, Outlines } from './Outlines';
import { WallClock } from './Props';
import { merged } from './shapes';
import { trophyMaterial } from './trophyModels';

/** White toon tinted by each vertex's colour (as the trophies are), cut away with the walls. */
const WALL_MATERIAL = (() => {
  const m = toon('#ffffff').clone() as THREE.MeshToonMaterial;
  m.vertexColors = true;
  // a clone copies the planes it had: these must be the shared ones the cutaway moves
  m.clippingPlanes = CUT_PLANES.room;
  return m;
})();
const WATER = toon('#5ec8f2', { opacity: 0.3 });
const FISH_MATERIAL = toon('#ffffff').clone() as THREE.MeshToonMaterial;

/** The tank's fish: colour, how fast they cross it, how high they swim and how far back. */
const FISH = [
  { color: '#f77f00', speed: 0.42, y: 0.3, z: -0.08, phase: 0 },
  { color: '#ffd166', speed: 0.55, y: 0.45, z: 0.06, phase: 2.1 },
  { color: '#4cc9f0', speed: 0.36, y: 0.22, z: 0.1, phase: 4.0 },
  { color: '#ff70a6', speed: 0.48, y: 0.52, z: -0.12, phase: 5.3 },
  { color: '#f77f00', speed: 0.6, y: 0.38, z: 0, phase: 1.2 },
];

/** A cartoon fish pointing +x: a squashed body and a tail fin. */
function fishGeometry() {
  const body = new THREE.SphereGeometry(0.06, 12, 8).scale(1, 0.72, 0.45);
  const tail = new THREE.CylinderGeometry(0.045, 0.002, 0.07, 8).rotateZ(Math.PI / 2).scale(1, 1, 0.3).translate(-0.085, 0, 0);
  return merged([body, tail]);
}

const fish = new THREE.Object3D();

/** The water and the fish swimming to and fro in it, turning at the glass. */
function FishTank() {
  const { x, z, w, d, base, h } = EXEC_TANK;
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(fishGeometry, []);
  useEffect(() => () => geo.dispose(), [geo]);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const c = new THREE.Color();
    FISH.forEach((f, i) => m.setColorAt(i, c.set(f.color)));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);
  const reach = w / 2 - 0.22;
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime;
    FISH.forEach((f, i) => {
      const a = t * f.speed + f.phase;
      const b = a * 2.3 + i;
      // heading along their path, so they turn round smoothly at the ends; a wag of the tail on top
      const vx = Math.cos(a) * reach;
      const vz = Math.cos(b) * 0.05 * 2.3;
      fish.position.set(Math.sin(a) * reach, base + f.y + Math.sin(t * 1.3 + i) * 0.03, f.z + Math.sin(b) * 0.05);
      fish.rotation.set(0, Math.atan2(-vz, vx) + Math.sin(t * 9 + i) * 0.12, 0);
      fish.updateMatrix();
      m.setMatrixAt(i, fish.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <group position={[x, 0, z]}>
      <instancedMesh ref={ref} args={[geo, FISH_MATERIAL, FISH.length]} frustumCulled={false} />
      <mesh position={[0, base + 0.05 + (h - 0.12) / 2, 0]} material={WATER}>
        <boxGeometry args={[w - 0.05, h - 0.12, d - 0.05]} />
      </mesh>
    </group>
  );
}

/** The pictures' faces: one canvas, one mesh, cut away with their walls. */
function Pictures() {
  const tex = useCanvasTexture(PICTURES_TEX.w, PICTURES_TEX.h, paintPictures, []);
  const geo = useMemo(() => picturesGeometry(PICTURES_TEX.cols, PICTURES_TEX.rows), []);
  const face = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, clippingPlanes: CUT_PLANES.room }), []);
  face.map = tex;
  useEffect(
    () => () => {
      geo.dispose();
      face.dispose();
    },
    [geo, face],
  );
  return <mesh geometry={geo} material={face} />;
}

export function CeoFurniture() {
  const room = useMemo(ceoRoom, []);
  useEffect(
    () => () => {
      for (const g of Object.values(room)) g.dispose();
    },
    [room],
  );
  return (
    <group>
      <mesh geometry={room.solid} material={trophyMaterial} castShadow receiveShadow>
        <Outlines thickness={0.018} color={INK} />
      </mesh>
      <mesh geometry={room.trim} material={trophyMaterial} receiveShadow />
      <mesh geometry={room.wall} material={WALL_MATERIAL}>
        <Outlines thickness={0.018} color={INK} cut="room" />
      </mesh>
      <mesh geometry={room.rugs} material={trophyMaterial} receiveShadow />
      <Pictures />
      <FishTank />
      <WallClock position={[HALF_W - 0.05, EXEC_CLOCK.y, EXEC_CLOCK.z]} rotationY={-Math.PI / 2} />
      <CeoWeekBoard />
    </group>
  );
}
