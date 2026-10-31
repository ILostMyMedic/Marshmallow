// You, drawn: the workers' cartoon parts in your own look (myLook.ts), standing where you are (rig.ts playerAt) and facing
// where you look. In first person the head is left out (the camera is in it, or just over it at the ping-pong table)
// and the body stands a little behind the camera, so looking down shows your chest, arms and feet; the overview shows
// all of you, with a "You" tag. Your arms swing as you walk, hold what you carry (view.ts held: a mug, a
// snack, a paddle), lift it for a sip (sipping.ts sipPose) and wave when you say hi. The look editor's preview draws
// the same figure turning on the spot.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { Appearance } from './appearance';
import { Piece } from './Batched';
import { gait, type Gait } from './body';
import { useCanvasTexture } from './canvasTexture';
import { PARTS } from './characterParts';
import { roundRect, SANS } from './draw';
import { blink, newFace, stepFace } from './face';
import { applyFace, HeadParts, Sleeve, TorsoWear, torsoWidth } from './Figure';
import { EYE_HEIGHT } from './layout';
import { useMe } from './myLook';
import { MugLook, mugColor } from './mugLook';
import { INK } from './Outlines';
import { PaddleLook } from './PongTable';
import { paddleAt } from './pongState';
import { playerAt, rigOwnsCamera } from './rig';
import { sipPose } from './sipping';
import { SnackLook } from './SnackLook';
import { Cyl } from './Toon';
import { useView, type Held } from './view';

type Arm = { pitch: number; yaw: number };

const PANTS = '#3d4a6b';
// Hips at the top of straight legs; the knee `thigh` below (characterParts.ts), as Character.tsx has them standing.
const HIP = { x: 0.11, standY: 0.815, thigh: 0.32 };
const HANG: Arm = { pitch: -1.42, yaw: -0.1 };
// Something held out in front: high and forward in first person, so it shows at the bottom right of the view; lower,
// like a worker's mug, when you see yourself from outside.
const HOLD_EYES: Arm = { pitch: 0.05, yaw: 0.16 };
const HOLD_SEEN: Arm = { pitch: -0.75, yaw: 0.3 };
const MOUTH: Arm = { pitch: 0.7, yaw: 0.85 };
const WAVE: Arm = { pitch: 1.25, yaw: -0.3 };
/** First person: the body stands this far (m) behind the camera. */
const BACK = 0.28;
// A mug or snack in the right hand (arm space: the hand is at z -0.5), kept upright whatever the arm does.
const HAND = { at: [0, -0.02, -0.52] as [number, number, number], ahead: -0.07, scale: 1.3 };
// The paddle in the right hand: its handle, and the blade's centre further along.
const BAT = { hand: -0.5, blade: -0.17 };
const TAG_Y = 0.45; // over the head

/** You wave until this (performance.now()); saying hi sets it. */
const hello = { until: 0 };
export function waveHello(seconds = 1.4) {
  hello.until = performance.now() + seconds * 1000;
}

/** How much bigger than life you're drawn, so your eyes are where the camera is (layout.ts EYE_HEIGHT). */
const scaleFor = (look: Appearance) => EYE_HEIGHT / (HIP.standY + 0.66 * look.height);

