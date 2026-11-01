// The lab's 3D side: its clock, the game's daylight and toon look, a soft floor, a desk and chair that roll in for the
// seated animations, the turntable, and the renderer that draws each design in a cell of its own from the same camera
// (only that design showing), so every one is framed alike.
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { indoorLight } from '../world/sky/indoor';
import { shade } from '../world/materials';
import { Box, Cyl } from '../world/Toon';
import { DESIGN_OF, type DesignId } from './designs';
import { inkGameOutlines } from './ink';
import { cellRect, gridFor } from './layout';
import { LabFigure } from './LabFigure';
import { blendWeight, inTurn, SEAT_BLEND_S } from './player';
import { SCENE, SEATED, smooth, type AnimName } from './poses';
import type { V3 } from './rig';
import { labClock, shownDesigns, useLab } from './state';

/** Late morning in the game's day (dayTime.ts phase), for its light. */
const DAY_T = 0.42;
const FLOOR = '#e6c9a3';
const RUG = '#d9b3a3';
const WOOD = '#f1d19b'; // Desk.tsx
const CHAIR = '#e07a5f';

/** Runs the lab's clock (paused, faster or slower) and moves on to the next animation when they play in turn. */
function Clock() {
  useFrame((_, delta) => {
    const s = useLab.getState();
    labClock.dt = s.paused ? 0 : Math.min(delta, 0.1) * s.speed;
    labClock.t += labClock.dt;
    if (s.inTurn) {
      const next = inTurn({ anim: s.anim, at: s.at }, labClock.t);
      if (next.anim !== s.anim) s.play(next.anim);
    }
  }, -1);
  return null;
}

/** The game's indoor daylight (sky/indoor.ts) at DAY_T: a sun casting shadows, the hemisphere and ambient fill. */
function Lights() {
  const L = useMemo(() => indoorLight(DAY_T), []);
  const gl = useThree((s) => s.gl);
  useEffect(() => void (gl.toneMappingExposure = L.exposure), [gl, L]);
  const key = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const k = key.current;
    if (!k) return;
    const cam = k.shadow.camera;
    cam.left = cam.bottom = -2.2;
    cam.right = cam.top = 2.2;
    cam.near = 1;
    cam.far = 30;
    cam.updateProjectionMatrix();
  }, []);
  const [x, y, z] = L.dir;
  return (
    <>
      <hemisphereLight args={[L.hemiSky, L.hemiGround, L.hemiIntensity]} />
      <ambientLight color={L.ambientColor} intensity={L.ambient} />
      <directionalLight ref={key} position={[x * 12, y * 12, z * 12]} color={L.keyColor} intensity={L.keyIntensity} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0006} shadow-normalBias={0.02} />
    </>
  );
}

function Floor() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[9, 64]} />
        <meshToonMaterial color={FLOOR} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} receiveShadow>
        <circleGeometry args={[1.45, 48]} />
        <meshToonMaterial color={RUG} />
      </mesh>
    </>
  );
}

/** The animations at the desk (sitting at ease has the chair alone, so the legs show). */
const AT_DESK: ReadonlySet<AnimName> = new Set<AnimName>(['type', 'asleep']);

/** Eases a piece of furniture in (1) or out (0) as the animation changes: in ahead of them sitting, out once they're up. */
function useComing(want: (a: AnimName) => boolean) {
  const st = useRef({ anim: useLab.getState().anim, from: -1, was: 0, at: want(useLab.getState().anim) ? 1 : 0 });
  return () => {
    const anim = useLab.getState().anim;
    const s = st.current;
    if (anim !== s.anim) {
      s.was = s.at;
      s.from = labClock.t;
      s.anim = anim;
    }
    const goal = want(anim) ? 1 : 0;
    const w = s.from < 0 ? 1 : blendWeight(labClock.t, s.from, SEAT_BLEND_S);
    const k = goal > s.was ? smooth(w * 1.7) : smooth((w - 0.35) * 1.6);
    s.at = s.was + (goal - s.was) * k;
    return s.at;
  };
}

/**
 * The game's desk and chair (Desk.tsx's sizes): the chair rolls in under them as they sit and back out as they stand;
 * the desk rises in front of them for the desk's animations and sinks away again.
 */
function Furniture() {
  const chair = useRef<THREE.Group>(null);
  const desk = useRef<THREE.Group>(null);
  const root = useRef<THREE.Group>(null);
  const seat = useComing((a) => SEATED.has(a));
  const atDesk = useComing((a) => AT_DESK.has(a));
  useFrame(() => {
    if (chair.current) chair.current.position.z = 0.75 * (1 - seat());
    if (desk.current) {
      const out = 1 - atDesk();
      desk.current.position.set(0, -0.9 * out, 0);
      desk.current.visible = out < 0.99;
    }
    if (root.current) inkGameOutlines(root.current, useLab.getState().outlines, 1);
  });
  const deskZ = SCENE.deskEdge - 0.475;
  return (
    <group ref={root}>
      <group ref={chair}>
        <Box size={[0.52, 0.08, 0.5]} position={[0, 0.44, 0]} color={CHAIR} outline />
        <Box size={[0.48, 0.42, 0.07]} position={[0, 0.72, 0.28]} color={CHAIR} outline />
        <Cyl r={0.035} h={0.36} position={[0, 0.22, 0]} color="#444a5c" />
        <Cyl r={0.26} h={0.04} position={[0, 0.03, 0]} color="#444a5c" />
      </group>
      <group ref={desk}>
        <group position={[0, 0, deskZ]}>
          <Box size={[1.25, 0.06, 0.95]} position={[0, 0.74, 0]} color={WOOD} outline />
          {[-0.57, 0.57].flatMap((x) => [-0.42, 0.42].map((z) => <Box key={`${x}${z}`} size={[0.06, 0.71, 0.06]} position={[x, 0.355, z]} color="#5c677d" />))}
          <Box size={[1.12, 0.4, 0.03]} position={[0, 0.5, -0.44]} color={shade(WOOD, -0.08)} />
          {/* the keyboard (typing.ts KEYBOARD_OFFSET) and a monitor at the back */}
          <Box size={[0.52, 0.03, 0.18]} position={[0, SCENE.keysY - 0.015, SCENE.keysZ - deskZ]} color="#c3c8d3" outline />
          <Box size={[0.6, 0.36, 0.05]} position={[0, 1.2, -0.3]} color="#2b2d42" outline />
          <Box size={[0.07, 0.3, 0.05]} position={[0, 0.92, -0.33]} color="#3d4152" />
          <Cyl r={0.15} h={0.025} position={[0, 0.782, -0.33]} color="#3d4152" />
        </group>
      </group>
    </group>
  );
}

