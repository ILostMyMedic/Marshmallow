// The game: the floor you're on in 3D, walked in first person or looked down on in the overview (rig.ts), its workers at
// their desks, out on errands and chatting, and the city round the building. A picker along the bottom moves between floors and
// the lobby; panels (a terminal, the board) open over the view. Adapted from cubefarm client/src/world/Game.tsx and
// camera/CameraRig.tsx (MIT): the canvas, lights and sky, and the overview's mouse.
import { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { HUD } from '../ui/HUD';
import { Overlays } from '../ui/Overlays';
import { OVERVIEW } from './cameraMath';
import { Chatter } from './Chatter';
import { City } from './City';
import { floorElevation, lobbyColliders, officeColliders } from './layout';
import { useRide } from './elevatorRide';
import { Me } from './Me';
import { Lobby, OfficeFloor } from './OfficeFloor';
import { AdaptiveResolution, currentDpr } from './perf';
import { Player } from './Player';
import { bindCamera, orbitBy, panBy, setViewport, zoomBy } from './rig';
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
 * Hands the camera and the view's size to the rig, and takes the overview's mouse: a drag turns it round the floor (and
 * tilts it), a right-drag or shift-drag pans, the wheel zooms. Mouse events, so the player's quiet guard can swallow
 * them after a click that opened something.
 */
function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const dom = useThree((s) => s.gl.domElement);
  useEffect(() => {
    bindCamera(camera);
    return () => bindCamera(null);
  }, [camera]);
  useEffect(() => setViewport(size.width, size.height), [size.width, size.height]);
  useEffect(() => {
    let drag: { x: number; y: number; pan: boolean } | null = null;
    const overview = () => useView.getState().mode === 'overview' && !useView.getState().overlay;
    const down = (e: MouseEvent) => {
      if (overview()) drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
    };
    const move = (e: MouseEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.pan) panBy(dx, dy);
      else orbitBy(dx, dy);
    };
    const up = () => (drag = null);
    const wheel = (e: WheelEvent) => {
      if (!overview()) return;
      e.preventDefault();
      zoomBy(e.deltaY);
    };
    const menu = (e: Event) => e.preventDefault();
    dom.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    dom.addEventListener('wheel', wheel, { passive: false });
    dom.addEventListener('contextmenu', menu);
    return () => {
      dom.removeEventListener('mousedown', down);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      dom.removeEventListener('wheel', wheel);
      dom.removeEventListener('contextmenu', menu);
    };
  }, [dom]);
  return null;
}

/** Floors and the lobby, along the bottom: which one the view shows. */
/** The view goes dark for a moment while the elevator carries you between floors. */
function RideFade() {
  const dark = useRide((s) => s.phase === 'dark');
  return <div className={`ride-fade${dark ? ' dark' : ''}`} />;
}

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
  const lobby = !floor;
  // The floor on screen is the one you're on, for the elevator's sign and buttons, until a ride or the picker moves you.
  const setFloor = useView((s) => s.setFloor);
  useEffect(() => {
    if (loaded && picked !== shown) setFloor(shown);
  }, [loaded, picked, shown, setFloor]);
  // the elevator's doorway opens and shuts with its doors (elevatorRide.ts elevatorShut)
  const colliders = useMemo(() => (lobby ? lobbyColliders(false) : officeColliders(false)), [lobby]);

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
        <CameraRig />
        <Player floor={shown} colliders={colliders} />
        <AdaptiveResolution />
        <Chatter />
        <Me />
        {floor ? <OfficeFloor key={floor.id} floor={floor} top={top} /> : <Lobby top={top} />}
        <City elevation={floorElevation(shown)} />
      </Canvas>
      <header className="game-title">
        <strong>{floor ? floor.fullName : 'Lobby'}</strong>
        {floor?.summary && <span>{floor.summary}</span>}
      </header>
      <HUD />
      <FloorPicker shown={shown} />
      <a className="game-debug" href="/debug">
        Debug page
      </a>
      <RideFade />
      <Overlays />
    </div>
  );
}
