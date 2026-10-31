// Adapted from cubefarm client/src/world/layout.ts (MIT): the footprint, the outside, the furniture an office floor
// has so far and the player's colliders (without the toys' heights).

// Every floor of the building shares one footprint. Units are metres; -Z is "north".

export const FLOOR_W = 32; // x from -16 to 16
export const FLOOR_D = 24; // z from -12 to 12
export const WALL_H = 3.6;
export const HALF_W = FLOOR_W / 2;
export const HALF_D = FLOOR_D / 2;

export const EYE_HEIGHT = 1.65;
export const PLAYER_RADIUS = 0.3;

// Elevator sits behind a doorway in the middle of the south wall.
export const ELEVATOR = { doorHalf: 1.2, cabinHalf: 1.5, depth: 2.6, doorHeight: 2.5 };
/** Where you start on a floor: in front of the elevator, facing north. */
export const SPAWN = { x: 0, z: HALF_D - 1.6, yaw: 0 };

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
/** The outer walls' colliders are this thick. */
const SHELL_T = 0.4;

/** The side walls' windows: w wide along the wall, h tall, centred y up. */
export const WINDOW = { w: 4.4, h: 1.8, y: 1.95 };
/** A side wall's glass door: half its width and its height. */
export const SIDE_DOOR = { half: 0.9, h: 2.5 };
// Each side wall's door and windows, as z of their middles.
export const SIDE_OPENINGS: Record<FloorKind, Record<Side, { door: number; windows: number[] }>> = {
  office: { west: { door: -4.2, windows: [-8.5, 0, 8] }, east: { door: 3.55, windows: [-8, -2] } },
  lobby: { west: { door: 4.5, windows: [0, 8.5] }, east: { door: 2.6, windows: [-1] } },
};

/** A side door opens while the player is within `across` of its wall's middle and `along` of the doorway's middle. */
export const DOOR_SENSOR = { across: 2, along: 1.5 };

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

/** A side wall's doorway, through the wall's collider: what the shut door fills. */
export function sideDoorway(kind: FloorKind, side: Side): Rect {
  const z = SIDE_OPENINGS[kind][side].door;
  return { ...across(side, HALF_W, HALF_W + SHELL_T), minZ: z - SIDE_DOOR.half, maxZ: z + SIDE_DOOR.half };
}

/** A balcony's railing: along its outer edge and across both ends. */
export function balconyRailing(side: Side): Rect[] {
  const { minZ, maxZ, railT } = BALCONY;
  return [
    { ...across(side, BALCONY_OUT - railT, BALCONY_OUT), minZ, maxZ },
    { ...across(side, BALCONY_IN - 0.1, BALCONY_OUT), minZ, maxZ: minZ + railT },
    { ...across(side, BALCONY_IN - 0.1, BALCONY_OUT), minZ: maxZ - railT, maxZ },
  ];
}

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

/** Both balconies' railings, planters and benches. */
export function outsideColliders(kind: FloorKind): Rect[] {
  return SIDES.flatMap((side) => {
    const { planters, bench } = balconyFurniture(kind, side);
    return [...balconyRailing(side), ...planters, bench];
  });
}

/** Which side the player at (x, z) is out on, past the middle of a side wall; null when inside. */
export const outsideAt = (x: number): Side | null => (Math.abs(x) <= HALF_W + WALL_T / 2 ? null : x < 0 ? 'west' : 'east');

/** The shell every floor shares: outer walls (with the elevator doorway and a side door each way) and the elevator cabin. */
export function shellColliders(kind: FloorKind = 'office'): Rect[] {
  const t = SHELL_T;
  const { doorHalf, cabinHalf, depth } = ELEVATOR;
  const side = (s: Side) => {
    const d = sideDoorway(kind, s);
    return [
      { minX: d.minX, maxX: d.maxX, minZ: -HALF_D, maxZ: d.minZ },
      { minX: d.minX, maxX: d.maxX, minZ: d.maxZ, maxZ: HALF_D },
    ];
  };
  return [
    { minX: -HALF_W - t, maxX: HALF_W + t, minZ: -HALF_D - t, maxZ: -HALF_D }, // north
    ...side('west'),
    ...side('east'),
    { minX: -HALF_W, maxX: -doorHalf, minZ: HALF_D, maxZ: HALF_D + t }, // south, left of door
    { minX: doorHalf, maxX: HALF_W, minZ: HALF_D, maxZ: HALF_D + t }, // south, right of door
    { minX: -cabinHalf - t, maxX: -cabinHalf, minZ: HALF_D, maxZ: HALF_D + depth }, // cabin sides
    { minX: cabinHalf, maxX: cabinHalf + t, minZ: HALF_D, maxZ: HALF_D + depth },
    { minX: -cabinHalf, maxX: cabinHalf, minZ: HALF_D + depth, maxZ: HALF_D + depth + t }, // cabin back
  ];
}

/** The elevator's doorway, filled while its doors are shut. */
export const elevatorDoorway = (): Rect => ({ minX: -ELEVATOR.doorHalf, maxX: ELEVATOR.doorHalf, minZ: HALF_D, maxZ: HALF_D + 0.4 });

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

/** The whiteboard on the north wall: w wide, h tall, its bottom y up, its face z. */
export const BOARD = { w: 12, h: 3.0, y: 0.45, z: -HALF_D + 0.06 };

// The ping-pong table in each office floor's play area, south of the front row of desks and west of the walk from the
// elevator. Its length runs east–west (x), so the ends face each other along the room; regulation sizes, `top` the
// playing surface's height. Players stand `stand` behind an end.
export const PONG_TABLE = { x: -6.6, z: 8.2, len: 2.74, wid: 1.525, top: 0.76, stand: 0.65 };
export const pongTableRect = (): Rect => rect(PONG_TABLE.x, PONG_TABLE.z, PONG_TABLE.len, PONG_TABLE.wid);