/** Draws every design on show in its own cell, from the one camera, with only that design visible. */
function Cells({ figures }: { figures: Map<DesignId, THREE.Group> }) {
  useFrame(({ gl, scene, camera, size }) => {
    const { view, hidden } = useLab.getState();
    const ids = shownDesigns(view, hidden).filter((id) => figures.has(id));
    const grid = gridFor(ids.length, size.width, size.height);
    const cam = camera as THREE.PerspectiveCamera;
    gl.autoClear = false;
    gl.setScissorTest(false);
    gl.clear();
    gl.setScissorTest(true);
    ids.forEach((id, i) => {
      figures.forEach((g, k) => (g.visible = k === id));
      const r = cellRect(i, grid, size.width, size.height);
      const y = size.height - r.y - r.h;
      gl.setViewport(r.x, y, r.w, r.h);
      gl.setScissor(r.x, y, r.w, r.h);
      cam.aspect = r.w / r.h;
      cam.updateProjectionMatrix();
      gl.render(scene, cam);
    });
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width, size.height);
  }, 1);
  return null;
}

/** Turns the figures and their furniture round, slowly, while the turntable's on. */
function Turntable({ children }: { children: ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (g.current && useLab.getState().turntable) g.current.rotation.y += Math.min(delta, 0.1) * 0.6;
  });
  return <group ref={g}>{children}</group>;
}

export type CameraName = 'full' | 'close' | 'side' | 'feet' | 'head';
export const CAMERAS: Record<CameraName, { target: V3; position: V3 }> = {
  full: { target: [0, 0.96, -0.12], position: [2.4, 1.8, -3.9] },
  close: { target: [0, 1.22, -0.05], position: [1.25, 1.6, -2.6] },
  side: { target: [0, 0.92, -0.12], position: [4.3, 1.3, -0.12] },
  feet: { target: [0, 0.1, -0.1], position: [0.75, 0.45, -1.15] },
  head: { target: [0, 1.7, 0], position: [0.85, 1.98, -1.45] },
};

/** The head preset's numbers are for a head drawn at this scale (Stylized human's); bigger heads are framed from further. */
const HEAD_SCALE = 0.88;

/**
 * Moves the orbit camera to one of the presets when `cam` changes. The head preset frames the first figure's head where
 * it is, once the figures have taken their pose.
 */
function CameraPreset({ cam }: { cam: CameraName }) {
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const pending = useRef(false);
  useEffect(() => {
    const c = CAMERAS[cam];
    camera.position.set(...c.position);
    controls?.target.set(...c.target);
    controls?.update();
    pending.current = cam === 'head';
  }, [cam, camera, controls]);
  useFrame(() => {
    if (!pending.current || !controls) return;
    let head: THREE.Object3D | null = null;
    scene.traverse((o) => {
      if (!head && o.userData.labHead) head = o;
    });
    const at = (head as THREE.Object3D | null)?.getWorldPosition(new THREE.Vector3());
    if (!head || !at || at.y < 0.2) return; // not posed yet
    const k = (head as THREE.Object3D).scale.x / HEAD_SCALE;
    const c = CAMERAS.head;
    controls.target.copy(at).add(new THREE.Vector3(0, 0.1 * k, 0));
    camera.position.set(c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]).multiplyScalar(k).add(controls.target);
    controls.update();
    pending.current = false;
  });
  return null;
}

export function LabScene({ cam }: { cam: CameraName }) {
  const look = useLab((s) => s.look);
  const view = useLab((s) => s.view);
  const hidden = useLab((s) => s.hidden);
  const ids = shownDesigns(view, hidden);
  const figures = useMemo(() => new Map<DesignId, THREE.Group>(), []);
  return (
    <>
      <Clock />
      <Lights />
      <Floor />
      <Turntable>
        <Furniture />
        {ids.map((id) => (
          <LabFigure
            key={id}
            design={DESIGN_OF[id]}
            look={look}
            group={(g) => {
              if (g) figures.set(id, g);
              else figures.delete(id);
            }}
          />
        ))}
      </Turntable>
      <OrbitControls makeDefault target={[...CAMERAS.full.target]} minDistance={0.6} maxDistance={9} maxPolarAngle={Math.PI / 2 - 0.04} />
      <CameraPreset cam={cam} />
      <Cells figures={figures} />
    </>
  );
}