/** The "You" tag over your head when you see yourself. */
function YouTag() {
  const tex = useCanvasTexture(
    256,
    96,
    (ctx) => {
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, 6, 10, 244, 76, 38);
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.font = `700 46px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⭐ You', 128, 50);
    },
    [],
  );
  return (
    <Billboard>
      <mesh>
        <planeGeometry args={[0.6, 0.225]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </Billboard>
  );
}

/** What's in your right hand, as it looks there. */
function InHand({ held }: { held: Held | null }) {
  if (held?.kind === 'mug')
    return (
      <group position={[0, 0, HAND.ahead]} rotation={[0, -Math.PI / 2, 0]} scale={HAND.scale}>
        <MugLook color={mugColor(held.id)} sips={held.sips} shadow={false} steam={false} />
      </group>
    );
  if (held?.kind === 'snack') return <SnackLook snack={held.snack} left={held.left} />;
  return null;
}

/**
 * Your figure. `preview`: the look editor's, turning on the spot with nothing in hand; otherwise you in the room,
 * moved every frame from where you are and what you hold.
 */
export function MeFigure({ look, preview = false }: { look: Appearance; preview?: boolean }) {
  const root = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const tag = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const hipL = useRef<THREE.Group>(null);
  const hipR = useRef<THREE.Group>(null);
  const kneeL = useRef<THREE.Group>(null);
  const kneeR = useRef<THREE.Group>(null);
  const cup = useRef<THREE.Group>(null);
  const bat = useRef<THREE.Group>(null);
  const blade = useRef<THREE.Group>(null);
  const faceMesh = useRef<THREE.Mesh>(null);
  const held = useView((s) => (preview ? null : s.held));
  const st = useMemo(
    () => ({
      x: playerAt.x,
      z: playerAt.z,
      speed: 0,
      phase: 0,
      fp: 0,
      r: { ...HANG },
      g: { stride: 0, cadence: 0, bob: 0, lean: 0 } as Gait,
      face: newFace(),
      aim: new THREE.Vector3(),
      shoulder: new THREE.Vector3(),
      q: new THREE.Quaternion(),
    }),
    [],
  );
  const scale = preview ? 1 : scaleFor(look);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const now = performance.now();
    const t = now / 1000;
    const g = root.current;
    if (!g) return;

    // ---------- where you are, and whether the camera is in your head ----------
    // first: the camera is in your head (walking), or just over it (at the ping-pong table)
    let first = false;
    if (preview) g.rotation.y = t * 0.6;
    else {
      first = !rigOwnsCamera();
      const moved = Math.hypot(playerAt.x - st.x, playerAt.z - st.z);
      st.speed += (Math.min(8, moved / Math.max(dt, 1e-3)) - st.speed) * (1 - Math.exp(-dt * 10));
      st.x = playerAt.x;
      st.z = playerAt.z;
      const back = first && held?.kind !== 'paddle' ? BACK : 0; // at the table Player.tsx stands you behind the paddle itself
      g.position.set(st.x + Math.sin(playerAt.yaw) * back, 0, st.z + Math.cos(playerAt.yaw) * back);
      g.rotation.y = playerAt.yaw;
    }
    st.fp += ((first ? 1 : 0) - st.fp) * (1 - Math.exp(-dt * 12));
    if (head.current) head.current.visible = !first;
    if (tag.current) tag.current.visible = !preview && !first;

    // ---------- the walk ----------
    const gt = gait(st.speed, st.g);
    if (st.speed > 0.05) st.phase = (st.phase + dt * gt.cadence * Math.PI) % (Math.PI * 2);
    const walk = Math.min(1, st.speed / 0.5);
    const swing = Math.sin(st.phase) * gt.stride * walk;
    const bob = -gt.bob * walk * Math.sin(st.phase) ** 2;
    const idle = Math.sin(t * 1.1) * 0.03 * (1 - walk);
    if (torso.current) {
      torso.current.position.y = HIP.standY + bob;
      torso.current.rotation.set(Math.sin(t * 1.6) * 0.015 - gt.lean * walk, Math.sin(st.phase) * 0.1 * walk, (Math.sin(t * 0.5) * 0.03 * (1 - walk) + Math.sin(st.phase) * 0.035 * walk) * (1 - st.fp));
    }
    if (hipL.current && hipR.current && kneeL.current && kneeR.current) {
      // knees bend as each leg swings forward; standing, one knee eases while the weight is on the other foot
      const lift = 0.3 + gt.stride;
      const shift = Math.sin(t * 0.5) * 0.15 * (1 - walk);
      const bendL = -(Math.max(0, Math.cos(st.phase)) * lift * walk + Math.max(0, shift) + 0.04);
      const bendR = -(Math.max(0, -Math.cos(st.phase)) * lift * walk + Math.max(0, -shift) + 0.04);
      hipL.current.position.y = hipR.current.position.y = HIP.standY + bob;
      hipL.current.rotation.x = swing - bendL * 0.4;
      hipR.current.rotation.x = -swing - bendR * 0.4;
      kneeL.current.rotation.x = bendL;
      kneeR.current.rotation.x = bendR;
    }

    // ---------- the arms: the left swings, the right holds, sips, aims the paddle or waves ----------
    if (armL.current) armL.current.rotation.set(HANG.pitch - swing * 1.1 + idle, -HANG.yaw, 0);
    const r = st.r;
    const k = 1 - Math.exp(-dt * 8);
    let want: Arm = { pitch: HANG.pitch + swing * 1.1 + idle, yaw: HANG.yaw };
    const holding = held?.kind === 'mug' || held?.kind === 'snack';
    if (holding) {
      const hold = { pitch: THREE.MathUtils.lerp(HOLD_SEEN.pitch, HOLD_EYES.pitch, st.fp), yaw: THREE.MathUtils.lerp(HOLD_SEEN.yaw, HOLD_EYES.yaw, st.fp) };
      want = { pitch: THREE.MathUtils.lerp(hold.pitch, MOUTH.pitch, sipPose.lift), yaw: THREE.MathUtils.lerp(hold.yaw, MOUTH.yaw, sipPose.lift) };
    }
    if (now < hello.until) want = { pitch: WAVE.pitch, yaw: WAVE.yaw + Math.sin(t * 9) * 0.4 };
    let aimed = false;
    if (held?.kind === 'paddle' && torso.current) {
      // the bat arm points at where the paddle is (an arm is one straight piece)
      const p = paddleAt(held.end);
      torso.current.localToWorld(st.shoulder.set(0.25 * torsoWidth(look), 0.44, 0));
      const d = st.aim.set(p.x, p.y, p.z).sub(st.shoulder).applyQuaternion(torso.current.getWorldQuaternion(st.q).invert()).normalize();
      r.yaw = Math.asin(Math.max(-1, Math.min(1, -d.x)));
      r.pitch = Math.atan2(d.y, -d.z);
      aimed = true;
    }
    if (!aimed) {
      r.pitch += (want.pitch - r.pitch) * k;
      r.yaw += (want.yaw - r.yaw) * k;
    }
    if (armR.current) {
      armR.current.rotation.set(r.pitch, r.yaw, 0);
      // undo the arm's turn (XYZ, so inverted as YXZ) so a mug stays upright, then tip it to the lips for a sip
      if (cup.current) cup.current.rotation.set(sipPose.tilt - r.pitch, -r.yaw, 0, 'YXZ');
      if (blade.current) blade.current.rotation.set(-r.pitch, -r.yaw, 0, 'YXZ');
    }
    if (bat.current) bat.current.visible = held?.kind === 'paddle';

    // ---------- the head (when it shows): a look round, a blink ----------
    if (head.current?.visible) {
      head.current.rotation.set(Math.sin(t * 0.3) * 0.05 + (holding ? sipPose.lift * 0.25 : 0), Math.sin(t * 0.4) * 0.12 * (1 - walk), 0);
      stepFace(st.face, now < hello.until ? 'joyful' : 'neutral', dt);
      applyFace(faceMesh, st.face, blink(t, 4242));
    }
  });

  return (
    <group ref={root} scale={scale}>
      {/* legs: jointed at the hips and knees */}
      {[
        { hip: hipL, knee: kneeL, x: -HIP.x },
        { hip: hipR, knee: kneeR, x: HIP.x },
      ].map(({ hip, knee, x }) => (
        <group key={x} ref={hip} position={[x, HIP.standY, 0]}>
          <Piece geometry={PARTS.thigh} color={PANTS} castShadow outline={0.012} />
          <group ref={knee} position={[0, -HIP.thigh, 0]}>
            <Piece geometry={PARTS.shin} color={PANTS} castShadow outline={0.012} />
            <Piece geometry={PARTS.shoe} color={INK} castShadow />
          </group>
        </group>
      ))}
      <group ref={torso} position={[0, HIP.standY, 0]} scale={look.height}>
        <TorsoWear role="worker" look={look} busy={false} />
        <group ref={armL} position={[-0.25 * torsoWidth(look), 0.44, 0]}>
          <Sleeve role="worker" look={look} />
        </group>
        <group ref={armR} position={[0.25 * torsoWidth(look), 0.44, 0]}>
          <Sleeve role="worker" look={look} />
          <group ref={cup} position={HAND.at}>
            <InHand held={held} />
          </group>
          <group ref={bat} position={[0, 0, BAT.hand]} visible={false}>
            <Cyl r={0.014} h={0.1} position={[0, 0, -0.05]} rotation={[Math.PI / 2, 0, 0]} color="#d4a373" shadow={false} />
            <group ref={blade} position={[0, 0, BAT.blade]}>
              <PaddleLook handle={false} />
            </group>
          </group>
        </group>
        <group ref={head} position={[0, 0.66, 0]}>
          <HeadParts look={look} busy={false} face={faceMesh} />
          <group ref={tag} position={[0, TAG_Y, 0]}>
            <YouTag />
          </group>
        </group>
      </group>
    </group>
  );
}

/** You in the room. */
export function Me() {
  const look = useMe((s) => s.look);
  return <MeFigure look={look} />;
}
