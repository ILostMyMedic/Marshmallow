// The game: the floor you're looking at in 3D, from above with its near walls and the floors above cut away, its
// workers at their desks, and the city round the building. A picker along the bottom moves between floors and the
// lobby. Adapted from cubefarm client/src/world/Game.tsx (MIT): the canvas, lights and sky; the overview camera's
// controls are rewritten (cubefarm's live in camera/rig.ts, with the first-person player).
import { useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { dampOrbit, newOrbit, newPose, orbitPose, OVERVIEW, overviewOrbit, panOrbit, type Orbit } from './cameraMath';
import { City } from './City';
import { setCut } from './cutaway';
import { floorElevation } from './layout';
import { Lobby, OfficeFloor } from './OfficeFloor';
import { AdaptiveResolution, currentDpr } from './perf';
import { useView } from './view';

const SKY = '#bfe3ff';
const HAZE = '#e4eef4';

function Lights() {
  return (
    <>
      <hemisphereLight args={['#fffaf0', '#a48a6a', 0.95]} />
      <ambientLight intensity={0.18} />
      <directionalLight position={[9, 14, 7]} intensity={1.55} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0006} shadow-normalBias={0.03}>
        <orthographicCamera attach="shadow-camera" args={[-22, 22, 22, -22, 0.5, 60]} />
      </directionalLight>
    </>
  );
}

/**
 * The overview: an orbit round the floor, fitted to the window to start with. Drag to turn it (and tilt it), the wheel
 * zooms, a right-drag (or shift-drag) pans. The walls facing the camera are cut away as it turns (cutaway.ts).
 */
function OverviewCamera() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const dom = useThree((s) => s.gl.domElement);
  const st = useMemo(() => ({ cur: newOrbit(), goal: newOrbit(), pose: newPose(), fit: 1, placed: false }), []);

  // Fit the floor to the window, and again when it's resized (keeping how far in the manager has zoomed).
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const fitted = overviewOrbit(st.placed ? st.goal.yaw : 0, aspect, newOrbit());
    const zoom = st.placed ? st.goal.dist / st.fit : 1;
    st.fit = fitted.dist;
    if (!st.placed) {
      Object.assign(st.goal, fitted);
      Object.assign(st.cur, fitted);
      st.placed = true;
    } else st.goal.dist = fitted.dist * zoom;
  }, [size.width, size.height, st]);

  useEffect(() => {
    let drag: { x: number; y: number; pan: boolean } | null = null;
    const zoomTo = (o: Orbit, d: number) => (o.dist = Math.min(st.fit * OVERVIEW.maxZoom, Math.max(OVERVIEW.minDist, d)));
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
      dom.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      const g = st.goal;
      if (drag.pan) {
        const perPx = (2 * g.dist * Math.tan((g.fov * Math.PI) / 360)) / Math.max(1, dom.clientHeight);
        panOrbit(g, -dx * perPx, (dy * perPx) / Math.sin(g.el));
      } else {
        g.yaw -= dx * 0.006;
        g.el = Math.min(OVERVIEW.maxEl, Math.max(OVERVIEW.minEl, g.el + dy * 0.004));
      }
    };
    const up = (e: PointerEvent) => {
      drag = null;
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomTo(st.goal, st.goal.dist * Math.exp(e.deltaY * 0.0012));
    };
    const menu = (e: Event) => e.preventDefault();
    dom.addEventListener('pointerdown', down);
    dom.addEventListener('pointermove', move);
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', wheel, { passive: false });
    dom.addEventListener('contextmenu', menu);
    return () => {
      dom.removeEventListener('pointerdown', down);
      dom.removeEventListener('pointermove', move);
      dom.removeEventListener('pointerup', up);
      dom.removeEventListener('pointercancel', up);
      dom.removeEventListener('wheel', wheel);
      dom.removeEventListener('contextmenu', menu);
    };
  }, [dom, st]);

  useFrame((_, delta) => {
    dampOrbit(st.cur, st.goal, Math.min(delta, 0.1), 8);
    const p = orbitPose(st.cur, st.pose);
    camera.position.set(p.x, p.y, p.z);
    camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    if (camera.fov !== p.fov || camera.near !== p.near) {
      camera.fov = p.fov;
      camera.near = p.near;
      camera.updateProjectionMatrix();
    }
    setCut(st.cur.yaw);
  });
  return null;
}

/** Floors and the lobby, along the bottom: which one the view shows. */
function FloorPicker({ shown }: { shown: number }) {
  const floors = useStore((s) => s.floors);
  const workers = useStore((s) => s.workers);
  const setFloor = useView((s) => s.setFloor);
  const count = (floorId: string) => Object.values(workers).filter((w) => w.floorId === floorId && w.role === 'worker').length;
  return (
    <nav className="floor-picker" aria-label="Floors">
      {[...floors].reverse().map((f) => (
        <button key={f.id} className={f.floor === shown ? 'on' : ''} style={{ borderColor: f.color }} onClick={() => setFloor(f.floor)} title={f.description || f.fullName}>
          <span className="floor-no" style={{ background: f.color }}>
            {f.floor}
          </span>
          {f.fullName.split('/')[1] ?? f.fullName}
          <span className="floor-count">{count(f.id)} 🧑‍💻</span>
        </button>
      ))}
      <button className={shown === 0 ? 'on' : ''} onClick={() => setFloor(0)}>
        <span className="floor-no">L</span>
        Lobby
      </button>
    </nav>
  );
}

export function Game() {
  const loaded = useStore((s) => s.loaded);
  const floors = useStore((s) => s.floors);
  const workers = useStore((s) => s.workers);
  const picked = useView((s) => s.floor);
  // Until the manager picks a floor: the first with workers on it, else the first floor, else the lobby.
  const busiest = floors.find((f) => Object.values(workers).some((w) => w.floorId === f.id)) ?? floors[0];
  const shown = picked !== null && (picked === 0 || floors.some((f) => f.floor === picked)) ? picked : (busiest?.floor ?? 0);
  const floor = floors.find((f) => f.floor === shown) ?? null;
  const top = floors.reduce((n, f) => Math.max(n, f.floor), 0);

  if (!loaded) return <div className="game-loading">Connecting to the office…</div>;
  return (
    <div className="game">
      <Canvas
        shadows
        dpr={currentDpr()}
        camera={{ fov: OVERVIEW.fov, near: 0.5, far: 900, position: [30, 30, 30] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1;
          gl.shadowMap.type = THREE.PCFShadowMap;
          // only the building's materials carry the cutaway's planes (cutaway.ts)
          gl.localClippingEnabled = true;
        }}
      >
        <color attach="background" args={[SKY]} />
        <fog attach="fog" args={[HAZE, 90, 320]} />
        <Lights />
        <OverviewCamera />
        <AdaptiveResolution />
        {floor ? <OfficeFloor key={floor.id} floorId={floor.id} floor={floor.floor} top={top} color={floor.color} /> : <Lobby top={top} />}
        <City elevation={floorElevation(shown)} />
      </Canvas>
      <header className="game-title">
        <strong>{floor ? floor.fullName : 'Lobby'}</strong>
        {floor?.summary && <span>{floor.summary}</span>}
      </header>
      <FloorPicker shown={shown} />
      <a className="game-debug" href="/debug">
        Debug page
      </a>
    </div>
  );
}
