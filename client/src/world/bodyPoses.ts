// The office's people on the character lab's rig (lab/rig.ts, lab/poses.ts): what Character.tsx and Me.tsx show, as
// rig Poses, so the IK puts hands on the keys, mugs at lips and phones at ears whatever the body style's proportions.
// Sat at a desk (typing, browsing, thinking, at ease, cheering, slumped) with the fidgets laid over it; on any seat
// leaning back (you, on a bench or a deck chair); up and about (standing, walking, running, sidestepping) with every
// gesture's arms. Hand targets near the head are in head space scaled by its radius, so a chibi's hands land on its
// big head rather than inside it. Pure (rig maths only); new objects each call, small enough not to matter.
import { gait, type Gait, type Gesture } from './body';
import type { Fidget } from './fidgets';
import { burstLevel, handLift, mouseDip, TAP_PHASE, type PoseName } from './typing';
import { DESK_SEAT } from './bodyStyle';
import { footCycle, frac, hang, seated, slideToReach, smooth } from '../lab/poses';
import { armLength, standHeight, type ArmIK, type LegGoal, type Pose, type Proportions, type V3 } from '../lab/rig';

/** A desk in front of the chair (Desk.tsx), in chair space: origin on the floor under the seat, facing the desk. */
export const DESK = {
  /** Where the wrists rest over the keys (either side of the middle), the mouse, and the desk mug. */
  keys: { x: 0.12, y: 0.84, z: -0.45 },
  mouse: [0.46, 0.83, -0.51] as V3,
  mug: [0.76, 0.86, -0.78] as V3,
};

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerp3 = (a: V3, b: V3, k: number): V3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const Z3: V3 = [0, 0, 0];

/** An arm part way (k) from one goal to another: the hand's target, the elbow's pole and the wrist all blended. */
export function mixArm(a: ArmIK, b: ArmIK, k: number): ArmIK {
  if (k <= 0) return a;
  if (k >= 1) return b;
  return { to: { between: [a.to, b.to], k }, pole: lerp3(a.pole, b.pole, k), twist: lerp(a.twist ?? 0, b.twist ?? 0, k), wrist: lerp3(a.wrist ?? Z3, b.wrist ?? Z3, k) };
}

/** Head-space distances scale with the head: `s` is its size against the game's radius-0.2 head. */
const headS = (p: Proportions) => p.headR / 0.2;

// ---------- arms, shared by sitting and standing ----------

/**
 * Wrists at the lips, holding a mug or a can up to them (lab poses.ts sip). A chibi's big face puts its mouth past its
 * short arm's reach: then the cup comes up as far as the arm goes with the elbow bent (chest space), and the head bows
 * to it instead of tipping back (lipsOutOfReach).
 */
const toLips = (p: Proportions): ArmIK => {
  const s = headS(p);
  const lips: V3 = [0.02 * s, -0.24 * s, -0.27 * s];
  if (!lipsOutOfReach(p)) return { to: { head: lips }, pole: [0.6, -1, 0.2], twist: 0.35 };
  // the lips in chest space with the head upright, brought back toward the shoulder to within a bent arm's reach
  const sh: V3 = [p.shoulderX, p.shoulderY, 0];
  const at: V3 = [lips[0], p.neck + p.head + lips[1], lips[2]];
  const d = Math.hypot(at[0] - sh[0], at[1] - sh[1], at[2] - sh[2]);
  const k = (armLength(p) * 0.85) / d;
  return { to: { chest: [sh[0] + (at[0] - sh[0]) * k, sh[1] + (at[1] - sh[1]) * k, sh[2] + (at[2] - sh[2]) * k] }, pole: [0.6, -1, 0.2], twist: 0.35 };
};

/** Whether the lips are further from the shoulder than a bent arm reaches (a chibi's). */
export function lipsOutOfReach(p: Proportions) {
  const s = headS(p);
  const dx = 0.02 * s - p.shoulderX;
  const dy = p.neck + p.head - 0.24 * s - p.shoulderY;
  const dz = -0.27 * s;
  return Math.hypot(dx, dy, dz) > armLength(p) * 0.85;
}

/** A sip's head: tipped back to drink, or bowed to a cup a short arm can't bring up to the mouth. */
const sipHead = (p: Proportions) => (lipsOutOfReach(p) ? -0.22 : 0.25);
/** A mug or a snack held in front of the chest, ready for a sip: in close, the elbow bent, however short the arm. */
const holdUp = (p: Proportions): ArmIK => ({
  to: { chest: [p.shoulderX * 0.45, p.shoulderY - Math.min(0.25, armLength(p) * 0.42), -(p.chestDepth + Math.min(0.12, armLength(p) * 0.18))] },
  pole: [0.6, -1, 0.2],
  twist: 0.35,
});
/** A hand out in front, palm up, as people talk with their hands; `w` waves it about. */
const talking = (p: Proportions, w: number, out = 0.1): ArmIK => {
  const a = armLength(p);
  return { to: { chest: [out + w * 0.03, p.shoulderY - a * 0.42 + w * 0.02, -(p.chestDepth * 0.6 + a * 0.3)] }, pole: [0.8, -1, 0], twist: -1.1, wrist: [0.2, 0, 0] };
};
/**
 * Arms up as steeply as `steep` (radians over level, out to the side) allows while the hand still clears the head: a
 * chibi's big head and short arms put them out in a V rather than overhead. A reach direction, chest space.
 */
