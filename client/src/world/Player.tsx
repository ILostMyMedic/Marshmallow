// You, on foot: WASD (or the arrows) walk, Shift runs, the mouse looks round once a click has captured it, E (or a
// click) uses what the crosshair is on (or sips what you hold), G puts down what you hold, C opens your look, V
// switches between the camera following behind you (you turn to face the way you walk) and looking out of your eyes,
// and Tab flies up to the overview and back. Walls, furniture and shut doors stop you (layout.ts collide, doors.ts, the
// elevator's doors: elevatorRide.ts); a ride in the elevator leaves you in its cabin on the new floor. With a ping-pong
// paddle in hand the mouse moves the paddle, a click serves, and the camera flies up behind your end of the table and
// over your shoulder (pongCam.ts), and back to your view when you put the paddle down. With a hoop's ball or a dart in
// hand, holding the mouse down winds up a throw and letting go throws it (games/gameState.ts). At a lookout on the roof
// you look through its binoculars until E, G or Esc. E on a seat (SeatTargets.tsx) sits you down
// in it: the camera lowers to your eyes sitting there, you look round but stay put, and E (with nothing else to aim
// at) or a step gets you up beside it (seats.ts standSpot), as does Tab, a ride or the seat going. While the overview
// has the camera, the keys pan it instead. Your body is Me.tsx's, drawn where this leaves you (playerAt); your steps
// sound by what's underfoot (ui/footsteps.ts).
// Adapted from cubefarm client/src/world/Player.tsx (MIT): walking, looking, using and holding things, sips and the
// paddle; toys, the gamepad, perches, photo mode, saved spots and key bindings are cut.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { surfaceAt } from '../ui/footstepRules';
import { footstepsFollow } from '../ui/footsteps';
import { act, heldTakesE, onAction } from './actions';
import { shutDoorways } from './doors';
import { elevatorShut, takeArrival } from './elevatorRide';
import { cancelCharge, releaseCharge, startCharge } from './games/gameState';
import { interactables } from './interact';
import { angleDelta } from './body';
import { BEHIND_HEAD, EYE_HEIGHTS, parseBodyStyle, SEATED_EYES } from './bodyStyle';
import { kindOf } from './floors';
import { collide, LOBBY_SPAWN, SPAWN, WALL_H, type Rect } from './layout';
import { createLookFilter, filterLookDelta, LOOK_RADIANS_PER_PX, resetLookFilter, useLookPrefs } from './look';
import { watchLookLock } from './lookLock';
import { lookingThrough, stepBack } from './lookout';
import { useMe } from './myLook';
import { blendCam, facingAt, newCamPose, newPongCam, PONG_CAM, stanceAt, stepPongCam, type CamPose } from './pongCam';
import type { End } from './pongPhysics';
import { paddle, pongClick, pongMouse, pongShake, tickPaddle } from './pongState';
import { arriveOnFloor, exitView, FIRST_FOV, lookAllowed, playerAt, rigInput, rigOwnsCamera, setHomeLook, setHomeView, stepRig, tapView } from './rig';
import { seatedEye, standSpot, type Seat } from './seats';
import { sipPose, tickSip } from './sipping';
import { useView, type Focus, type Person } from './view';
import { useStore } from '../store';

/** The office's body style: where your eyes are depends on it (bodyStyle.ts). */
const styleNow = () => parseBodyStyle(useStore.getState().settings.bodyStyle);

let canvasEl: HTMLCanvasElement | null = null;

// After an action, mouse presses are swallowed for a moment, so the second half of a double click (or a click right
// after E) can't land on the panel's backdrop and close it.
const QUIET_MS = 400;
let quietUntil = 0;
const QUIET_EVENTS = ['mousedown', 'mouseup', 'click', 'dblclick'] as const;
const hushMouse = () => {
  quietUntil = performance.now() + QUIET_MS;
};

