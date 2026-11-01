// You, drawn: a body in the office's style (RigBody.tsx) in your own look (myLook.ts), standing where you are (rig.ts
// playerAt) and facing the way you face. Following behind you (third person) all of you shows, and in the overview a
// "You" tag floats over you too; in first person the head is left out (the camera is in it) and the body stands a little
// behind the camera, so looking down shows your chest, arms and feet. At the ping-pong table, with the camera raised
// behind you (pongCam.ts), you're drawn see-through and headless, so the ball is never lost behind you.
// Your arms swing as you walk, hold what you carry (view.ts held: a mug, a snack, a paddle, a marshmallow on a stick, a
// hoop's ball or a dart, which games/ draw where your hand reaches), lift it for a sip (sipping.ts sipPose) and wave
// when you say hi. In first person a mug, a snack or the stick is drawn
// with the camera instead, in your own forearm and hand low on the right, as in a game: the body's own hand is behind
// the camera. Sitting (view.ts seated), your hips are on the seat, your legs bent to the floor and your hands in your
// lap, the whole of you leant back with a deck chair or into a beanbag (seats.ts). The look editor's preview draws the
// same figure, turned whichever way you drag it.
import { useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { BodyStyle } from '../../../shared/types';
import { bodyMaterial } from '../lab/ink';
import { BI } from '../lab/rig';
import type { Appearance } from './appearance';
import { gait, type Gait } from './body';
import { holdArm, legLength, seatPose, stickArm, upPose, waveArm } from './bodyPoses';
import { playerScale } from './bodyStyle';
import { useCanvasTexture } from './canvasTexture';
import { roundRect, SANS } from './draw';
import { blink, newFace, stepFace } from './face';
import { applyFace, HeadParts, NeckPhones } from './Figure';
import { useMe } from './myLook';
import { MUG_SIZE, MugLook, mugColor } from './mugLook';
import { lookingThrough } from './lookout';
import { INK, ObjectInk } from './Outlines';
import { PLAYER, toyHand } from './games/gameState';
import { PaddleLook } from './PongTable';
import { paddleAt } from './pongState';
import { playerAt, rigOwnsCamera } from './rig';
import { ArmPiece, BodyMeshes, OnBone, Poser, useBody, useBodyStyle } from './RigBody';
import { MarshmallowStick, type StickState } from './roof/MarshmallowStick';
import { liveOf } from './roof/toasting';
import { SIT_POSE } from './seats';
import { sipPose } from './sipping';
import { DRINK_H, SnackLook } from './SnackLook';
import { Cyl } from './Toon';
import { useView, type Held } from './view';

type Vec3 = [number, number, number];

/** First person: the body stands this far (m) behind the camera. */
const BACK = 0.28;
// A mug or snack in the right hand, kept upright whatever the arm does: a mug just ahead of the fist, its handle in it.
const HAND = { ahead: -0.07, scale: 1.3 };
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
const AHEAD = new THREE.Vector3(0, 0, 1); // the forearm runs along +Z from the hand (RigBody.tsx forearmOf)
/** The paddle: its blade's middle this far over the wrist, the handle in the fist. */
const BAT = { blade: 0.17 };
// A marshmallow's stick: out from your hand, all but level, over the fire you're facing (roof/marshmallow.ts HEAT
// reach); in first person from the hand in view to a point low in the middle of it (camera space, as VIEW, looking
// level), a stride and more out in front, and kept level however far you look up or down.
const STICK = { len: 1.35, tilt: -0.04, viewTip: new THREE.Vector3(-0.02, -0.5, -2.25) };
const VIEW_STICK = STICK.viewTip.clone().sub(VIEW.rest);
const VIEW_STICK_TURN = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), VIEW_STICK.clone().normalize());
const X_AXIS = new THREE.Vector3(1, 0, 0);
const unPitch = new THREE.Quaternion();
/** Your marshmallow as its stick draws it (filled in each frame, not made anew). */
const myStick: StickState = { toast: 0, flame: 0 };
function myStickNow(): StickState {
  const h = useView.getState().held;
  if (h?.kind !== 'marshmallow') return myStick;
  const l = liveOf(h);
  myStick.toast = l.toast;
  myStick.flame = l.flame;
  myStick.eaten = h.eaten;
  myStick.lift = sipPose.lift;
  return myStick;
}
/** The "You" tag's height over the top of your head. */
const TAG_UP = 0.27;