function clearUp(p: Proportions, steep: number, fwd = -0.08): V3 {
  const a = armLength(p);
  const head = p.neck + p.head - p.shoulderY;
  for (let th = steep; th > 0; th -= 0.05) {
    const x = p.shoulderX + a * Math.cos(th);
    const y = a * Math.sin(th);
    if (Math.hypot(x, y - head) > p.headR * 1.1 + p.hand * 0.6) return [Math.cos(th), Math.sin(th), fwd];
  }
  return [1, 0, fwd];
}

/** Arms up in a V (lab poses.ts cheer), as high as clears the head, pumping with `pump` (-1 to 1). */
const vArm = (p: Proportions, pump = 0): ArmIK => {
  const [x, y] = clearUp(p, 1.07);
  return { to: { reach: [x, y, -0.3 - pump * 0.14], ext: 0.95 + pump * 0.03 }, pole: [1, -0.2, 0.4], twist: -0.5, wrist: [0.15, 0, 0] };
};
/** A hand up beside the head, waving (lab poses.ts wave): out clear of the head however big, the forearm swinging. */
function waving(p: Proportions, w: number): ArmIK {
  const arm = armLength(p);
  const out = Math.max(p.shoulderX + arm * 0.55, p.headR + 0.08);
  const up = Math.max(p.shoulderY + arm * 0.55, p.neck + p.head - p.headR * 0.6);
  return { to: { chest: [out + w * 0.07, up, 0] }, pole: [1, -0.9, 0.2], twist: -0.9, wrist: [0, 0, -w * 0.3] };
}
/** A hand on the hip, elbow out. */
const onHip = (p: Proportions): ArmIK => ({ to: { root: [p.hipX + p.splay * 0.5 + 0.11, standHeight(p) + 0.03, 0.02] }, pole: [1, 0, 0.7], twist: -1.0, wrist: [0, 0, 0.5] });
/** Reaching out along a direction from the shoulder (chest space, x outward), the elbow soft. */
const reach = (dir: V3, ext = 0.96, pole: V3 = [0.5, -1, 0.3], twist = 0.6): ArmIK => ({ to: { reach: dir, ext }, pole, twist });

/**
 * The phone held to the ear: the wrist a hand's length under the ear and just behind it, so the hand comes up the side of
 * the head to the phone, the elbow down and out, the palm to the cheek. Outside the head's radius, so clear of the face
 * for any head size; the head tilts toward it (PHONE_TILT), which brings the ear within a short arm's reach.
 */
export function phoneArm(p: Proportions): ArmIK {
  return { to: { head: [p.headR + 0.03, -(p.hand * 0.85 + 0.1 * p.headR), 0.06 * p.headR] }, pole: [0.45, -1, -0.35], twist: -1.35, wrist: [0.15, 0, 0.25] };
}

/** On the phone, the head leans toward it (radians, toward their right). */
export const PHONE_TILT = 0.22;

/** Both hands to the cheeks (watching something astonishing). */
const toCheek = (p: Proportions): ArmIK => ({ to: { head: [p.headR * 1.08, -0.62 * p.headR, -0.25 * p.headR] }, pole: [0.5, -1, -0.2], twist: -1.3, wrist: [0.2, 0, 0.3] });

/**
 * A point just out from the side of the head (head space, x outward) as high up it as the arm reaches: the top for a
 * long arm, lower down beside the ear for a chibi's short one.
 */
function headSide(p: Proportions, heights: readonly number[], z = 0): V3 {
  const reachable = armLength(p) * 0.97 + p.hand * 0.5;
  const up = p.neck + p.head - p.shoulderY;
  const at = (k: number): V3 => [p.headR * (Math.sqrt(Math.max(0, 1 - k * k)) + 0.12), p.headR * k, z];
  for (const k of heights) {
    const [x, y] = at(k);
    if (Math.hypot(x - p.shoulderX, up + y, z) <= reachable) return at(k);
  }
  return at(heights[heights.length - 1]);
}

// ---------- sat at a desk ----------

export interface DeskInput {
  /** Seconds, offset per person. */
  t: number;
  /** The seat's top (a desk chair's by default). */
  seatY?: number;
  pose: PoseName;
  /** Taps a radian-second (typing.ts tapSpeed). */
  tapSpeed: number;
  /** Extra head turn: a glance at the keys, looking about, a nod. */
  head: V3;
  /** Leaning in to read (browsing), 0 to 1. */
  leanIn: number;
  /** The fidget playing over it, how far through (0 to 1; seconds for a doze), and how much of it shows (0 to 1). */
  fidget: Fidget | null;
  progress: number;
  weight: number;
  /** Which way the one they wave to sits (a head turn, > 0 to their left). */
  toward: number;
  /** How far forward on the seat (eased by the caller between poses; deskSlide gives each pose's). */
  slide: number;
}

