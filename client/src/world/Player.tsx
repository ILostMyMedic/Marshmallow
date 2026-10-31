// You, on foot: WASD (or the arrows) walk, Shift runs, the mouse looks round once a click has captured it, E (or a
// click) uses what the crosshair is on (or sips what you hold), G puts down what you hold, C opens your look, V
// switches between the camera following behind you (you turn to face the way you walk) and looking out of your eyes,
// and Tab flies up to the overview and back. Walls, furniture and shut doors stop you (layout.ts collide, doors.ts, the
// elevator's doors: elevatorRide.ts); a ride in the elevator leaves you in its cabin on the new floor. With a ping-pong
// paddle in hand the mouse moves the paddle, a click serves, and the camera stands behind your end of the table; at a
// lookout on the roof you look through its binoculars until E, G or Esc. While the overview has the camera, the keys
// pan it instead. Your body is Me.tsx's, drawn where this leaves you (playerAt); your steps sound by what's underfoot
// (ui/footsteps.ts).
// Adapted from cubefarm client/src/world/Player.tsx (MIT): walking, looking, using and holding things, sips and the
// paddle; toys, the gamepad, perches, photo mode, saved spots and key bindings are cut.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { surfaceAt } from '../ui/footstepRules';
import { footstepsFollow } from '../ui/footsteps';
import { act, heldTakesE } from './actions';
import { shutDoorways } from './doors';
import { elevatorShut, takeArrival } from './elevatorRide';
import { interactables } from './interact';
import { angleDelta } from './body';
import { kindOf } from './floors';
import { collide, EYE_HEIGHT, SPAWN, WALL_H, type Rect } from './layout';
import { createLookFilter, filterLookDelta, LOOK_RADIANS_PER_PX, resetLookFilter, useLookPrefs } from './look';
import { watchLookLock } from './lookLock';
import { lookingThrough, stepBack } from './lookout';
import { useMe } from './myLook';
import { clear } from './nav';
import { fromOwn, type End } from './pongPhysics';
import { paddle, pongCamera, pongClick, pongMouse, tickPaddle } from './pongState';
import { arriveOnFloor, exitView, FIRST_FOV, lookAllowed, playerAt, rigInput, rigOwnsCamera, setHomeLook, setHomeView, stepRig, tapView } from './rig';
import { sipPose, tickSip } from './sipping';
import { useView, type Focus } from './view';

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

