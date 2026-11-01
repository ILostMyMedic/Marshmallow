// The character designs the lab compares. Each dresses the shared rig (rig.ts) from the same Appearance: skin, shirt and
// outfit, build, height, the feminine or masculine shape; the head and face are the game's own (HeadParts), scaled.
// A design returns its proportions and its body merged into one skinned geometry (build.ts).
import * as THREE from 'three';
import { ACCENTS, BUILD_SHAPE, type Appearance } from '../world/appearance';
import { PARTS } from '../world/characterParts';
import { shade } from '../world/materials';
import { INK } from '../world/Outlines';
import { ball, blob, Body, collarRing, band, diamond, loaf, panel, rbox, surfacePatch, surfacePoint, taper, thetaAt, torsoWeights, xf, type TorsoShape, type Weigh } from './build';
import { BI, bindPositions, standHeight, type Proportions, type V3 } from './rig';

export const PANTS = '#3d4a6b'; // the game's trousers (Character.tsx)
const WHITE = '#f8f9fa';
const SOLE = '#ece6da';

export interface Built {
  props: Proportions;
  body: THREE.BufferGeometry;
  detail: THREE.BufferGeometry | null;
  /** The game's head is drawn at this scale (1: radius 0.2). */
  headScale: number;
  /** Ink shell thickness (m). */
  ink: number;
  /** Where a held mug's middle sits in the right hand (hand space). */
  grip: V3;
  /** Headphones resting round the neck, in chest space. */
  phones: { at: V3; scale: number };
}

export interface Design {
  id: DesignId;
  name: string;
  blurb: string;
  build(look: Appearance): Built;
}

export type DesignId = 'soft' | 'blocks' | 'human' | 'chibi' | 'floaty' | 'today';

// ---------- what every design reads from the look ----------

function measure(look: Appearance) {
  const shape = BUILD_SHAPE[look.build];
  return {
    h: look.height,
    /** Shoulder width (build and shoulders), hip width (build), depth. */
    w: shape.width * look.shoulders,
    hw: shape.width,
    d: shape.depth,
    fem: look.look === 'feminine',
    /** Limb thickness. */
    limb: look.build === 'slim' ? 0.9 : look.build === 'broad' ? 1.12 : 1,
    long: look.outfit !== 'tee' && look.outfit !== 'stripe',
  };
}

function palette(look: Appearance) {
  return {
    shirt: look.shirt,
    skin: look.skin,
    collar: shade(look.shirt, -0.15),
    main: shade(look.shirt, -0.08),
    trim: look.outfit === 'stripe' ? ACCENTS[look.accent] : look.outfit === 'hoodie' || look.outfit === 'cardigan' ? WHITE : shade(look.shirt, -0.14),
    cuff: shade(look.shirt, -0.1),
  };
}

type Knot = readonly [v: number, rx: number, rz: number, dz: number, n: number];

/** A torso profile through knots of height v (0 bottom, 1 top), eased between them. */
function profile(cy: number, hy: number, m: number, knots: readonly Knot[], sx: number, sz: number): TorsoShape {
  const at = (th: number, k: 1 | 2 | 3 | 4) => {
    const v = th / Math.PI;
    let i = 0;
    while (i < knots.length - 2 && v > knots[i + 1][0]) i++;
    const a = knots[i];
    const b = knots[i + 1];
    const t = Math.min(1, Math.max(0, (v - a[0]) / (b[0] - a[0])));
    const s = t * t * (3 - 2 * t);
    return a[k] + (b[k] - a[k]) * s;
  };
  return { cy, hy, m, rx: (th) => at(th, 1) * sx, rz: (th) => at(th, 2) * sz, dz: (th) => at(th, 3) * sz, n: (th) => at(th, 4) };
}

const tmp = new THREE.Vector3();
/** The torso's half-width at its side, and its depth in front, at height y. */
const halfWidth = (s: TorsoShape, y: number) => surfacePoint(s, Math.PI / 2, thetaAt(s, y), tmp).x;
const frontDepth = (s: TorsoShape, y: number) => -surfacePoint(s, 0, thetaAt(s, y), tmp).z;

/**
 * The torso and what's worn on it: trousers below the hem, the shirt above, and the outfit's own pieces (a hoodie's hood,
 * pocket and strings, a cardigan's open front and buttons, a stripe, a sweater's ribbing and diamonds, a turtleneck's
 * rolls). `k` scales the small pieces to the body.
 */
