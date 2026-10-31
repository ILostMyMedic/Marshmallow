// You, on foot: WASD (or the arrows) walk, Shift runs, the mouse looks round once a click has captured it, E (or a
// click) uses what the crosshair is on, and Tab flies up to the overview and back. Walls, furniture and shut doors
// stop you (layout.ts collide, doors.ts). While the overview has the camera, the keys pan it instead.
// Adapted from cubefarm client/src/world/Player.tsx (MIT): walking, looking and using things; toys, held things, the
// gamepad, perches, photo mode, saved spots and key bindings are cut.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { shutDoorways } from './doors';
import { interactables } from './interact';
import { collide, EYE_HEIGHT, SPAWN, type Rect } from './layout';
import { createLookFilter, filterLookDelta, LOOK_RADIANS_PER_PX, resetLookFilter, useLookPrefs } from './look';
import { watchLookLock } from './lookLock';
import { arriveOnFloor, exitView, lookAllowed, playerAt, rigInput, rigOwnsCamera, setHomeLook, stepRig, tapView } from './rig';
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

/** E (or a click while looking round): use what the crosshair is on. */
function interact() {
  const { focus, openOverlay } = useView.getState();
  if (!focus) return;
  hushMouse();
  if (document.pointerLockElement) document.exitPointerLock();
  openOverlay(focus.action);
}

const MOVE = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
} as const;
const held = (keys: Set<string>, codes: readonly string[]) => codes.some((c) => keys.has(c));

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export function Player({ colliders, floor }: { colliders: Rect[]; floor: number }) {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const look = useRef({ yaw: SPAWN.yaw, pitch: -0.05 });
  const bob = useRef(0);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const center = useMemo(() => new THREE.Vector2(0, 0), []);
  const frame = useRef(0);
  const lookFilter = useMemo(createLookFilter, []);
  useEffect(() => setHomeLook(() => look.current), []);

  // For checks in a browser (Playwright): where you stand, and putting you somewhere facing a way (degrees).
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__mmPlayer = {
      get at() {
        return { x: camera.position.x, z: camera.position.z, yaw: look.current.yaw, floor };
      },
      place(x: number, z: number, yawDeg = 0, pitchDeg = -3) {
        camera.position.set(x, EYE_HEIGHT, z);
        look.current = { yaw: (yawDeg * Math.PI) / 180, pitch: (pitchDeg * Math.PI) / 180 };
      },
    };
  }, [camera, floor]);

  // Arrive in front of the elevator whenever the floor changes.
  useEffect(() => {
    if (!rigOwnsCamera()) camera.position.set(SPAWN.x, EYE_HEIGHT, SPAWN.z);
    look.current = { yaw: SPAWN.yaw, pitch: -0.05 };
    arriveOnFloor({ x: SPAWN.x, z: SPAWN.z, ...look.current });
  }, [floor, camera]);

  useEffect(() => {
    canvasEl = gl.domElement;
    // Left button only. If the mouse is captured, act on the crosshair's target (like E); otherwise this press just
    // captures the mouse, so the click that locks never also acts.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || !lookAllowed()) return;
      if (document.pointerLockElement !== gl.domElement) return requestLook();
      if (!useView.getState().overlay) interact();
    };
    const onQuietMouse = (e: MouseEvent) => {
      if (performance.now() >= quietUntil) return;
      e.stopPropagation();
      e.preventDefault();
    };
    const onLockChange = () => {
      resetLookFilter(lookFilter);
      useView.getState().setLocked(document.pointerLockElement === gl.domElement);
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement || !document.hasFocus()) return;
      const d = filterLookDelta(lookFilter, e.movementX, e.movementY, e.timeStamp);
      if (!d) return;
      const { sensitivity, invertY } = useLookPrefs.getState();
      const k = LOOK_RADIANS_PER_PX * sensitivity;
      look.current.yaw -= d[0] * k;
      look.current.pitch = Math.max(-1.35, Math.min(1.35, look.current.pitch - d[1] * k * (invertY ? -1 : 1)));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const view = useView.getState();
      if (view.overlay) return;
      keys.current.add(e.code);
      if (e.code === 'Escape' && view.mode !== 'first') return exitView();
      if (e.code === 'KeyE' && !e.repeat && view.mode === 'first') interact();
      if (e.code === 'Tab') {
        e.preventDefault(); // not on to the next button
        if (e.repeat) return;
        tapView();
        if (useView.getState().mode === 'first' && useLookPrefs.getState().grabOnClose) requestLook();
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

    // the overview has the camera (rig.ts): you stay where you were standing, and the keys pan it
    if (rigOwnsCamera()) {
      rigInput.right = strafe;
      rigInput.forward = fwd;
      rigInput.fast = running;
      if (view.focus) view.setFocus(null);
      stepRig(dt);
      return;
    }

    const { yaw, pitch } = look.current;
    let moving = false;
    if (fwd || strafe) {
      const len = Math.hypot(fwd, strafe);
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const dx = ((-sin * fwd + cos * strafe) / len) * speed * dt;
      const dz = ((-cos * fwd - sin * strafe) / len) * speed * dt;
      let p = collide(camera.position.x + dx, camera.position.z + dz, colliders);
      const shut = shutDoorways(); // a side door still sliding open
      if (shut.length) p = collide(p.x, p.z, shut);
      camera.position.x = p.x;
      camera.position.z = p.z;
      moving = true;
    }
    bob.current += moving ? dt * speed * 2.2 : 0;
    camera.position.y = EYE_HEIGHT + (moving ? Math.sin(bob.current) * 0.035 : 0);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    playerAt.x = camera.position.x;
    playerAt.z = camera.position.z;
    playerAt.yaw = yaw;

    // what are we looking at?
    if (++frame.current % 3 !== 0) return;
    if (view.overlay) {
      if (view.focus) view.setFocus(null);
      return;
    }
    ray.setFromCamera(center, camera);
    ray.far = 8;
    const hits = ray.intersectObjects([...interactables.keys()], true);
    let found: Focus | null = null;
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !interactables.has(o)) o = o.parent;
      if (!o) continue;
      const info = interactables.get(o)!;
      if (h.distance <= info.range) found = info.pick?.(h.point, o) ?? { id: info.id, label: info.label, action: info.action };
      break;
    }
    view.setFocus(found);
  });

  return null;
}