/** Grab the mouse for looking around. Must be called from a click handler. */
export function requestLook() {
  if (!canvasEl || useView.getState().overlay || !lookAllowed()) return;
  const el = canvasEl;
  // Raw (unadjusted) input skips the OS mouse path that produces bogus spikes on Windows. Browsers that can't do it
  // reject with NotSupportedError (Firefox ignores the option); Chrome also refuses a re-lock for a moment after Esc.
  lockPointer(el, { unadjustedMovement: true })?.catch?.((err: unknown) => {
    if (err instanceof DOMException && err.name === 'NotSupportedError') lockPointer(el)?.catch?.(() => undefined);
  });
}

function lockPointer(el: HTMLCanvasElement, options?: PointerLockOptions): Promise<void> | undefined {
  try {
    return el.requestPointerLock?.(options);
  } catch {
    return undefined; // older browsers throw instead of rejecting
  }
}

/** E: what you hold gets first go (a sip), then what the crosshair is on; a click (`withHeld` false) goes straight to the target. */
function interact(withHeld = true) {
  const { focus } = useView.getState();
  if ((withHeld && heldTakesE(focus?.action.kind ?? null)) || !focus) return;
  hushMouse();
  act(focus.action); // a panel takes the mouse back; something done in the room leaves you looking round
}

/** G: put down what you hold (a paddle: you leave the table). */
function putDown() {
  const { held, setHeld, showToast } = useView.getState();
  if (!held) return;
  setHeld(null);
  if (held.kind === 'mug') showToast('☕ You leave the mug on the side');
}

/** Player.tsx's own getting up, beside the seat; set while it's mounted. */
let leaveSeat: (() => void) | null = null;

/** Up out of your seat, if you're in one: beside it. */
export function standUp() {
  if (!useView.getState().seated) return;
  if (leaveSeat) leaveSeat();
  else useView.getState().setSeated(null);
}

/** Tab (or the overview's "Walk the floor" button): down onto the floor and grab the mouse, or back up to the overview. */
export function toggleWalk() {
  const view = useView.getState();
  if (playingAt()) view.setHeld(null); // up from the table first
  standUp(); // and out of your seat
  tapView();
  if (useView.getState().mode === 'first' && !lookFirstTime() && useLookPrefs.getState().grabOnClose) requestLook();
}

/** Your look, the first time you walk the floor without one of your own. */
function lookFirstTime() {
  if (useMe.getState().chosen) return false;
  if (document.pointerLockElement) document.exitPointerLock();
  useView.getState().openOverlay({ kind: 'look' });
  return true;
}

const MOVE = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
} as const;
const held = (keys: Set<string>, codes: readonly string[]) => codes.some((c) => keys.has(c));
const playingAt = (): End | null => {
  const h = useView.getState().held;
  return h?.kind === 'paddle' ? h.end : null;
};

/** What E does sitting down, with nothing else in your sights. */
const STAND_UP: Focus = { id: 'stand', label: 'Stand up', action: { kind: 'stand' } };

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/**
 * Following behind you: the camera this far (m) back from your head, which it looks past, and the pitch it may tilt
 * through (it rises to look down on you); you turn to face the way you walk this fast (rad/s).
 */
const BEHIND = { dist: 3.2, head: 1.55, minPitch: -1.0, maxPitch: 0.5, turn: 11 };
/** Sitting, in first person: how far you can turn your head from the way the seat faces (radians). */
const SEATED_TURN = 1.9;

/** Sitting in third person, the camera's tries round you (turns from the way you face): in front a little to each side, then behind, then beside. */
const SEATED_VIEWS = [Math.PI - 0.55, Math.PI + 0.55, 0.55, -0.55, Math.PI / 2, -Math.PI / 2];

/**
 * Where you look sitting down in `s`: in first person the way it faces (a deck chair's a little up); in third the
 * camera comes round to look down at you from in front, a little to one side, or wherever round you the walls (`walls`)
 * leave it the most room (a seat at a counter, say).
 */
function seatedLook(s: Seat, person: Person, walls: Rect[]) {
  if (person !== 'third') return { yaw: s.facing, pitch: s.kind === 'deckchair' ? 0.05 : -0.12 };
  const pitch = -0.3;
  let best = { yaw: s.facing + SEATED_VIEWS[0], room: -1 };
  for (const turn of SEATED_VIEWS) {
    const room = behind(s.x, s.z, s.facing + turn, pitch, walls, Infinity, BEHIND.dist, scratch, s.height + SEATED_EYES[styleNow()]);
    if (room > best.room + 0.05) best = { yaw: s.facing + turn, room };
    if (room >= BEHIND.dist) break;
  }
  return { yaw: best.yaw, pitch };
}
const scratch = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