function dressTorso(body: Body, s: TorsoShape, look: Appearance, o: { waist: number; neck: number; chest: number; k: number; weigh: Weigh; lift?: number }) {
  const c = palette(look);
  const { waist, neck, chest, k, weigh } = o;
  const lift = o.lift ?? 0.005;
  const tw = thetaAt(s, waist);
  body.skinned(
    surfacePatch(s, (u, v) => [u * Math.PI * 2, tw * v], 0, 28, 8),
    PANTS,
    weigh,
  );
  body.skinned(
    surfacePatch(s, (u, v) => [u * Math.PI * 2, tw + (Math.PI - tw) * v], 0, 28, 16),
    c.shirt,
    weigh,
  );
  // the hem, a lip over the trousers
  body.skinned(band(s, waist - 0.004, waist + 0.032 * k, lift * 1.2), look.outfit === 'sweater' ? c.trim : c.shirt, weigh);
  switch (look.outfit) {
    case 'tee':
      body.skinned(collarRing(s, neck, 0.004, 0.018 * k), c.collar, weigh);
      break;
    case 'stripe':
      body.skinned(collarRing(s, neck, 0.004, 0.018 * k), c.collar, weigh);
      body.skinned(band(s, chest - 0.04 * k, chest + 0.04 * k, lift), c.trim, weigh, true);
      break;
    case 'hoodie': {
      // the hood bunched round the back of the neck, the kangaroo pocket, the strings
      body.skinned(collarRing(s, neck - 0.01 * k, 0.012 * k, 0.04 * k, Math.PI * 0.32, Math.PI * 1.68, false), c.main, weigh);
      const back = surfacePoint(s, Math.PI, thetaAt(s, neck - 0.02 * k), new THREE.Vector3());
      body.skinned(xf(blob(0.11 * k, 0.085 * k, 0.06 * k), { at: [back.x, back.y + 0.015 * k, back.z + 0.035 * k], rot: [0.4, 0, 0] }), c.main, weigh);
      body.skinned(collarRing(s, neck, 0.004, 0.02 * k), c.main, weigh);
      body.skinned(panel(s, -0.55, 0.55, waist + 0.03 * k, waist + 0.15 * k, lift * 1.4), c.main, weigh, true);
      for (const side of [-1, 1]) {
        const top = surfacePoint(s, side * 0.18, thetaAt(s, neck - 0.025 * k), new THREE.Vector3());
        body.skinned(xf(taper(0.008 * k, 0.008 * k, 0.11 * k, 6, 2), { at: [top.x, top.y, top.z - 0.012] }), WHITE, weigh, true);
        body.skinned(xf(ball(0.014 * k, 8, 6), { at: [top.x, top.y - 0.115 * k, top.z - 0.014] }), WHITE, weigh, true);
      }
      break;
    }
    case 'cardigan': {
      // open down the front over a white tee; the edges a shade deeper, buttons on one side, two pockets
      body.skinned(panel(s, -0.3, 0.3, waist, neck, lift * 0.7, 6, 10), WHITE, weigh, true);
      for (const side of [-1, 1]) body.skinned(panel(s, side * 0.3, side * 0.38, waist, neck, lift * 1.4, 2, 10), c.main, weigh, true);
      for (const y of [0.25, 0.5, 0.75]) {
        const at = surfacePoint(s, 0.34, thetaAt(s, waist + (neck - waist) * y), new THREE.Vector3());
        body.skinned(xf(ball(0.013 * k, 8, 6), { at: [at.x, at.y, at.z - 0.01] }), WHITE, weigh, true);
      }
      for (const side of [-1, 1]) body.skinned(panel(s, side * 0.62, side * 0.98, waist + 0.04 * k, waist + 0.12 * k, lift * 1.6, 4, 2), c.main, weigh, true);
      body.skinned(collarRing(s, neck, 0.004, 0.016 * k), WHITE, weigh);
      break;
    }
    case 'sweater': {
      body.skinned(collarRing(s, neck, 0.006, 0.03 * k), c.trim, weigh);
      for (const a of [-0.5, -0.25, 0, 0.25, 0.5]) body.skinned(diamond(s, a, chest, 0.16, 0.06 * k, lift * 1.2), c.trim, weigh, true);
      break;
    }
    case 'turtleneck':
      body.skinned(collarRing(s, neck - 0.005, 0.008, 0.034 * k), c.main, weigh);
      body.skinned(collarRing(s, neck + 0.03 * k, -0.004, 0.03 * k), c.main, weigh);
      break;
  }
}

