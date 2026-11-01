import { describe, expect, it } from 'vitest';
import type { FloorItem } from '../../../shared/types';
import { planRects } from './decor/spots';
import type { FloorKindOf } from './floors';
import { BALCONY_OUT, ceoColliders, collide, COUCH, HALF_D, HALF_W, lobbyColliders, LOBBY_COUCH, officeColliders, WALL_T, type Rect } from './layout';
import { FIRE, ROOF_SEATS, roofColliders } from './roof/roofLayout';
import { atSeat, decorSeats, SEATED_EYE, seatedEye, seatedLegs, seatsFor, seatTaken, SIT_POSE, sitLabel, standSpot, type Seat, type SeatKind } from './seats';

const item = (spot: string, name: string): FloorItem => ({ spot, item: name, tier: 1, since: 0 });
/** Every spot the shop's seats can stand in: the sofa and the beanbags in each big spot. */
const BIG = ['big-1', 'big-2', 'big-3'];
const PLANS: FloorItem[][] = [
  [item('big-2', 'sofa'), item('big-1', 'beanbags')],
  [item('big-1', 'sofa'), item('big-3', 'beanbags')],
  [item('big-3', 'sofa'), item('big-2', 'beanbags')],
];
const KINDS: FloorKindOf[] = ['office', 'lobby', 'ceo', 'roof'];

const collidersFor = (kind: FloorKindOf, plan: FloorItem[] = []): Rect[] =>
  kind === 'office' ? [...officeColliders(false), ...planRects(plan)] : kind === 'lobby' ? lobbyColliders(false) : kind === 'ceo' ? ceoColliders(false) : roofColliders();

/** Every floor kind's seats with the colliders round them (an office floor once for each plan). */
const cases = (): { kind: FloorKindOf; seats: Seat[]; colliders: Rect[] }[] => [
  ...PLANS.map((plan) => ({ kind: 'office' as const, seats: seatsFor('office', plan), colliders: collidersFor('office', plan) })),
  ...KINDS.filter((k) => k !== 'office').map((kind) => ({ kind, seats: seatsFor(kind), colliders: collidersFor(kind) })),
];

const inside = (r: Rect, p: { x: number; z: number }) => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ;
const forward = (s: Seat, d = 1) => ({ x: s.x - Math.sin(s.facing) * d, z: s.z - Math.cos(s.facing) * d });
const outdoors = (p: { x: number; z: number }) => Math.abs(p.x) > HALF_W + WALL_T / 2;