// The lounge, the kitchenette and the rest, where cubefarm has them (its errands' named spots are measured from these).
/** The couch against the west wall, facing east, and the coffee table in front of it. */
export const COUCH = { x: -HALF_W + 0.9, z: 6.5 };
export const COFFEE_TABLE = { x: -HALF_W + 2.6, z: 6.5 };
/** The kitchenette counter against the east wall, facing west: its middle (the machine, mugs and fridge are placed from it). */
export const KITCHEN = { x: HALF_W - 0.45, z: 7 };
export const COOLER = { x: HALF_W - 0.5, z: -9.5 };
/** The wall clock on the north wall, y its middle. */
export const CLOCK = { x: -10, y: 2.75, z: -HALF_D + 0.05 };
/** The merge gong in the north-west corner (Gong.tsx): its frame w wide, d deep and h tall, the disc's radius r and middle y. */
export const GONG = { x: -8.85, z: -11.3, w: 2.3, d: 0.9, h: 2.35, r: 0.72, y: 1.3 };
export const gongRect = (): Rect => ({ minX: GONG.x - GONG.w / 2, maxX: GONG.x + GONG.w / 2, minZ: -HALF_D, maxZ: GONG.z + GONG.d / 2 });
/** Where someone stands in front of the gong. */
export const GONG_SPOT = { x: GONG.x, z: GONG.z + GONG.d / 2 + 0.9 };
/** A floor's plants: x, z and how big. */
export const OFFICE_PLANTS: [number, number, number][] = [
  [-7.1, -HALF_D + 0.7, 1],
  [7.1, -HALF_D + 0.7, 1],
  [-HALF_W + 0.7, HALF_D - 0.8, 1.2],
  [-11, -HALF_D + 0.7, 1.1],
  [HALF_W - 0.7, HALF_D - 0.7, 0.9],
];

const plantRect = ([x, z, s]: [number, number, number]) => rect(x, z, 0.6 * s, 0.6 * s);

/** What the player can't walk through on an office floor. */
export function officeColliders(): Rect[] {
  const out = [...shellColliders('office'), elevatorDoorway(), ...outsideColliders('office')];
  for (let s = 0; s < SEATS; s++) {
    const { x, z } = deskPosition(s);
    if (isEastDesk(s)) {
      out.push(rect(x, z, DESK.d + 0.1, DESK.w + 0.1)); // turned to face the wall
      out.push(rect(x - 0.8, z, 0.6, 0.7)); // chair + occupant
    } else {
      out.push(rect(x, z, DESK.w + 0.1, DESK.d + 0.1));
      out.push(rect(x, z + 0.8, 0.7, 0.6)); // chair + occupant
    }
  }
  out.push(rect(0, -HALF_D + 0.25, BOARD.w + 0.4, 0.5)); // whiteboard + marker tray
  out.push(rect(COUCH.x, COUCH.z, 1.1, 3.2));
  out.push(rect(COFFEE_TABLE.x, COFFEE_TABLE.z, 0.9, 1.4));
  out.push(pongTableRect());
  out.push(rect(KITCHEN.x, KITCHEN.z + 0.4, 0.9, 5)); // kitchenette counter + fridge
  out.push(rect(COOLER.x, COOLER.z, 0.7, 0.7));
  out.push(gongRect());
  out.push(...OFFICE_PLANTS.map(plantRect));
  return out;
}

// ---------- the lobby (floor 0) ----------

/** The CEO's desk in the lobby. */
export const CEO_DESK = { x: 12, z: -7.4 };
/** The big rug in front of reception. */
export const LOBBY_RUG = rect(3, 3, 14, 9);
/** The lobby's plants, in its corners. */
export const LOBBY_PLANTS: [number, number, number][] = [
  [-HALF_W + 0.9, -HALF_D + 0.9, 1.2],
  [HALF_W - 0.9, -HALF_D + 0.9, 1.2],
  [-HALF_W + 0.9, HALF_D - 0.9, 1.2],
  [HALF_W - 0.9, HALF_D - 0.9, 1.2],
];

/** What the player can't walk through in the lobby: only what it draws so far. */
export function lobbyColliders(): Rect[] {
  return [
    ...shellColliders('lobby'),
    elevatorDoorway(),
    ...outsideColliders('lobby'),
    rect(CEO_DESK.x, CEO_DESK.z, DESK.w + 0.1, DESK.d + 0.1),
    rect(CEO_DESK.x, CEO_DESK.z + 0.8, 0.7, 0.6),
    ...LOBBY_PLANTS.map(plantRect),
  ];
}

/** Push a circle out of any rects it overlaps (cheap, axis-separated). */
export function collide(x: number, z: number, rects: Rect[], r = PLAYER_RADIUS): { x: number; z: number } {
  for (let pass = 0; pass < 2; pass++) {
    for (const b of rects) {
      const minX = b.minX - r;
      const maxX = b.maxX + r;
      const minZ = b.minZ - r;
      const maxZ = b.maxZ + r;
      if (x <= minX || x >= maxX || z <= minZ || z >= maxZ) continue;
      const pushes = [minX - x, maxX - x, minZ - z, maxZ - z];
      const abs = pushes.map(Math.abs);
      const i = abs.indexOf(Math.min(...abs));
      if (i < 2) x += pushes[i];
      else z += pushes[i];
    }
  }
  return { x, z };
}