/** Sleeves on two-part arms: long (to a cuff at the wrist) or short (a sleeve over the top of a bare arm). */
function sleeves(body: Body, look: Appearance, p: Proportions, arm: { upper: () => THREE.BufferGeometry; fore: () => THREE.BufferGeometry; r1: number; r2: number; r3: number }) {
  const c = palette(look);
  const long = measure(look).long;
  if (long) {
    body.pair('upperArm', arm.upper, c.shirt);
    body.pair('forearm', arm.fore, c.shirt);
    body.pair('forearm', () => taper(arm.r3 + 0.008, arm.r3 + 0.008, 0.03, 12, 2).translate(0, -p.forearm + 0.035, 0), c.cuff);
  } else {
    body.pair('upperArm', arm.upper, c.skin);
    body.pair('forearm', arm.fore, c.skin);
    const len = p.upperArm * 0.55;
    body.pair('upperArm', () => taper(arm.r1 + 0.016, arm.r1 + (arm.r2 - arm.r1) * 0.55 + 0.02, len, 12, 4), c.shirt);
  }
}

/** A smooth curve through knots [s, value], eased between them. */
const curve =
  (knots: readonly (readonly [number, number])[]) =>
  (s: number): number => {
    let i = 0;
    while (i < knots.length - 2 && s > knots[i + 1][0]) i++;
    const [s0, a] = knots[i];
    const [s1, b] = knots[i + 1];
    const t = Math.min(1, Math.max(0, (s - s0) / (s1 - s0)));
    return a + (b - a) * t * t * (3 - 2 * t);
  };

const SHOE = '#3a3546';
// the upper, heights from the ground, s from the heel (0) to the toe (1)
const SHOE_BACK = 0.075;
const SHOE_FRONT = -0.19;
const SHOE_M = 2.8;
const WELT = 0.024;
const shoeWidth = curve([[0, 0.047], [0.45, 0.044], [0.75, 0.053], [1, 0.051]]);
// the sole reaches past the upper's ink shell (Built.ink) all round, or that ink shows outside the sole as hooks
const SOLE_LIP = 0.013;
const shoeTop = curve([[0, 0.095], [0.28, 0.105], [0.55, 0.066], [1, 0.04]]);

/** The top of the upper (from the ground) at z, as loaf() lays it: its profile, rounded towards the heel and toe. */
function instep(z: number) {
  const s = (SHOE_BACK - z) / (SHOE_BACK - SHOE_FRONT);
  const c = Math.sign(1 - 2 * s) * Math.abs(1 - 2 * s) ** (SHOE_M / 2);
  const rr = Math.sqrt(Math.max(0, 1 - c * c)) ** (2 / SHOE_M);
  return WELT + rr * (shoeTop(s) - WELT);
}

/**
 * Trainers on the foot bones (origin at the ankle, `ankle` above the ground, toes to -z): a smooth upper, low at the
 * toe and up round the ankle, white laces down the instep, sitting in a flat rubber sole a little wider all round.
 */
function trainers(body: Body, ankle: number) {
  body.pair('foot', () => loaf(SHOE_BACK, SHOE_FRONT, shoeWidth, (s) => shoeTop(s) - ankle, WELT - ankle, 0.008, { n: 2.4, m: SHOE_M, seg: 24, rings: 16 }), SHOE);
  const [lb, lf] = [-0.05, -0.13];
  const lz = (s: number) => lb + (lf - lb) * s;
  body.pair('foot', () => loaf(lb, lf, curve([[0, 0.02], [1, 0.024]]), (s) => instep(lz(s)) + 0.004 - ankle, (s) => instep(lz(s)) - 0.003 - ankle, 0.004, { n: 3, m: 2.4, seg: 12, rings: 8 }), WHITE, false, 0.5);
  body.pair('foot', () => loaf(SHOE_BACK + 0.018, SHOE_FRONT - 0.018, (s) => shoeWidth(s) + SOLE_LIP, () => 0.033 - ankle, 0.016 - ankle, 0.016, { n: 4, m: 3.5, seg: 24, rings: 18 }), SOLE, false, 0.35);
}

/** The headphones' resting place round the neck, in chest space. */
function phonesAt(p: Proportions, neckY: number, s: TorsoShape, scale: number): Built['phones'] {
  const b = bindPositions(p);
  return { at: [0, neckY - b[BI.chest][1] + 0.02, -frontDepth(s, neckY) * 0.35], scale };
}