/** Tab (or the overview's "Walk the floor" button): down onto the floor and grab the mouse, or back up to the overview. */
export function toggleWalk() {
  const view = useView.getState();
  if (playingAt()) view.setHeld(null); // up from the table first
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

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/** Where you stand at your end of the table: behind your paddle, a little to its left, so it's in your right hand. */
const BAT_STANCE = { back: 0.42, left: 0.3 };

/**
 * Following behind you: the camera this far (m) back from your head, which it looks past, and the pitch it may tilt
 * through (it rises to look down on you); you turn to face the way you walk this fast (rad/s).
 */
const BEHIND = { dist: 3.2, head: 1.55, minPitch: -1.0, maxPitch: 0.5, turn: 11 };

/**
 * Where the camera sits behind someone at (x, z) looking yaw/pitch, pulled in when a wall (`walls`) is in the way and
 * kept under the ceiling. Writes into `out`; returns how far back it ended up.
 */
function behind(x: number, z: number, yaw: number, pitch: number, walls: Rect[], ceiling: number, dist: number, out: { x: number; y: number; z: number; yaw: number; pitch: number }) {
  const p = Math.max(BEHIND.minPitch, Math.min(BEHIND.maxPitch, pitch));
  const cp = Math.cos(p);
  const bx = Math.sin(yaw) * cp;
  const bz = Math.cos(yaw) * cp;
  let d = dist;
  for (let t = 0.3; t <= dist; t += 0.1) {
    if (clear(walls, x + bx * t, z + bz * t, 0.2)) continue;
    d = Math.max(0.3, t - 0.15);
    break;
  }
  out.x = x + bx * d;
  out.y = Math.max(0.4, Math.min(ceiling, BEHIND.head - Math.sin(p) * d));
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
  /** Where you stood before picking up a paddle, to step back to when you put it down. */
  const beforePong = useRef<{ x: number; z: number } | null>(null);
  /** You were looking through a lookout's binoculars last frame (the lens zoomed). */
  const atLookout = useRef(false);
  /** Where you stand (the camera is in your eyes, or behind you), which way you face, and how far back the camera is. */
  const pos = useRef({ x: SPAWN.x, z: SPAWN.z });
  const facing = useRef<number>(SPAWN.yaw);
  const back = useRef(BEHIND.dist);
  const cam = useMemo(() => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }), []);
  // no ceiling over the roof terrace
  const ceiling = kindOf(floor) === 'roof' ? Infinity : WALL_H - 0.25;
  const latest = useRef({ walls, ceiling });
  latest.current = { walls, ceiling };
  useEffect(() => setHomeLook(() => look.current), []);
  // The flight down from the overview lands where the camera will be: behind you, or in your eyes.
  useEffect(
    () =>
      setHomeView((x, z, yaw, pitch, out) => {
        if (useView.getState().person === 'first') {
          out.x = x;
          out.y = EYE_HEIGHT;
          out.z = z;
          out.yaw = yaw;
          out.pitch = pitch;
        } else behind(x, z, yaw, pitch, latest.current.walls, latest.current.ceiling, BEHIND.dist, out);
      }),
    [],
  );

  // For checks in a browser (Playwright): where you stand, and putting you somewhere facing a way (degrees).
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__mmPlayer = {
      get at() {
        const v = useView.getState();
        return { x: pos.current.x, z: pos.current.z, yaw: look.current.yaw, floor, person: v.person, mode: v.mode, overlay: v.overlay?.kind ?? null };
      },
      place(x: number, z: number, yawDeg = 0, pitchDeg = -3) {
        pos.current = { x, z };
        look.current = { yaw: (yawDeg * Math.PI) / 180, pitch: (pitchDeg * Math.PI) / 180 };
        facing.current = look.current.yaw;
      },
    };
  }, [camera, floor]);

  // A new floor: in the elevator's cabin after a ride, else in front of the elevator. A paddle stays with its table;
  // a mug or a snack comes with you.
  useEffect(() => {
    if (playingAt()) useView.getState().setHeld(null);
    beforePong.current = null;
    const at = takeArrival() ?? SPAWN;
    pos.current = { x: at.x, z: at.z };
    facing.current = at.yaw;
    look.current = { yaw: at.yaw, pitch: -0.05 };
    arriveOnFloor({ x: at.x, z: at.z, ...look.current });
  }, [floor, camera]);

  useEffect(() => {
    canvasEl = gl.domElement;
    // Left button only. If the mouse is captured, act on the crosshair's target (like E) or serve at the table;
    // otherwise this press just captures the mouse, so the click that locks never also acts.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || !lookAllowed()) return;
      if (document.pointerLockElement !== gl.domElement) return requestLook();
      if (useView.getState().overlay) return;
      if (playingAt()) pongClick();
      else interact(false);
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
      if (e.code === 'KeyV' && view.mode === 'first' && !playingAt() && !lookingThrough()) view.setPerson(view.person === 'first' ? 'third' : 'first');
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

    // the overview has the camera (rig.ts): you stay where you were standing, and the keys pan it
    if (rigOwnsCamera()) {
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

    // at the ping-pong table: the camera stands behind your end, and you stand at it with the paddle in hand
    const end = playingAt();
    if (end) {
      tickPaddle(dt);
      beforePong.current ??= { ...pos.current };
      const v = pongCamera(end);
      camera.position.set(v.x + v.shake.x, v.y + v.shake.y, v.z + v.shake.z);
      camera.rotation.set(v.pitch, v.yaw, 0, 'YXZ');
      const at = fromOwn(end, Math.max(paddle.back, 0) + BAT_STANCE.back, paddle.lat - BAT_STANCE.left);
      playerAt.x = at.x;
      playerAt.z = at.z;
      playerAt.yaw = v.yaw;
      look.current = { yaw: v.yaw, pitch: -0.05 }; // put the paddle down and you still face the table
      if (view.focus) view.setFocus(null);
      return;
    }
    if (beforePong.current) {
      // back from the table: where you stood when you picked the paddle up, looking at the table still
      pos.current = beforePong.current;
      facing.current = look.current.yaw;
      beforePong.current = null;
    }

    const { yaw, pitch } = look.current;
    const third = view.person === 'third';
    const me = pos.current;
    let moving = false;
    if (fwd || strafe) {
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
    if (third) {
      // the camera behind you: in at once when a wall comes between, back out gently
      const want = behind(me.x, me.z, yaw, pitch, walls, ceiling, BEHIND.dist, cam);
      back.current = want < back.current ? want : back.current + (want - back.current) * (1 - Math.exp(-dt * 4));
      behind(me.x, me.z, yaw, pitch, walls, ceiling, back.current, cam);
      camera.position.set(cam.x, cam.y, cam.z);
      camera.rotation.set(cam.pitch, cam.yaw, 0, 'YXZ');
    } else {
      camera.position.set(me.x, EYE_HEIGHT + (moving ? Math.sin(bob.current) * 0.035 : 0), me.z);
      // a sip tips your head back a little (the last gulp more)
      camera.rotation.set(pitch + sipPose.head, yaw, 0, 'YXZ');
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
    view.setFocus(found);
  });

  return null;
}
