import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BI, bindPositions, blendSolved, N_BONES, newSolved, PARENT, solve, standHeight, twoBone, worldOf, type Pose, type Proportions } from './rig';

const P: Proportions = {
  thigh: 0.35,
  shin: 0.36,
  ankle: 0.1,
  hipX: 0.11,
  hipY: 0.02,
  spine: 0.14,
  chest: 0.16,
  neck: 0.2,
  head: 0.12,
  headR: 0.2,
  shoulderX: 0.22,
  shoulderY: 0.1,
  upperArm: 0.25,
  forearm: 0.23,
  hand: 0.08,
  seat: 0.08,
  chestDepth: 0.14,
  splay: 0.12,
};

const rest = (over: Partial<Pose> = {}): Pose => ({
  pelvis: [0, standHeight(P), 0],
  hips: [0, 0, 0],
  spine: [0, 0, 0],
  chest: [0, 0, 0],
  neck: [0, 0, 0],
  head: [0, 0, 0],
  clav: { l: [0, 0, 0], r: [0, 0, 0] },
  arm: { l: { swing: 0, out: 0, bend: 0 }, r: { swing: 0, out: 0, bend: 0 } },
  leg: { l: { ankle: [P.hipX, P.ankle, 0] }, r: { ankle: [P.hipX, P.ankle, 0] } },
  ...over,
});

function world(pose: Pose, p = P) {
  const pos = new Float32Array(N_BONES * 3);
  const rot = new Float32Array(N_BONES * 4);
  worldOf(solve(pose, p, newSolved()), p, pos, rot);
  return { at: (b: number) => new THREE.Vector3().fromArray(pos, b * 3), rot: (b: number) => new THREE.Quaternion().fromArray(rot, b * 4) };
}

describe('the skeleton', () => {
  it('lists parents before children', () => {
    PARENT.forEach((p, i) => expect(p).toBeLessThan(i));
  });

  it('stands on the floor in the bind pose', () => {
    const b = bindPositions(P);
    expect(b[BI.pelvis][1]).toBeCloseTo(standHeight(P));
    expect(b[BI.footL][1]).toBeCloseTo(P.ankle);
    expect(b[BI.footR][0]).toBeCloseTo(P.hipX);
    expect(b[BI.upperArmL][0]).toBeCloseTo(-P.shoulderX);
  });
});

describe('two-bone IK', () => {
  const out = new THREE.Quaternion();
  it('lands the end on a reachable goal, bending toward the pole', () => {
    const root = new THREE.Vector3(0, 1, 0);
    const goal = new THREE.Vector3(0.1, 0.8, -0.3);
    const pole = new THREE.Vector3(0, 0, 1);
    const bend = twoBone(root, goal, pole, 0.3, 0.25, false, out);
    // the elbow is a along -Y of the first bone; the forearm turns about its local X by the bend
    const elbow = new THREE.Vector3(0, -0.3, 0).applyQuaternion(out).add(root);
    const fore = new THREE.Quaternion().copy(out).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), bend));
    const end = new THREE.Vector3(0, -0.25, 0).applyQuaternion(fore).add(elbow);
    expect(end.distanceTo(goal)).toBeLessThan(1e-5);
    // the elbow sits off the shoulder-to-goal line on the pole's side
    const d = goal.clone().sub(root).normalize();
    const side = pole.clone().addScaledVector(d, -pole.dot(d));
    expect(elbow.clone().sub(root).dot(side)).toBeGreaterThan(0);
  });

  it('reaches straight toward a goal too far away', () => {
    const root = new THREE.Vector3();
    const bend = twoBone(root, new THREE.Vector3(0, 0, -5), new THREE.Vector3(0, -1, 0), 0.3, 0.25, false, out);
    expect(bend).toBeLessThan(0.05);
    expect(new THREE.Vector3(0, -1, 0).applyQuaternion(out).z).toBeLessThan(-0.99);
  });

  it('leaves a straight limb hanging under its joint unturned', () => {
    twoBone(new THREE.Vector3(), new THREE.Vector3(0, -0.6, 0), new THREE.Vector3(0, 0, 1), 0.3, 0.3, false, out);
    expect(Math.abs(out.w)).toBeCloseTo(1, 3);
    twoBone(new THREE.Vector3(), new THREE.Vector3(0, -0.6, 0), new THREE.Vector3(0, 0, -1), 0.3, 0.3, true, out);
    expect(Math.abs(out.w)).toBeCloseTo(1, 3); // a leg's knee points ahead without turning it
  });
});

