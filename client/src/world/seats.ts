// Everywhere you can sit, on each kind of floor: the lounge's couch and the balconies' benches on an office floor (and
// the shop's sofa and beanbags where the floor has bought them, in their spot), the lobby's couch and the patio's
// benches, the CEO's floor's (layout.ts CEO_SEATS), and the roof's deck chairs, the benches round the fire and the
// picnic table's. All from the furniture's own numbers (layout.ts, roofLayout.ts, decor/spots.ts), so a seat moves with
// what it's on. Also whether someone else has it, where you get up to, where your eyes are sitting there and how your
// legs bend. Pure, so it's tested (seats.test.ts); SeatTargets.tsx offers them to E, Player.tsx sits you down and
// Me.tsx draws you sitting. New in Marshmallow.
import type { FloorItem } from '../../../shared/types';
import { BEANBAG, placedItems, placement } from './decor/spots';
import type { FloorKindOf } from './floors';
import { BENCH, CEO_SEATS, collide, COUCH, HALF_W, LOBBY_COUCH, PLAYER_RADIUS, SIDES, WALL_T, balconyFurniture, sideSign, type FloorKind, type Rect } from './layout';
import { DECK_CHAIRS, FIRE_BENCH, PICNIC, ROOF_SEATS } from './roof/roofLayout';

export type SeatKind = 'sofa' | 'armchair' | 'chair' | 'bench' | 'deckchair' | 'stool' | 'beanbag';

export interface Seat {
  /** Unique on its floor; a roof seat's is roofLayout.ts ROOF_SEATS's, so a roof break's claim on it is the same id. */
  id: string;
  /** Where the sitter's hips go. */
  x: number;
  z: number;
  /** The yaw a sitter faces (body.ts's heading: 0 faces -Z). */
  facing: number;
  /** The seat's top: how high the hips are. */
  height: number;
  kind: SeatKind;
}

type Pt = { x: number; z: number };

/** A heading's step forward on the floor, and to its right. */
const ahead = (h: number): Pt => ({ x: -Math.sin(h), z: -Math.cos(h) });
const rightOf = (h: number): Pt => ({ x: Math.cos(h), z: -Math.sin(h) });

/** Places along a piece of furniture at (x, z) whose sitters face `facing`: `along` each (+ to a sitter's right), `fwd` forward of its middle. */
function row(id: string, x: number, z: number, facing: number, along: readonly number[], fwd: number, height: number, kind: SeatKind): Seat[] {
  const f = ahead(facing);
  const r = rightOf(facing);
  return along.map((u, i) => ({ id: `${id}-${i}`, x: x + r.x * u + f.x * fwd, z: z + r.z * u + f.z * fwd, facing, height, kind }));
}

// ---------- the furniture's seats ----------

/** The couch (Props.tsx Couch, 3 m long): three places, a little in front of its middle. */
export const COUCH_SEAT = { along: [-0.85, 0, 0.85], fwd: 0.05, height: 0.46 };
/** A balcony's (or the patio's) bench (Outside.tsx): two places, the seat's top `height` up, the hips `out` from the wall's outer face. */
export const BENCH_SEAT = { along: [-0.45, 0.45], out: BENCH.w / 2 + 0.06, height: 0.5 };
/** The picnic table's benches (Garden.tsx): two places each, the boards' top `height` up, their middles `out` from the table's. */
export const PICNIC_SEAT = { along: [-0.5, 0.5], out: PICNIC.d / 2 - 0.15, height: 0.47 };
/** The shop's sofa (decor/models.ts sofaModel, front +z) and beanbags (beanbagsModel): where each sits in its own frame. */
const DECOR_SEATS: Record<string, { u: readonly number[]; v: number; height: number; kind: SeatKind }> = {
  sofa: { u: [-0.5, 0.5], v: 0.05, height: 0.46, kind: 'sofa' },
  beanbags: { u: BEANBAG.xs, v: 0.06, height: BEANBAG.seat, kind: 'beanbag' },
};

const couch = (id: string, at: Pt, facing: number) => row(id, at.x, at.z, facing, COUCH_SEAT.along, COUCH_SEAT.fwd, COUCH_SEAT.height, 'sofa');

