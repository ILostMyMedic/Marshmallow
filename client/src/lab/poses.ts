// The lab's animations: pure functions from time (seconds since the animation started) and a design's proportions to a
// pose (rig.ts) plus what goes with it: the face, the mug, the chair and desk. Every design gets the same function, so
// they all move alike; the proportions only decide where contacts land (feet on the floor, hands on the keyboard).
import { gait, type Gait } from '../world/body';
import type { Expression } from '../world/face';
import { burstLevel, handLift, TAP_PHASE } from '../world/typing';
import { armLength, standHeight, type ArmGoal, type ArmIK, type LegGoal, type Pose, type Proportions, type V3 } from './rig';

/** The game's furniture (Desk.tsx) in the figure's frame: origin on the floor under the chair's middle, facing the desk. */
export const SCENE = {
  seatY: 0.48,
  deskY: 0.77,
  /** The desk's near edge (the chair sits 0.8 from the middle of a desk 0.95 deep). */
  deskEdge: -0.325,
  keysY: 0.8,
  keysZ: -0.53,
};

export interface Frame {
  pose: Pose;
  face: Expression;
  /** Lids shut this far on top of blinking (1: asleep). */
  lids: number;
  /** The mug in the right hand (shown when > 0.5) and how far it's tipped to the lips (radians). */
  mug: number;
  tilt: number;
  /** How far they're sat at the desk (the chair and desk come in with it). */
  seat: number;
  zzz: boolean;
  /** At work: headphones on the head rather than round the neck. */
  busy: boolean;
}

export type Anim = (t: number, p: Proportions) => Frame;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smooth = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};
const frac = (x: number) => x - Math.floor(x);
/** 0 outside [a, b], easing up to 1 over `ramp` at each end. */
const window01 = (u: number, a: number, b: number, ramp: number) => smooth((u - a) / ramp) * (1 - smooth((u - b + ramp) / ramp));

function frame(pose: Pose, extras: Partial<Omit<Frame, 'pose'>> = {}): Frame {
  return { pose, face: 'neutral', lids: 0, mug: 0, tilt: 0, seat: 0, zzz: false, busy: false, ...extras };
}

// ---------- pieces of poses ----------

/** An arm hanging relaxed at the side, splayed enough to clear the body; `fwd` swings it a little. */
const hang = (p: Proportions, fwd = 0, ext = 0.985): ArmIK => ({ to: { reach: [p.splay, -1, -0.04 - fwd], ext }, pole: [0.3, 0, 1], twist: 0.3 });
/** A foot flat on the floor under its hip. */
const planted = (p: Proportions, out = 0.015): LegGoal => ({ ankle: [p.hipX + out, p.ankle, 0], toe: 0.12 });

/** Every few seconds a look off to one side and back, alternating sides: -1 to 1. */
function glance(t: number, every = 6.5) {
  const side = Math.floor(t / every) % 2 ? 1 : -1;
  return side * window01(t % every, 2.4, 4.6, 0.5);
}

/** Standing at ease: a slow weight shift from foot to foot (the pelvis over one leg, the other knee easing), breathing. */
function standing(t: number, p: Proportions, sway = 1): Pose {
  const S = standHeight(p);
  const shift = Math.sin(t * 0.55) * sway;
  const breathe = Math.sin(t * 1.7);
  return {
    pelvis: [shift * 0.022, S - 0.01 - Math.abs(shift) * 0.006, 0],
    hips: [0.02, shift * 0.05, shift * 0.035],
    spine: [0.005 * breathe, -shift * 0.025, -shift * 0.03],
    chest: [-0.01 - 0.012 * breathe, 0, -shift * 0.01],
    neck: [0, 0, 0],
    head: [0.02, 0, 0],
    clav: { l: [0, 0, 0.012 * breathe], r: [0, 0, 0.012 * breathe] },
    arm: { l: hang(p, 0.01 * breathe), r: hang(p, 0.01 * breathe) },
    leg: { l: planted(p), r: planted(p) },
  };
}

/** The pelvis on the seat, `slide` forward of its middle. */
const seatAt = (p: Proportions, slide: number): V3 => [0, SCENE.seatY + p.seat, 0.05 - slide];

/**
 * A seated leg: the thigh along the seat, the shin down to the floor in front of the chair; a short one that can't reach
 * the floor dangles, swinging a little.
 */