// ---------- the designs ----------

const softToy: Design = {
  id: 'soft',
  name: 'Soft toy',
  blurb: 'A rounded bean with noodle limbs, mitten hands and round shoes: cosy, Animal Crossing-like proportions.',
  build(look) {
    const m = measure(look);
    const c = palette(look);
    const h = m.h;
    const L = m.limb;
    const aR = 0.05 * L;
    const lR = 0.066 * L;
    const P0 = 0.03 + 0.24 + 0.27 + 0.1;
    const s = profile(
      P0 + 0.16 * h,
      0.31 * h,
      2.4,
      [
        [0, 0.17 * m.hw, 0.15, 0, 2.2],
        [0.33, (m.fem ? 0.212 : 0.205) * m.hw, 0.175, -0.012, 2.2],
        [0.62, (m.fem ? 0.18 : 0.19) * m.w, 0.158, -0.004, 2.3],
        [1, 0.15 * m.w, 0.13, 0.01, 2.3],
      ],
      h,
      m.d * h,
    );
    const shoulderY = P0 + 0.29 * h;
    const props: Proportions = {
      thigh: 0.24,
      shin: 0.27,
      ankle: 0.1,
      hipX: 0.095 * m.hw,
      hipY: 0.03,
      spine: 0.13 * h,
      chest: 0.13 * h,
      neck: 0.17 * h,
      head: 0.17 * h,
      headR: 0.2 * 1.22 * h,
      shoulderX: halfWidth(s, shoulderY) - aR * 0.35,
      shoulderY: 0.03 * h,
      upperArm: 0.19 * h,
      forearm: 0.18 * h,
      hand: 0.09 * h,
      seat: 0.075,
      chestDepth: frontDepth(s, shoulderY - 0.08),
      splay: 0.42,
    };
    const body = new Body(props);
    const weigh = torsoWeights(props);
    dressTorso(body, s, look, { waist: P0 + 0.02 * h, neck: P0 + 0.42 * h, chest: P0 + 0.25 * h, k: h, weigh });
    sleeves(body, look, props, { upper: () => taper(aR, aR, props.upperArm), fore: () => taper(aR, aR, props.forearm), r1: aR, r2: aR, r3: aR });
    // mittens: a soft paddle and a thumb, palm to the body, thumb forward
    body.pair('hand', () => blob(0.032 * L * h, 0.06 * h, 0.05 * L * h).translate(0, -0.05 * h, 0), c.skin);
    body.pair('hand', () => xf(blob(0.022 * h, 0.034 * h, 0.022 * h), { at: [-0.008, -0.03 * h, -0.045 * h], rot: [0.6, 0, 0] }), c.skin);
    body.pair('thigh', () => taper(lR, lR * 0.96, props.thigh), PANTS);
    body.pair('shin', () => taper(lR * 0.96, lR * 0.92, props.shin), PANTS);
    body.pair('foot', () => blob(0.072, 0.058, 0.11).translate(0, -props.ankle + 0.052, -0.045), INK);
    body.pair('foot', () => blob(0.075, 0.022, 0.114).translate(0, -props.ankle + 0.016, -0.045), SOLE);
    const { body: g, detail } = body.build();
    return { props, body: g, detail, headScale: 1.22 * h, ink: 0.011, grip: [-0.02, -0.06 * h, -0.02], phones: phonesAt(props, P0 + 0.4 * h, s, 0.78 * h) };
  },
};

