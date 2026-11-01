// The roof terrace's plan (Roof.tsx draws it): the deck and the parapet round it, the hut over the elevator, where
// everything stands, what the player bumps into, and where people up here walk, sit, look out and pace. Pure. Units are
// metres in the floor's frame (layout.ts): -Z is north and the deck is y 0. Body headings as body.ts's: 0 faces north.
// Adapted from cubefarm client/src/world/layout.ts and roof/roofWalks.ts (MIT): the helipad, windsock, grill and
// telescope are cut; the fireplace lounge, the lookouts and the seats are new.

import { ELEVATOR, HALF_D, HALF_W, PLAYER_RADIUS, WALL_T, elevatorDoorway, rect, type Rect } from '../layout';
import { makeNav, planPath, type Nav, type Pt } from '../nav';
import { BRIDGE } from '../bridgeLayout';

/** A person's radius on the walk grid: the player's, as on the floors (walkways.ts). */
const WALK_R = PLAYER_RADIUS;
/** The cabin's colliders are this thick, as every floor's (layout.ts shellColliders). */
const SHELL_T = 0.4;

/** The deck runs out to the walls' outer faces; a parapet `t` thick and `parapet` high, glazed up to `h`, goes all round. */
export const ROOF_EDGE = { x: HALF_W + WALL_T, z: HALF_D + WALL_T, t: WALL_T, parapet: 0.5, h: 1.1 };

// The hut over the elevator shaft (and the stairs, west of it) stands on the south edge with its back out over the
// street, like the cabin on every floor: its front wall holds the elevator's doorway where every floor's south wall does.
export const ROOF_HUT = { minX: -4.6, maxX: 2.2, maxZ: HALF_D + ELEVATOR.depth + 0.4, h: 3.9, front: WALL_T, stairX: -3.4 };

/** The lounge's wooden decking on the east half, under the string lights. */
export const DECKING: Rect = { minX: 2, maxX: HALF_W - 0.3, minZ: -6.2, maxZ: 8.6 };
/**
 * Deck chairs in a row on the decking, facing north over the garden to the city: x of each, z of their middles; a
 * sitter's hips are `hip` up, and they lean back `recline` (radians) with the canvas.
 */
export const DECK_CHAIRS = { xs: [4.4, 6.9, 9.4, 11.9], z: -2.4, w: 0.72, l: 1.3, hip: 0.34, recline: 0.45 };
/** Little round tables between the chairs. */
export const SIDE_TABLES = [5.65, 10.65].map((x) => ({ x, z: DECK_CHAIRS.z - 0.1, r: 0.3 }));
/** The string lights' poles round the decking; the lights zigzag between the north and south rows. */
export const LIGHT_POLES = [2.3, 8.8, 15.3].flatMap((x) => [
  { x, z: -5.9 },
  { x, z: 8.3 },
]);
export const POLE = { r: 0.07, h: 2.9 };
/** The picnic table at the decking's south end. */
export const PICNIC = { x: 8.6, z: 5.4, w: 2.2, d: 1.9, h: 0.75 };
/** The old wooden water tank on its stand in the north-west corner. */
export const WATER_TANK = { x: -13.2, z: -9.2, r: 1.35, legs: 2.2, h: 2.4 };
/** Raised garden beds along the north parapet, `BED_H` high. */
export const GARDEN_BEDS: Rect[] = [rect(-7.4, -11.4, 6, 1.1), rect(-0.6, -11.4, 5.4, 1.1), rect(5.6, -11.4, 4.6, 1.1)];
export const BED_H = 0.6;
/** Planters with a little tree each: by the decking, in the south-east corner and round the fire. */
export const TREE_PLANTERS = [
  { x: 1.3, z: -6.8 },
  { x: 15.1, z: 9.8 },
  { x: -13.6, z: 7 },
  { x: -4.4, z: -4.6 },
].map((p) => ({ ...p, w: 1.1, h: 0.6 }));

// ---------- the fireplace lounge ----------

/** The fire pit in the middle of the west half: a stone ring `r` round and `h` high. */
export const FIRE = { x: -9, z: 1.5, r: 0.8, h: 0.4 };
/**
 * Benches round it on three sides (north, west and south; the east lies open to the terrace): their middles `ring`
 * from the fire's, `len` long and `d` deep, the cushion's top `seat` high, two seats `apart` on each.
 */