/** How far each desk pose leans in (radians forward). */
const DESK_LEAN: Record<PoseName, number> = { typing: 0.17, browsing: 0.12, thinking: 0.06, relaxed: -0.06, cheer: -0.05, slump: 0.25 };

/** How far forward on the seat they sit for a pose: far enough for their hands to reach the keys, or none. */
export function deskSlide(p: Proportions, pose: PoseName, seatY = DESK_SEAT) {
  const k = DESK.keys;
  return pose === 'typing' || pose === 'browsing' || pose === 'thinking' ? slideToReach(p, DESK_LEAN[pose], k.x, k.y, k.z, seatY) : 0;
}

const onKeys = (lift: number, drift: number): ArmIK => ({
  to: { root: [DESK.keys.x + drift, DESK.keys.y + lift, DESK.keys.z + drift * 0.5] },
  pole: [0.9, -0.35, 0.45],
  twist: 1.45,
  wrist: [-0.3, 0, 0.12],
});

/** Hands resting on the thighs (lab poses.ts sit). */
function onThigh(p: Proportions, pelvis: V3, side: number): ArmIK {
  return {
    to: { root: [p.hipX + 0.02, pelvis[1] - p.hipY + p.seat + 0.045, pelvis[2] - p.thigh * 0.62 + side * 0.02] },
    pole: [0.8, 0, 0.6],
    twist: 1.45,
    wrist: [-0.25, 0, 0.1],
  };
}

/** The fidget's own arms, lean and head, or null for what it leaves alone. */
interface Overlay {
  l?: ArmIK;
  r?: ArmIK;
  lean?: number;
  head?: V3;
  /** The chest turned (> 0 to their left). */
  twist?: number;
}

function fidgetOverlay(p: Proportions, f: Fidget, u: number, t: number, toward: number): Overlay {
  const s = headS(p);
  const R = p.headR;
  const a = armLength(p);
  switch (f) {
    case 'leanBack': // hands behind the head (behind the ears, for a big head and short arms), elbows out, rocking a little
      return {
        l: { to: { head: [R * 1.05, R * 0.05, R * 0.5] }, pole: [1, 0.5, -0.1], twist: -0.6, wrist: [0, 0, 0.5] },
        r: { to: { head: [R * 1.05, R * 0.05, R * 0.5] }, pole: [1, 0.5, -0.1], twist: -0.6, wrist: [0, 0, 0.5] },
        lean: -0.22 + Math.sin(t * 1.4) * 0.025,
        head: [0.14, 0, 0],
      };
    case 'spin':
      return { head: [0, -Math.sin(u * Math.PI * 2) * 0.27, 0] };
    case 'phone': {
      // both hands in front of the chest, head down, a thumb tapping
      const hand = (side: number): ArmIK => ({
        to: { chest: [0.035, p.shoulderY - a * 0.42 + (side && Math.sin(t * 11) > 0.4 ? 0.01 : 0), -(p.chestDepth + a * 0.3)] },
        pole: [0.6, -1, 0.1],
        twist: 1.1,
        wrist: [0.5, 0, 0],
      });
      return { l: hand(0), r: hand(1), lean: 0.06, head: [-0.42, 0, 0] };
    }
    case 'sip': {
      // reach for the desk mug, bring it up, a sip with the head back, and put it down again
      const up = smooth((u - 0.3) / 0.15) - smooth((u - 0.62) / 0.15);
      const desk: ArmIK = { to: { root: DESK.mug }, pole: [0.6, -1, 0.3], twist: 0.6 };
      const r = mixArm(desk, toLips(p), up);
      return { r, lean: 0.16 * (1 - up), twist: -0.3 * (1 - up), head: [(lipsOutOfReach(p) ? -0.25 : 0.28) * up, 0, 0] };
    }
    case 'doze':
      return { head: [-0.6 + Math.sin(u * 0.9) * 0.05 + (Math.sin(u * 0.37) > 0.97 ? 0.12 : 0), 0, 0.16], lean: 0.08 };
    case 'neckRoll': {
      const k = u * Math.PI * 2.4;
      return { head: [Math.sin(k) * 0.24 - 0.05, 0, Math.cos(k) * 0.3] };
    }
    case 'shoulders': // the left arm pulled across the chest, looking away from it
      return { l: { to: { chest: [-p.shoulderX * 0.85, p.shoulderY - 0.04 * s, -(p.chestDepth + 0.05)] }, pole: [0.3, -0.2, -1], twist: 0.2 }, head: [0, 0.3, 0], twist: -0.12 };
    case 'scratch': {
      // a hand on top of the head (beside it, for a short arm), scratching
      const [x, y, z] = headSide(p, [0.6, 0.4, 0.2, 0, -0.2], -R * 0.1);
      return { r: { to: { head: [x + Math.sin(t * 17) * 0.01, y + Math.sin(t * 17 + 1) * 0.01, z] }, pole: [1, 0.3, 0.2], twist: -0.8, wrist: [0, 0, -0.6] }, head: [0.04, 0, -0.14] };
    }
    case 'facepalm': // hand to the forehead, head down, a slow shake
      return { r: { to: { head: [R * 0.12, -R * 0.15, -R * 1.25] }, pole: [0.4, -1, -0.3], twist: -1.3, wrist: [0.6, 0, 0] }, head: [-0.3, Math.sin(t * 5) * 0.12, 0], lean: 0.12 };
    case 'fistPump': {
      // three quick pumps, the fist up beside the head
      const [x, y] = clearUp(p, 1.25, -0.3);
      return { r: reach([x, y, -0.3], 0.78 + Math.max(0, Math.sin(u * Math.PI * 6)) * 0.2, [1, -0.3, 0.3], -0.4), head: [0.18, 0, 0], lean: -0.06 };
    }
    case 'wave': {
      // turn toward them and wave with the near hand
      const w = waving(p, Math.sin(t * 10));
      const look: V3 = [0.08, clamp(toward * 0.7, -1.1, 1.1), 0];
      return { ...(toward > 0 ? { l: w } : { r: w }), head: look, twist: clamp(toward * 0.3, -0.4, 0.4) };
    }
    case 'stretch': // stood up (Character.tsx): nothing to lay over the desk pose
      return {};
  }
}

