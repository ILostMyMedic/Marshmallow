// You, drawn: the workers' cartoon parts in your own look (myLook.ts), standing where you are (rig.ts playerAt) and facing
// the way you face. Following behind you (third person) all of you shows, and in the overview a "You" tag floats over
// you too; in first person the head is left out (the camera is in it, or just over it at the ping-pong table) and the
// body stands a little behind the camera, so looking down shows your chest, arms and feet. Your arms swing as you
// walk, hold what you carry (view.ts held: a mug, a snack, a paddle), lift it for a sip (sipping.ts sipPose) and wave
// when you say hi. In first person a mug or a snack is drawn with the camera instead, in a hand low on the right, as
// in a game: the body's own hand is behind the camera. The look editor's preview draws the same figure, turned
// whichever way you drag it.
import { useMemo, useRef, type RefObject } from 'react';
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
import { applyFace, HeadParts, shirtColor, Sleeve, TorsoWear, torsoWidth } from './Figure';
import { EYE_HEIGHT } from './layout';
import { useMe } from './myLook';
import { MUG_SIZE, MugLook, mugColor } from './mugLook';
import { lookingThrough } from './lookout';
import { INK } from './Outlines';
import { PaddleLook } from './PongTable';
import { paddleAt } from './pongState';
import { playerAt, rigOwnsCamera } from './rig';
import { sipPose } from './sipping';
import { DRINK_H, SnackLook } from './SnackLook';
import { Cyl } from './Toon';
import { useView, type Held } from './view';

type Arm = { pitch: number; yaw: number };
type Vec3 = [number, number, number];

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
// First person: your hand and what it holds, in camera space (metres: +X right, +Y up, -Z ahead): low on the right at
// rest, at the bottom middle for a sip; the forearm comes in from the bottom right, from `elbow`. A mug sits left of the
// hand (its handle in it), a snack just above it.
const VIEW = {
  rest: new THREE.Vector3(0.27, -0.25, -0.46),
  mouth: new THREE.Vector3(0.15, -0.17, -0.26),
  elbow: new THREE.Vector3(0.45, -0.66, -0.08),
  scale: 1.1,
  mug: [-0.14, 0.01, 0] as Vec3,
  snack: [-0.09, 0.06, -0.01] as Vec3,
  foodTurn: 1.1, // food points in towards the middle, not away from you, so you see it
};
const AHEAD = new THREE.Vector3(0, 0, 1); // a sleeve's length runs along +Z from the hand (Sleeve has it at -0.5)
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

const CAN_R = 0.033; // a drink's radius, near enough (SnackLook.tsx)

/**
 * What a sip tips about, in hand space (InHand places a mug at `mug` and a snack at `snack`): a mug's rim or a drink's
 * top on your side (+Z), so it stays at your lips while the bottom comes up; food where it's held (it comes up level).
 */
function tipPoint(held: Held, mug: Vec3, snack: Vec3, out: THREE.Vector3): THREE.Vector3 {
  if (held.kind === 'mug') return out.set(mug[0], mug[1] + (MUG_SIZE.h / 2) * HAND.scale, mug[2] + MUG_SIZE.r * HAND.scale);
  const h = held.kind === 'snack' ? DRINK_H[held.snack] : undefined;
  return h ? out.set(snack[0], snack[1] + h / 2, snack[2] + CAN_R) : out.set(...snack);
}

/**
 * What's in your right hand (hand space, upright): a mug centred at `mug`, turned `turn` so its handle meets the
 * hand, or a snack at `snack`, food turned `foodTurn` from pointing straight ahead. `tip` is what a sip tips
 * towards you, about tipPoint.
 */
function InHand({ held, tip, mug, turn, snack, foodTurn }: { held: Held | null; tip: RefObject<THREE.Group | null>; mug: Vec3; turn: number; snack: Vec3; foodTurn: number }) {
  if (held?.kind !== 'mug' && held?.kind !== 'snack') return null;
  const p = tipPoint(held, mug, snack, new THREE.Vector3());
  const at = held.kind === 'mug' ? mug : snack;
  return (
    <group ref={tip} position={p}>
      <group position={[at[0] - p.x, at[1] - p.y, at[2] - p.z]} rotation={[0, held.kind === 'mug' ? turn : foodTurn, 0]} scale={held.kind === 'mug' ? HAND.scale : 1}>
        {held.kind === 'mug' ? <MugLook color={mugColor(held.id)} sips={held.sips} shadow={false} steam={false} /> : <SnackLook snack={held.snack} left={held.left} />}
      </group>
    </group>
  );
}

/**
 * Your figure. `preview`: the look editor's, with nothing in hand, easing round to the yaw `spin` holds (the editor
 * turns it as you drag); otherwise you in the room, moved every frame from where you are and what you hold.
 */
