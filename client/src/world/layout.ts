// Adapted from cubefarm client/src/world/layout.ts (MIT): the footprint, the outside and the desks; colliders and the
// rest of the furniture come with the phases that need them.

// Every floor of the building shares one footprint. Units are metres; -Z is "north".

export const FLOOR_W = 32; // x from -16 to 16
export const FLOOR_D = 24; // z from -12 to 12
export const WALL_H = 3.6;
export const HALF_W = FLOOR_W / 2;
export const HALF_D = FLOOR_D / 2;

export const EYE_HEIGHT = 1.65;

// Elevator sits behind a doorway in the middle of the south wall.
export const ELEVATOR = { doorHalf: 1.2, cabinHalf: 1.5, depth: 2.6, doorHeight: 2.5 };

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const rect = (cx: number, cz: number, w: number, d: number): Rect => ({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });

// ---------- outside: windows, side doors and balconies ----------

export type FloorKind = 'office' | 'lobby';
export type Side = 'west' | 'east';
export const SIDES: readonly Side[] = ['west', 'east'];
/** -1 for the west wall, 1 for the east one. */
export const sideSign = (side: Side) => (side === 'west' ? -1 : 1);

/** Storey height, floor to floor: a room (WALL_H) and the slab between floors. The lobby's floor is the ground. */
export const FLOOR_HEIGHT = 4.2;
/** How far floor `floor`'s floor is above the ground (the lobby is floor 0). */
export const floorElevation = (floor: number) => Math.max(0, floor) * FLOOR_HEIGHT;

/** The outer walls as drawn (Shell.tsx). */
export const WALL_T = 0.3;

/** The side walls' windows: w wide along the wall, h tall, centred y up. */
export const WINDOW = { w: 4.4, h: 1.8, y: 1.95 };
/** A side wall's glass door: half its width and its height. */
export const SIDE_DOOR = { half: 0.9, h: 2.5 };
// Each side wall's door and windows, as z of their middles.
export const SIDE_OPENINGS: Record<FloorKind, Record<Side, { door: number; windows: number[] }>> = {
  office: { west: { door: -4.2, windows: [-8.5, 0, 8] }, east: { door: 3.55, windows: [-8, -2] } },
  lobby: { west: { door: 4.5, windows: [0, 8.5] }, east: { door: 2.6, windows: [-1] } },
};

/**
 * A balcony runs along each side wall (the lobby's is a patio on the ground): `depth` out from the wall's outer face,
 * from minZ to maxZ, with a railing `rail` high and `railT` thick on the slab.
 */
export const BALCONY = { depth: 2.5, minZ: -11.2, maxZ: 11.2, rail: 1.05, railT: 0.1, slab: 0.25 };
const BALCONY_IN = HALF_W + WALL_T;
/** |x| of the balconies' outer edge. */
export const BALCONY_OUT = BALCONY_IN + BALCONY.depth;
/** The underside of the balcony above. */
export const BALCONY_TOP = FLOOR_HEIGHT - BALCONY.slab;

/** Spans [a, b] on side `side`, measured out from x = 0 (a < b), as minX/maxX. */
const across = (side: Side, a: number, b: number) => (side === 'west' ? { minX: -b, maxX: -a } : { minX: a, maxX: b });

export const PLANTER = { w: 0.55, l: 1.8, h: 0.55 };
export const BENCH = { w: 0.6, l: 1.8, h: 0.85 };

/** On each balcony: a planter against the railing near each end, and a bench against the wall looking out, 3.6 m from the door. */
export function balconyFurniture(kind: FloorKind, side: Side): { planters: Rect[]; bench: Rect } {
  const door = SIDE_OPENINGS[kind][side].door;
  const x = across(side, BALCONY_OUT - BALCONY.railT - PLANTER.w, BALCONY_OUT - BALCONY.railT);
  const pz = BALCONY.maxZ - 1.3;
  const bz = door - 3.6 * Math.sign(door || 1);
  return {
    planters: [-pz, pz].map((z) => ({ ...x, minZ: z - PLANTER.l / 2, maxZ: z + PLANTER.l / 2 })),
    bench: { ...across(side, BALCONY_IN, BALCONY_IN + BENCH.w), minZ: bz - BENCH.l / 2, maxZ: bz + BENCH.l / 2 },
  };
}

// ---------- office floors ----------

// A floor's desks, numbered 0 to SEATS - 1: the open-plan grid first (0 to MAX_DESKS - 1), then the desks along the
// east wall, whose people face the wall with their backs to the room.
export const DESK_COLS = [-10.5, -3.5, 3.5, 10.5];
export const DESK_ROWS = [-6.2, -1.6, 3.0];
/** The open-plan grid's desks. */
export const MAX_DESKS = DESK_COLS.length * DESK_ROWS.length;
/** The east wall's desks: their x, and the z of each (desks MAX_DESKS and up). */
export const EAST_DESKS = { x: HALF_W - 2.0, z: [-5.2, -2.0, 1.2] };
/** How the east wall's desks are turned: facing the wall. */
export const EAST_ROTATION = -Math.PI / 2;
/** Every desk in a floor's room: the most workers a floor holds (the server's maxWorkers is at most this). */
export const SEATS = MAX_DESKS + EAST_DESKS.z.length;

export const DESK = { w: 1.9, d: 0.95, h: 0.74 };

/** One long rug under each row of desks (and their chairs). */
export const DESK_RUGS: Rect[] = DESK_ROWS.map((z) => rect(0, z + 0.35, 24.4, 2.9));

/** Whether desk `slot` is one of the east wall's (turned to face the wall). */
export const isEastDesk = (slot: number) => slot % SEATS >= MAX_DESKS;

/** Where desk `slot` stands. The grid fills from the row nearest the elevator, so a new team shows as you arrive. */
export function deskPosition(slot: number) {
  const s = slot % SEATS;
  if (s >= MAX_DESKS) return { x: EAST_DESKS.x, z: EAST_DESKS.z[s - MAX_DESKS] };
  const row = DESK_ROWS.length - 1 - Math.floor(s / DESK_COLS.length);
  const col = s % DESK_COLS.length;
  return { x: DESK_COLS[col], z: DESK_ROWS[row] };
}

/** How desk `slot` is turned about y: 0 for the grid (facing north), EAST_ROTATION for the east wall's. */
export const deskRotation = (slot: number) => (isEastDesk(slot) ? EAST_ROTATION : 0);

// ---------- the lobby (floor 0) ----------

/** The CEO's desk in the lobby. */
export const CEO_DESK = { x: 12, z: -7.4 };
/** The big rug in front of reception. */
export const LOBBY_RUG = rect(3, 3, 14, 9);