function seatedLeg(p: Proportions, pelvis: V3, t: number, phase: number): LegGoal {
  const hipY = pelvis[1] - p.hipY;
  const knee = { y: hipY - p.thigh * 0.06, z: pelvis[2] - p.thigh * 0.998 };
  const drop = knee.y - p.ankle;
  if (drop >= p.shin + 0.05) {
    const a = 0.22 + Math.sin(t * 2.6 + phase) * 0.18; // kicking their heels
    return { ankle: [p.hipX + 0.02, knee.y - p.shin * Math.cos(a), knee.z - p.shin * Math.sin(a)], pitch: -0.35, toe: 0.1, pole: [0, 0.5, -1] };
  }
  // just short: the shin straight down, the toes reaching for the floor
  if (drop >= p.shin * 0.995) return { ankle: [p.hipX + 0.03, knee.y - p.shin * 0.998, knee.z - 0.01], pitch: -Math.min(0.6, (drop - p.shin * 0.99) * 9), toe: 0.1, pole: [0, 0.5, -1] };
  const lean = Math.acos(drop / p.shin);
  return { ankle: [p.hipX + 0.03, p.ankle, knee.z - p.shin * Math.sin(lean)], toe: 0.1, pole: [0, 0.5, -1] };
}

/** Where the shoulders are (roughly) when sat leaning forward `lean`, with the pelvis at `pelvis`. */
function shoulderAt(p: Proportions, pelvis: V3, lean: number) {
  const up = p.spine + p.chest + p.shoulderY;
  return { y: pelvis[1] + up * Math.cos(lean), z: pelvis[2] - up * Math.sin(lean) };
}

/** How far forward on the seat they sit so their hands reach (x, y, z), leaning `lean`: short arms perch on the edge. */
function slideToReach(p: Proportions, lean: number, x: number, y: number, z: number) {
  const s = shoulderAt(p, seatAt(p, 0), lean);
  const reach = armLength(p) * 0.93;
  const dx = x - p.shoulderX;
  const dy = y - s.y;
  const flat = reach * reach - dx * dx - dy * dy;
  const dz = flat > 0 ? Math.sqrt(flat) : 0;
  return Math.min(0.2, Math.max(0, s.z - z - dz));
}

function seated(t: number, p: Proportions, lean: number, slide: number): Pose {
  const pelvis = seatAt(p, slide);
  const breathe = Math.sin(t * 1.5);
  return {
    pelvis,
    hips: [-lean * 0.35, 0, 0],
    spine: [-lean * 0.35 + 0.005 * breathe, 0, 0],
    chest: [-lean * 0.3 - 0.012 * breathe, 0, 0],
    neck: [0, 0, 0],
    head: [lean * 0.7, 0, 0],
    clav: { l: [0, 0, 0.01 * breathe], r: [0, 0, 0.01 * breathe] },
    arm: { l: hang(p), r: hang(p) },
    leg: { l: seatedLeg(p, pelvis, t, 0), r: seatedLeg(p, pelvis, t, 1.7) },
  };
}

// ---------- the animations ----------

export function idle(t: number, p: Proportions): Frame {
  const pose = standing(t, p);
  const g = glance(t);
  pose.neck = [0, g * 0.18, 0];
  pose.head = [0.03 + Math.sin(t * 0.7) * 0.02, g * 0.5, g * 0.05];
  return frame(pose);
}

/** The foot's place in a step cycle u (0 to 1, landing at 0): planted from `duty`'s start, then lifted and brought forward. */
function footCycle(u: number, excursion: number, lift: number, duty: number, run: boolean) {
  if (u < duty) return { z: -excursion / 2 + (excursion * u) / duty, y: 0, pitch: 0, stance: u / duty };
  const k = (u - duty) / (1 - duty);
  const s = Math.sin(Math.PI * k);
  return {
    z: excursion / 2 - excursion * (0.5 - 0.5 * Math.cos(Math.PI * k)) + (run ? 0.16 * s * (1 - k) : 0),
    y: lift * (run ? s * (1 - 0.4 * k) : s),
    pitch: -0.5 * (1 - k) ** 2 * s + 0.3 * k * k * (1 - k) * 2,
    stance: -1,
  };
}

const G: Gait = { stride: 0, cadence: 0, bob: 0, lean: 0 };