const chunky: Design = {
  id: 'blocks',
  name: 'Chunky blocks',
  blurb: 'Bevelled boxes with square shoulders and hips, two-part limbs with ball joints, block hands and shoes: reads from far away.',
  build(look) {
    const m = measure(look);
    const c = palette(look);
    const h = m.h;
    const L = m.limb;
    const P0 = 0.04 + 0.33 + 0.33 + 0.12;
    const s = profile(
      P0 + 0.32 * h,
      0.26 * h,
      7,
      [
        [0, (m.fem ? 0.17 : 0.18) * m.hw, 0.12, 0, 5],
        [0.45, (m.fem ? 0.165 : 0.19) * m.w, 0.125, 0, 5],
        [0.8, (m.fem ? 0.23 : 0.25) * m.w, 0.135, -0.005, 5.5],
        [1, (m.fem ? 0.22 : 0.24) * m.w, 0.13, 0, 5.5],
      ],
      h,
      m.d * h,
    );
    const shoulderY = P0 + 0.5 * h;
    const props: Proportions = {
      thigh: 0.33,
      shin: 0.33,
      ankle: 0.12,
      hipX: 0.11 * m.hw,
      hipY: 0.04,
      spine: 0.15 * h,
      chest: 0.17 * h,
      neck: 0.24 * h,
      head: 0.2 * h,
      headR: 0.2 * h,
      shoulderX: halfWidth(s, shoulderY) + 0.01,
      shoulderY: 0.18 * h,
      upperArm: 0.25 * h,
      forearm: 0.23 * h,
      hand: 0.1 * h,
      seat: 0.075,
      chestDepth: frontDepth(s, P0 + 0.35 * h),
      splay: 0.26,
    };
    const body = new Body(props);
    const weigh = torsoWeights(props);
    // the hips: a box in the trousers' colour under the shirt
    body.rigid('pelvis', rbox((m.fem ? 0.37 : 0.35) * m.hw, 0.2, 0.25 * m.d, 0.045).translate(0, -0.015, 0.005), PANTS);
    dressTorso(body, s, look, { waist: P0 + 0.1 * h, neck: P0 + 0.575 * h, chest: P0 + 0.38 * h, k: h, weigh, lift: 0.006 });
    body.rigid('neck', rbox(0.11 * h, 0.14 * h, 0.1 * h, 0.035 * h).translate(0, 0.05 * h, 0), c.skin);
    const joint = (col: string) => shade(col, -0.04);
    const sleeveCol = m.long ? c.shirt : c.skin;
    body.pair('upperArm', () => ball(0.072 * L * h), c.shirt);
    body.pair('upperArm', () => rbox(0.11 * L * h, props.upperArm - 0.07 * h, 0.11 * L * h, 0.03 * h).translate(0, -props.upperArm / 2 + 0.005, 0), m.long ? c.shirt : c.skin);
    if (!m.long) body.pair('upperArm', () => rbox(0.13 * L * h, props.upperArm * 0.42, 0.13 * L * h, 0.035 * h).translate(0, -props.upperArm * 0.2, 0), c.shirt);
    body.pair('forearm', () => ball(0.054 * L * h), joint(sleeveCol));
    body.pair('forearm', () => rbox(0.1 * L * h, props.forearm - 0.06 * h, 0.1 * L * h, 0.028 * h).translate(0, -props.forearm / 2, 0), sleeveCol);
    if (m.long) body.pair('forearm', () => rbox(0.112 * L * h, 0.035 * h, 0.112 * L * h, 0.014 * h, 1).translate(0, -props.forearm + 0.04 * h, 0), c.cuff);
    // block hands: a palm and a thumb, palm to the body
    body.pair('hand', () => rbox(0.05 * h, 0.1 * h, 0.085 * h, 0.018 * h, 1).translate(0.004, -0.06 * h, 0), c.skin);
    body.pair('hand', () => xf(rbox(0.032 * h, 0.05 * h, 0.03 * h, 0.012 * h, 1), { at: [-0.012 * h, -0.045 * h, -0.05 * h], rot: [0.45, 0, 0] }), c.skin);
    body.pair('thigh', () => rbox(0.15 * L, props.thigh - 0.05, 0.155 * L, 0.035).translate(0, -props.thigh / 2 + 0.01, 0), PANTS);
    body.pair('shin', () => ball(0.064 * L), joint(PANTS));
    body.pair('shin', () => rbox(0.135 * L, props.shin - 0.07, 0.14 * L, 0.032).translate(0, -props.shin / 2 - 0.005, 0), PANTS);
    body.pair('foot', () => rbox(0.14, 0.09, 0.24, 0.03).translate(0, -props.ankle + 0.07, -0.055), INK);
    body.pair('foot', () => rbox(0.15, 0.035, 0.25, 0.012, 1).translate(0, -props.ankle + 0.0175, -0.055), SOLE);
    const { body: g, detail } = body.build();
    return { props, body: g, detail, headScale: h, ink: 0.012, grip: [-0.02, -0.07 * h, -0.02], phones: phonesAt(props, P0 + 0.56 * h, s, 0.82 * h) };
  },
};

