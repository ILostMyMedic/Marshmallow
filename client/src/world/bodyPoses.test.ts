import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DESIGN_OF } from '../lab/designs';
import { armLength, BI, N_BONES, newSolved, solve, standHeight, worldOf, type Pose, type Proportions } from '../lab/rig';
import { seededAppearance } from './appearance';
import { gait, LEG, type Gesture } from './body';
import { carryFrame, carryScale, DESK, deskPose, deskSlide, gestureArms, legLength, PHONE_TILT, seatPose, stepPose, upPose, type DeskInput } from './bodyPoses';
import { BODY_STYLES, DESK_SEAT } from './bodyStyle';
import type { Fidget } from './fidgets';
import type { PoseName } from './typing';

const LOOKS = [
  { ...seededAppearance({ seed: 1, role: 'worker' }), height: 1.1, build: 'broad' as const },
  { ...seededAppearance({ seed: 7, role: 'worker' }), height: 0.9, build: 'slim' as const },
];
const BODIES = BODY_STYLES.flatMap((style) => LOOKS.map((look, i) => ({ name: `${style}#${i}`, style, p: DESIGN_OF[style].build(look).props })));
const TIMES = [0, 0.4, 1.3, 2.9, 5.1];
const GESTURES: Gesture[] = ['none', 'reach', 'post', 'hold', 'sip', 'stretch', 'mug', 'tap', 'chat', 'cheer', 'wave', 'talk', 'stoop', 'shrug', 'take', 'windup', 'strike', 'clap', 'nod', 'thumbs', 'paddle', 'point', 'gasp', 'call'];

/** Every bone's place in figure space for a pose, and the middle of each palm. */
function placed(pose: Pose, p: Proportions) {
  const pos = new Float32Array(N_BONES * 3);
  const rot = new Float32Array(N_BONES * 4);
  worldOf(solve(pose, p, newSolved()), p, pos, rot);
  const at = (b: number) => new THREE.Vector3().fromArray(pos, b * 3);
  const palm = (b: number) => new THREE.Vector3(0, -p.hand * 0.55, 0).applyQuaternion(new THREE.Quaternion().fromArray(rot, b * 4)).add(at(b));
  const finite = [...pos].every(Number.isFinite);
  return { at, palm, finite, headRot: new THREE.Quaternion().fromArray(rot, BI.head * 4), rot: (b: number) => new THREE.Quaternion().fromArray(rot, b * 4) };
}

const up = (g: Gesture, t: number, p: Proportions, speed = 0) => upPose(p, { t, speed, phase: t * 3, dir: [0, -1], gesture: g, party: false, paddle: null, carry: carryScale(p), head: [0, 0, 0] });

/**
 * Whether a point is over the face: in front of the head (it faces -Z), within its width and between the mouth and the
 * brow, in the head's own frame (a chibi's chin comes down to its hands on the keys, so the chin doesn't count).
 */
function overFace(pt: THREE.Vector3, head: THREE.Vector3, rot: THREE.Quaternion, R: number) {
  const v = pt.clone().sub(head).applyQuaternion(rot.clone().invert());
  return Math.abs(v.x) < R * 0.6 && v.y > -R * 0.6 && v.y < R * 0.6 && v.z < -R * 0.3 && v.z > -R * 2.2;
}

