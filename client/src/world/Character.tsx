// Adapted from cubefarm client/src/world/Character.tsx (MIT): toys hitting people, themes, the screen's glow on the
// face and the handshake are cut; their steps, chair, voice (every bubble, ui/voices.ts) and merge cheer are heard.
// The body is the office's style (RigBody.tsx, Settings.bodyStyle), posed by bodyPoses.ts on the character lab's rig.
import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Worker } from '../../../shared/types';
import { qaKey, useStore } from '../store';
import { cheerVoice } from '../ui/cheerRules';
import { cheerFrom } from '../ui/cheerSfx';
import { hearBody, hearing } from '../ui/peopleSounds';
import { registerVoice } from '../ui/voices';
import { BI, type V3 } from '../lab/rig';
import { seededAppearance } from './appearance';
import { Piece } from './Batched';
import { newBodyState, smooth, stepBody, WALK_SPEED, type BodyTarget } from './body';
import { BOX_AHEAD, carryFrame, carryScale, deskPose, deskSlide, legLength, upPose } from './bodyPoses';
import { DESK_SEAT, HEAD_LIFT } from './bodyStyle';
import { PARTS } from './characterParts';
import { blink, expressionFor, isDrowsy, newFace, prFaceOf, stepFace } from './face';
import { fidgetProgress, fidgetWeight, newDeskLife, play, stepDeskLife, type Mood } from './fidgets';
import { applyFace, HeadParts, NeckPhones } from './Figure';
import { FoodLook } from './food';
import { malletHolder } from './gongRunner';
import { isCelebrating } from './gongState';
import { toon } from './materials';
import { lifeOf } from './model';
import { MugLook, mugColor } from './mugLook';
import { INK, ObjectInk } from './Outlines';
import { bodyTarget, handFood, handMug, handSnack, isHidden, seatBody, setBody, subscribeMugs, trackBody } from './people';
import { PaddleLook } from './PongTable';
import { holdsPaddle, pongPaddle } from './pongState';
import { toyHand } from './games/gameState';
import { takeReaction } from './reactionFeed';
import { BodyMeshes, OnBone, Poser, useBody, useBodyStyle, viewOf } from './RigBody';
import { SnackLook } from './SnackLook';
import { BUBBLE_TOP, SpeechBubble } from './SpeechBubble';
import { Ball, Cyl } from './Toon';
import { hashString, poseFor, tapSpeed, typingSeed, type PoseName } from './typing';
import { Zzz } from './Zzz';

// A cartoon worker. Origin is the floor under the chair; they face -Z (toward the desk). Seated by default; the people
// controller (people.ts, body.ts) can get them up, walk them about and sit them back down. `children` (the name tag)
// float over the desk while seated and over their head while up.

// Where they step out to when they get up (chair space): beside the chair, in front of it. The chair rolls back.
const STAND = { x: 0.62, z: -0.1 };
const CHAIR_ROLL = 0.18;
const TAG_SEATED: [number, number, number] = [0, 1.98, -1.12]; // over the desk
/** A held mug: this far in from the grip toward the body, so its handle (+X) is in the hand, and its size. */
const HAND_MUG = { inward: 0.07, scale: 1.3, sipTilt: 1.0 };
/** The paddle: its blade's middle this far over the wrist, the handle in the fist. */
const BAT = { blade: 0.17 };
/** The phone held to the ear (head-bone space, from the head's radius): just out from the ear, toward the mouth. */
const CALL_PHONE = { out: 0.014, down: 0.26, ahead: 0.2 };
const NO_HEAD: V3 = [0, 0, 0];

/**
 * `chair` rolls back while they're up; `mug` is the desk mug they sip from (moved into their hand and back). `carrying`
 * is drawn in their hands while they hold something (the 'hold' gesture), in the old figure's torso frame (the
 * shoulders 0.44 over the hips, facing -Z), scaled to their body. `seatY`: the seat's height (an executive chair's is higher).
 */