const human: Design = {
  id: 'human',
  name: 'Stylized human',
  blurb: 'A sculpted torso (chest, waist, slim hips, shoulders that read), tapered sleeves and trousers, hands with a thumb, trainers with laces and a rubber sole: slimmer and taller.',
  build(look) {
    const m = measure(look);
    const c = palette(look);
    const h = m.h;
    const L = m.limb;
    const P0 = 0.05 + 0.4 + 0.43 + 0.075;
    const f = m.fem;
    const s = profile(
      P0 + 0.26 * h,
      0.29 * h,
      2.8,
      [
        [0, 0.125 * m.hw, 0.095, 0, 2.3],
        [0.2, (f ? 0.148 : 0.14) * m.hw, 0.102, 0, 2.3],
        [0.44, (f ? 0.115 : 0.132) * m.hw, 0.094, -0.004, 2.2],
        [0.7, (f ? 0.165 : 0.178) * m.w, f ? 0.128 : 0.122, f ? -0.02 : -0.012, 2.5],
        [0.88, (f ? 0.175 : 0.195) * m.w, 0.112, 0, 3.2],
        [1, 0.12 * m.w, 0.085, 0.005, 2.6],
      ],
      h,
      m.d * h,
    );
    const shoulderY = P0 + 0.49 * h;
    const aR = 0.058 * L * h;
    const props: Proportions = {
      thigh: 0.4,
      shin: 0.43,
      ankle: 0.075,
      hipX: 0.082 * m.hw,
      hipY: 0.05,
      spine: 0.15 * h,
      chest: 0.18 * h,
      neck: 0.2 * h,
      head: 0.23 * h,
      headR: 0.2 * 0.88 * h,
      shoulderX: halfWidth(s, shoulderY) - aR * 0.25,
      shoulderY: 0.16 * h,
      upperArm: 0.285 * h,
      forearm: 0.26 * h,
      hand: 0.11 * h,
      seat: 0.08,
      chestDepth: frontDepth(s, P0 + 0.42 * h),
      splay: 0.16,
    };
    const body = new Body(props);
    const weigh = torsoWeights(props);
    dressTorso(body, s, look, { waist: P0 + 0.05 * h, neck: P0 + 0.535 * h, chest: P0 + 0.4 * h, k: h * 0.9, weigh, lift: 0.004 });
    // a belt under the hem
    body.skinned(band(s, P0 + 0.025 * h, P0 + 0.05 * h, 0.003), shade(PANTS, -0.12), weigh);
    body.rigid('neck', taper(0.052 * h, 0.05 * h, 0.2 * h, 12, 3).translate(0, 0.16 * h, 0), c.skin);
    sleeves(body, look, props, {
      upper: () => taper(aR, 0.044 * L * h, props.upperArm),
      fore: () => taper(0.044 * L * h, 0.033 * L * h, props.forearm),
      r1: aR,
      r2: 0.044 * L * h,
      r3: 0.033 * L * h,
    });
    // hands: a palm, the fingers together and slightly curled, a thumb
    const H = h * 1.15;
    body.pair('hand', () => rbox(0.03 * H, 0.075 * H, 0.07 * H, 0.012 * H, 1).translate(0, -0.042 * H, 0), c.skin);
    body.pair('hand', () => xf(rbox(0.024 * H, 0.06 * H, 0.064 * H, 0.011 * H, 1), { at: [-0.005 * H, -0.1 * H, 0.002], rot: [0, 0, -0.18] }), c.skin);
    body.pair('hand', () => xf(taper(0.013 * H, 0.011 * H, 0.04 * H, 8, 3), { at: [-0.012 * H, -0.025 * H, -0.032 * H], rot: [0.75, 0, 0.25] }), c.skin);
    body.pair('thigh', () => taper(0.074 * L, 0.058 * L, props.thigh), PANTS);
    body.pair('shin', () => taper(0.058 * L, 0.048 * L, props.shin, 12, 4), PANTS);
    trainers(body, props.ankle);
    const { body: g, detail } = body.build();
    return { props, body: g, detail, headScale: 0.88 * h, ink: 0.009, grip: [-0.02, -0.065 * h, -0.02], phones: phonesAt(props, P0 + 0.53 * h, s, 0.7 * h) };
  },
};