describe('the seats', () => {
  it('has every seat once on each floor, on something you bump into (the furniture it is)', () => {
    for (const { seats, colliders } of cases()) {
      expect(new Set(seats.map((s) => s.id)).size).toBe(seats.length);
      for (const s of seats) expect(colliders.some((r) => inside(r, s)), s.id).toBe(true);
    }
  });

  it('has the kinds where they are: couches, benches, deck chairs, the shop sofa and beanbags', () => {
    const kinds = (seats: Seat[]) => new Set(seats.map((s) => s.kind));
    expect([...kinds(seatsFor('office'))].sort()).toEqual(['bench', 'sofa']);
    expect([...kinds(seatsFor('office', PLANS[0]))].sort()).toEqual(['beanbag', 'bench', 'sofa']);
    expect([...kinds(seatsFor('lobby'))].sort()).toEqual(['bench', 'sofa']);
    expect([...kinds(seatsFor('roof'))].sort()).toEqual(['bench', 'deckchair']);
    expect(seatsFor('office').filter((s) => s.kind === 'bench' && outdoors(s))).toHaveLength(4);
    expect(seatsFor('lobby').filter((s) => s.kind === 'bench' && outdoors(s))).toHaveLength(4);
  });

  it('seats you on the couches facing the room', () => {
    const office = seatsFor('office').filter((s) => s.id.startsWith('couch'));
    expect(office).toHaveLength(3);
    for (const s of office) expect(forward(s).x).toBeGreaterThan(s.x); // the west wall's couch looks east
    expect(Math.max(...office.map((s) => Math.abs(s.x - COUCH.x)))).toBeLessThan(0.2);
    const lobby = seatsFor('lobby').filter((s) => s.id.startsWith('couch'));
    for (const s of lobby) expect(forward(s).x).toBeLessThan(s.x); // the east wall's looks west
    expect(Math.max(...lobby.map((s) => Math.abs(s.z - LOBBY_COUCH.z)))).toBeLessThan(1);
  });

  it('sits you on the balcony benches looking out, and round the fire facing it', () => {
    for (const s of seatsFor('office').filter((x) => x.kind === 'bench')) expect(Math.abs(forward(s).x)).toBeGreaterThan(Math.abs(s.x));
    const fire = seatsFor('roof').filter((s) => s.id.startsWith('fire'));
    expect(fire).toHaveLength(6);
    for (const s of fire) expect(Math.hypot(forward(s).x - FIRE.x, forward(s).z - FIRE.z)).toBeLessThan(Math.hypot(s.x - FIRE.x, s.z - FIRE.z) - 0.9);
  });

  it("gives the roof's deck chairs and fire seats the roof breaks' ids, leaning back in the chairs", () => {
    const roof = seatsFor('roof');
    for (const r of ROOF_SEATS.filter((x) => x.kind !== 'lookout')) expect(roof.find((s) => s.id === r.id)).toMatchObject({ x: r.x, z: r.z, facing: r.heading });
    const chairs = roof.filter((s) => s.kind === 'deckchair');
    expect(chairs).toHaveLength(4);
    expect(SIT_POSE.deckchair.lean).toBeGreaterThan(0.3);
    for (const s of chairs) expect(forward(s).z).toBeLessThan(s.z); // north, over the garden
  });

  it("has the shop's sofa and beanbags only where the floor bought them, facing out of their spot", () => {
    expect(decorSeats(undefined)).toEqual([]);
    expect(decorSeats([item('big-1', 'vending-machine'), item('floor-1', 'plant'), item('lounge', 'couch')])).toEqual([]);
    for (const spot of BIG) {
      const seats = decorSeats([item(spot, 'sofa')]);
      expect(seats.map((s) => s.kind)).toEqual(['sofa', 'sofa']);
      // the big spots back onto the north or south wall: the sofa looks into the room
      for (const s of seats) expect(Math.abs(forward(s).z)).toBeLessThan(Math.abs(s.z));
    }
    for (const spot of BIG) {
      const seats = decorSeats([item(spot, 'beanbags')]);
      expect(seats.map((s) => s.kind)).toEqual(['beanbag', 'beanbag']);
      // a grown-up's beanbag each: a metre or so apart, low, looking into the room
      expect(Math.hypot(seats[0].x - seats[1].x, seats[0].z - seats[1].z)).toBeGreaterThan(0.95);
      for (const s of seats) {
        expect(s.height).toBeLessThan(0.4); // low
        expect(Math.abs(forward(s).z)).toBeLessThan(Math.abs(s.z));
      }
    }
  });

  it('labels E on each kind of seat', () => {
    const kinds: SeatKind[] = ['sofa', 'armchair', 'chair', 'bench', 'deckchair', 'stool', 'beanbag'];
    for (const k of kinds) expect(sitLabel(k)).toMatch(/^(Sit|Flop)/);
    expect(sitLabel('bench')).toBe('Sit on the bench');
    expect(sitLabel('chair')).toBe('Sit down');
  });
});

