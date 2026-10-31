// The camera rig: first person (the player drives the camera, Player.tsx) or the overview, and the flights between
// them. In the overview the rig drives the camera, cuts the floor open (cutaway.ts) and takes the manager's drags,
// wheel and keys; Tab flies down to where you were standing, and back up.
// Adapted from cubefarm client/src/world/camera/rig.ts (MIT): first person and the overview; the building view and the
// follow cam are cut, and floor changes are instant (no elevator ride yet).
import type * as THREE from 'three';
import { blendPose, clampFocus, copyOrbit, copyPose, dampOrbit, ease, fitDistance, newOrbit, newPose, orbitPose, OVERVIEW, overviewOrbit, panOrbit, type Pose } from './cameraMath';
import { cutOff, setCut } from './cutaway';
import { EYE_HEIGHT, SPAWN } from './layout';
import { useView, type ViewMode } from './view';

/** Where the player is standing and facing: the camera in first person, and where they left themselves in the overview. */
export const playerAt = { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw };

interface Home {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

export const FIRST_FOV = 72;
export const FIRST_NEAR = 0.05;
/** Seconds: out to the overview, and back to first person. */
const FLY_OUT = 0.9;
const FLY_BACK = 0.65;

const rig = {
  mode: 'overview' as ViewMode,
  /** The rig drives the camera: in the overview, and on the flight back to first person. */
  owns: true,
  flight: 1,
  flightTime: FLY_OUT,
  from: newPose(),
  pose: newPose(),
  goalPose: newPose(),
  /** The orbit the camera is on (eased) and the one it's easing to. */
  orbit: newOrbit(),
  goal: newOrbit(),
  /** The zoom that fits the floor. */
  fit: 40,
  placed: false,
  home: { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw, pitch: 0 } as Home,
  aspect: 16 / 9,
  height: 900,
};

let camera: THREE.PerspectiveCamera | null = null;
let homeLook: () => { yaw: number; pitch: number } = () => rig.home;

function setMode(mode: ViewMode) {
  rig.mode = mode;
  useView.getState().setMode(mode);
}

/** Game.tsx hands over the camera. */
export function bindCamera(c: THREE.PerspectiveCamera | null) {
  camera = c;
}

/** How big the view is: the overview refits the floor to it. */
export function setViewport(width: number, height: number) {
  const aspect = width / Math.max(1, height);
  rig.height = height;
  if (!rig.placed) {
    // the first frame: the overview of the floor, fitted to the window
    rig.aspect = aspect;
    overviewOrbit(rig.home.yaw, aspect, rig.goal);
    rig.fit = rig.goal.dist;
    copyOrbit(rig.goal, rig.orbit);
    orbitPose(rig.orbit, rig.pose);
    rig.placed = true;
    return;
  }
  if (Math.abs(aspect - rig.aspect) < 1e-3) return;
  rig.aspect = aspect;
  if (rig.mode === 'overview') refit();
}

/** Player.tsx: where the player looks while the rig flies them back (the mouse may move meanwhile). */
export function setHomeLook(fn: () => { yaw: number; pitch: number }) {
  homeLook = fn;
}

/** Whether first person may grab the mouse. */
export const lookAllowed = () => rig.mode === 'first';
export const rigOwnsCamera = () => rig.owns;
/** Whether the rig's flight is under way. */
export const rigFlying = () => rig.flight < 1;

// ---------- switching views ----------

function refit() {
  const ratio = rig.goal.dist / rig.fit;
  rig.fit = fitDistance(rig.goal, rig.aspect);
  rig.goal.dist = Math.max(OVERVIEW.minDist, Math.min(rig.fit * OVERVIEW.maxZoom, rig.fit * ratio));
}

/** Where the camera is now, as a pose (from the camera itself when the player was driving it). */
function capture(out: Pose) {
  if (rig.owns || !camera) return copyPose(rig.pose, out);
  out.x = camera.position.x;
  out.y = camera.position.y;
  out.z = camera.position.z;
  out.yaw = camera.rotation.y;
  out.pitch = camera.rotation.x;
  out.fov = camera.fov;
  out.near = camera.near;
  return out;
}

/** Leaving first person: remember where you stand, and let go of the mouse. */
function leaveFirst() {
  if (rig.owns || !camera) return;
  const look = homeLook();
  rig.home = { x: camera.position.x, z: camera.position.z, yaw: look.yaw, pitch: look.pitch };
  playerAt.x = rig.home.x;
  playerAt.z = rig.home.z;
  playerAt.yaw = rig.home.yaw;
  useView.getState().setFocus(null);
  if (document.pointerLockElement) document.exitPointerLock();
}

function startFlight(time: number) {
  capture(rig.from);
  copyPose(rig.from, rig.pose);
  rig.flight = 0;
  rig.flightTime = time;
}

/** Flies out to the overview of the floor you're on. */
export function enterOverview() {
  if (rig.mode === 'overview' || !camera) return;
  leaveFirst();
  startFlight(FLY_OUT);
  overviewOrbit(rig.home.yaw, rig.aspect, rig.goal);
  rig.fit = rig.goal.dist;
  copyOrbit(rig.goal, rig.orbit);
  setMode('overview');
  rig.owns = true;
}

/** Flies back to where you were standing and gives you the controls again. */
export function exitView() {
  if (rig.mode === 'first') return;
  startFlight(FLY_BACK);
  setMode('first');
}

/** Tab: the overview and back. */
export function tapView() {
  if (rig.mode === 'first') enterOverview();
  else exitView();
}

/** The floor shown changed: you're standing at `spawn` on it; the overview stays the overview, refitted. */
export function arriveOnFloor(spawn: Home) {
  rig.home = { ...spawn };
  playerAt.x = spawn.x;
  playerAt.z = spawn.z;
  playerAt.yaw = spawn.yaw;
  if (rig.mode === 'overview') {
    overviewOrbit(spawn.yaw, rig.aspect, rig.goal);
    rig.fit = rig.goal.dist;
    copyOrbit(rig.goal, rig.orbit);
    orbitPose(rig.orbit, rig.pose);
    rig.flight = 1;
  }
}

// ---------- the overview's controls ----------

/** A drag in the overview: turns it round the floor and tilts it (pixels). */
export function orbitBy(dx: number, dy: number) {
  if (rig.mode !== 'overview') return;
  rig.goal.yaw -= dx * 0.006;
  rig.goal.el = Math.min(OVERVIEW.maxEl, Math.max(OVERVIEW.minEl, rig.goal.el + dy * 0.004));
}

/** A right-drag (or shift-drag) in the overview: moves along the floor as the camera sees it (pixels). */
export function panBy(dx: number, dy: number) {
  if (rig.mode !== 'overview') return;
  const g = rig.goal;
  const perPx = (2 * g.dist * Math.tan((g.fov * Math.PI) / 360)) / Math.max(1, rig.height);
  panOrbit(g, -dx * perPx, (dy * perPx) / Math.max(0.3, Math.sin(g.el)));
}

/** The wheel in the overview: zooms in (< 0) or out. */
export function zoomBy(delta: number) {
  if (rig.mode !== 'overview') return;
  rig.goal.dist = Math.min(rig.fit * OVERVIEW.maxZoom, Math.max(OVERVIEW.minDist, rig.goal.dist * Math.exp(delta * 0.0012)));
}

/** What the keys say this frame in the overview (Player.tsx fills it in): -1 to 1 each. */
export const rigInput = { right: 0, forward: 0, fast: false };

// ---------- every frame ----------

function applyPose(c: THREE.PerspectiveCamera, p: Pose) {
  c.position.set(p.x, p.y, p.z);
  c.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  if (Math.abs(c.fov - p.fov) > 1e-4 || Math.abs(c.near - p.near) > 1e-5) {
    c.fov = p.fov;
    c.near = p.near;
    c.updateProjectionMatrix();
  }
}

function restoreLens(c: THREE.PerspectiveCamera) {
  if (c.fov === FIRST_FOV && c.near === FIRST_NEAR) return;
  c.fov = FIRST_FOV;
  c.near = FIRST_NEAR;
  c.updateProjectionMatrix();
}

/** One frame of the rig (Player.tsx calls it while the rig owns the camera). */
export function stepRig(dt: number) {
  const c = camera;
  if (!rig.owns || !c) return;
  const g = rig.goal;
  if (rig.mode === 'overview') {
    const speed = g.dist * (rigInput.fast ? 1.6 : 0.8) * dt;
    if (rigInput.right || rigInput.forward) panOrbit(g, rigInput.right * speed, rigInput.forward * speed);
    clampFocus(g);
    dampOrbit(rig.orbit, g, dt, 7);
    orbitPose(rig.orbit, rig.goalPose);
  } else {
    const look = homeLook();
    const p = rig.goalPose;
    p.x = rig.home.x;
    p.y = EYE_HEIGHT;
    p.z = rig.home.z;
    p.yaw = look.yaw;
    p.pitch = look.pitch;
    p.fov = FIRST_FOV;
    p.near = FIRST_NEAR;
  }

  if (rig.flight < 1) {
    rig.flight = Math.min(1, rig.flight + dt / rig.flightTime);
    blendPose(rig.from, rig.goalPose, ease(rig.flight), rig.pose);
  } else copyPose(rig.goalPose, rig.pose);
  applyPose(c, rig.pose);

  // The floor stays cut open on the flight back until it's nearly home.
  if (rig.mode === 'overview' || rig.flight < 0.8) setCut(rig.orbit.yaw);
  else cutOff();
  if (rig.mode === 'first' && rig.flight >= 1) {
    rig.owns = false;
    cutOff();
    restoreLens(c);
  }
}