/** Sat at the desk: the pose for their state, with a fidget over it. */
export function deskPose(p: Proportions, d: DeskInput): Pose {
  const seatY = d.seatY ?? DESK_SEAT;
  const t = d.t;
  const ov: Overlay = d.fidget && d.weight > 0 ? fidgetOverlay(p, d.fidget, d.progress, t, d.toward) : {};
  const w = d.weight;
  const baseLean = DESK_LEAN[d.pose] + d.leanIn * 0.1;
  const lean = ov.lean === undefined ? baseLean : lerp(baseLean, ov.lean, w);
  const pose = seated(t, p, lean, d.slide, seatY);
  const burst = burstLevel(t);
  const pelvis = pose.pelvis;
  let l: ArmIK;
  let r: ArmIK;
  let head: V3 = [lean * 0.7, 0, 0];
  switch (d.pose) {
    case 'typing':
    case 'browsing':
    case 'thinking': {
      const typing = d.pose === 'typing' ? 1 : d.pose === 'browsing' ? 0.25 : 0.3;
      const tap = (phase: number) => handLift(t, d.tapSpeed, phase) * burst * 0.018 * typing;
      l = onKeys(tap(TAP_PHASE.l), Math.sin(t * 3.1) * 0.012 * typing);
      if (d.pose === 'typing') r = onKeys(tap(TAP_PHASE.r), Math.sin(t * 2.7 + 1) * 0.012);
      else if (d.pose === 'browsing') {
        // the mouse: small glides and a click now and then
        const m = DESK.mouse;
        r = { to: { root: [m[0] + Math.sin(t * 1.9) * 0.03, m[1] - mouseDip(t) * 0.25, m[2] + Math.sin(t * 1.3) * 0.015] }, pole: [0.9, -0.3, 0.4], twist: 1.45, wrist: [-0.25, 0, 0.1] };
      } else {
        // a fist under the chin, the elbow on the desk
        const s = headS(p);
        r = { to: { head: [0.02 * s, -0.21 * s - p.hand * 0.8, -0.13 * s] }, pole: [0.2, -1, -0.35], twist: -0.2, wrist: [0.9, 0, 0] };
      }
      head = [0.06 + (d.pose === 'thinking' ? 0.08 : d.pose === 'browsing' ? 0.05 : -0.04) + Math.sin(t * 4.5) * 0.008 * burst * typing, d.pose === 'browsing' ? 0.04 : d.pose === 'thinking' ? -0.12 : 0, d.pose === 'thinking' ? 0.12 : 0];
      break;
    }
    case 'cheer': {
      const pump = Math.sin(t * 9);
      l = vArm(p, pump);
      r = vArm(p, -pump);
      head = [0.2, 0, 0];
      break;
    }
    case 'slump':
      l = hang(p);
      r = hang(p);
      head = [-0.45, 0, 0];
      break;
    case 'relaxed':
    default:
      l = onThigh(p, pelvis, 0);
      r = onThigh(p, pelvis, 1);
      head = [0.06, 0, 0];
      break;
  }
  if (ov.l) l = mixArm(l, ov.l, w);
  if (ov.r) r = mixArm(r, ov.r, w);
  if (ov.head) head = lerp3(head, ov.head, w);
  pose.arm = { l, r };
  pose.neck = [0, (head[1] + d.head[1]) * 0.3, 0];
  pose.head = [head[0] + d.head[0], (head[1] + d.head[1]) * 0.7, head[2] + d.head[2]];
  if (ov.twist) pose.chest = [pose.chest[0], ov.twist * w, pose.chest[2]];
  return pose;
}