/** Walking or running on the spot, at the game's speeds (body.ts): feet planted and swept back, the arms swinging. */
function locomotion(t: number, p: Proportions, run: boolean): Pose {
  const g = gait(run ? 2.8 : 1.1, G);
  const leg = p.thigh + p.shin;
  const scale = leg / 0.8; // body.ts's leg
  const step = 2 * 0.8 * Math.sin(g.stride) * scale;
  const duty = run ? 0.36 : 0.6;
  const excursion = step * (run ? 0.5 : 0.85);
  const phase = t * g.cadence * Math.PI;
  const u = frac(phase / (Math.PI * 2));
  const l = footCycle(u, excursion, (run ? 0.24 : 0.07) * scale, duty, run);
  const r = footCycle(frac(u + 0.5), excursion, (run ? 0.24 : 0.07) * scale, duty, run);
  const S = standHeight(p);
  const reachY = (z: number) => p.ankle + p.hipY + Math.sqrt(Math.max(0, (leg * 0.985) ** 2 - z * z));
  let y: number;
  if (run) y = reachY(excursion / 2) - 0.035 * scale + 0.035 * scale * Math.cos(Math.PI * 4 * (u - 0.43));
  else y = Math.min(S - 0.02, l.stance >= 0 ? reachY(l.z) : Infinity, r.stance >= 0 ? reachY(r.z) : Infinity);
  const half = excursion / 2;
  const lean = g.lean;
  const swing = run ? 0.7 : 0.38;
  const arm = (opposite: number): ArmGoal => {
    const s = swing * (-opposite / half);
    return { swing: s, out: p.splay * 0.9 + (run ? 0.08 : 0.02), bend: run ? 1.5 : 0.22 + Math.max(0, s) * 0.5, twist: run ? 0.6 : 0.3 };
  };
  return {
    pelvis: [-Math.sin(phase) * 0.018, y, 0],
    hips: [-lean * 0.5, (0.1 * (l.z - r.z)) / excursion, -0.04 * Math.sin(phase)],
    spine: [-lean * 0.3, (-0.06 * (l.z - r.z)) / excursion, 0.02 * Math.sin(phase)],
    chest: [-lean * 0.2, (-0.1 * (l.z - r.z)) / excursion, 0.01 * Math.sin(phase)],
    neck: [lean * 0.3, 0, 0],
    head: [lean * 0.5, (0.06 * (l.z - r.z)) / excursion, 0],
    clav: { l: [0, 0, run ? 0.05 : 0], r: [0, 0, run ? 0.05 : 0] },
    arm: { l: arm(r.z), r: arm(l.z) },
    leg: {
      l: { ankle: [p.hipX * 0.85, p.ankle + l.y, l.z], pitch: l.pitch, toe: 0.06 },
      r: { ankle: [p.hipX * 0.85, p.ankle + r.y, r.z], pitch: r.pitch, toe: 0.06 },
    },
  };
}

export const walk: Anim = (t, p) => frame(locomotion(t, p, false));
export const run: Anim = (t, p) => frame(locomotion(t, p, true), { face: 'focused' });

/** Sat in the chair at ease: hands on the thighs, looking about. */
export function sit(t: number, p: Proportions): Frame {
  const pose = seated(t, p, -0.06, 0);
  const g = glance(t, 7);
  pose.head = [0.02, Math.sin(t * 0.35) * 0.25 + g * 0.3, 0];
  const pelvis = pose.pelvis;
  const onThigh = (side: number): ArmIK => ({
    to: { root: [p.hipX + 0.02, pelvis[1] - p.hipY + p.seat + 0.045, pelvis[2] - p.thigh * 0.62 + side * 0.02] },
    pole: [0.8, 0, 0.6],
    twist: 1.45,
    wrist: [-0.25, 0, 0.1],
  });
  pose.arm = { l: onThigh(0), r: onThigh(1) };
  return frame(pose, { seat: 1 });
}

const KEYS = { x: 0.12, y: SCENE.keysY + 0.04, z: SCENE.keysZ + 0.08 };

/** At the desk, typing in bursts (typing.ts's rhythm), eyes on the screen with a glance at the keys now and then. */
export function type(t: number, p: Proportions): Frame {
  const lean = 0.17;
  const slide = slideToReach(p, lean, KEYS.x, KEYS.y, KEYS.z);
  const pose = seated(t, p, lean, slide);
  const burst = burstLevel(t);
  const tap = (phase: number) => handLift(t, 19, phase) * burst * 0.018;
  const hand = (lift: number, drift: number): ArmIK => ({
    to: { root: [KEYS.x + drift, KEYS.y + lift, KEYS.z + drift * 0.5] },
    pole: [0.9, -0.35, 0.45],
    twist: 1.45,
    wrist: [-0.3, 0, 0.12],
  });
  pose.arm = { l: hand(tap(TAP_PHASE.l), Math.sin(t * 3.1) * 0.012), r: hand(tap(TAP_PHASE.r), Math.sin(t * 2.7 + 1) * 0.012) };
  const look = Math.sin(t * 0.55 + 2) > 0.92 ? -0.25 : 0;
  pose.head = [0.06 + look + Math.sin(t * 4.5) * 0.008 * burst, Math.sin(t * 0.4) * 0.06, 0];
  return frame(pose, { seat: 1, face: 'focused', busy: true });
}