/** A floor's two balcony benches (the lobby's are the patio's), their sitters looking out. */
function benchSeats(kind: FloorKind): Seat[] {
  return SIDES.flatMap((side) => {
    const s = sideSign(side);
    const b = balconyFurniture(kind, side).bench;
    return row(`bench-${side}`, s * (HALF_W + WALL_T + BENCH_SEAT.out), (b.minZ + b.maxZ) / 2, (-s * Math.PI) / 2, BENCH_SEAT.along, 0, BENCH_SEAT.height, 'bench');
  });
}

/** An office floor's own seats: the lounge's couch, facing east, and the balconies' benches. */
export const officeSeats = (): Seat[] => [...couch('couch', COUCH, -Math.PI / 2), ...benchSeats('office')];

/** The lobby's: its couch by the east wall, facing west, and the patio's benches. */
export const lobbySeats = (): Seat[] => [...couch('couch', LOBBY_COUCH, Math.PI / 2), ...benchSeats('lobby')];

/** The roof's: the deck chairs (leaning back), the benches round the fire (ROOF_SEATS's ids) and the picnic table's. */
export function roofSeats(): Seat[] {
  const out: Seat[] = [];
  for (const s of ROOF_SEATS) {
    if (s.kind === 'chair') out.push({ id: s.id, x: s.x, z: s.z, facing: s.heading, height: DECK_CHAIRS.hip, kind: 'deckchair' });
    else if (s.kind === 'fire') out.push({ id: s.id, x: s.x, z: s.z, facing: s.heading, height: FIRE_BENCH.seat, kind: 'bench' });
  }
  // the north bench faces south across the table, the south one north
  out.push(...row('picnic-n', PICNIC.x, PICNIC.z - PICNIC_SEAT.out, Math.PI, PICNIC_SEAT.along, 0, PICNIC_SEAT.height, 'bench'));
  out.push(...row('picnic-s', PICNIC.x, PICNIC.z + PICNIC_SEAT.out, 0, PICNIC_SEAT.along, 0, PICNIC_SEAT.height, 'bench'));
  return out;
}

/** The seats of what an office floor bought (the sofa, the beanbags), each in its spot; nothing for what it hasn't. */
export function decorSeats(plan: readonly FloorItem[] | undefined): Seat[] {
  const out: Seat[] = [];
  for (const item of placedItems(plan)) {
    const d = DECOR_SEATS[item.item];
    const p = d && placement(item.spot, item.item);
    if (!d || !p) continue;
    // the model's front (its +z) is turned rotY, and a sitter looks out of it: (sin rotY, cos rotY) as a heading
    const c = Math.cos(p.rotY);
    const s = Math.sin(p.rotY);
    const facing = Math.atan2(-s, -c);
    d.u.forEach((u, i) => out.push({ id: `${item.item}-${item.spot}-${i}`, x: p.x + u * c + d.v * s, z: p.z - u * s + d.v * c, facing, height: d.height, kind: d.kind }));
  }
  return out;
}

/** Every seat on a floor of kind `kind`; an office floor's with what its `plan` has bought. */
export function seatsFor(kind: FloorKindOf, plan?: readonly FloorItem[]): Seat[] {
  if (kind === 'office') return [...officeSeats(), ...decorSeats(plan)];
  if (kind === 'lobby') return lobbySeats();
  if (kind === 'roof') return roofSeats();
  return [...CEO_SEATS];
}

/** What E on a seat says. */
export function sitLabel(kind: SeatKind): string {
  switch (kind) {
    case 'sofa':
      return 'Sit on the sofa';
    case 'armchair':
      return 'Sit in the armchair';
    case 'bench':
      return 'Sit on the bench';
    case 'deckchair':
      return 'Sit in the deck chair';
    case 'beanbag':
      return 'Flop onto the beanbag';
    case 'stool':
      return 'Sit on the stool';
    default:
      return 'Sit down';
  }
}

// ---------- someone else's ----------

/** Whether a point is in `seat` (within `near` metres of where its hips go). */
export const atSeat = (seat: Pt, p: Pt, near = 0.4) => Math.hypot(p.x - seat.x, p.z - seat.z) < near;