// ---------- sat anywhere ----------

export interface SeatInput {
  t: number;
  /** The seat's top. */
  seatY: number;
  /**
   * The whole figure leant back this far by the caller, turned about the seat's top over the hips (a deck chair, a
   * beanbag: Me.tsx): the head comes forward to look ahead and the feet still find the floor.
   */
  tilt?: number;
  /** The knees raised this far (radians), on a low seat. */
  lift?: number;
  /** The back leant back this far besides (a slouch). */
  back?: number;
  /** How far forward of the seat's middle the pelvis sits (m). */
  slide?: number;
  /** Arms: on the thighs, or what the caller passes (a mug held, a toasting stick). */
  l?: ArmIK;
  r?: ArmIK;
  /** Extra head turn. */
  head?: V3;
}

/**
 * A leg sat down: the thigh out along the seat (raised `lift`), the shin down to the floor, which is `tilt` turned
 * from the figure's own frame about the seat's top (the pivot); a leg too short to reach it hangs straight down.
 */
function seatLeg(p: Proportions, pelvis: V3, pivotY: number, tilt: number, lift: number): LegGoal {
  const hy = pelvis[1] - p.hipY;
  const [c, s] = [Math.cos(tilt), Math.sin(tilt)];
  // the knee's height over the floor with the thigh raised `l` from the seat
  const knee = (l: number) => {
    const kz = pelvis[2] - p.thigh * 0.998 * Math.cos(l);
    const ky = hy + p.thigh * 0.998 * Math.sin(l);
    return { kz, ky, h: pivotY + (ky - pivotY) * c - kz * s };
  };
  // leant back, the knees come up off the floor: let the thighs down off the seat (as far as level in the room) until
  // the feet reach it again
  let l = lift;
  if (knee(l).h - p.ankle > p.shin * 0.98) {
    let lo = -tilt;
    let hi = lift;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (knee(mid).h - p.ankle > p.shin * 0.98) hi = mid;
      else lo = mid;
    }
    l = lo;
  }
  const { kz, ky, h: kneeH } = knee(l);
  const drop = kneeH - p.ankle;
  const a = drop >= p.shin ? 0 : Math.acos(clamp(drop / p.shin, -1, 1));
  // straight down the room, swung forward `a`
  const dy = -c * Math.cos(a) - s * Math.sin(a);
  const dz = s * Math.cos(a) - c * Math.sin(a);
  return { ankle: [p.hipX + 0.02, ky + dy * p.shin, kz + dz * p.shin], pitch: -tilt, toe: 0.1, pole: [0, 0.5, -1] };
}

/** Sat on any seat at any height, leant back as far as asked, hands on the thighs unless given. */
export function seatPose(p: Proportions, s: SeatInput): Pose {
  const tilt = s.tilt ?? 0;
  const back = s.back ?? 0;
  const pose = seated(s.t, p, -back, s.slide ?? 0, s.seatY);
  pose.hips = [back * 0.25, 0, 0];
  pose.spine = [back * 0.45 + pose.spine[0], 0, 0];
  pose.chest = [back * 0.3 + pose.chest[0], 0, 0];
  const look = s.head ?? Z3;
  pose.neck = [-(tilt + back) * 0.25, look[1] * 0.3, 0];
  pose.head = [-(tilt + back) * 0.45 + look[0], look[1] * 0.7, look[2]];
  pose.leg = { l: seatLeg(p, pose.pelvis, s.seatY, tilt, s.lift ?? 0), r: seatLeg(p, pose.pelvis, s.seatY, tilt, s.lift ?? 0) };
  pose.arm = { l: s.l ?? onThigh(p, pose.pelvis, 0), r: s.r ?? onThigh(p, pose.pelvis, 1) };
  return pose;
}

/** Your right arm's holds (Me.tsx): a mug or a snack up in front, brought to the lips `lift` of the way; a toasting stick out ahead. */
export const holdArm = (p: Proportions, lift: number): ArmIK => mixArm(holdUp(p), toLips(p), lift);
export const stickArm = (): ArmIK => reach([0.12, -0.3, -1], 0.92, [0.8, -1, 0.3], 1.3);
export const waveArm = (p: Proportions, t: number): ArmIK => waving(p, Math.sin(t * 9));

// ---------- up and about ----------

export interface UpInput {
  t: number;
  /** Ground speed (m/s) and the walk cycle (body.ts phase: one turn is a left and a right step). */
  speed: number;
  phase: number;
  /** Which way they're moving, in their own frame (unit x, z; (0, -1) straight ahead): sideways at the ping-pong table. */
  dir: readonly [number, number];
  gesture: Gesture;
  /** A merge party on their floor: arms up in a V, whatever else. */
  party: boolean;
  /** Where the paddle is (their own frame), for the bat hand to hold it there; null when not playing. */
  paddle: V3 | null;
  /** How big what they carry in both hands is drawn (the 'hold' gesture's box; 1 = the old figure's); 0 when it's one small thing in one hand. */
  carry: number;
  /** The free hand on the hip when nothing else has it (the CEO on a call). */
  hip?: boolean;
  /** Extra head turn: looking round, a nod. */
  head: V3;
}

