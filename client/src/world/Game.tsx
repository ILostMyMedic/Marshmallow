// The game: the floor you're on in 3D, walked in first person or looked down on in the overview (rig.ts): the lobby,
// a repo's office with its workers at their desks, out on errands and chatting, the CEO's floor or the roof terrace
// (floors.ts), and the city round the building. A picker along the bottom moves between them; panels (a terminal, the
// board, the front desk) open over the view. The sky, the light and the lamps follow the office's clock (sky/).
// Adapted from cubefarm client/src/world/Game.tsx and camera/CameraRig.tsx (MIT): the canvas, lights and sky, and the
// overview's mouse.
import { useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { HUD } from '../ui/HUD';
import { OfficeKeys } from '../ui/OfficeKeys';
import { Overlays } from '../ui/Overlays';
import { SoundToggle } from '../ui/SoundToggle';
import { Toasts } from '../ui/Toasts';
import { act } from './actions';
import { OVERVIEW } from './cameraMath';
import { Chatter } from './Chatter';
import { City } from './City';
import { WorldEvents } from './events/WorldEvents';
import { CeoFloor } from './CeoFloor';
import { planRects } from './decor/spots';
import { useRide } from './elevatorRide';
import { elevationOf, isFloor, kindOf, stops, topStorey } from './floors';
import { ceoColliders, lobbyColliders, officeColliders, shellColliders } from './layout';
import { Lobby } from './Lobby';
import { Me } from './Me';
import { OfficeFloor } from './OfficeFloor';
import { OverviewChips } from './OverviewChips';
import { AdaptiveResolution, currentDpr } from './perf';
import { pickAt } from './picking';
import { Player } from './Player';
import { bindCamera, orbitBy, panBy, setViewport, zoomBy } from './rig';
import { Roof } from './roof/Roof';
import { roofColliders } from './roof/roofLayout';
import { DayClock } from './sky/DayClock';
import { DayLights } from './sky/DayLights';
import { Sky } from './sky/Sky';
import { Sounds } from './Sounds';
import { TourGuide } from './TourGuide';
import { useView } from './view';

/** A press that moves less than this (px) before it lets go is a click, not a drag. */
const CLICK_PX = 5;

/**
 * Hands the camera and the view's size to the rig, and takes the overview's mouse: a drag turns it round the floor (and
 * tilts it), a right-drag or shift-drag pans, the wheel zooms, and a click opens what's under it (picking.ts: a
 * person's chip, a desk, the board). Mouse events, so the player's quiet guard can swallow them after a click that
 * opened something.
 */
function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const dom = useThree((s) => s.gl.domElement);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const mouse = useMemo(() => ({ ndc: new THREE.Vector2(), moved: false }), []);
  useEffect(() => {
    bindCamera(camera);
    return () => bindCamera(null);
  }, [camera]);
  useEffect(() => setViewport(size.width, size.height), [size.width, size.height]);
  useEffect(() => {
    let drag: { x: number; y: number; pan: boolean; travel: number } | null = null;
    const overview = () => useView.getState().mode === 'overview' && !useView.getState().overlay;
    const toNdc = (e: MouseEvent) => {
      const r = dom.getBoundingClientRect();
      mouse.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      mouse.moved = true;
    };
    const down = (e: MouseEvent) => {
      if (overview()) drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey, travel: 0 };
    };
    const move = (e: MouseEvent) => {
      if (e.target === dom) toNdc(e);
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.travel += Math.abs(dx) + Math.abs(dy);
      if (drag.pan) panBy(dx, dy);
      else orbitBy(dx, dy);
    };
    const up = (e: MouseEvent) => {
      const click = drag && !drag.pan && drag.travel < CLICK_PX && e.button === 0;
      drag = null;
      if (!click || !overview()) return;
      toNdc(e);
      ray.setFromCamera(mouse.ndc, camera);
      const hit = pickAt(ray);
      if (hit) act(hit.action);
    };
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
  }, [dom, camera, ray, mouse]);
  // what a click would open, under the mouse once it has moved: the hint says it and the cursor points
  useFrame(() => {
    const view = useView.getState();
    if (view.mode !== 'overview' || view.overlay) {
      if (view.hover) {
        view.setHover(null);
        dom.style.cursor = '';
      }
      return;
    }
    if (!mouse.moved) return;
    mouse.moved = false;
    ray.setFromCamera(mouse.ndc, camera);
    const hit = pickAt(ray);
    view.setHover(hit);
    dom.style.cursor = hit ? 'pointer' : '';
  });
  return null;
}

/** The view goes dark for a moment while the elevator carries you between floors. */
function RideFade() {
  const dark = useRide((s) => s.phase === 'dark');
  return <div className={`ride-fade${dark ? ' dark' : ''}`} />;
}