export function Character({
  worker,
  chair,
  mug,
  carrying,
  standAt = STAND,
  seatedTag = TAG_SEATED,
  seatY = DESK_SEAT,
  children,
}: {
  worker: Worker;
  chair?: RefObject<THREE.Object3D | null>;
  mug?: RefObject<THREE.Object3D | null>;
  carrying?: ReactNode;
  /** Where they step out to when they get up, in chair space (default: beside the chair). */
  standAt?: { x: number; z: number };
  /** Where the name tag floats while they sit (chair space): over the desk, or over their head where there's no desk. */
  seatedTag?: [number, number, number];
  seatY?: number;
  children?: ReactNode;
}) {
  const id = worker.id;
  const seed = useMemo(() => typingSeed(id), [id]);
  const look = useMemo(() => seededAppearance({ seed: worker.seed, role: worker.role }), [worker.seed, worker.role]);
  const style = useBodyStyle();
  const rig = useBody(look, worker.role, style);
  const props = rig.props;
  const poser = useMemo(() => new Poser(props), [props]);
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const tag = useRef<THREE.Group>(null);
  const mallet = useRef<THREE.Group>(null);
  const bat = useRef<THREE.Group>(null);
  const held = useRef<THREE.Group>(null);
  const chairZ = useRef<number | null>(null);
  const handCup = useRef<THREE.Group>(null);
  const cupTip = useRef<THREE.Group>(null);
  const inHand = useRef<THREE.Group>(null);
  const grip = useRef<THREE.Group>(null);
  const zzz = useRef<THREE.Group>(null);
  const carried = useSyncExternalStore(subscribeMugs, () => handMug(id));
  const food = useSyncExternalStore(subscribeMugs, () => handFood(id));
  const snack = useSyncExternalStore(subscribeMugs, () => handSnack(id));
  // Everything the body needs between frames, made once: the walk state, which way they're going and the sip's tilt.
  const move = useMemo(
    () => ({
      s: newBodyState(),
      placed: false,
      lastX: NaN,
      lastZ: NaN,
      dir: [0, -1] as [number, number],
      tilt: 0,
      slide: 0,
      v: new THREE.Vector3(),
      paddle: [0, 0, 0] as [number, number, number],
      tick: 0,
    }),
    [],
  );
  // Fidgets: the schedule, the stretch's body target, who they wave to and the mug's rest spot.
  const life = useMemo(
    () => ({
      s: newDeskLife(id, performance.now() / 1000, mug != null),
      stretch: null as BodyTarget | null,
      toward: 0,
      browse: 0,
      rest: null as THREE.Vector3 | null,
      held: false,
      v: new THREE.Vector3(),
    }),
    [id, mug],
  );
  const asleep = useRef(false);
  const phone = useRef<THREE.Group>(null);
  const callPhone = useRef<THREE.Group>(null);
  // The face (face.ts): their open PR's mood, the blended expression and the mesh it drives.
  const task = worker.task;
  const prMood = useStore((s) => prFaceOf({ role: worker.role, task: task?.kind ?? null, floorId: worker.floorId, prNumber: task?.prNumber ?? null }, s.floors, task?.prNumber != null ? s.qa[qaKey(worker.floorId, task.prNumber)] : undefined));
  const face = useMemo(() => ({ s: newFace(), seed: hashString(id) % 10007 }), [id]);
  const faceMesh = useRef<THREE.Mesh>(null);
  // Their merge cheer (ui/cheerSfx.ts): their own voice, whether they were cheering last frame and where their head is.
  const voice = useMemo(() => ({ v: cheerVoice(id, look.look), party: false, head: new THREE.Vector3() }), [id, look.look]);
  useEffect(() => trackBody(id, move.s), [id, move]);
  useEffect(() => hearing(id), [id]);
  useEffect(() => registerVoice(id, worker.name, look.look, worker.role), [id, worker.name, look.look, worker.role]);
  // Leaving mid-stretch (another floor): don't leave them standing.
  useEffect(
    () => () => {
      if (life.stretch && bodyTarget(id) === life.stretch) seatBody(id);
    },
    [id, life],
  );
  // a leaver's box in both hands; anything else they hold (a snack, a can, lunch) goes in the right hand alone
  const carry = carryScale(props);
  const box = carryFrame(props, carry);

  useFrame(({ camera, gl }, delta) => {
    const dt = Math.min(delta, 0.1);
    const now = performance.now();
    const t = now / 1000 + seed;
    const office = useStore.getState();
    const wall = Date.now(); // moments carry the server's clock
    const lived = lifeOf(worker, office.moments, wall);
    const party = isCelebrating(worker.floorId, now); // the gong struck for a merge on this floor: everyone cheers, busy or not
    const b = body.current;
    if (party && !voice.party && b && !isHidden(id)) {
      // the arms go up: a "woo!" from their head
      b.localToWorld(voice.head.fromArray(poser.pos, BI.head * 3));
      cheerFrom(voice.v, voice.head.x, voice.head.y, voice.head.z);
    }
    voice.party = party;

    // ---------- where the body is ----------
    const st = move.s;
    st.leg = legLength(props);
    const r0 = root.current;
    const goal = bodyTarget(id);
    let gesture = goal?.gesture ?? 'none';
    let holding = false;
    let aiming = false;
    if (r0) {
      r0.visible = !isHidden(id);
      if (!move.placed) {
        r0.updateWorldMatrix(true, false);
        move.placed = true;
      }
      const te = r0.matrixWorld.elements;
      st.seatX = te[12];
      st.seatZ = te[14];
      st.seatHeading = Math.atan2(te[8], te[10]);
      st.standX = te[0] * standAt.x + te[8] * standAt.z + te[12];
      st.standZ = te[2] * standAt.x + te[10] * standAt.z + te[14];
      stepBody(st, goal ?? null, dt);
      if (!isHidden(id)) hearBody(id, st, dt, te[13]);
      if (b && st.stage === 'seated') {
        b.position.set(0, 0, 0);
        b.rotation.y = 0;
      } else if (b) {
        // world to chair space (the chair's frame is only ever turned about Y)
        const dx = st.x - te[12];
        const dz = st.z - te[14];
        b.position.set(te[0] * dx + te[2] * dz, 0, te[8] * dx + te[10] * dz);
        b.rotation.y = st.heading - st.seatHeading;
      }
      // which way they're going, in their own frame (sideways at the ping-pong table)
      const mx = st.x - move.lastX;
      const mz = st.z - move.lastZ;
      const moved = Math.hypot(mx, mz);
      if (moved > 1e-4 && st.speed > 0.05) {
        const c = Math.cos(st.heading);
        const s = Math.sin(st.heading);
        const k = 1 - Math.exp(-dt * 10);
        move.dir[0] += ((mx * c - mz * s) / moved - move.dir[0]) * k;
        move.dir[1] += ((mx * s + mz * c) / moved - move.dir[1]) * k;
        const n = Math.hypot(move.dir[0], move.dir[1]) || 1;
        move.dir[0] /= n;
        move.dir[1] /= n;
      } else if (st.speed < 0.05) move.dir = [0, -1];
      move.lastX = st.x;
      move.lastZ = st.z;
      gesture = st.stage === 'up' ? gesture : 'none';
      holding = st.stage === 'up' && malletHolder() === id;
      // at the ping-pong table, the bat hand goes where the match has the paddle (the blade's middle over the fist)
      // ...or where a game has the ball or the dart they hold (games/gameState.ts)
      const paddle = st.stage === 'up' && !party ? pongPaddle(id) : null;
      const toy = !paddle && st.stage === 'up' && !party ? toyHand(id) : null;
      const aim = paddle ?? toy;
      if (aim && b) {
        b.updateWorldMatrix(true, false);
        b.worldToLocal(move.v.set(aim.x, aim.y - (paddle ? BAT.blade : 0), aim.z));
        move.paddle[0] = move.v.x;
        move.paddle[1] = move.v.y;
        move.paddle[2] = move.v.z;
        aiming = true;
      }
      if (held.current) held.current.visible = gesture === 'hold';
      if (mallet.current) mallet.current.visible = holding;
      if (bat.current) bat.current.visible = st.stage === 'up' && holdsPaddle(id);
    }
    const seated = st.stage === 'seated';
    const k = smooth(st.sit); // 1 seated, 0 standing
    const up = 1 - k;
    if (chair?.current) {
      chairZ.current ??= chair.current.position.z;
      chair.current.position.z = chairZ.current + CHAIR_ROLL * up;
    }

    // ---------- what they're doing at the desk ----------
    const busy = worker.status === 'working' || worker.status === 'preparing';
    const cheering = party || lived.cheering;
    const lastLog = office.logs[id]?.at(-1)?.t ?? 0;
    const name: PoseName = party ? 'cheer' : poseFor(worker.status, worker.activity?.kind ?? null, wall - lastLog, cheering);

    // ---------- little life at the desk: fidgets and reactions laid over the seated pose ----------
    const ls = life.s;
    const sec = now / 1000;
    const queued = takeReaction(id);
    if (queued) {
      play(ls, queued.fidget, sec);
      if (r0) {
        // which way the one they wave to sits, as a turn of the head (> 0: to their left)
        const te = r0.matrixWorld.elements;
        const dx = queued.x - te[12];
        const dz = queued.z - te[14];
        life.toward = Math.atan2(-(te[0] * dx + te[2] * dz), -(te[8] * dx + te[10] * dz));
      }
    }
    const mine = goal != null && goal === life.stretch;
    const mood: Mood =
      (goal && !mine) || cheering || worker.status === 'preparing' || worker.status === 'error'
        ? 'busy'
        : busy
          ? name === 'browsing'
            ? 'browsing'
            : name === 'thinking'
              ? 'thinking'
              : 'working'
          : 'idle';
    stepDeskLife(ls, mood, sec);
    const p = fidgetProgress(ls, sec);
    // The stretch gets them up (body.ts) for a moment and sits them back down.
    if (ls.fidget === 'stretch' && p < 0.8) {
      if (!life.stretch && !goal && seated && p < 0.2) {
        setBody(id, { mode: 'standing', x: st.standX, z: st.standZ, heading: st.seatHeading, speed: WALK_SPEED, gesture: 'stretch' });
        life.stretch = bodyTarget(id) ?? null;
      }
    } else if (life.stretch) {
      if (bodyTarget(id) === life.stretch) seatBody(id);
      life.stretch = null;
    }
    const fw = fidgetWeight(ls, sec);
    // browsing: lean in closer to the screen, slowly
    life.browse += ((name === 'browsing' ? 1 : 0) - life.browse) * (1 - Math.exp(-dt * 1.2));
    asleep.current = seated && ls.fidget === 'doze' && fw > 0.5;
    // the face: an expression for their state, eased in, with blinks; joyful while cheering at the stand-up too
    const greeting = st.stage === 'up' && goal?.gesture === 'cheer';
    const idleFor = !busy && worker.idleSince != null ? (wall - worker.idleSince) / 1000 : 0;
    const expression = expressionFor({
      status: worker.status,
      cheering: cheering || greeting,
      asleep: asleep.current,
      drowsy: isDrowsy(ls.mood === 'idle' ? sec - ls.moodSince : 0, idleFor),
      pr: prMood,
      justMerged: lived.justMerged,
    });
    stepFace(face.s, expression, dt);
    applyFace(faceMesh, face.s, asleep.current ? 1 : blink(t, face.seed));
    if (phone.current) phone.current.visible = seated && ls.fidget === 'phone' && fw > 0.35;
    if (callPhone.current) callPhone.current.visible = st.stage === 'up' && gesture === 'call' && !party;
    const spin = seated && ls.fidget === 'spin' ? Math.sin(p * Math.PI * 2) * 0.55 * fw : 0;
    if (seated && b) b.rotation.y = spin;
    if (chair?.current) chair.current.rotation.y = spin;

    // ---------- the pose: sat at the desk, up and about, or part way between ----------
    move.slide += (deskSlide(props, name, seatY) - move.slide) * (1 - Math.exp(-dt * 5));
    // nobody sees a pose out of view (or out of sight), and far off every other frame is plenty; a sip from the desk
    // mug still needs the hand where it is
    move.tick++;
    if (b && !life.held) {
      const seen = r0?.visible ? viewOf(camera, b, rig.top, gl.info.render.frame) : 0;
      if (seen === 0 || (seen === 2 && (move.tick + seed) % 2 < 1)) return;
    }
    const glance = busy && Math.sin(t * 0.55 + 2) > 0.92 ? -0.22 : 0;
    const gaze = worker.status === 'preparing' ? Math.sin(t * 1.3) * 0.5 : Math.sin(t * 0.4) * 0.08;
    const sat =
      k > 0.001
        ? deskPose(props, { t, seatY, pose: name, tapSpeed: tapSpeed(worker.status), head: [glance, gaze, 0], leanIn: life.browse, fidget: fw > 0 ? ls.fidget : null, progress: p, weight: fw, toward: life.toward, slide: move.slide })
        : null;
    const walk = Math.min(1, st.speed / 0.5);
    const nod = st.stage === 'up' && gesture === 'nod' ? Math.max(0, Math.sin(t * 6)) * 0.22 : 0;
    const partyArms = party && !holding;
    const standing =
      k < 0.999
        ? upPose(props, {
            t,
            speed: st.speed,
            phase: st.phase,
            dir: move.dir,
            gesture: holding ? 'none' : gesture,
            party: partyArms,
            paddle: aiming ? move.paddle : null,
            carry: carrying ? carry : 0,
            head: st.stage === 'up' ? [Math.sin(t * 0.3) * 0.05 - nod, Math.sin(t * 0.4) * 0.15 * (1 - walk), 0] : NO_HEAD,
          })
        : null;
    const key = k > 0.5 ? `s:${name}` : `u:${partyArms ? 'party' : gesture}:${aiming}`;
    poser.show(rig.bones, sec, key, k, sat, standing);

    // ---------- what's in their hands, and over their head ----------
    const hand = BI.handR;
    if (grip.current) poser.at(hand, rig.built.grip, grip.current.position);
    if (inHand.current) inHand.current.position.copy(grip.current?.position ?? move.v);
    const cup = handCup.current;
    if (cup) {
      cup.visible = !seated;
      cup.position.set(grip.current!.position.x - HAND_MUG.inward, grip.current!.position.y, grip.current!.position.z);
      const want = !party && gesture === 'sip' ? HAND_MUG.sipTilt : 0;
      move.tilt += (want - move.tilt) * (1 - Math.exp(-dt * 6));
      if (cupTip.current) cupTip.current.rotation.x = move.tilt;
    }
    if (bat.current?.visible) poser.at(hand, [0, 0, 0], bat.current.position);
    const z = zzz.current;
    if (z) poser.at(BI.head, [0.12 * rig.built.headScale, 0.2 * rig.built.headScale, 0], z.position);
    if (tag.current) {
      const [tx, ty, tz] = seatedTag;
      tag.current.position.set(tx * k, ty * k + (rig.top + 0.26) * up, tz * k);
    }
    // A sip: the desk mug slides into the hand, goes up to the mouth tipped toward them, and back down.
    const m = mug?.current;
    if (m) {
      const hold = ls.fidget === 'sip' && seated ? smooth(Math.min(1, Math.max(0, (p - 0.2) / 0.1))) - smooth(Math.min(1, Math.max(0, (p - 0.78) / 0.1))) : 0;
      if (hold > 0 && grip.current && m.parent) {
        life.rest ??= m.position.clone();
        grip.current.getWorldPosition(life.v);
        m.parent.worldToLocal(life.v);
        m.position.lerpVectors(life.rest, life.v, hold);
        const lift = smooth(Math.min(1, Math.max(0, (p - 0.3) / 0.15))) - smooth(Math.min(1, Math.max(0, (p - 0.62) / 0.15)));
        m.rotation.x = 0.7 * lift;
        life.held = true;
      } else if (life.held && life.rest) {
        m.position.copy(life.rest);
        m.rotation.x = 0;
        life.held = false;
      }
    }
  });

  const busy = worker.status === 'working' || worker.status === 'preparing';
  const R = props.headR;

  return (
    <group ref={root}>
      <group ref={body}>
        <BodyMeshes body={rig} />
        <OnBone body={rig} bone="head">
          <group scale={rig.built.headScale}>
            <ObjectInk.Provider value={rig.built.headScale}>
              <HeadParts look={look} busy={busy} face={faceMesh} />
            </ObjectInk.Provider>
          </group>
          {/* on a call: the phone at the ear, screen to the cheek */}
          <group ref={callPhone} position={[R + CALL_PHONE.out, -R * CALL_PHONE.down, -R * CALL_PHONE.ahead]} rotation={[-Math.PI / 2 + 0.35, Math.PI / 2, 0, 'YXZ']} scale={Math.min(1.35, Math.max(1, rig.built.headScale))} visible={false}>
            <Piece geometry={PARTS.phone} color={INK} />
            <mesh geometry={PARTS.phoneScreen} material={toon('#8ecae6', { emissive: '#8ecae6', emissiveIntensity: 0.5 })} />
          </group>
        </OnBone>
        {look.headphones && !busy && (
          <OnBone body={rig} bone="chest">
            <NeckPhones look={look} at={rig.built.phones.at} scale={rig.built.phones.scale} />
          </OnBone>
        )}
        <OnBone body={rig} bone="handR">
          {/* the phone they check at the desk, lying in the hand */}
          <group ref={phone} position={[-0.035, -props.hand * 0.7, -0.02]} rotation={[0, 0, Math.PI / 2]} visible={false}>
            <Piece geometry={PARTS.phone} color={INK} />
            <mesh geometry={PARTS.phoneScreen} material={toon('#8ecae6', { emissive: '#8ecae6', emissiveIntensity: 0.5 })} />
          </group>
          {/* the gong's mallet, in the right hand while they have it (gongRunner.ts); the handle out from the fist */}
          <group ref={mallet} position={[0, -props.hand * 0.6, 0]} rotation={[-0.4, 0, 0]} visible={false}>
            <Cyl r={0.025} h={0.55} position={[0, 0, -0.27]} rotation={[Math.PI / 2, 0, 0]} color="#f1d19b" shadow={false} />
            <Ball r={0.12} position={[0, 0, -0.56]} color="#e76f51" outline shadow={false} />
            <Cyl r={0.125} h={0.05} position={[0, 0, -0.56]} rotation={[Math.PI / 2, 0, 0]} color="#f4a261" shadow={false} />
          </group>
        </OnBone>
        {carrying && (
          <OnBone body={rig} bone="chest">
            <group ref={held} position={[0, box.y - 0.2 * carry, box.z + BOX_AHEAD * carry]} scale={carry} visible={false}>
              {carrying}
            </group>
          </OnBone>
        )}
        {/* where the right hand holds things (figure space), kept upright whatever the arm does */}
        <group ref={grip} />
        <group ref={inHand}>
          {food && <FoodLook kind={food} />}
          {snack && <SnackLook snack={snack.snack} left={snack.left} />}
        </group>
        {carried && (
          <group ref={handCup} visible={false}>
            <group ref={cupTip}>
              <group scale={HAND_MUG.scale}>
                <MugLook color={mugColor(carried.id)} sips={carried.sips} shadow={false} />
              </group>
            </group>
          </group>
        )}
        {/* a ping-pong paddle while they play (pongState.ts): the blade square to the way they face, over the fist */}
        <group ref={bat} visible={false}>
          <Cyl r={0.014} h={0.1} position={[0, 0.06, 0]} color="#d4a373" shadow={false} />
          <group position={[0, BAT.blade, 0]}>
            <PaddleLook handle={false} />
          </group>
        </group>
        <group ref={zzz}>
          <Zzz on={asleep} position={[0, 0, 0]} />
        </group>
        {/* just above their name tag */}
        <SpeechBubble id={id} y={rig.top + 0.4} top={BUBBLE_TOP + HEAD_LIFT[style].standing} />
        {children && (
          <group ref={tag} position={seatedTag}>
            {children}
          </group>
        )}
      </group>
    </group>
  );
}