const G: Gait = { stride: 0, cadence: 0, bob: 0, lean: 0 };

/** A leg's length hip to ankle, for gait (body.ts takes it to scale steps). */
export const legLength = (p: Proportions) => p.thigh + p.shin + p.ankle;

/**
 * Standing at ease or on the move: feet planted under the hips and swept along the ground at its speed (no skating;
 * past what the legs can reach, they slide), the arms swinging, a weight shift while still.
 */
export function stepPose(p: Proportions, t: number, speed: number, phase: number, dir: readonly [number, number]): Pose {
  const S = standHeight(p);
  const leg = p.thigh + p.shin;
  const g = gait(speed, G, legLength(p));
  const walk = clamp(speed / 0.5, 0, 1);
  const run = smooth((speed - 1.7) / 0.8);
  const duty = lerp(0.58, 0.36, run);
  // the planted foot moves back as fast as the ground goes by: two steps a cycle
  const stepLen = g.cadence > 0 ? speed / g.cadence : 0;
  const excursion = Math.min(2 * duty * stepLen, leg * 1.05) * walk;
  const u = frac(phase / (Math.PI * 2));
  const scale = leg / 0.8;
  const liftH = lerp(0.07, 0.2, run) * scale * walk;
  const lc = footCycle(u, excursion, liftH, duty, run > 0.5);
  const rc = footCycle(frac(u + 0.5), excursion, liftH, duty, run > 0.5);
  const [mx, mz] = dir;
  // each ankle in their frame: under its hip, moved along the way they go (the cycle's z runs back along it)
  const stance = p.hipX * 0.9;
  const ax = (c: { z: number }, side: number) => side * stance - c.z * mx;
  const az = (c: { z: number }) => -c.z * mz;
  const reachY = (c: { z: number }, side: number) => {
    const dx = ax(c, side) - side * p.hipX;
    const dz = az(c);
    return p.ankle + p.hipY + Math.sqrt(Math.max(0, (leg * 0.985) ** 2 - dx * dx - dz * dz));
  };
  const shift = Math.sin(t * 0.55) * (1 - walk);
  const breathe = Math.sin(t * 1.7);
  let y: number;
  if (run > 0.5) y = Math.min(S - 0.02, reachY({ z: excursion / 2 }, 1)) - 0.03 * scale + 0.03 * scale * Math.cos(Math.PI * 4 * (u - 0.43));
  else {
    const planted = Math.min(lc.stance >= 0 ? reachY(lc, -1) : Infinity, rc.stance >= 0 ? reachY(rc, 1) : Infinity);
    y = Math.min(S - 0.01 - Math.abs(shift) * 0.006, planted);
  }
  const fwd = Math.abs(mz);
  const lean = g.lean * walk * fwd;
  const half = Math.max(excursion / 2, 1e-4);
  const twist = walk * fwd * (lc.z - rc.z) / (2 * half);
  const arm = (opp: number): ArmIK => {
    // swung against the opposite leg, the elbow bending as it comes forward (and bent right up running)
    const sw = lerp(0.38, 0.7, run) * walk * fwd * (-opp / half) + 0.01 * breathe;
    const bend = lerp(0.12 + Math.max(0, sw) * 0.25, 0.75, run) * walk;
    return { to: { reach: [p.splay * (1 - 0.05 * walk) + run * 0.08, -Math.cos(sw), -Math.sin(sw) - 0.04], ext: 0.985 - bend * 0.2 }, pole: [0.3, 0, 1], twist: lerp(0.3, 0.6, run) };
  };
  return {
    pelvis: [shift * 0.022 - Math.sin(phase) * 0.018 * walk, y, 0],
    hips: [0.02 - lean * 0.5, shift * 0.05 + 0.1 * twist, shift * 0.035 - 0.04 * Math.sin(phase) * walk],
    spine: [0.005 * breathe - lean * 0.3, -shift * 0.025 - 0.06 * twist, -shift * 0.03 + 0.02 * Math.sin(phase) * walk],
    chest: [-0.01 - 0.012 * breathe - lean * 0.2, -0.1 * twist, -shift * 0.01],
    neck: [lean * 0.3, 0, 0],
    head: [0.02 + lean * 0.5, 0, 0],
    clav: { l: [0, 0, 0.012 * breathe + run * 0.05], r: [0, 0, 0.012 * breathe + run * 0.05] },
    arm: { l: arm(rc.z), r: arm(lc.z) },
    leg: {
      l: { ankle: [-ax(lc, -1), p.ankle + lc.y, az(lc)], pitch: lc.pitch * walk, toe: lerp(0.12, 0.06, walk) },
      r: { ankle: [ax(rc, 1), p.ankle + rc.y, az(rc)], pitch: rc.pitch * walk, toe: lerp(0.12, 0.06, walk) },
    },
  };
}

