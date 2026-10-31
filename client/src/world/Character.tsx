// Adapted from cubefarm client/src/world/Character.tsx (MIT): the seated worker only. Walking, gestures, fidgets and
// what people carry come with their phases.
import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Worker } from '../../../shared/types';
import { qaKey, useStore } from '../store';
import { seededAppearance } from './appearance';
import { Piece } from './Batched';
import { PARTS } from './characterParts';
import { blink, expressionFor, isDrowsy, newFace, prFaceOf, stepFace } from './face';
import { applyFace, HeadParts, Sleeve, TorsoWear, torsoWidth } from './Figure';
import { lifeOf } from './model';
import { INK } from './Outlines';
import { burstLevel, handLift, hashString, mouseDip, poseFor, TAP_PHASE, tapSpeed, typingSeed, type PoseName } from './typing';

// A cartoon worker at their desk. Origin is the floor under the chair; they face -Z (toward the desk). `children` (the
// name tag) float over the desk.

type Arm = { pitch: number; yaw: number }; // yaw > 0 swings the hand toward the body's centre line
type Pose = { l: Arm; r: Arm; lean: number; headPitch: number; headYaw: number; type: number; mouse: number };

const KEYS: Arm = { pitch: -0.34, yaw: 0.26 };
// Arm pitch rotates the arm (which points along -Z) up from horizontal: 0 = straight ahead, +PI/2 = straight up. The
// poses are chosen so hands never pass through the head (radius 0.2, ~0.22 above the shoulders).
const POSES: Record<PoseName, Pose> = {
  typing: { l: KEYS, r: KEYS, lean: 0.1, headPitch: -0.02, headYaw: 0, type: 1, mouse: 0 },
  browsing: { l: KEYS, r: { pitch: -0.4, yaw: -0.22 }, lean: 0.06, headPitch: 0.05, headYaw: 0.04, type: 0.25, mouse: 1 },
  thinking: { l: KEYS, r: { pitch: 0.55, yaw: 0.95 }, lean: 0.02, headPitch: 0.1, headYaw: -0.12, type: 0.3, mouse: 0 }, // hand under the chin
  relaxed: { l: { pitch: -0.9, yaw: 0.35 }, r: { pitch: -0.9, yaw: 0.35 }, lean: -0.1, headPitch: 0.06, headYaw: 0, type: 0, mouse: 0 }, // hands in the lap
  cheer: { l: { pitch: 1.45, yaw: -0.35 }, r: { pitch: 1.45, yaw: -0.35 }, lean: -0.05, headPitch: 0.2, headYaw: 0, type: 0, mouse: 0 }, // arms up in a V
  slump: { l: { pitch: -1.35, yaw: -0.15 }, r: { pitch: -1.35, yaw: -0.15 }, lean: 0.25, headPitch: -0.45, headYaw: 0, type: 0, mouse: 0 }, // arms dangling
};

const clone = (p: Pose): Pose => ({ ...p, l: { ...p.l }, r: { ...p.r } });
const PANTS = '#3d4a6b';
const SEAT_Y = 0.5;
const TAG_SEATED: [number, number, number] = [0, 1.98, -1.12]; // over the desk