describe('someone else in it', () => {
  const seat: Seat = { id: 'couch-1', x: 2, z: 3, facing: 0, height: 0.46, kind: 'sofa' };
  it('is taken by someone sitting in it, or a claim on it, not by someone nearby', () => {
    expect(seatTaken(seat, [], new Set())).toBe(false);
    expect(seatTaken(seat, [{ x: 2.1, z: 3.1 }], new Set())).toBe(true);
    expect(seatTaken(seat, [{ x: 2.9, z: 3 }], new Set())).toBe(false);
    expect(seatTaken(seat, [], new Set(['couch-1']))).toBe(true);
    expect(seatTaken(seat, [], new Set(['couch-0']))).toBe(false);
    expect(atSeat(seat, { x: 2, z: 3.3 })).toBe(true);
  });

  it("tells the couch's places apart, so one taken leaves the next free", () => {
    const [a, b] = seatsFor('office').filter((s) => s.id.startsWith('couch'));
    expect(seatTaken(b, [{ x: a.x, z: a.z }], new Set())).toBe(false);
  });
});

describe('getting up', () => {
  it('stands you somewhere clear beside every seat, near it and on its side of the wall', () => {
    for (const { kind, seats, colliders } of cases()) {
      for (const s of seats) {
        const p = standSpot(s, colliders);
        expect(collide(p.x, p.z, colliders), `${kind} ${s.id}`).toEqual(p);
        expect(Math.hypot(p.x - s.x, p.z - s.z), `${kind} ${s.id}`).toBeLessThan(1.7);
        if (kind !== 'roof') {
          expect(outdoors(p), `${kind} ${s.id}`).toBe(outdoors(s));
          expect(Math.abs(p.x)).toBeLessThan(BALCONY_OUT);
          expect(Math.abs(p.z)).toBeLessThan(HALF_D);
        }
      }
    }
  });

  it('prefers straight in front of the seat', () => {
    const bench = seatsFor('office').find((s) => s.id === 'bench-west-0')!;
    const p = standSpot(bench, collidersFor('office'));
    expect(p.z).toBeCloseTo(bench.z);
    expect(p.x).toBeLessThan(bench.x); // out on the balcony, west of the bench
  });
});

describe('sitting there', () => {
  it('puts your eyes over your hips, lower and further back in a deck chair', () => {
    const bench: Seat = { id: 'b', x: 0, z: 0, facing: 0, height: 0.5, kind: 'chair' };
    expect(seatedEye(bench)).toEqual({ x: 0, y: 0.5 + SEATED_EYE, z: 0 });
    const chair: Seat = { ...bench, kind: 'deckchair', height: 0.34 };
    const eye = seatedEye(chair);
    expect(eye.y).toBeLessThan(0.34 + SEATED_EYE);
    expect(eye.z).toBeGreaterThan(0.25); // behind you: you face -z
    expect(eye.x).toBeCloseTo(0);
  });

  it('bends your legs so your feet reach the floor, or hang from a high seat', () => {
    const thigh = 0.32;
    const shin = 0.495;
    const foot = (hip: number, lean: number, lift: number) => {
      const l = seatedLegs(hip, thigh, shin, lean, lift);
      const t = l.hip + lean;
      return hip - thigh * Math.cos(t) - shin * Math.cos(t + l.knee);
    };
    // each kind's seat height, in a body drawn 1.12 times life size (Me.tsx)
    const hips: Record<Exclude<SeatKind, 'stool'>, number> = { sofa: 0.46, armchair: 0.42, chair: 0.5, bench: 0.5, deckchair: 0.34, beanbag: 0.33 };
    for (const [kind, height] of Object.entries(hips) as [SeatKind, number][]) {
      const { lean, lift } = SIT_POSE[kind];
      expect(foot(height / 1.12, lean, lift), kind).toBeCloseTo(0, 6);
    }
    // a bar stool: the shins hang straight down, the feet off the floor
    const high = seatedLegs(0.95, thigh, shin, 0, 0);
    expect(high.knee).toBeCloseTo(-Math.PI / 2);
    expect(foot(0.95, 0, 0)).toBeGreaterThan(0.1);
  });
});