describe('standing gestures', () => {
  it('solve for both styles at any time, with both feet on the floor', () => {
    for (const { p } of BODIES)
      for (const g of GESTURES)
        for (const t of TIMES) {
          const a = placed(up(g, t, p), p);
          expect(a.finite).toBe(true);
          expect(a.at(BI.footL).y).toBeCloseTo(p.ankle, 3);
          expect(a.at(BI.footR).y).toBeCloseTo(p.ankle, 3);
        }
  });

  it('never put a hand inside the head, nor an arm across the face', () => {
    for (const { name, p } of BODIES)
      for (const g of GESTURES)
        for (const t of TIMES) {
          const a = placed(up(g, t, p), p);
          const head = a.at(BI.head);
          for (const side of ['L', 'R'] as const) {
            const hand = a.palm(BI[`hand${side}`]);
            // a hand on the cheek or holding a phone to the ear touches the head, no more
            const touch = g === 'gasp' || g === 'call';
            expect(hand.distanceTo(head), `${name} ${g} hand${side} in the head`).toBeGreaterThan(p.headR * (touch ? 0.85 : 0.95));
            for (const pt of [a.at(BI[`forearm${side}`]), a.at(BI[`hand${side}`]), hand]) expect(overFace(pt, head, a.headRot, p.headR), `${name} ${g} ${side} over the face`).toBe(false);
          }
        }
  });

  it('hold the phone to the ear: the right hand at the right side of the head, the head leaning to it, the left on the hip', () => {
    for (const { name, p } of BODIES) {
      const a = placed(up('call', 1, p), p);
      const head = a.at(BI.head);
      const v = a.palm(BI.handR).sub(head).applyQuaternion(a.headRot.clone().invert());
      // out at the side of the head, about level with the ear (a chibi's short arm gets the hand to just under it)
      expect(v.x, name).toBeGreaterThan(p.headR * 0.85);
      expect(v.x, name).toBeLessThan(p.headR + 0.12);
      expect(Math.abs(v.z), name).toBeLessThan(p.headR * 0.6);
      expect(v.y, name).toBeGreaterThan(-p.headR - 0.08);
      // the elbow lower than the hand: the forearm comes up the side of the head
      expect(a.at(BI.forearmR).y, name).toBeLessThan(a.at(BI.handR).y);
      // leaning the head toward the phone tips its top to their right
      expect(new THREE.Vector3(0, 1, 0).applyQuaternion(a.headRot).x, name).toBeGreaterThan(Math.sin(PHONE_TILT) * 0.5);
      // the left hand at the hip, not hanging
      expect(Math.abs(a.at(BI.handL).y - standHeight(p)), name).toBeLessThan(0.12);
    }
  });

  it('carry a box in both hands at its sides', () => {
    for (const { p } of BODIES) {
      const a = placed(up('hold', 1, p), p);
      const box = carryFrame(p, carryScale(p));
      const chest = a.at(BI.chest);
      expect(a.at(BI.handL).distanceTo(a.at(BI.handR))).toBeGreaterThan(box.halfW * 1.6);
      expect(a.at(BI.handR).z).toBeLessThan(chest.z - 0.05);
    }
  });

  it('take a mug up to the lips for a sip', () => {
    for (const { p } of BODIES) {
      const held = placed(up('mug', 1, p), p);
      const sip = placed(up('sip', 1, p), p);
      expect(sip.at(BI.handR).distanceTo(sip.at(BI.head))).toBeLessThan(held.at(BI.handR).distanceTo(held.at(BI.head)) - 0.04);
    }
  });

  it('put the bat hand where the paddle is', () => {
    for (const { p } of BODIES) {
      const paddle: [number, number, number] = [0.3, standHeight(p) + 0.1, -0.3];
      const a = placed(upPose(p, { t: 1, speed: 0, phase: 0, dir: [0, -1], gesture: 'paddle', party: false, paddle, carry: 1, head: [0, 0, 0] }), p);
      const reach = Math.hypot(paddle[0] - a.at(BI.upperArmR).x, paddle[1] - a.at(BI.upperArmR).y, paddle[2] - a.at(BI.upperArmR).z);
      if (reach < armLength(p) * 0.98) expect(a.at(BI.handR).distanceTo(new THREE.Vector3(...paddle))).toBeLessThan(0.01);
    }
  });

  it('give each gesture its arms, and leave the walk alone for none', () => {
    for (const { p } of BODIES) {
      expect(gestureArms(p, 'none', 0)).toEqual({ l: null, r: null, head: 0 });
      for (const g of GESTURES.filter((x) => x !== 'none' && x !== 'nod')) {
        const arms = gestureArms(p, g, 0);
        expect(arms.l ?? arms.r, g).not.toBeNull();
      }
    }
  });
});