/** A hand up beside the head, waving; leaning into it, joyful. */
export function wave(t: number, p: Proportions): Frame {
  const pose = standing(t, p, 0.5);
  const w = Math.sin(t * 9);
  // out beside the head and above its chin (clear of it, however big), the forearm swinging from the elbow
  const arm = armLength(p);
  const out = Math.max(p.shoulderX + arm * 0.55, p.headR + 0.08);
  const up = Math.max(p.shoulderY + arm * 0.55, p.neck + p.head - p.headR * 0.6);
  pose.arm.r = { to: { chest: [out + w * 0.07, up, 0.0] }, pole: [1, -0.9, 0.2], twist: -0.9, wrist: [0, 0, -w * 0.3] };
  pose.clav.r = [0, 0, 0.14];
  pose.chest = [-0.01, 0.05, -0.05];
  pose.head = [0.06, -0.12, -0.08];
  return frame(pose, { face: 'joyful' });
}

/** Arms up in a V and a hop, again and again. */
export function cheer(t: number, p: Proportions): Frame {
  const pose = standing(t, p, 0);
  const u = frac(t / 1.05);
  const scale = (p.thigh + p.shin) / 0.8;
  const air = u > 0.28 && u < 0.62 ? 4 * ((u - 0.28) / 0.34) * (1 - (u - 0.28) / 0.34) * 0.11 * scale : 0;
  const squat = (window01(u, 0.06, 0.3, 0.1) * 0.07 + window01(u, 0.6, 0.84, 0.1) * 0.06) * scale;
  pose.pelvis = [0, standHeight(p) - 0.01 - squat + air, 0];
  const feet = Math.max(0, air - 0.015);
  const leg = (): LegGoal => ({ ankle: [p.hipX + 0.03, p.ankle + feet, 0.01], pitch: -feet * 3, toe: 0.15 });
  pose.leg = { l: leg(), r: leg() };
  const pump = Math.sin(u * Math.PI * 2 - 1.2);
  const up = (): ArmIK => ({ to: { reach: [0.55, 1, -0.18 - pump * 0.08], ext: 0.95 + pump * 0.03 }, pole: [1, -0.2, 0.4], twist: -0.5, wrist: [0.15, 0, 0] });
  pose.arm = { l: up(), r: up() };
  pose.clav = { l: [0, 0, 0.16], r: [0, 0, 0.16] };
  pose.hips = [squat * 1.2, 0, 0];
  pose.spine = [-squat * 1.5, 0, 0];
  pose.chest = [0.06, 0, 0];
  pose.head = [0.22, 0, 0];
  return frame(pose, { face: 'joyful' });
}

/** Holding a mug at the chest, lifting it to the lips for a sip every few seconds. */
export function sip(t: number, p: Proportions): Frame {
  const pose = standing(t, p, 0.7);
  const u = frac(t / 4.5);
  const lift = window01(u, 0.2, 0.72, 0.16);
  const tip = window01(u, 0.34, 0.62, 0.08);
  const s = p.headR / 0.2;
  const rest: V3 = [0.03, p.shoulderY - 0.24, -(p.chestDepth + 0.15)];
  const lips: V3 = [0.02 * s, -0.24 * s, -0.27 * s];
  pose.arm.r = { to: { between: [{ chest: rest }, { head: lips }], k: lift }, pole: [0.6, -1, 0.2], twist: 0.35 };
  pose.head = [tip * 0.22 + 0.02, 0, 0];
  pose.neck = [tip * 0.08, 0, 0];
  pose.chest = [-0.01 + tip * 0.04, 0, 0];
  return frame(pose, { mug: 1, tilt: tip * 1.05 });
}

/** Clapping in front of the chest, bobbing along. */
export function clap(t: number, p: Proportions): Frame {
  const pose = standing(t, p, 0.3);
  const open = Math.abs(Math.sin(t * Math.PI * 2.4)) ** 0.8;
  // in front of the chest, as far out as the arms comfortably go
  const arm = armLength(p);
  const hand = (): ArmIK => ({ to: { chest: [0.035 + open * 0.11, p.shoulderY - Math.min(0.16, arm * 0.35), -(p.chestDepth + Math.min(0.2, arm * 0.4))] }, pole: [0.4, -1, 0.1], twist: 0.15, wrist: [0.35, 0, 0] });
  pose.arm = { l: hand(), r: hand() };
  const bob = Math.abs(Math.sin(t * Math.PI * 1.2));
  pose.pelvis = [pose.pelvis[0], pose.pelvis[1] - bob * 0.015, 0];
  pose.head = [0.05 - bob * 0.06, 0, 0];
  return frame(pose, { face: 'joyful' });
}