/** Whether someone else has `seat`: a person sitting in it (`sitters`: where people sit), or a claim on its id (a roof break's). */
export const seatTaken = (seat: Seat, sitters: readonly Pt[], claimed: ReadonlySet<string>) => claimed.has(seat.id) || sitters.some((p) => atSeat(seat, p));

// ---------- getting up ----------

const clearAt = (x: number, z: number, colliders: Rect[], r: number) => {
  const p = collide(x, z, colliders, r);
  return Math.abs(p.x - x) < 1e-6 && Math.abs(p.z - z) < 1e-6;
};

/**
 * Where you stand up to from `seat`: the nearest clear spot straight in front of it, else straight behind it (a chair
 * at a table), else in front and to one side, else beside it; somewhere pushed clear in front when nothing is.
 * `colliders` as the player's (layout.ts collide).
 */
export function standSpot(seat: Seat, colliders: Rect[], r = PLAYER_RADIUS): Pt {
  const f = ahead(seat.facing);
  const s = rightOf(seat.facing);
  const at = (a: number, b: number) => ({ x: seat.x + f.x * a + s.x * b, z: seat.z + f.z * a + s.z * b });
  const tries: [number, number][] = [];
  for (let a = 0.6; a <= 1.61; a += 0.1) tries.push([a, 0]);
  for (let a = -0.6; a >= -1.21; a -= 0.1) tries.push([a, 0]);
  for (let a = 0.6; a <= 1.61; a += 0.2) for (const b of [0.5, -0.5, 1, -1]) tries.push([a, b]);
  for (const b of [0.8, -0.8, 1.1, -1.1]) tries.push([0, b]);
  for (const [a, b] of tries) {
    const p = at(a, b);
    if (clearAt(p.x, p.z, colliders, r)) return p;
  }
  const p = at(0.9, 0);
  return collide(p.x, p.z, colliders, r);
}

// ---------- sitting there ----------

/** How far your eyes are above your hips sitting up (layout.ts EYE_HEIGHT less the standing hips, for an average body). */
export const SEATED_EYE = 0.74;

/**
 * How each kind of seat sits you: leaning back `lean` (radians: a deck chair's canvas, a sofa's cushions, sinking into
 * a beanbag) and your knees up `lift` (radians, a low seat).
 */
export const SIT_POSE: Record<SeatKind, { lean: number; lift: number }> = {
  sofa: { lean: 0.1, lift: 0.05 },
  armchair: { lean: 0.1, lift: 0.05 },
  chair: { lean: 0, lift: 0 },
  bench: { lean: 0.03, lift: 0 },
  stool: { lean: 0, lift: 0 },
  deckchair: { lean: DECK_CHAIRS.recline, lift: 0 },
  beanbag: { lean: 0.3, lift: 0.35 },
};

/** Where your eyes are sitting in `seat` (the camera, in first person): `above` over your hips, leant back with the seat. */
export function seatedEye(seat: Seat, above = SEATED_EYE): { x: number; y: number; z: number } {
  const { lean } = SIT_POSE[seat.kind];
  const f = ahead(seat.facing);
  const back = above * Math.sin(lean);
  return { x: seat.x - f.x * back, y: seat.height + above * Math.cos(lean), z: seat.z - f.z * back };
}

/**
 * How your legs bend sitting with your hips `hip` above the floor (in the body's own units, as its `thigh` and `shin`),
 * the whole body leant back `lean` and the knees up `lift`: the hips' and the knees' turns about x (0 hanging straight
 * down, + swinging forward; the knee's from the thigh). The feet reach the floor, or hang when the seat's too high.
 */
export function seatedLegs(hip: number, thigh: number, shin: number, lean: number, lift: number): { hip: number; knee: number } {
  const t = Math.PI / 2 + lift + lean; // the thigh, from straight down, in the room
  const kneeY = hip - thigh * Math.cos(t);
  const s = kneeY >= shin ? 0 : Math.acos(Math.max(-1, kneeY / shin)); // the shin, forward from straight down
  return { hip: Math.PI / 2 + lift, knee: s - t };
}