/** Every floor along the bottom, the lobby first and the roof last: which one the view shows. */
function FloorPicker({ shown }: { shown: number }) {
  const floors = useStore((s) => s.floors);
  const workers = useStore((s) => s.workers);
  const setFloor = useView((s) => s.setFloor);
  const count = (floorId: string) => Object.values(workers).filter((w) => w.floorId === floorId && w.role === 'worker').length;
  return (
    <nav className="floor-picker" aria-label="Floors">
      {[...stops(floors)].reverse().map((st) => {
        const f = floors.find((x) => x.floor === st.floor);
        const kind = kindOf(st.floor);
        return (
          <button key={st.floor} className={st.floor === shown ? 'on' : ''} style={f ? { borderColor: f.color } : undefined} onClick={() => setFloor(st.floor)} title={f ? f.description || f.fullName : st.name}>
            <span className="floor-no" style={f ? { background: f.color } : undefined}>
              {st.key}
            </span>
            {kind === 'office' ? (st.name.split('/')[1] ?? st.name) : kind === 'lobby' ? 'Lobby' : kind === 'ceo' ? 'CEO' : 'Roof'}
            {f && <span className="floor-count">{count(f.id)} 🧑‍💻</span>}
          </button>
        );
      })}
    </nav>
  );
}

/** The title over the view: the floor's name and what it's about. */
const titleOf = (kind: ReturnType<typeof kindOf>, name: string | undefined) => (kind === 'office' ? (name ?? '') : kind === 'ceo' ? "CEO's office" : kind === 'roof' ? 'Roof terrace' : 'Lobby');

export function Game() {
  const loaded = useStore((s) => s.loaded);
  const floors = useStore((s) => s.floors);
  const workers = useStore((s) => s.workers);
  const picked = useView((s) => s.floor);
  // Until the manager picks a floor: the first with workers on it, else the first floor, else the lobby.
  const busiest = floors.find((f) => Object.values(workers).some((w) => w.floorId === f.id)) ?? floors[0];
  const shown = picked !== null && isFloor(picked, floors) ? picked : (busiest?.floor ?? 0);
  const kind = kindOf(shown);
  const floor = kind === 'office' ? (floors.find((f) => f.floor === shown) ?? null) : null;
  const top = floors.reduce((n, f) => Math.max(n, f.floor), 0);
  // The floor on screen is the one you're on, for the elevator's sign and buttons, until a ride or the picker moves you.
  const setFloor = useView((s) => s.setFloor);
  useEffect(() => {
    if (loaded && picked !== shown) setFloor(shown);
  }, [loaded, picked, shown, setFloor]);
  // the elevator's doorway opens and shuts with its doors (elevatorRide.ts elevatorShut)
  // an office floor's bought furniture blocks you too (rugs and wall art don't)
  const plan = useStore((s) => (floor ? s.floorPlans[floor.id] : undefined));
  const colliders = useMemo(
    () => (kind === 'lobby' ? lobbyColliders(false) : kind === 'ceo' ? ceoColliders(false) : kind === 'roof' ? roofColliders() : [...officeColliders(false), ...planRects(plan ?? [])]),
    [kind, plan],
  );
  // what the camera following you stays inside: the room's walls (none round the roof terrace)
  const walls = useMemo(() => (kind === 'roof' ? [] : shellColliders(kind === 'lobby' ? 'lobby' : kind === 'ceo' ? 'ceo' : 'office')), [kind]);

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
        <DayClock />
        <Sky />
        <DayLights roof={kind === 'roof'} />
        <CameraRig />
        <Player floor={shown} colliders={colliders} walls={walls} />
        <AdaptiveResolution />
        <Chatter />
        <Me />
        <OverviewChips floor={shown} />
        {floor ? <OfficeFloor key={floor.id} floor={floor} top={topStorey(top)} /> : kind === 'ceo' ? <CeoFloor top={top} /> : kind === 'roof' ? <Roof top={top} /> : <Lobby top={topStorey(top)} />}
        <TourGuide floor={shown} />
        <City elevation={elevationOf(shown, top)} />
        <WorldEvents elevation={elevationOf(shown, top)} />
        <Sounds floor={shown} />
      </Canvas>
      <header className="game-title">
        <strong>{titleOf(kind, floor?.fullName)}</strong>
        {floor?.summary && <span>{floor.summary}</span>}
      </header>
      <HUD />
      <OfficeKeys />
      <Toasts />
      <FloorPicker shown={shown} />
      <a className="game-debug" href="/debug">
        Debug page
      </a>
      <SoundToggle />
      <RideFade />
      <Overlays />
    </div>
  );
}