export const FIRE_BENCH = { ring: 2.45, len: 2.1, d: 0.62, seat: 0.5, apart: 1.0 };
/** Which way each bench is from the fire. */
const BENCH_OUT: readonly Pt[] = [
  { x: 0, z: -1 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
];
/** Where someone sitting by the fire stands up to, in front of their seat (the Character's standAt, in its seat's frame). */
export const FIRE_STAND = { x: 0, z: -0.62 };
/** The crate on the fire's open (east) side, with a bag of marshmallows and a can of sticks on it: its middle, size and top. */
export const MARSHMALLOW_CRATE = { x: FIRE.x + 1.6, z: FIRE.z, w: 0.5, d: 0.42, h: 0.42 };

/** The way a body heading faces, as a unit step (heading 0 faces -z). */
export const facing = (heading: number): Pt => ({ x: -Math.sin(heading), z: -Math.cos(heading) });
/** The body heading that faces along (dx, dz). */
export const headingAlong = (dx: number, dz: number) => Math.atan2(-dx, -dz);

export interface Bench {
  x: number;
  z: number;
  /** The heading its sitters face: the fire. */
  heading: number;
  rect: Rect;
}

/** The benches round the fire. */
export const FIRE_BENCHES: readonly Bench[] = BENCH_OUT.map((o) => {
  const x = FIRE.x + o.x * FIRE_BENCH.ring;
  const z = FIRE.z + o.z * FIRE_BENCH.ring;
  const along = o.z !== 0; // a bench north or south of the fire runs east–west
  return { x, z, heading: headingAlong(-o.x, -o.z), rect: along ? rect(x, z, FIRE_BENCH.len, FIRE_BENCH.d) : rect(x, z, FIRE_BENCH.d, FIRE_BENCH.len) };
});

// ---------- the lookouts ----------

export interface Lookout {
  id: string;
  /** Its post, and the heading it looks out along (over the railing). */
  x: number;
  z: number;
  heading: number;
  /** Where its binoculars point until someone turns them (yaw as the heading, pitch up +): the west one at the bridge's north tower, clear of the rooftops between. */
  sight?: { yaw: number; pitch: number };
}

/** A lookout's post stands `inset` in from the parapet's inner face on a base `base` square; you stand `stand` behind it. */
export const LOOKOUT = { inset: 0.55, base: 0.5, stand: 0.8 };

/** Coin-op binoculars at the railing, one looking out each way. */
export const LOOKOUTS: readonly Lookout[] = [
  { id: 'north', x: 11.5, z: -HALF_D + LOOKOUT.inset, heading: 0 },
  { id: 'east', x: HALF_W - LOOKOUT.inset, z: 1.5, heading: -Math.PI / 2 },
  { id: 'south', x: -10.5, z: HALF_D - LOOKOUT.inset, heading: Math.PI },
  { id: 'west', x: -HALF_W + LOOKOUT.inset, z: -3, heading: Math.PI / 2, sight: { yaw: Math.atan2(-(BRIDGE.x + HALF_W), -(BRIDGE.z - BRIDGE.main / 2 + 3)), pitch: 0.09 } },
];

/** Where you (or anyone) stand to look through lookout `l`: behind its post, facing out. */
export function lookoutStand(l: Lookout): Pt {
  const out = facing(l.heading);
  return { x: l.x - out.x * LOOKOUT.stand, z: l.z - out.z * LOOKOUT.stand };
}

export const lookoutById = (id: string) => LOOKOUTS.find((l) => l.id === id);

// ---------- where people go ----------

export type SeatKind = 'chair' | 'fire' | 'lookout';

/** Somewhere a visitor spends their break: a deck chair, a seat by the fire or a lookout's binoculars. */
export interface RoofSeat {
  id: string;
  kind: SeatKind;
  /** Where they sit (the seat: their Character's root) or, at a lookout, stand; and the heading they face there. */
  x: number;
  z: number;
  heading: number;
  /** Where they walk to first: in front of the seat, or behind the lookout (where they stand). */
  front: Pt;
}

/** A lookout's seat id (the player's, while looking through it, for roofBreaks.ts). */
export const lookoutSeat = (id: string) => `lookout-${id}`;

/** Every seat on the roof: the deck chairs, the seats by the fire, the lookouts. */
export const ROOF_SEATS: readonly RoofSeat[] = [
  ...DECK_CHAIRS.xs.map((x, i): RoofSeat => ({ id: `chair-${i}`, kind: 'chair', x, z: DECK_CHAIRS.z + 0.05, heading: 0, front: { x, z: DECK_CHAIRS.z - DECK_CHAIRS.l / 2 - 0.55 } })),
  ...FIRE_BENCHES.flatMap((b, i) => {
    const out = facing(b.heading); // towards the fire
    return [-1, 1].map((k, j): RoofSeat => {
      const x = b.x - out.z * k * (FIRE_BENCH.apart / 2);
      const z = b.z + out.x * k * (FIRE_BENCH.apart / 2);
      return { id: `fire-${i * 2 + j}`, kind: 'fire', x, z, heading: b.heading, front: { x: x + out.x * -FIRE_STAND.z, z: z + out.z * -FIRE_STAND.z } };
    });
  }),
  ...LOOKOUTS.map((l): RoofSeat => {
    const at = lookoutStand(l);
    return { id: lookoutSeat(l.id), kind: 'lookout', x: at.x, z: at.z, heading: l.heading, front: at };
  }),
];

export const seatById = (id: string) => ROOF_SEATS.find((s) => s.id === id);

/** In front of the elevator's doors, where visitors step out and go back in. */
export const LIFT: Pt = { x: 0, z: HALF_D - 1 };
/** Where the CEO paces on a call: along the south railing, east of the hut, looking out over the city. */
export const CALL_SPOTS: readonly Pt[] = [
  { x: 6.5, z: HALF_D - 0.85 },
  { x: 12.5, z: HALF_D - 0.85 },
];
export const CALL_HEADING = Math.PI;

// ---------- what's in the way ----------

/**
 * What the player can't walk through on the roof: the parapet all round, the hut and the cabin (as on every floor),
 * and everything on the deck. Without the elevator's doorway unless `doorway` (the player's opens with the elevator's
 * doors: elevatorRide.ts elevatorShut).
 */
export function roofColliders(doorway = false): Rect[] {
  const { x: X, z: Z, t } = ROOF_EDGE;
  const { doorHalf, cabinHalf, depth } = ELEVATOR;
  const hut = ROOF_HUT;
  return [
    { minX: -X, maxX: X, minZ: -Z, maxZ: -Z + t }, // north parapet
    { minX: -X, maxX: -X + t, minZ: -Z, maxZ: Z }, // west
    { minX: X - t, maxX: X, minZ: -Z, maxZ: Z }, // east
    { minX: -X, maxX: hut.minX, minZ: Z - t, maxZ: Z }, // south, either side of the hut
    { minX: hut.maxX, maxX: X, minZ: Z - t, maxZ: Z },
    { minX: hut.minX, maxX: -doorHalf, minZ: HALF_D, maxZ: HALF_D + hut.front }, // the hut's front, beside the doorway
    { minX: doorHalf, maxX: hut.maxX, minZ: HALF_D, maxZ: HALF_D + hut.front },
    { minX: -cabinHalf - SHELL_T, maxX: -cabinHalf, minZ: HALF_D, maxZ: HALF_D + depth }, // the cabin, as on every floor
    { minX: cabinHalf, maxX: cabinHalf + SHELL_T, minZ: HALF_D, maxZ: HALF_D + depth },
    { minX: -cabinHalf, maxX: cabinHalf, minZ: HALF_D + depth, maxZ: HALF_D + depth + SHELL_T },
    ...(doorway ? [elevatorDoorway()] : []),
    rect(WATER_TANK.x, WATER_TANK.z, 2.7, 2.7),
    ...GARDEN_BEDS,
    ...TREE_PLANTERS.map((p) => rect(p.x, p.z, p.w, p.w)),
    ...DECK_CHAIRS.xs.map((x) => rect(x, DECK_CHAIRS.z, DECK_CHAIRS.w, DECK_CHAIRS.l)),
    ...SIDE_TABLES.map((s) => rect(s.x, s.z, s.r * 2, s.r * 2)),
    ...LIGHT_POLES.map((p) => rect(p.x, p.z, POLE.r * 4, POLE.r * 4)),
    rect(PICNIC.x, PICNIC.z, PICNIC.w, PICNIC.d),
    rect(FIRE.x, FIRE.z, FIRE.r * 2, FIRE.r * 2),
    ...FIRE_BENCHES.map((b) => b.rect),
    rect(MARSHMALLOW_CRATE.x, MARSHMALLOW_CRATE.z, MARSHMALLOW_CRATE.w, MARSHMALLOW_CRATE.d),
    ...LOOKOUTS.map((l) => rect(l.x, l.z, LOOKOUT.base, LOOKOUT.base)),
  ];
}

// ---------- the walk grid ----------

let nav: Nav | null = null;

/** The roof's walk grid, a person wide: its colliders and the elevator's doorway (built once). */
export const roofNav = () => (nav ??= makeNav(roofColliders(true), { planR: WALK_R + 0.1, lineR: WALK_R + 0.03, greed: 1.3 }));

/** A walk from `from` to `to` round the furniture, as waypoints after `from`; null when there's no way. */
export const findRoofPath = (from: Pt, to: Pt): Pt[] | null => planPath(roofNav(), from, to);
