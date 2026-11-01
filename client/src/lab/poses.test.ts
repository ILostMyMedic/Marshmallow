import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { seededAppearance } from '../world/appearance';
import { DESIGNS } from './designs';
import { blendSeconds, inTurn, nextAnim, SEAT_BLEND_S, TURN_S } from './player';
import { ANIM_NAMES, ANIMS, SCENE, SEATED, type AnimName } from './poses';
import { armLength, BI, N_BONES, newSolved, solve, standHeight, worldOf, type Proportions } from './rig';

// every design's proportions, for a tall broad look and a short slim one
const LOOKS = [
  { ...seededAppearance({ seed: 1, role: 'worker' }), height: 1.1, build: 'broad' as const },
  { ...seededAppearance({ seed: 7, role: 'worker' }), height: 0.9, build: 'slim' as const },
];
const BODIES = DESIGNS.flatMap((d) => LOOKS.map((look, i) => ({ name: `${d.id}#${i}`, p: d.build(look).props })));
const TIMES = Array.from({ length: 24 }, (_, i) => i * 0.37);

function pose(anim: AnimName, t: number, p: Proportions) {
  const f = ANIMS[anim](t, p);
  const pos = new Float32Array(N_BONES * 3);
  const rot = new Float32Array(N_BONES * 4);
  worldOf(solve(f.pose, p, newSolved()), p, pos, rot);
  return { f, at: (b: number) => new THREE.Vector3().fromArray(pos, b * 3) };
}

describe('every animation', () => {
  it('gives finite poses for every design at any time, the same each time', () => {
    for (const { p } of BODIES)
      for (const anim of ANIM_NAMES)
        for (const t of [0, 0.5, 3.3, 11.9]) {
          const a = pose(anim, t, p);
          for (let b = 0; b < N_BONES; b++) expect(Number.isFinite(a.at(b).length())).toBe(true);
          expect(pose(anim, t, p).at(BI.handR).equals(a.at(BI.handR))).toBe(true);
        }
  });

  it('says which ones are sat down, and they bring the chair', () => {
    for (const anim of ANIM_NAMES) expect(ANIMS[anim](1, BODIES[0].p).seat > 0.5).toBe(SEATED.has(anim));
  });
});

describe('standing', () => {
  it('keeps both feet on the floor while idle, clapping, waving or pointing', () => {
    for (const { p } of BODIES)
      for (const anim of ['idle', 'clap', 'wave', 'point', 'sip'] as const)
        for (const t of TIMES) {
          const a = pose(anim, t, p);
          expect(a.at(BI.footL).y).toBeCloseTo(p.ankle, 3);
          expect(a.at(BI.footR).y).toBeCloseTo(p.ankle, 3);
        }
  });

  it('walks with a foot always down and never stands taller than straight legs', () => {
    for (const { p } of BODIES)
      for (const t of TIMES) {
        const a = pose('walk', t, p);
        expect(Math.min(a.at(BI.footL).y, a.at(BI.footR).y)).toBeCloseTo(p.ankle, 3);
        expect(a.at(BI.pelvis).y).toBeLessThanOrEqual(standHeight(p));
      }
  });

  it('runs with moments in the air, both feet off the floor', () => {
    const { p } = BODIES[0];
    const lowest = Array.from({ length: 60 }, (_, i) => {
      const a = pose('run', i * 0.01, p);
      return Math.min(a.at(BI.footL).y, a.at(BI.footR).y);
    });
    expect(Math.max(...lowest)).toBeGreaterThan(p.ankle + 0.01);
    expect(Math.min(...lowest)).toBeCloseTo(p.ankle, 3);
  });

  it('cheers with the arms up high and hops clear of the floor', () => {
    for (const { p } of BODIES) {
      const frames = Array.from({ length: 40 }, (_, i) => pose('cheer', i * 0.026, p));
      expect(Math.max(...frames.map((a) => a.at(BI.pelvis).y))).toBeGreaterThan(standHeight(p));
      expect(Math.max(...frames.map((a) => a.at(BI.footL).y))).toBeGreaterThan(p.ankle + 0.02);
      // over the head for most; a chibi's short arms only get as high as its big head allows
      for (const a of frames) expect(a.at(BI.handR).y).toBeGreaterThan(a.at(BI.upperArmR).y + armLength(p) * 0.75);
    }
  });

  it('claps: the hands meet in front of the chest, then open', () => {
    for (const { p } of BODIES) {
      const gaps = Array.from({ length: 50 }, (_, i) => {
        const a = pose('clap', i * 0.017, p);
        expect(a.at(BI.handR).z).toBeLessThan(a.at(BI.chest).z);
        return a.at(BI.handL).distanceTo(a.at(BI.handR));
      });
      expect(Math.min(...gaps)).toBeLessThan(0.1);
      expect(Math.max(...gaps)).toBeGreaterThan(0.25);
    }
  });

  it('sips: the mug in hand comes up to the head, tipped, and goes back down', () => {
    for (const { p } of BODIES) {
      const rest = pose('sip', 0.1, p);
      const up = pose('sip', 2.2, p);
      expect(rest.f.mug).toBe(1);
      expect(up.f.tilt).toBeGreaterThan(0.8);
      expect(rest.f.tilt).toBe(0);
      expect(up.at(BI.handR).distanceTo(up.at(BI.head))).toBeLessThan(rest.at(BI.handR).distanceTo(rest.at(BI.head)) - 0.05);
    }
  });

  it('waves with the hand up beside the head, not in it', () => {
    for (const { p } of BODIES)
      for (const t of TIMES) {
        const a = pose('wave', t, p);
        const hand = a.at(BI.handR);
        const head = a.at(BI.head);
        expect(hand.y).toBeGreaterThan(head.y - p.headR);
        expect(hand.distanceTo(head)).toBeGreaterThan(p.headR);
      }
  });
});