describe('walking and carrying', () => {
  // what people walk about with (errands, lunch, a leaver's box, a call), which arms hold it, and the empty-handed walk
  const CARRIES: { name: string; g: Gesture; box: boolean; holding: ('L' | 'R')[] }[] = [
    { name: 'empty-handed', g: 'none', box: false, holding: [] },
    { name: 'a snack, a can or lunch', g: 'hold', box: false, holding: ['R'] },
    { name: "a leaver's box", g: 'hold', box: true, holding: ['L', 'R'] },
    { name: 'a mug', g: 'mug', box: false, holding: ['R'] },
    { name: 'a sip on the way', g: 'sip', box: false, holding: ['R'] },
    { name: 'a mug and a chat', g: 'chat', box: false, holding: ['L', 'R'] },
    // the phone's arm goes up the side of the head, not out ahead (a chibi's short one reaches its ear straight)
    { name: 'a phone call', g: 'call', box: false, holding: [] },
  ];
  // straight on, curving round a turn either way, and sidestepping
  const DIRS: (readonly [number, number])[] = [[0, -1], [Math.sin(0.5), -Math.cos(0.5)], [-Math.sin(0.5), -Math.cos(0.5)], [1, 0]];
  const angle = (a: THREE.Vector3, b: THREE.Vector3) => a.angleTo(b);

  it('never locks an arm straight out ahead: carrying arms stay bent and close, empty ones swing low', () => {
    for (const { name, p } of BODIES)
      for (const c of CARRIES)
        for (const speed of [0, 0.6, 1.1, 2.5])
          for (const dir of DIRS)
            for (let i = 0; i < 12; i++) {
              const phase = (i / 12) * Math.PI * 2;
              const pose = upPose(p, { t: i * 0.21, speed, phase, dir, gesture: c.g, party: false, paddle: null, carry: c.box ? carryScale(p) : 0, head: [0, 0, 0] });
              const a = placed(pose, p);
              const chest = a.rot(BI.chest).invert();
              for (const side of ['L', 'R'] as const) {
                const shoulder = a.at(BI[`upperArm${side}`]);
                const elbow = a.at(BI[`forearm${side}`]);
                const wrist = a.at(BI[`hand${side}`]);
                const ahead = -wrist.clone().sub(shoulder).applyQuaternion(chest).z;
                const what = `${name}: ${c.name} at ${speed} m/s, ${side}`;
                // a free arm swings low; a holding one has something in front of a belly (a chibi's is round), so a little further
                const holds = c.holding.includes(side);
                expect(ahead, `${what} reaches out ahead`).toBeLessThan(armLength(p) * (holds ? 0.85 : 0.7));
                if (!holds) continue;
                expect(angle(elbow.clone().sub(shoulder), wrist.clone().sub(elbow)), `${what} elbow not bent`).toBeGreaterThan(0.45);
                expect(wrist.distanceTo(shoulder), `${what} held at arm's length`).toBeLessThan(armLength(p) * 0.92);
              }
            }
  });

  it('holds a box in against the body, and one small thing in one hand with the other arm swinging', () => {
    for (const { p } of BODIES) {
      const box = carryFrame(p, carryScale(p));
      // the box's back face no further out than the chest's front: held against the belly
      expect(-box.z - 0.15 * carryScale(p)).toBeLessThan(p.chestDepth + 0.03);
      const one = gestureArms(p, 'hold', 0, 0);
      expect(one.l).toBeNull();
      expect(one.r).not.toBeNull();
      // walking, the free arm still swings from front to back
      const z = (i: number) => {
        const a = placed(upPose(p, { t: 0, speed: 1.1, phase: (i / 8) * Math.PI * 2, dir: [0, -1], gesture: 'hold', party: false, paddle: null, carry: 0, head: [0, 0, 0] }), p);
        return a.at(BI.handL).z;
      };
      const zs = Array.from({ length: 8 }, (_, i) => z(i));
      expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.05);
    }
  });
});

describe('walking', () => {
  it('keeps a foot on the floor walking, never stands taller than straight legs, and steps quicker on short legs', () => {
    for (const { p } of BODIES)
      for (let i = 0; i < 24; i++) {
        const a = placed(stepPose(p, i * 0.1, 1.1, i * 0.37, [0, -1]), p);
        expect(Math.min(a.at(BI.footL).y, a.at(BI.footR).y)).toBeCloseTo(p.ankle, 2);
        expect(Math.min(a.at(BI.footL).y, a.at(BI.footR).y)).toBeGreaterThanOrEqual(p.ankle - 1e-3);
        expect(a.at(BI.pelvis).y).toBeLessThanOrEqual(standHeight(p) + 1e-6);
      }
    const g = { stride: 0, cadence: 0, bob: 0, lean: 0 };
    const chibi = BODIES.find((b) => b.style === 'chibi')!.p;
    const human = BODIES.find((b) => b.style === 'human')!.p;
    const old = gait(1.1, { ...g }).cadence;
    expect(gait(1.1, { ...g }, LEG).cadence).toBe(old);
    expect(gait(1.1, { ...g }, legLength(chibi)).cadence).toBeGreaterThan(old * 1.3);
    expect(gait(1.1, { ...g }, legLength(human)).cadence).toBeLessThan(old);
  });

  it('steps sideways when they sidestep', () => {
    for (const { p } of BODIES) {
      let spread = 0;
      for (let i = 0; i < 16; i++) {
        const a = placed(stepPose(p, 0, 1.5, (i / 16) * Math.PI * 2, [1, 0]), p);
        spread = Math.max(spread, Math.abs(a.at(BI.footR).z) + Math.abs(a.at(BI.footL).z));
      }
      expect(spread).toBeLessThan(0.02);
    }
  });
});

const desk = (p: Proportions, pose: PoseName, extra: Partial<DeskInput> = {}): DeskInput => ({
  t: 1.7,
  pose,
  tapSpeed: 19,
  head: [0, 0, 0],
  leanIn: 0,
  fidget: null,
  progress: 0,
  weight: 0,
  toward: 0,
  slide: deskSlide(p, pose),
  ...extra,
});