/** Where the camera is now, as a pose (Player sets its rotation as 'YXZ': y is the yaw, x the pitch). */
const cameraPose = (c: THREE.Camera, out: CamPose): CamPose => Object.assign(out, { x: c.position.x, y: c.position.y, z: c.position.z, yaw: c.rotation.y, pitch: c.rotation.x });

/** Whether (x, z) is within `r` of a wall: out on a balcony (or a bench there) the camera may hang out over it. */
const nearWall = (walls: Rect[], x: number, z: number, r: number) => walls.some((b) => x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r);

/**
 * Where the camera sits behind someone at (x, z) looking yaw/pitch, pulled in when a wall (`walls`) is in the way and
 * kept under the ceiling; it looks past their head, `head` up (lower when they sit). Writes into `out`; returns how far
 * back it ended up.
 */
function behind(x: number, z: number, yaw: number, pitch: number, walls: Rect[], ceiling: number, dist: number, out: { x: number; y: number; z: number; yaw: number; pitch: number }, head = BEHIND.head) {
  const p = Math.max(BEHIND.minPitch, Math.min(BEHIND.maxPitch, pitch));
  const cp = Math.cos(p);
  const bx = Math.sin(yaw) * cp;
  const bz = Math.cos(yaw) * cp;
  let d = dist;
  for (let t = 0.3; t <= dist; t += 0.1) {
    if (!nearWall(walls, x + bx * t, z + bz * t, 0.2)) continue;
    d = Math.max(0.3, t - 0.15);
    break;
  }
  out.x = x + bx * d;
  out.y = Math.max(0.4, Math.min(ceiling, head - Math.sin(p) * d));
  out.z = z + bz * d;
  out.yaw = yaw;
  out.pitch = p;
  return d;
}