const chibi: Design = {
  id: 'chibi',
  name: 'Chibi',
  blurb: 'A big head on a small round body, with short stubby limbs that still bend.',
  build(look) {
    const m = measure(look);
    const c = palette(look);
    const h = m.h;
    const L = m.limb;
    const aR = 0.046 * L * h;
    const lR = 0.056 * L;
    const P0 = 0.03 + 0.15 + 0.15 + 0.09;
    const s = profile(
      P0 + 0.085 * h,
      0.19 * h,
      2.2,
      [
        [0, 0.14 * m.hw, 0.125, 0, 2.1],
        [0.4, (m.fem ? 0.148 : 0.152) * m.hw, 0.13, -0.008, 2.1],
        [1, 0.115 * m.w, 0.105, 0.005, 2.2],
      ],
      h,
      m.d * h,
    );
    const shoulderY = P0 + 0.2 * h;
    const props: Proportions = {
      thigh: 0.15,
      shin: 0.15,
      ankle: 0.09,
      hipX: 0.08 * m.hw,
      hipY: 0.03,
      spine: 0.09 * h,
      chest: 0.09 * h,
      neck: 0.09 * h,
      head: 0.28 * h,
      headR: 0.2 * 1.6 * h,
      shoulderX: halfWidth(s, shoulderY) - aR * 0.3,
      shoulderY: 0.02 * h,
      upperArm: 0.13 * h,
      forearm: 0.12 * h,
      hand: 0.06 * h,
      seat: 0.06,
      chestDepth: frontDepth(s, shoulderY - 0.04),
      splay: 0.5,
    };
    const body = new Body(props);
    const weigh = torsoWeights(props);
    dressTorso(body, s, look, { waist: P0 + 0.005 * h, neck: P0 + 0.255 * h, chest: P0 + 0.15 * h, k: h * 0.75, weigh, lift: 0.004 });
    sleeves(body, look, props, { upper: () => taper(aR, aR, props.upperArm), fore: () => taper(aR, aR, props.forearm), r1: aR, r2: aR, r3: aR });
    body.pair('hand', () => ball(0.05 * h, 12, 9).translate(0, -0.045 * h, 0), c.skin);
    body.pair('hand', () => blob(0.018 * h, 0.024 * h, 0.018 * h).translate(-0.01 * h, -0.03 * h, -0.042 * h), c.skin);
    body.pair('thigh', () => taper(lR, lR, props.thigh), PANTS);
    body.pair('shin', () => taper(lR, lR * 0.98, props.shin), PANTS);
    body.pair('foot', () => blob(0.066, 0.056, 0.095).translate(0, -props.ankle + 0.05, -0.03), INK);
    body.pair('foot', () => blob(0.078, 0.022, 0.108).translate(0, -props.ankle + 0.014, -0.03), SOLE, false, 0.35);
    const { body: g, detail } = body.build();
    return { props, body: g, detail, headScale: 1.6 * h, ink: 0.01, grip: [-0.015, -0.045 * h, -0.02], phones: phonesAt(props, P0 + 0.24 * h, s, 0.72 * h) };
  },
};

const floaty: Design = {
  id: 'floaty',
  name: 'Floaty (no limbs)',
  blurb: 'My extra idea: a bean body with floating mitts and sneakers and no arms or legs at all, Rayman-style: nothing to bend badly, and cheapest of all.',
  build(look) {
    const m = measure(look);
    const c = palette(look);
    const h = m.h;
    const P0 = 0.03 + 0.3 + 0.3 + 0.1;
    const s = profile(
      P0 + 0.11 * h,
      0.31 * h,
      2.3,
      [
        [0, 0.2 * m.hw, 0.17, 0, 2.2],
        [0.3, (m.fem ? 0.222 : 0.215) * m.hw, 0.18, -0.01, 2.2],
        [0.66, (m.fem ? 0.18 : 0.19) * m.w, 0.16, -0.005, 2.3],
        [1, 0.14 * m.w, 0.125, 0.01, 2.3],
      ],
      h,
      m.d * h,
    );
    const shoulderY = P0 + 0.28 * h;
    const props: Proportions = {
      thigh: 0.3,
      shin: 0.3,
      ankle: 0.1,
      hipX: 0.11 * m.hw,
      hipY: 0.03,
      spine: 0.13 * h,
      chest: 0.15 * h,
      neck: 0.17 * h,
      head: 0.27 * h,
      headR: 0.2 * 1.1 * h,
      shoulderX: halfWidth(s, shoulderY) + 0.03,
      shoulderY: 0.0,
      upperArm: 0.21 * h,
      forearm: 0.2 * h,
      hand: 0.09 * h,
      seat: 0.08,
      chestDepth: frontDepth(s, shoulderY - 0.06),
      splay: 0.3,
    };
    const body = new Body(props);
    const weigh = torsoWeights(props);
    dressTorso(body, s, look, { waist: P0 - 0.01 * h, neck: P0 + 0.37 * h, chest: P0 + 0.22 * h, k: h, weigh });
    // the hands: big mitts, a cuff floating at the wrist for long sleeves
    body.pair('hand', () => blob(0.04 * h, 0.07 * h, 0.06 * h).translate(0, -0.06 * h, 0), c.skin);
    body.pair('hand', () => xf(blob(0.026 * h, 0.04 * h, 0.026 * h), { at: [-0.01, -0.035 * h, -0.055 * h], rot: [0.6, 0, 0] }), c.skin);
    if (m.long) body.pair('forearm', () => taper(0.048 * h, 0.05 * h, 0.035 * h, 12, 3).translate(0, -props.forearm + 0.045 * h, 0), c.shirt);
    // sneakers
    body.pair('foot', () => blob(0.08, 0.065, 0.13).translate(0, -props.ankle + 0.06, -0.05), INK);
    body.pair('foot', () => blob(0.084, 0.024, 0.135).translate(0, -props.ankle + 0.018, -0.05), SOLE);
    const { body: g, detail } = body.build();
    return { props, body: g, detail, headScale: 1.1 * h, ink: 0.011, grip: [-0.02, -0.065 * h, -0.02], phones: phonesAt(props, P0 + 0.38 * h, s, 0.8 * h) };
  },
};