/** Each gesture's arms (null: that arm keeps walking or idling) and the head's nod. */
export function gestureArms(p: Proportions, g: Gesture, t: number, carry = 1): { l: ArmIK | null; r: ArmIK | null; head: number; bow?: number; tilt?: number } {
  const a = armLength(p);
  switch (g) {
    case 'none':
      return { l: null, r: null, head: 0 };
    case 'reach': // touch the board, up beside the head
    case 'post': {
      const [x, y] = clearUp(p, 0.95, 0);
      return { l: null, r: reach([x, y, -0.4], 0.98, [0.8, -1, 0.3], 1.2), head: 0.15 };
    }
    case 'hold': {
      // a snack, a can or lunch (carry 0): in the right hand, held in close at the waist, the left arm free to swing
      if (carry <= 0) return { l: null, r: carryOne(p), head: -0.05 };
      // a box in both hands (Leavers.tsx): held in close against the belly, the hands at its sides, the elbows bent
      const box = carryFrame(p, carry);
      const hand: ArmIK = { to: { chest: [box.halfW + 0.01, box.y, box.z] }, pole: [1, -0.6, 0.3], twist: 1.3, wrist: [0, 0, -0.2] };
      return { l: hand, r: hand, head: -0.05 };
    }
    case 'sip':
      return { l: null, r: toLips(p), head: sipHead(p) };
    case 'stretch': {
      const dir = clearUp(p, 1.35);
      return { l: reach(dir, 0.99, [1, 0, 0.3], -0.3), r: reach(dir, 0.99, [1, 0, 0.3], -0.3), head: 0.3 };
    }
    case 'stoop': // reaching down for something low (the fridge's bottom shelf), bending over
      return { l: reach([0.25, -0.75, -0.65], 0.98, [1, 0, 0.6], 0.8), r: reach([0.25, -0.75, -0.65], 0.98, [1, 0, 0.6], 0.8), head: -0.3, bow: 0.45 };
    case 'shrug': {
      // palms up and out: oh well
      const palm: ArmIK = { to: { chest: [p.shoulderX + a * 0.3, p.shoulderY - a * 0.62, -(p.chestDepth + a * 0.18)] }, pole: [0.6, -1, 0.6], twist: -1.5, wrist: [0, 0, 0.3] };
      return { l: palm, r: palm, head: -0.12 };
    }
    case 'mug':
      return { l: null, r: holdUp(p), head: -0.05 };
    case 'tap': // a hand on the counter: the cooler, the coffee machine
      return { l: null, r: reach([0.08, -0.32, -1], 0.94, [0.8, -0.6, 0.4], 1.4), head: -0.3 };
    case 'chat': // a mug in one hand, the other talking
      return { l: talking(p, Math.sin(t * 3.1)), r: holdUp(p), head: 0.08 };
    case 'cheer': {
      const pump = Math.sin(t * 9);
      return { l: vArm(p, pump), r: vArm(p, -pump), head: 0.2 };
    }
    case 'wave':
      return { l: null, r: waving(p, Math.sin(t * 9)), head: 0.1 };
    case 'talk':
      return { l: null, r: talking(p, Math.sin(t * 4.3) + Math.sin(t * 2.6) * 0.5, 0.06), head: 0.05 };
    // the gong (gongRunner.ts): a hand out for the mallet on its hook, raised back over the shoulder, then brought down
    case 'take':
      return { l: null, r: reach([0.35, 0.55, -0.75], 0.98, [1, -0.8, 0.3], 1.1), head: 0.1 };
    case 'windup': {
      const [x, y] = clearUp(p, 1.25, 0);
      return { l: reach([0.2, -0.35, -1], 0.9, [0.8, -1, 0.3]), r: { to: { reach: [x, y, 0.55], ext: 0.95 }, pole: [1, 0.2, -0.4], twist: 0.4, wrist: [-0.6, 0, 0] }, head: 0.1 };
    }
    case 'strike':
      return { l: reach([0.25, -0.65, -0.75], 0.95, [0.8, -1, 0.3]), r: reach([0.06, -0.3, -1], 0.98, [0.8, -1, 0.3], 1.3), head: 0 };
    // the stand-up (Rituals.tsx): clapping in front of the chest, nodding along, a thumbs-up
    case 'clap': {
      const open = Math.abs(Math.sin(t * 7)) ** 0.8;
      const hand: ArmIK = { to: { chest: [0.035 + open * 0.11, p.shoulderY - Math.min(0.16, a * 0.35), -(p.chestDepth + Math.min(0.2, a * 0.4))] }, pole: [0.4, -1, 0.1], twist: 0.15, wrist: [0.35, 0, 0] };
      return { l: hand, r: hand, head: 0.08 };
    }
    case 'nod':
      return { l: null, r: null, head: -0.05 };
    case 'thumbs':
      return { l: null, r: { to: { chest: [p.shoulderX * 0.6, p.shoulderY - a * 0.4, -(p.chestDepth + a * 0.35)] }, pole: [0.8, -1, 0.2], twist: -0.2, wrist: [0.4, 0, 0] }, head: 0.12 };
    // ping-pong: the free hand out for balance; the bat hand at the paddle (upPose puts it there)
    case 'paddle':
      return { l: reach([0.55, -0.55, -0.6], 0.88, [1, -0.5, 0.3]), r: reach([0.3, -0.25, -0.9], 0.85, [1, -0.8, 0.2], 1.4), head: 0.05 };
    // watching something outside (events/watch.ts): pointing up at it, and both hands to the cheeks
    case 'point':
      return { l: onHip(p), r: { to: { reach: [0.18, 0.62, -0.78], ext: 0.995 }, pole: [0, -1, 0.3], twist: 1.4, wrist: [-0.1, 0, 0] }, head: 0.28 };
    case 'gasp':
      return { l: toCheek(p), r: toCheek(p), head: 0.18 };
    case 'call': // on the phone: held to the ear, the other hand on the hip
      return { l: onHip(p), r: phoneArm(p), head: 0.06, tilt: PHONE_TILT };
  }
}