export function Player({ colliders, walls, floor }: { colliders: Rect[]; walls: Rect[]; floor: number }) {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const look = useRef({ yaw: SPAWN.yaw, pitch: -0.05 });
  const bob = useRef(0);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const center = useMemo(() => new THREE.Vector2(0, 0), []);
  const frame = useRef(0);
  const lookFilter = useMemo(createLookFilter, []);
  /** Where you stood, looked and faced before picking up a paddle, to step back to when you put it down. */
  const beforePong = useRef<{ x: number; z: number; yaw: number; pitch: number; facing: number } | null>(null);
  /** The camera at the table (pongCam.ts), eased after the paddle; and its flight in from your view or back out to it. */
  const tableCam = useMemo(() => ({ cam: newPongCam(), pose: newCamPose(), shown: newCamPose(), here: newCamPose() }), []);
  const flight = useRef<{ from: CamPose; t: number; out: boolean } | null>(null);
  /** You were looking through a lookout's binoculars last frame (the lens zoomed). */
  const atLookout = useRef(false);
  /** Where you stand (the camera is in your eyes, or behind you), which way you face, and how far back the camera is. */
  const pos = useRef({ x: SPAWN.x, z: SPAWN.z });
  const facing = useRef<number>(SPAWN.yaw);
  const back = useRef(BEHIND.dist);
  const cam = useMemo(() => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }), []);
  /** The seat you're sitting in (view.ts seated, as this last saw it). */
  const sitting = useRef<Seat | null>(null);
  // no ceiling over the roof terrace
  const ceiling = kindOf(floor) === 'roof' ? Infinity : WALL_H - 0.25;
  const latest = useRef({ walls, ceiling, colliders });
  latest.current = { walls, ceiling, colliders };
  // Sitting down and getting up (only refs: made once). Down: into the seat, facing its way; up: beside it, still
  // looking where you were in first person, facing out from it in third.
  const seat = useMemo(
    () => ({
      sit(s: Seat) {
        if (playingAt() || lookingThrough()) return;
        sitting.current = s;
        useView.getState().setSeated(s);
        pos.current = { x: s.x, z: s.z };
        facing.current = s.facing;
        look.current = seatedLook(s, useView.getState().person, latest.current.walls);
        keys.current.clear(); // a key still down from walking up doesn't get you straight back up
      },
      leave() {
        const s = sitting.current ?? useView.getState().seated;
        sitting.current = null;
        if (useView.getState().seated) useView.getState().setSeated(null);
        if (!s) return;
        const p = standSpot(s, latest.current.colliders);
        pos.current = { x: p.x, z: p.z };
        facing.current = s.facing;
        playerAt.x = p.x;
        playerAt.z = p.z;
        playerAt.yaw = s.facing;
        if (useView.getState().person === 'third') look.current = { yaw: s.facing, pitch: -0.05 };
      },
    }),
    [],
  );
  useEffect(() => {
    leaveSeat = seat.leave;
    const offSit = onAction('sit', (a) => seat.sit(a.seat));
    const offStand = onAction('stand', seat.leave);
    return () => {
      offSit();
      offStand();
      if (leaveSeat === seat.leave) leaveSeat = null;
    };
  }, [seat]);
  useEffect(() => setHomeLook(() => look.current), []);
  // The flight down from the overview lands where the camera will be: behind you, or in your eyes.
  useEffect(
    () =>
      setHomeView((x, z, yaw, pitch, out) => {
        if (useView.getState().person === 'first') {
          out.x = x;
          out.y = EYE_HEIGHTS[styleNow()];
          out.z = z;
          out.yaw = yaw;
          out.pitch = pitch;
        } else behind(x, z, yaw, pitch, latest.current.walls, latest.current.ceiling, BEHIND.dist, out);
      }),
    [],
  );

  // For checks in a browser (Playwright): where you stand (the seat you're in, what E would do, what you hold), putting
  // you somewhere facing a way (degrees; out of any seat), and turning your head where you are.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__mmPlayer = {
      get at() {
        const v = useView.getState();
        return { x: pos.current.x, z: pos.current.z, yaw: look.current.yaw, floor, person: v.person, mode: v.mode, overlay: v.overlay?.kind ?? null, seated: v.seated?.id ?? null, focus: v.focus?.label ?? null, held: v.held };
      },
      place(x: number, z: number, yawDeg = 0, pitchDeg = -3) {
        sitting.current = null;
        useView.getState().setSeated(null);
        pos.current = { x, z };
        look.current = { yaw: (yawDeg * Math.PI) / 180, pitch: (pitchDeg * Math.PI) / 180 };
        facing.current = look.current.yaw;
      },
      look(yawDeg: number, pitchDeg = -3) {
        look.current = { yaw: (yawDeg * Math.PI) / 180, pitch: (pitchDeg * Math.PI) / 180 };
      },
    };
  }, [camera, floor]);

  // A new floor: in the elevator's cabin after a ride, else in front of the elevator (in the lobby, facing the front
  // desk). A paddle stays with its table; a mug or a snack comes with you; your seat stays behind.
  useEffect(() => {
    if (playingAt()) useView.getState().setHeld(null);
    sitting.current = null;
    if (useView.getState().seated) useView.getState().setSeated(null);
    beforePong.current = null;
    flight.current = null;
    const at = takeArrival() ?? (kindOf(floor) === 'lobby' ? LOBBY_SPAWN : SPAWN);
    pos.current = { x: at.x, z: at.z };
    facing.current = at.yaw;
    look.current = { yaw: at.yaw, pitch: -0.05 };
    arriveOnFloor({ x: at.x, z: at.z, ...look.current });
  }, [floor, camera]);

  useEffect(() => {
    canvasEl = gl.domElement;
    // Left button only. If the mouse is captured, act on the crosshair's target (like E), serve at the table, or wind
    // up a throw with a hoop's ball or a dart in hand (let go to throw); otherwise this press just captures the mouse,
    // so the click that locks never also acts.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || !lookAllowed()) return;
      if (document.pointerLockElement !== gl.domElement) return requestLook();
      if (useView.getState().overlay) return;
      if (playingAt()) pongClick();
      else if (!startCharge()) interact(false);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) releaseCharge();
    };
    const onQuietMouse = (e: MouseEvent) => {
      if (performance.now() >= quietUntil) return;
      e.stopPropagation();
      e.preventDefault();
    };
    const onLockChange = () => {
      resetLookFilter(lookFilter);
      const locked = document.pointerLockElement === gl.domElement;
      useView.getState().setLocked(locked);
      // Esc at the table: you've stepped away, so the paddle goes back on its hook; at a lookout, you step back from it
      if (!locked && playingAt()) useView.getState().setHeld(null);
      if (!locked && lookingThrough()) stepBack();
      if (!locked) cancelCharge(); // a throw wound up when the mouse was let go of isn't thrown
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement || !document.hasFocus()) return;
      const d = filterLookDelta(lookFilter, e.movementX, e.movementY, e.timeStamp);
      if (!d) return;
      const { sensitivity, invertY } = useLookPrefs.getState();
      if (playingAt()) return pongMouse(d[0], d[1], sensitivity); // playing: the mouse moves the paddle
      const zoom = lookingThrough(); // through binoculars the view turns slower, as much as it's zoomed
      const k = LOOK_RADIANS_PER_PX * sensitivity * (zoom ? zoom.fov / FIRST_FOV : 1);
      const third = !zoom && useView.getState().person === 'third';
      look.current.yaw -= d[0] * k;
      look.current.pitch = Math.max(third ? BEHIND.minPitch : -1.35, Math.min(third ? BEHIND.maxPitch : 1.35, look.current.pitch - d[1] * k * (invertY ? -1 : 1)));
      // sitting, your head turns only so far from the way the seat faces
      const sat = sitting.current;
      if (sat && !third) look.current.yaw = sat.facing + Math.max(-SEATED_TURN, Math.min(SEATED_TURN, angleDelta(sat.facing, look.current.yaw)));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e) || e.defaultPrevented) return; // handled already: the Esc that closed a panel (Panel.tsx)
      const view = useView.getState();
      if (view.overlay) return;
      keys.current.add(e.code);
      if (e.code === 'Escape' && view.mode !== 'first') return exitView();
      if (e.repeat) return;
      if (lookingThrough() && (e.code === 'KeyE' || e.code === 'KeyG')) return stepBack();
      if (e.code === 'KeyE' && view.mode === 'first' && !playingAt()) interact();
      if (e.code === 'KeyG' && view.mode === 'first') putDown();
      if (e.code === 'KeyV' && view.mode === 'first' && !playingAt() && !lookingThrough()) {
        view.setPerson(view.person === 'first' ? 'third' : 'first');
        if (view.seated) look.current = seatedLook(view.seated, useView.getState().person, latest.current.walls);
      }
      if (e.code === 'KeyC' && view.mode === 'first') {
        if (document.pointerLockElement) document.exitPointerLock();
        view.openOverlay({ kind: 'look' });
      }
      if (e.code === 'Tab') {
        e.preventDefault(); // not on to the next button
        toggleWalk();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    // Alt+Tab would otherwise leave you walking
    const onBlur = () => keys.current.clear();
    gl.domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    for (const type of QUIET_EVENTS) window.addEventListener(type, onQuietMouse, true);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    const stopLookLock = watchLookLock(requestLook, hushMouse);
    return () => {
      stopLookLock();
      gl.domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      for (const type of QUIET_EVENTS) window.removeEventListener(type, onQuietMouse, true);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [gl, lookFilter]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const view = useView.getState();
    if (view.overlay) keys.current.clear();
    const k = keys.current;
    const fwd = (held(k, MOVE.forward) ? 1 : 0) - (held(k, MOVE.back) ? 1 : 0);
    const strafe = (held(k, MOVE.right) ? 1 : 0) - (held(k, MOVE.left) ? 1 : 0);
    const running = held(k, MOVE.run);
    const speed = running ? 6.5 : 3.6;
    tickSip();
    // got up some other way (the seat went), or picked up a paddle or the binoculars from it: beside it
    if (sitting.current && (view.seated !== sitting.current || playingAt() || lookingThrough())) seat.leave();

    // the overview has the camera (rig.ts): you stay where you were standing, and the keys pan it
    if (rigOwnsCamera()) {
      // up from the table to the overview (Tab): back where you stood before the game, without a flight of your own
      if (beforePong.current && !playingAt()) {
        const b = beforePong.current;
        pos.current = { x: b.x, z: b.z };
        look.current = { yaw: b.yaw, pitch: b.pitch };
        facing.current = b.facing;
        Object.assign(playerAt, { x: b.x, z: b.z, yaw: b.facing });
        beforePong.current = null;
      }
      flight.current = null;
      rigInput.right = strafe;
      rigInput.forward = fwd;
      rigInput.fast = running;
      if (view.focus) view.setFocus(null);
      stepRig(dt);
      return;
    }

    // at a lookout: the camera at the eyepiece, zoomed, turning only as far as the stand lets it; you stay put
    const lens = lookingThrough();
    if (lens) {
      if (!atLookout.current) look.current = { yaw: lens.yaw, pitch: lens.pitch };
      atLookout.current = true;
      look.current.yaw = Math.max(lens.minYaw, Math.min(lens.maxYaw, look.current.yaw));
      look.current.pitch = Math.max(lens.minPitch, Math.min(lens.maxPitch, look.current.pitch));
      camera.position.set(lens.x, lens.y, lens.z);
      camera.rotation.set(look.current.pitch, look.current.yaw, 0, 'YXZ');
      const lensCam = camera as THREE.PerspectiveCamera;
      if (lensCam.fov !== lens.fov) {
        lensCam.fov = lens.fov;
        lensCam.updateProjectionMatrix();
      }
      if (view.focus) view.setFocus(null);
      return;
    }
    if (atLookout.current) {
      // back from the binoculars: your own eyes again, where you stood
      atLookout.current = false;
      (camera as THREE.PerspectiveCamera).fov = FIRST_FOV;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }

    // at the ping-pong table: the camera raised behind your end and over your shoulder (pongCam.ts), flying there from
    // your view as you pick the paddle up, and you at the end with the paddle in hand, off to the side of the ball's way
    const end = playingAt();
    if (end) {
      tickPaddle(dt);
      if (!beforePong.current) {
        beforePong.current = { x: pos.current.x, z: pos.current.z, yaw: look.current.yaw, pitch: look.current.pitch, facing: facing.current };
        tableCam.cam.started = false;
        flight.current = { from: cameraPose(camera, newCamPose()), t: 0, out: false };
      }
      let v = stepPongCam(tableCam.cam, end, paddle.back, paddle.lat, dt, tableCam.pose);
      const f = flight.current;
      if (f && !f.out) {
        f.t += dt;
        v = blendCam(f.from, v, f.t / PONG_CAM.blend, tableCam.shown);
        if (f.t >= PONG_CAM.blend) flight.current = null;
      }
      const shake = pongShake();
      camera.position.set(v.x + shake.x, v.y + shake.y, v.z + shake.z);
      camera.rotation.set(v.pitch, v.yaw, 0, 'YXZ');
      const at = stanceAt(end, paddle.back, paddle.lat);
      playerAt.x = at.x;
      playerAt.z = at.z;
      playerAt.yaw = facingAt(end);
      if (view.focus) view.setFocus(null);
      return;
    }
    if (beforePong.current) {
      // back from the table: where you stood when you picked the paddle up, looking where you looked, the camera flying
      // back to your view from where it was
      const b = beforePong.current;
      pos.current = { x: b.x, z: b.z };
      look.current = { yaw: b.yaw, pitch: b.pitch };
      facing.current = b.facing;
      beforePong.current = null;
      flight.current = { from: cameraPose(camera, newCamPose()), t: 0, out: true };
    }

    const { yaw, pitch } = look.current;
    const third = view.person === 'third';
    // a step gets you up out of your seat (and walking, from beside it)
    if (sitting.current && (fwd || strafe)) seat.leave();
    const sat = sitting.current;
    const me = pos.current;
    let moving = false;
    if ((fwd || strafe) && !sat) {
      const len = Math.hypot(fwd, strafe);
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const dx = ((-sin * fwd + cos * strafe) / len) * speed * dt;
      const dz = ((-cos * fwd - sin * strafe) / len) * speed * dt;
      let p = collide(me.x + dx, me.z + dz, colliders);
      const shut = shutDoorways(); // a side door still sliding open
      if (shut.length) p = collide(p.x, p.z, shut);
      const lift = elevatorShut(); // the elevator's doors, unless they're open
      if (lift.length) p = collide(p.x, p.z, lift);
      me.x = p.x;
      me.z = p.z;
      moving = true;
      // following behind, you turn to face the way you walk
      if (third) facing.current += Math.max(-BEHIND.turn * dt, Math.min(BEHIND.turn * dt, angleDelta(facing.current, Math.atan2(-dx, -dz))));
    }
    if (!third) facing.current = yaw;
    // a step each half bob, whichever way the camera looks at you
    bob.current += moving ? dt * speed * 2.2 : 0;
    footstepsFollow(bob.current, moving, moving && running, surfaceAt(kindOf(floor), me.x, me.z));
    if (sat) facing.current = sat.facing; // sitting, you face the way the seat does, whichever way you look
    if (third) {
      // the camera behind you: in at once when a wall comes between, back out gently (past your head, lower sitting)
      const style = styleNow();
      const head = sat ? sat.height + SEATED_EYES[style] : BEHIND_HEAD[style];
      const want = behind(me.x, me.z, yaw, pitch, walls, ceiling, BEHIND.dist, cam, head);
      back.current = want < back.current ? want : back.current + (want - back.current) * (1 - Math.exp(-dt * 4));
      behind(me.x, me.z, yaw, pitch, walls, ceiling, back.current, cam, head);
      camera.position.set(cam.x, cam.y, cam.z);
      camera.rotation.set(cam.pitch, cam.yaw, 0, 'YXZ');
    } else {
      if (sat) {
        const eye = seatedEye(sat, SEATED_EYES[styleNow()]);
        camera.position.set(eye.x, eye.y, eye.z);
      } else camera.position.set(me.x, EYE_HEIGHTS[styleNow()] + (moving ? Math.sin(bob.current) * 0.035 : 0), me.z);
      // a sip tips your head back a little (the last gulp more)
      camera.rotation.set(pitch + sipPose.head, yaw, 0, 'YXZ');
    }
    // just put the paddle down: the camera flies back from the table to where it now belongs
    const out = flight.current;
    if (out?.out) {
      out.t += dt;
      const v = blendCam(out.from, cameraPose(camera, tableCam.here), out.t / PONG_CAM.blend, tableCam.shown);
      camera.position.set(v.x, v.y, v.z);
      camera.rotation.set(v.pitch, v.yaw, 0, 'YXZ');
      if (out.t >= PONG_CAM.blend) flight.current = null;
    }
    playerAt.x = me.x;
    playerAt.z = me.z;
    playerAt.yaw = facing.current;

    // what are we looking at?
    if (++frame.current % 3 !== 0) return;
    if (view.overlay) {
      if (view.focus) view.setFocus(null);
      return;
    }
    ray.setFromCamera(center, camera);
    ray.far = 8 + (third ? back.current : 0);
    const hits = ray.intersectObjects([...interactables.keys()], true);
    let found: Focus | null = null;
    // following behind, the crosshair reaches past you: what's between the camera and you doesn't count, and reach is from you
    const reach = third ? back.current : 0;
    for (const h of hits) {
      if (h.distance < reach - 0.2) continue;
      let o: THREE.Object3D | null = h.object;
      while (o && !interactables.has(o)) o = o.parent;
      if (!o) continue;
      const info = interactables.get(o)!;
      if (h.distance - reach <= info.range) found = info.pick?.(h.point, o) ?? { id: info.id, label: info.label, action: info.action };
      break;
    }
    // sitting, with nothing else to aim at, E gets you up
    view.setFocus(found ?? (sat ? STAND_UP : null));
  });

  return null;
}