export function MeFigure({ look, preview = false, spin }: { look: Appearance; preview?: boolean; spin?: { current: number } }) {
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
  const tip = useRef<THREE.Group>(null);
  const inView = useRef<THREE.Group>(null); // first person: follows the camera
  const viewGrip = useRef<THREE.Group>(null);
  const viewArm = useRef<THREE.Group>(null);
  const viewTip = useRef<THREE.Group>(null);
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
      spun: false, // the preview has been turned at least once (so it opens where it starts, not easing round to it)
      toElbow: new THREE.Vector3(),
      pivot: new THREE.Vector3(),
    }),
    [],
  );
  const scale = preview ? 1 : scaleFor(look);

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.1);
    const now = performance.now();
    const t = now / 1000;
    const g = root.current;
    if (!g) return;

    // ---------- where you are, and whether the camera is in your head ----------
    // first: the camera is in your head (walking in first person, at a lookout), or just over it (at the ping-pong
    // table); following behind you, or in the overview, all of you shows
    let first = false;
    if (preview) {
      const want = spin?.current ?? 0;
      g.rotation.y = st.spun ? g.rotation.y + (want - g.rotation.y) * (1 - Math.exp(-dt * 14)) : want;
      st.spun = true;
    } else {
      first = !rigOwnsCamera() && (useView.getState().person === 'first' || held?.kind === 'paddle' || !!lookingThrough());
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
    if (tag.current) tag.current.visible = !preview && rigOwnsCamera(); // the overview: where am I?

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
    // first person (not at a lookout): a mug or snack is drawn with the camera, and this arm swings like the other
    const seen = holding && first && !lookingThrough();
    if (holding && !seen) {
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
      // undo the arm's turn (XYZ, so inverted as YXZ) so a mug stays upright; a sip tips it to the lips
      if (cup.current) {
        cup.current.rotation.set(-r.pitch, -r.yaw, 0, 'YXZ');
        cup.current.visible = !seen;
      }
      if (tip.current) tip.current.rotation.x = sipPose.tilt;
      if (blade.current) blade.current.rotation.set(-r.pitch, -r.yaw, 0, 'YXZ');
    }
    if (bat.current) bat.current.visible = held?.kind === 'paddle';

    // ---------- first person: the hand in view, brought up for a sip, swaying as you walk ----------
    const v = inView.current;
    if (v) {
      v.visible = seen;
      if (seen && viewGrip.current && viewArm.current) {
        v.position.copy(camera.position);
        v.quaternion.copy(camera.quaternion);
        const grip = viewGrip.current.position.lerpVectors(VIEW.rest, VIEW.mouth, sipPose.lift);
        grip.x += Math.sin(st.phase) * 0.012 * walk;
        grip.y -= Math.sin(st.phase) ** 2 * 0.014 * walk;
        // the hand tips with what it holds (about the same point, as three.js turns about X), so it keeps hold
        const p = tipPoint(held, VIEW.mug, VIEW.snack, st.pivot);
        const [c, sn] = [Math.cos(sipPose.tilt), Math.sin(sipPose.tilt)];
        const hand = viewArm.current.position.set(-p.x, -p.y * c + p.z * sn, -p.y * sn - p.z * c).add(p);
        st.toElbow.copy(VIEW.elbow).sub(grip).addScaledVector(hand, -VIEW.scale).normalize();
        viewArm.current.quaternion.setFromUnitVectors(AHEAD, st.toElbow);
        if (viewTip.current) viewTip.current.rotation.x = sipPose.tilt;
      }
    }

    // ---------- the head (when it shows): a look round, a blink ----------
    if (head.current?.visible) {
      head.current.rotation.set(Math.sin(t * 0.3) * 0.05 + (holding ? sipPose.lift * 0.25 : 0), Math.sin(t * 0.4) * 0.12 * (1 - walk), 0);
      stepFace(st.face, now < hello.until ? 'joyful' : 'neutral', dt);
      applyFace(faceMesh, st.face, blink(t, 4242));
    }
  });

  return (
    <>
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
              <InHand held={held} tip={tip} mug={[0, 0, HAND.ahead]} turn={-Math.PI / 2} snack={[0, 0, 0]} foodTurn={0} />
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
      {!preview && (
        <group ref={inView} visible={false}>
          <group ref={viewGrip} scale={VIEW.scale}>
            <group ref={viewArm}>
              <Piece position={[0, 0, 0.26]} rotation={[Math.PI / 2, 0, 0]} geometry={PARTS.sleeve} color={shirtColor('worker', look)} outline={0.012} />
              <Piece geometry={PARTS.hand} color={look.skin} />
            </group>
            <InHand held={held} tip={viewTip} mug={VIEW.mug} turn={0} snack={VIEW.snack} foodTurn={VIEW.foodTurn} />
          </group>
        </group>
      )}
    </>
  );
}

/** You in the room. */
export function Me() {
  const look = useMe((s) => s.look);
  return <MeFigure look={look} />;
}