describe('sat at the desk', () => {
  it('sits on the seat for every pose, the feet on the floor or hanging over it', () => {
    for (const { p } of BODIES)
      for (const pose of ['typing', 'browsing', 'thinking', 'relaxed', 'cheer', 'slump'] as PoseName[])
        for (const seatY of [DESK_SEAT, 0.52]) {
          const a = placed(deskPose(p, desk(p, pose, { seatY, slide: deskSlide(p, pose, seatY) })), p);
          expect(a.finite).toBe(true);
          expect(a.at(BI.pelvis).y).toBeCloseTo(seatY + p.seat, 5);
          expect(Math.min(a.at(BI.footL).y, a.at(BI.footR).y)).toBeGreaterThanOrEqual(p.ankle - 1e-3);
        }
  });

  it('types with both hands on the keys (a chibi perched at the front of the seat to reach)', () => {
    for (const { name, style, p } of BODIES) {
      const a = placed(deskPose(p, desk(p, 'typing')), p);
      for (const [side, x] of [
        ['L', -DESK.keys.x],
        ['R', DESK.keys.x],
      ] as const) {
        const wrist = a.at(BI[`hand${side}`]);
        expect(wrist.distanceTo(new THREE.Vector3(x, DESK.keys.y, DESK.keys.z)), `${name} ${side}`).toBeLessThan(style === 'chibi' ? 0.12 : 0.05);
      }
    }
  });

  it('keeps hands out of the head and arms off the face in every fidget but the facepalm', () => {
    const fidgets: Fidget[] = ['leanBack', 'spin', 'phone', 'sip', 'doze', 'neckRoll', 'shoulders', 'scratch', 'fistPump', 'wave'];
    for (const { name, p } of BODIES)
      for (const f of fidgets)
        for (const u of [0.1, 0.5, 0.9])
          for (const toward of [-1, 1]) {
            // each over the pose it plays in: the idle ones at ease, the scratch thinking, the rest at work
            const base: PoseName = ['leanBack', 'spin', 'phone', 'sip', 'doze'].includes(f) ? 'relaxed' : f === 'scratch' ? 'thinking' : 'typing';
            const a = placed(deskPose(p, desk(p, base, { fidget: f, progress: u, weight: 1, toward })), p);
            const head = a.at(BI.head);
            for (const side of ['L', 'R'] as const) {
              const hand = a.palm(BI[`hand${side}`]);
              // scratching the head and hands behind it touch it, no more
              expect(hand.distanceTo(head), `${name} ${f} ${side}`).toBeGreaterThan(p.headR * (f === 'scratch' || f === 'leanBack' ? 0.85 : 0.9));
              // a hand still down on the keys is under the face, whatever the head does over it
              if (a.at(BI[`hand${side}`]).y > DESK.keys.y + 0.08) expect(overFace(a.at(BI[`hand${side}`]), head, a.headRot, p.headR), `${name} ${f} ${side} over the face`).toBe(false);
            }
          }
  });

  it('thinks with a fist under the chin, below the face', () => {
    for (const { p } of BODIES) {
      const a = placed(deskPose(p, desk(p, 'thinking')), p);
      const head = a.at(BI.head);
      const v = a.palm(BI.handR).sub(head).applyQuaternion(a.headRot.clone().invert());
      expect(v.y).toBeLessThan(-p.headR * 0.8);
      expect(a.palm(BI.handR).distanceTo(head)).toBeLessThan(p.headR + p.hand * 2 + 0.06);
    }
  });
});

describe('sat on any seat', () => {
  it('sits at the seat’s height, leaning back as asked, the feet finding the floor of the room', () => {
    for (const { p } of BODIES)
      for (const [seatY, tilt, lift] of [
        [0.45, 0, 0],
        [0.42, 0.45, 0],
        [0.3, 0.3, 0.35],
        [0.75, 0, 0],
      ]) {
        const a = placed(seatPose(p, { t: 1, seatY, tilt, lift }), p);
        expect(a.at(BI.pelvis).y).toBeCloseTo(seatY + p.seat, 5);
        // the figure is turned back `tilt` about the seat's top by its caller: where the soles are in the room then
        const room = (v: THREE.Vector3) => seatY + (v.y - seatY) * Math.cos(tilt) - v.z * Math.sin(tilt);
        for (const foot of [BI.footL, BI.footR]) expect(room(a.at(foot))).toBeGreaterThanOrEqual(p.ankle - 0.01);
        if (seatY < 0.5 && p.thigh + p.shin > 0.6) expect(Math.min(room(a.at(BI.footL)), room(a.at(BI.footR)))).toBeCloseTo(p.ankle, 2);
      }
  });
});