/** Today's parts (characterParts.ts) on the rig: the capsule torso, one-piece arms, legs with knees and no ankles. */
const today: Design = {
  id: 'today',
  name: "Today's figure",
  blurb: "The game's current parts on the same rig, for comparison: a capsule torso, straight one-piece arms, block shoes fixed to the shins.",
  build(look) {
    const m = measure(look);
    const c = palette(look);
    const h = m.h;
    const tw = m.w; // Figure.tsx torsoWidth
    const props: Proportions = {
      thigh: 0.32,
      shin: 0.43,
      ankle: 0.065,
      hipX: 0.11,
      hipY: 0,
      spine: 0.15 * h,
      chest: 0.17 * h,
      neck: 0.24 * h,
      head: 0.1 * h,
      headR: 0.2 * h,
      shoulderX: 0.25 * tw * h,
      shoulderY: 0.12 * h,
      upperArm: 0.5 * h,
      forearm: 0,
      hand: 0,
      seat: 0.02,
      chestDepth: 0.2 * m.d * h,
      splay: 0.1,
    };
    const body = new Body(props);
    const weigh = torsoWeights(props);
    const P0 = standHeight(props);
    // torso space (Figure.tsx TorsoWear): origin at the hips, scaled by the build, then by height
    const torso = (g: THREE.BufferGeometry, o: { at?: V3; rot?: V3 } = {}) => xf(xf(g, o), { at: [0, P0, 0], scale: [tw * h, h, m.d * h] });
    body.skinned(torso(PARTS.torso.clone(), { at: [0, 0.3, 0] }), c.shirt, weigh);
    if (look.outfit !== 'sweater' && look.outfit !== 'turtleneck') body.skinned(torso(PARTS.collar.clone(), { at: [0, 0.5, -0.02], rot: [Math.PI / 2, 0, 0] }), c.collar, weigh);
    const outfit = PARTS.outfit[look.outfit];
    if (outfit.main) body.skinned(torso(outfit.main.clone()), c.main, weigh);
    if (outfit.trim) body.skinned(torso(outfit.trim.clone()), c.trim, weigh, true);
    // the sleeve runs from the shoulder to the hand (Figure.tsx Sleeve), here down the arm bone
    body.pair('upperArm', () => PARTS.sleeve.clone().scale(h, h, h).translate(0, -0.24 * h, 0), c.shirt);
    body.pair('hand', () => PARTS.hand.clone().scale(h, h, h), c.skin);
    body.pair('thigh', () => PARTS.thigh.clone(), PANTS);
    body.pair('shin', () => PARTS.shin.clone(), PANTS);
    body.pair('shin', () => PARTS.shoe.clone(), INK);
    const { body: g, detail } = body.build();
    return { props, body: g, detail, headScale: h, ink: 0.012, grip: [0, -0.02, -0.02], phones: { at: [0, (0.49 - 0.32) * h, -0.09 * m.d * h], scale: 0.74 * h } };
  },
};

export const DESIGNS: readonly Design[] = [softToy, chunky, human, chibi, floaty, today];
export const DESIGN_OF = Object.fromEntries(DESIGNS.map((d) => [d.id, d])) as Record<DesignId, Design>;