/**
 * Where something carried in both hands sits (chest space): its middle and half-width, from the old figure's box (its
 * middle 0.2 over the hips, 0.42 wide and 0.3 deep) scaled to this body by `carry`, and held in against the body: the
 * old figure's 0.44 ahead was past the reach of either style's bending arms, which locked them straight out.
 * The box is drawn here too (Character.tsx moves Leavers.tsx's box from where the old figure had it).
 */
export function carryFrame(p: Proportions, carry: number) {
  const up = p.spine + p.chest;
  const z = -(p.chestDepth + 0.15 * carry + 0.012);
  const halfW = 0.21 * carry;
  // no lower than the hands reach with the elbows still bent (a chibi's short arms hold it up under the chin)
  const reach = armLength(p) * 0.85;
  const dx = halfW + 0.01 - p.shoulderX;
  const drop = Math.sqrt(Math.max(0, reach * reach - z * z - dx * dx));
  return { y: Math.max(0.2 * carry - up, p.shoulderY - drop), z, halfW };
}

/** The old figure's box's middle was this far ahead of its torso (Leavers.tsx draws it there), at scale 1. */
export const BOX_AHEAD = 0.44;

/** One small thing carried in the right hand: in at the waist, the forearm forward and the elbow bent at the side. */
export function carryOne(p: Proportions): ArmIK {
  const a = armLength(p);
  return { to: { chest: [p.shoulderX * 0.6, p.shoulderY - a * 0.55, -(p.chestDepth + a * 0.15)] }, pole: [0.5, -0.4, 1], twist: 1.1, wrist: [0.1, 0, 0] };
}

/** How big the old figure's carried box is drawn on this body: shoulders over the hips, against the old 0.44. */
export const carryScale = (p: Proportions) => (p.spine + p.chest + p.shoulderY) / 0.44;

/** Up and about: standing or moving, with the gesture's arms (or a party's), the bat hand at the paddle. */
export function upPose(p: Proportions, u: UpInput): Pose {
  const pose = stepPose(p, u.t, u.speed, u.phase, u.dir);
  const g = u.party ? { l: vArm(p, Math.sin(u.t * 9)), r: vArm(p, -Math.sin(u.t * 9)), head: 0.2 } : gestureArms(p, u.gesture, u.t, u.carry);
  if (g.l) pose.arm.l = g.l;
  else if (u.hip) pose.arm.l = onHip(p);
  if (g.r) pose.arm.r = g.r;
  if (!u.party && u.paddle) pose.arm.r = { to: { root: u.paddle }, pole: [1, -0.8, 0.2], twist: 1.4, wrist: [0, 0, 0] };
  const bow = 'bow' in g ? (g.bow ?? 0) : 0;
  if (bow) {
    pose.spine = [pose.spine[0] - bow * 0.5, pose.spine[1], pose.spine[2]];
    pose.chest = [pose.chest[0] - bow * 0.5, pose.chest[1], pose.chest[2]];
  }
  if (u.gesture === 'clap' || u.gesture === 'cheer' || u.party) {
    // bobbing along
    const bob = Math.abs(Math.sin(u.t * Math.PI * 1.2));
    pose.pelvis = [pose.pelvis[0], pose.pelvis[1] - bob * 0.012, pose.pelvis[2]];
  }
  const look = u.head;
  // a tilt toward their right is a turn about z the other way (the rig's z > 0 tips the top to their left)
  const tilt = 'tilt' in g ? -(g.tilt ?? 0) : 0;
  pose.neck = [pose.neck[0], look[1] * 0.3, tilt * 0.65];
  pose.head = [pose.head[0] + g.head + look[0], look[1] * 0.7, look[2] + tilt * 0.35];
  return pose;
}