export function Character({ worker, children }: { worker: Worker; children?: ReactNode }) {
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const faceMesh = useRef<THREE.Mesh>(null);
  const cur = useRef<Pose>(clone(POSES.relaxed));
  const look = useMemo(() => seededAppearance({ seed: worker.seed, role: worker.role }), [worker.seed, worker.role]);
  const seed = useMemo(() => typingSeed(worker.id), [worker.id]);
  const face = useMemo(() => ({ s: newFace(), seed: hashString(worker.id) % 10007 }), [worker.id]);
  const task = worker.task;
  // their own open PR's mood (face.ts): its checks and QA record
  const prMood = useStore((s) => prFaceOf({ role: worker.role, task: task?.kind ?? null, floorId: worker.floorId, prNumber: task?.prNumber ?? null }, s.floors, task?.prNumber != null ? s.qa[qaKey(worker.floorId, task.prNumber)] : undefined));
  const busy = worker.status === 'working' || worker.status === 'preparing';

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const now = Date.now();
    const t = performance.now() / 1000 + seed;
    const office = useStore.getState();
    const life = lifeOf(worker, office.moments, now);
    const lastLog = office.logs[worker.id]?.at(-1)?.t ?? 0;

    // ---------- the pose: eased toward the one their state calls for ----------
    const name = poseFor(worker.status, worker.activity?.kind ?? null, now - lastLog, life.cheering);
    const target = POSES[name];
    const c = cur.current;
    const k5 = 1 - Math.exp(-dt * 5);
    for (const side of ['l', 'r'] as const) {
      c[side].pitch += (target[side].pitch - c[side].pitch) * k5;
      c[side].yaw += (target[side].yaw - c[side].yaw) * k5;
    }
    for (const key of ['lean', 'headPitch', 'headYaw', 'type', 'mouse'] as const) c[key] += (target[key] - c[key]) * k5;

    // Typing comes in bursts: fast alternating taps, then a short pause to read.
    const burst = burstLevel(t);
    const tap = c.type * burst * 0.1;
    const speed = tapSpeed(worker.status);
    const tapL = handLift(t, speed, TAP_PHASE.l) * tap;
    const tapR = handLift(t, speed, TAP_PHASE.r) * tap * (1 - c.mouse);
    const driftL = Math.sin(t * 3.1) * 0.05 * c.type;
    const driftR = Math.sin(t * 2.7 + 1) * 0.05 * c.type;
    // Mouse hand: small glides plus a click now and then.
    const glide = Math.sin(t * 1.9) * 0.06 * c.mouse;
    const click = mouseDip(t) * c.mouse;
    const wave = life.cheering ? Math.sin(t * 9) * 0.35 : 0;
    // Longer arms on taller people: tip them down a touch so hands still land on the keyboard.
    const reach = -(look.height - 1) * 0.55;
    if (armL.current && armR.current) {
      armL.current.rotation.set(c.l.pitch + reach + tapL, -(c.l.yaw + driftL) + wave, 0);
      armR.current.rotation.set(c.r.pitch + reach + tapR - click, c.r.yaw + driftR * (1 - c.mouse) + glide - wave, 0);
    }
    if (torso.current) {
      const breathe = Math.sin(t * 1.6) * 0.015;
      torso.current.rotation.x = -c.lean + breathe + (busy ? Math.sin(t * 9) * 0.006 * burst : 0);
    }
    if (head.current) {
      // Every few seconds, glance down at the keyboard; while setting up, look around.
      const glance = busy && Math.sin(t * 0.55 + 2) > 0.92 ? -0.22 : 0;
      const gaze = worker.status === 'preparing' ? Math.sin(t * 1.3) * 0.5 : Math.sin(t * 0.4) * 0.08;
      head.current.rotation.set(c.headPitch + glance + (busy ? Math.sin(t * 4.5) * 0.02 * burst : 0), gaze + c.headYaw, name === 'thinking' ? 0.12 : 0);
    }

    // ---------- the face: an expression for their state, eased in, with blinks ----------
    const idleFor = !busy && worker.idleSince != null ? (now - worker.idleSince) / 1000 : 0;
    const expression = expressionFor({ status: worker.status, cheering: life.cheering, asleep: false, drowsy: isDrowsy(idleFor, idleFor), pr: prMood, justMerged: life.justMerged });
    stepFace(face.s, expression, dt);
    applyFace(faceMesh, face.s, blink(t, face.seed));
  });

  return (
    <group>
      {/* seated legs don't move, so both are one mesh */}
      <Piece geometry={PARTS.legs} color={PANTS} castShadow outline={0.012} />
      <Piece geometry={PARTS.shoes} color={INK} castShadow />
      {/* taller people sit a touch further forward so their back stays clear of the chair */}
      <group ref={torso} position={[0, SEAT_Y, -(look.height - 1) * 0.25]} scale={look.height}>
        <TorsoWear role={worker.role} look={look} busy={busy} />
        {/* arms pivot at the shoulders */}
        {[
          { ref: armL, x: -0.25 },
          { ref: armR, x: 0.25 },
        ].map(({ ref, x }) => (
          <group key={x} ref={ref} position={[x * torsoWidth(look), 0.44, 0]}>
            <Sleeve role={worker.role} look={look} />
          </group>
        ))}
        <group ref={head} position={[0, 0.66, 0]}>
          <HeadParts look={look} busy={busy} face={faceMesh} />
        </group>
      </group>
      {children && <group position={TAG_SEATED}>{children}</group>}
    </group>
  );
}