describe('sitting', () => {
  it('sits on the seat with the feet on the floor, or dangling when the legs are too short', () => {
    for (const { name, p } of BODIES) {
      const a = pose('sit', 1, p);
      expect(a.at(BI.pelvis).y).toBeCloseTo(SCENE.seatY + p.seat, 5);
      // the knee sits a touch below the hip; from there the shin reaches the floor or doesn't
      const knee = SCENE.seatY + p.seat - p.hipY - p.thigh * 0.06;
      const foot = Math.min(a.at(BI.footL).y, a.at(BI.footR).y);
      if (knee - p.ankle < p.shin * 0.995) expect(foot, name).toBeCloseTo(p.ankle, 3);
      else expect(foot, name).toBeGreaterThan(p.ankle);
    }
  });

  it('types with the hands on the keyboard, short arms perching forward to reach', () => {
    for (const { name, p } of BODIES)
      for (const t of TIMES) {
        const a = pose('type', t, p);
        // a chibi's arms are too short for the game's desk even perched on the edge: they reach for its near edge
        // and today's one-piece arms can't bend to land exactly
        const slack = armLength(p) < 0.3 ? 0.1 : p.forearm === 0 ? 0.07 : 0.04;
        for (const hand of [BI.handL, BI.handR]) {
          const h = a.at(hand);
          expect(Math.abs(h.y - SCENE.keysY - 0.04), name).toBeLessThan(slack);
          expect(Math.abs(h.z - SCENE.keysZ - 0.08), name).toBeLessThan(slack);
        }
        expect(a.f.busy).toBe(true);
      }
  });

  it('sleeps slumped over the desk: head down on the arms, not through the desk, eyes shut', () => {
    for (const { name, p } of BODIES) {
      const a = pose('asleep', 1, p);
      const head = a.at(BI.head);
      const chin = head.y - p.headR;
      expect(chin, name).toBeLessThan(SCENE.deskY + 0.16);
      expect(head.y - p.headR * 0.85, name).toBeGreaterThan(SCENE.deskY);
      expect(a.f.lids).toBe(1);
      expect(a.f.zzz).toBe(true);
    }
  });
});

describe('the arms reach', () => {
  it('no further than their length', () => {
    for (const { p } of BODIES)
      for (const anim of ANIM_NAMES) {
        const a = pose(anim, 1.7, p);
        expect(a.at(BI.handR).distanceTo(a.at(BI.upperArmR))).toBeLessThanOrEqual(armLength(p) + 1e-4);
      }
  });
});

describe('the player', () => {
  it('blends longer between sitting and standing', () => {
    expect(blendSeconds('idle', 'type')).toBe(SEAT_BLEND_S);
    expect(blendSeconds('type', 'asleep')).toBeLessThan(SEAT_BLEND_S);
  });

  it('plays them in turn, round the list', () => {
    expect(nextAnim(ANIM_NAMES[ANIM_NAMES.length - 1])).toBe(ANIM_NAMES[0]);
    const p = { anim: 'idle' as const, at: 2 };
    expect(inTurn(p, 2 + TURN_S - 0.1)).toBe(p);
    expect(inTurn(p, 2 + TURN_S)).toEqual({ anim: nextAnim('idle'), at: 2 + TURN_S });
  });
});