let ghostMat: THREE.MeshToonMaterial | null = null;
/**
 * Your body at the ping-pong table: see-through and without its ink, so the ball is never lost behind you (the camera
 * keeps you off to the side anyway: pongCam.ts). Made once, from the bodies' own material.
 */
function ghostMaterial() {
  if (ghostMat) return ghostMat;
  ghostMat = bodyMaterial.clone();
  ghostMat.transparent = true;
  ghostMat.opacity = 0.4;
  ghostMat.depthWrite = false;
  return ghostMat;
}

/** You wave until this (performance.now()); saying hi sets it. */
const hello = { until: 0 };
export function waveHello(seconds = 1.4) {
  hello.until = performance.now() + seconds * 1000;
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);

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
 * hand, a snack at `snack`, food turned `foodTurn` from pointing straight ahead, or a marshmallow's stick from the hand
 * turned by `stick`, `stickLen` long. `tip` is what a sip tips towards you, about tipPoint.
 */
function InHand({ held, tip, mug, turn, snack, foodTurn, stick, stickLen, stickRef }: { held: Held | null; tip: RefObject<THREE.Group | null>; mug: Vec3; turn: number; snack: Vec3; foodTurn: number; stick: THREE.Quaternion | Vec3; stickLen: number; stickRef?: RefObject<THREE.Group | null> }) {
  if (held?.kind === 'marshmallow')
    return (
      <group ref={stickRef} {...(stick instanceof THREE.Quaternion ? { quaternion: stick } : { rotation: stick })}>
        <MarshmallowStick live={myStickNow} length={stickLen} />
      </group>
    );
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
 * Your figure. `preview`: the look editor's (or the setup's, in `style` rather than the office's), with nothing in hand,
 * easing round to the yaw `spin` holds (the editor turns it as you drag); otherwise you in the room, moved every frame
 * from where you are and what you hold.
 */
export function MeFigure({ look, preview = false, spin, style }: { look: Appearance; preview?: boolean; spin?: { current: number }; style?: BodyStyle }) {
  const office = useBodyStyle();
  const rig = useBody(look, 'worker', style ?? office);
  const props = rig.props;
  const poser = useMemo(() => new Poser(props), [props]);
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const tag = useRef<THREE.Group>(null);
  const phones = useRef<THREE.Group>(null);
  const cup = useRef<THREE.Group>(null);
  const tip = useRef<THREE.Group>(null);
  const inView = useRef<THREE.Group>(null); // first person: follows the camera
  const viewGrip = useRef<THREE.Group>(null);
  const viewArm = useRef<THREE.Group>(null);
  const viewTip = useRef<THREE.Group>(null);
  const viewStick = useRef<THREE.Group>(null);
  const bat = useRef<THREE.Group>(null);
  const faceMesh = useRef<THREE.Mesh>(null);
  const held = useView((s) => (preview ? null : s.held));
  const st = useMemo(
    () => ({
      x: playerAt.x,
      z: playerAt.z,
      speed: 0,
      phase: 0,
      fp: 0,
      g: { stride: 0, cadence: 0, bob: 0, lean: 0 } as Gait,
      face: newFace(),
      v: new THREE.Vector3(),
      paddle: [0, 0, 0] as Vec3,
      spun: false, // the preview has been turned at least once (so it opens where it starts, not easing round to it)
      sit: 0, // 1 sitting, 0 on your feet, eased in between
      hip: 0.45, // the last seat's height, in the body's units
      lean: 0,
      lift: 0,
      toElbow: new THREE.Vector3(),
      pivot: new THREE.Vector3(),
    }),
    [],
  );
  const scale = preview ? 1 : playerScale(style ?? office, look.height);

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
      const seat = useView.getState().seated;
      const moved = Math.hypot(playerAt.x - st.x, playerAt.z - st.z);
      // sitting down or getting up moves you there at once: that's no walk
      if (seat || moved > 0.6) st.speed = 0;
      else st.speed += (Math.min(8, moved / Math.max(dt, 1e-3)) - st.speed) * (1 - Math.exp(-dt * 10));
      st.x = playerAt.x;
      st.z = playerAt.z;
      const back = first && held?.kind !== 'paddle' ? BACK : 0; // at the table Player.tsx stands you behind the paddle itself
      g.position.set(st.x + Math.sin(playerAt.yaw) * back, 0, st.z + Math.cos(playerAt.yaw) * back);
      g.rotation.set(0, playerAt.yaw, 0, 'YXZ');
      if (seat) {
        // hips on the seat, leant back about them: the whole figure turned about that point
        const pose = SIT_POSE[seat.kind];
        st.hip = seat.height / scale;
        st.lean = pose.lean;
        st.lift = pose.lift;
        const lean = pose.lean * smoothstep(st.sit);
        g.rotation.x = lean;
        g.position.y = seat.height * (1 - Math.cos(lean));
        g.position.x -= seat.height * Math.sin(lean) * Math.sin(seat.facing);
        g.position.z -= seat.height * Math.sin(lean) * Math.cos(seat.facing);
      }
      st.sit += ((seat ? 1 : 0) - st.sit) * (1 - Math.exp(-dt * 10));
    }
    st.fp += ((first ? 1 : 0) - st.fp) * (1 - Math.exp(-dt * 12));
    if (head.current) head.current.visible = !first;
    // at the ping-pong table you're a see-through figure without ink (the body mesh, its ink shell and its details)
    const ghost = !preview && held?.kind === 'paddle' && !rigOwnsCamera();
    rig.meshes.forEach((m, i) => {
      if (i === 1) m.visible = !ghost;
      else if (m.material !== (ghost ? ghostMaterial() : bodyMaterial)) m.material = ghost ? ghostMaterial() : bodyMaterial;
    });
    if (phones.current) phones.current.visible = !ghost; // solid headphones round a see-through neck would float
    // the neck goes with the head, or it stands up out of the collar right under the camera
    rig.bones[BI.neck].scale.setScalar(first ? 1e-3 : 1);
    if (tag.current) tag.current.visible = !preview && rigOwnsCamera(); // the overview: where am I?

    // ---------- the walk (and sitting: k is how far down you are) ----------
    const k = smoothstep(st.sit);
    const gt = gait(st.speed, st.g, legLength(props));
    if (st.speed > 0.05) st.phase = (st.phase + dt * gt.cadence * Math.PI) % (Math.PI * 2);
    const walk = Math.min(1, st.speed / 0.5);

    // ---------- the right hand: aims the paddle, waves, holds and sips, or swings like the left ----------
    const holding = held?.kind === 'mug' || held?.kind === 'snack' || held?.kind === 'marshmallow';
    // first person (not at a lookout): a mug or snack is drawn with the camera, and this arm swings like the other
    const seen = holding && first && !lookingThrough();
    let mode = 'free';
    if (held?.kind === 'paddle') {
      // the bat hand where the paddle is (its blade's middle over the fist)
      const p = paddleAt(held.end);
      g.updateWorldMatrix(true, false);
      g.worldToLocal(st.v.set(p.x, p.y - BAT.blade * scale, p.z));
      st.paddle = [st.v.x, st.v.y, st.v.z];
      mode = 'paddle';
    } else if (held?.kind === 'game' && toyHand(PLAYER)) {
      // a hoop's ball or a dart: the right hand where the game holds it (games/gameState.ts)
      const p = toyHand(PLAYER)!;
      g.updateWorldMatrix(true, false);
      g.worldToLocal(st.v.set(p.x, p.y, p.z));
      st.paddle = [st.v.x, st.v.y, st.v.z];
      mode = 'toy';
    } else if (now < hello.until) mode = 'wave';
    else if (holding && !seen) mode = held?.kind === 'marshmallow' ? 'stick' : 'hold';
    const right = mode === 'wave' ? waveArm(props, t) : mode === 'hold' ? holdArm(props, sipPose.lift) : mode === 'stick' ? stickArm() : undefined;
    const look: Vec3 = [Math.sin(t * 0.3) * 0.05 + (holding ? sipPose.lift * 0.25 : 0), Math.sin(t * 0.4) * 0.12 * (1 - walk), 0];
    const sat = k > 0.001 ? seatPose(props, { t, seatY: st.hip, tilt: st.lean * k, lift: st.lift, r: right, head: look }) : null;
    let standing = null;
    if (k < 0.999) {
      standing = upPose(props, { t, speed: st.speed, phase: st.phase, dir: [0, -1], gesture: 'none', party: false, paddle: mode === 'paddle' || mode === 'toy' ? st.paddle : null, carry: 1, head: look });
      if (right) standing.arm.r = right;
    }
    poser.show(rig.bones, now / 1000, `${k > 0.5 ? 's' : 'u'}:${mode}`, k, sat, standing);

    // what's in the hand, upright at its grip (figure space); a sip tips it to the lips
    if (cup.current) {
      poser.at(BI.handR, rig.built.grip, cup.current.position);
      cup.current.visible = !seen;
    }
    if (tip.current) tip.current.rotation.x = sipPose.tilt;
    if (bat.current) {
      bat.current.visible = held?.kind === 'paddle';
      if (bat.current.visible) poser.at(BI.handR, [0, 0, 0], bat.current.position);
    }

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
        // a marshmallow's stick stays out level over the fire, however far you look down at it
        if (viewStick.current) viewStick.current.quaternion.copy(VIEW_STICK_TURN).premultiply(unPitch.setFromAxisAngle(X_AXIS, -camera.rotation.x));
      }
    }

    // ---------- the face (when it shows): a blink, joyful when you say hi ----------
    if (head.current?.visible) {
      stepFace(st.face, now < hello.until ? 'joyful' : 'neutral', dt);
      applyFace(faceMesh, st.face, blink(t, 4242));
    }
  });

  return (
    <>
      <group ref={root} scale={scale}>
        <BodyMeshes body={rig} />
        <OnBone body={rig} bone="head">
          <group ref={head} scale={rig.built.headScale}>
            <ObjectInk.Provider value={rig.built.headScale}>
              <HeadParts look={look} busy={false} face={faceMesh} />
            </ObjectInk.Provider>
          </group>
          <group ref={tag} position={[0, props.headR + TAG_UP, 0]}>
            <YouTag />
          </group>
        </OnBone>
        {look.headphones && (
          <OnBone body={rig} bone="chest">
            <group ref={phones}>
              <NeckPhones look={look} at={rig.built.phones.at} scale={rig.built.phones.scale} />
            </group>
          </OnBone>
        )}
        <group ref={cup}>
          <InHand held={held} tip={tip} mug={[0, 0, HAND.ahead]} turn={-Math.PI / 2} snack={[0, 0, 0]} foodTurn={0} stick={[STICK.tilt, 0, 0]} stickLen={STICK.len} />
        </group>
        <group ref={bat} visible={false}>
          <Cyl r={0.014} h={0.1} position={[0, 0.06, 0]} color="#d4a373" shadow={false} />
          <group position={[0, BAT.blade, 0]}>
            <PaddleLook handle={false} />
          </group>
        </group>
      </group>
      {!preview && (
        <group ref={inView} visible={false}>
          <group ref={viewGrip} scale={VIEW.scale}>
            <group ref={viewArm}>
              <ArmPiece built={rig.built} />
            </group>
            <InHand held={held} tip={viewTip} mug={VIEW.mug} turn={0} snack={VIEW.snack} foodTurn={VIEW.foodTurn} stick={VIEW_STICK_TURN} stickLen={VIEW_STICK.length() / VIEW.scale} stickRef={viewStick} />
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