/** Pointing at something up and off to their left, the other hand on the hip. */
export function point(t: number, p: Proportions): Frame {
  const pose = standing(t, p, 0.4);
  const jab = window01(frac(t / 2.2), 0.1, 0.35, 0.08);
  pose.arm.l = { to: { reach: [0.75, 0.5, -0.7], ext: 0.985 + jab * 0.015 }, pole: [0, -1, 0.3], twist: 1.4, wrist: [-0.1, 0, 0] };
  pose.arm.r = { to: { root: [p.hipX + p.splay * 0.5 + 0.13, standHeight(p) + 0.03, 0.02] }, pole: [1, 0, 0.7], twist: -1.0, wrist: [0, 0, 0.5] };
  pose.hips = [0.02, 0.1, -0.03];
  pose.chest = [0.02, 0.14, 0];
  pose.head = [0.22, 0.4, 0];
  return frame(pose, { face: 'surprised' });
}

/** How a slump of `lean` curls the back: the share of it at the hips, waist, chest and neck (they add up to 1). */
const SLUMP = [0.2, 0.35, 0.35, 0.1] as const;

/** Where the middle of the head is, above and in front of the pelvis, slumped forward by `lean`. */
function slumpedHead(p: Proportions, lean: number) {
  const segs = [p.spine, p.chest, p.neck, p.head];
  let a = 0;
  let y = 0;
  let z = 0;
  segs.forEach((len, i) => {
    a += SLUMP[i] * lean;
    y += len * Math.cos(a);
    z -= len * Math.sin(a);
  });
  return { y, z };
}

/** The slump that brings the head down to height `y` over a pelvis at `pelvisY` (as far as a back curls). */
function slumpTo(p: Proportions, pelvisY: number, y: number) {
  let lo = 0;
  let hi = 1.5;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (pelvisY + slumpedHead(p, mid).y > y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Nodded off at the desk: slumped forward, head on folded arms, breathing slow. */
export function asleep(t: number, p: Proportions): Frame {
  const slide = slideToReach(p, 0.5, 0.1, SCENE.deskY + 0.05, SCENE.deskEdge - 0.14);
  const pelvis = seatAt(p, slide);
  const breathe = Math.sin(t * 1.3);
  // slump far enough that the head comes down onto the arms on the desk
  const lean = slumpTo(p, pelvis[1], SCENE.deskY + 0.075 + p.headR * 0.92);
  const pose = seated(t, p, 0, slide);
  pose.hips = [-lean * SLUMP[0], 0, 0];
  pose.spine = [-lean * SLUMP[1] + breathe * 0.01, 0, 0];
  pose.chest = [-lean * SLUMP[2] - breathe * 0.015, 0, 0];
  pose.neck = [-lean * SLUMP[3], -0.25, -0.1];
  pose.head = [lean * 0.55, -0.55, -0.45];
  pose.clav = { l: [0, 0.1, 0.06 + breathe * 0.015], r: [0, 0.1, 0.06 + breathe * 0.015] };
  const headZ = pelvis[2] + slumpedHead(p, lean).z;
  const z = Math.min(SCENE.deskEdge - 0.08, headZ + 0.02);
  const fold = (): ArmIK => ({ to: { root: [-0.07, SCENE.deskY + 0.05, z] }, pole: [0.9, 0.2, 0.3], twist: 1.5, wrist: [0, 0, 0.35] });
  pose.arm = { l: fold(), r: fold() };
  return frame(pose, { seat: 1, face: 'sleepy', lids: 1, zzz: true });
}

export const ANIMS = { idle, walk, run, sit, type, wave, cheer, sip, clap, point, asleep } satisfies Record<string, Anim>;
export type AnimName = keyof typeof ANIMS;
export const ANIM_NAMES = Object.keys(ANIMS) as AnimName[];
/** The animations sat at the desk (their frames' `seat` is 1). */
export const SEATED: ReadonlySet<AnimName> = new Set<AnimName>(['sit', 'type', 'asleep']);
export const ANIM_LABELS: Record<AnimName, string> = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  sit: 'Sit',
  type: 'Type',
  wave: 'Wave',
  cheer: 'Cheer',
  sip: 'Sip',
  clap: 'Clap',
  point: 'Point',
  asleep: 'Asleep',
};