describe('solve', () => {
  it('puts the wrists and ankles on their targets', () => {
    const w = world(
      rest({
        arm: { l: { to: { root: [0.3, 1.0, -0.25] }, pole: [0.5, 0, 1] }, r: { to: { chest: [0.15, 0, -0.3] }, pole: [0.5, -1, 0] } },
        leg: { l: { ankle: [0.15, 0.2, -0.2] }, r: { ankle: [0.1, P.ankle + 0.06, 0.1] } },
      }),
    );
    expect(w.at(BI.handL).distanceTo(new THREE.Vector3(-0.3, 1.0, -0.25))).toBeLessThan(1e-4);
    const chest = w.at(BI.chest);
    expect(w.at(BI.handR).distanceTo(chest.add(new THREE.Vector3(0.15, 0, -0.3)))).toBeLessThan(1e-4);
    expect(w.at(BI.footL).distanceTo(new THREE.Vector3(-0.15, 0.2, -0.2))).toBeLessThan(1e-4);
    expect(w.at(BI.footR).distanceTo(new THREE.Vector3(0.1, P.ankle + 0.06, 0.1))).toBeLessThan(1e-4);
  });

  it('keeps feet flat on the floor whatever the legs do', () => {
    const w = world(rest({ pelvis: [0, standHeight(P) - 0.1, 0.05], hips: [-0.3, 0.2, 0.1] }));
    const toe = new THREE.Vector3(0, 0, -1).applyQuaternion(w.rot(BI.footL));
    expect(toe.y).toBeCloseTo(0, 5);
  });

  it('mirrors one side onto the other', () => {
    const arm = { to: { reach: [0.4, -0.3, -1] as const, ext: 0.9 }, pole: [0.5, -0.5, 0.5] as const, twist: 0.7, wrist: [0.2, 0.3, 0.1] as const };
    const w = world(rest({ arm: { l: arm, r: arm }, leg: { l: { ankle: [0.2, 0.3, -0.1], pitch: 0.2, toe: 0.3 }, r: { ankle: [0.2, 0.3, -0.1], pitch: 0.2, toe: 0.3 } } }));
    for (const [l, r] of [
      [BI.forearmL, BI.forearmR],
      [BI.handL, BI.handR],
      [BI.shinL, BI.shinR],
    ]) {
      const a = w.at(l);
      const b = w.at(r);
      expect(a.x).toBeCloseTo(-b.x, 5);
      expect(a.y).toBeCloseTo(b.y, 5);
      expect(a.z).toBeCloseTo(b.z, 5);
    }
  });

  it('points a one-piece arm (no forearm) straight at its target', () => {
    const p = { ...P, upperArm: 0.5, forearm: 0 };
    const w = world(rest({ arm: { l: { to: { root: [0.2, 1.5, -1] }, pole: [0, 0, 1] }, r: { swing: 0, out: 0, bend: 0 } } }), p);
    const shoulder = w.at(BI.upperArmL);
    const dir = new THREE.Vector3(-0.2, 1.5, -1).sub(shoulder).normalize();
    expect(w.at(BI.handL).sub(shoulder).normalize().dot(dir)).toBeCloseTo(1, 5);
  });
});

describe('blendSolved', () => {
  it('runs from one pose to the other', () => {
    const a = solve(rest(), P, newSolved());
    const b = solve(rest({ pelvis: [0, 0.5, 0], spine: [0.5, 0, 0] }), P, newSolved());
    const out = newSolved();
    blendSolved(a, b, 0, out);
    expect(Array.from(out.q)).toEqual(Array.from(a.q));
    blendSolved(a, b, 1, out);
    out.q.forEach((v, i) => expect(v).toBeCloseTo(b.q[i], 6));
    blendSolved(a, b, 0.5, out);
    expect(out.pelvis[1]).toBeCloseTo((standHeight(P) + 0.5) / 2);
    const q = new THREE.Quaternion().fromArray(out.q, BI.spine * 4);
    expect(q.length()).toBeCloseTo(1, 6);
  });
});
