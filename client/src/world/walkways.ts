// Adapted from cubefarm client/src/world/walkways.ts (MIT): the spots Marshmallow's floors have (no toys or jukebox;
// the CEO has a floor of their own), and the grid built from the floor's colliders.

// Walkways: where people can walk on each floor kind, how to get from A to B, and the named places they walk to.
// Pure (no three.js): the grid and A* are nav.ts's, sized for a person. Headings follow nav's: facing h looks along
// (cos h, sin h), so 0 is east, π/2 south (+z), π west, -π/2 north. (body.ts's headings differ: errands.ts converts.)

import { reservedRects, slotSpots, wallSlotSpots } from './decor/spots';
import { kanbanColumnSpan, KANBAN_KEYS } from './draw';
import { BOARD, ceoColliders, deskPosition, EXEC_AWARD_SHELF, EXEC_BAR, EXEC_CHESS, EXEC_COFFEE, EXEC_DESK, EXEC_GLOBE, EXEC_GREEN, EXEC_POOL, EXEC_SHELVES, EXEC_TANK, EXEC_WEEK, HALF_D, HALF_W, isEastDesk, lobbyColliders, officeColliders, PLAYER_RADIUS, RECEPTION, PONG_TABLE, SEATS, sideDoorway, SIDE_OPENINGS, SIDES, WALL_T, type FloorKind, type Rect } from './layout';
import { clear, makeNav, planPath, type Nav, type Pt } from './nav';

export type { FloorKind };

/** A person's radius, the same as the player's. */
export const WALK_R = PLAYER_RADIUS;
/** Normal walking speed, m/s. */
export const WALK_SPEED = 1.2;

const EAST = 0;
const SOUTH = Math.PI / 2;
const WEST = Math.PI;
const NORTH = -Math.PI / 2;

/** A named place: where to stand and which way to face there, plus a seat for places you sit down at. */
export interface Spot {
  id: string;
  x: number;
  z: number;
  facing: number;
  sit?: { x: number; z: number; facing: number };
}

export interface Walkways {
  floor: FloorKind;
  nav: Nav;
  spots: Spot[];
  /** Where people start from: every desk (office), the CEO's desk (lobby). */
  homes: Spot[];
}

// ---------- named spots ----------

const STAND_BACK = 1.5; // behind a desk's chair, where its occupant stands up

/** Desk `slot`'s "stand up here" spot, just behind the chair, facing the desk (the east wall's desks face the wall). */
export function deskSpot(slot: number): Spot {
  const { x, z } = deskPosition(slot);
  return isEastDesk(slot) ? { id: `desk-${slot}`, x: x - STAND_BACK, z, facing: EAST } : { id: `desk-${slot}`, x, z: z + STAND_BACK, facing: NORTH };
}

/** In front of each board column, as drawKanban lays them out across the board. */
function boardSpots(): Spot[] {
  const px = 2560; // the board's canvas width (KanbanBoard.tsx); only the ratio matters
  return KANBAN_KEYS.map((key, ci) => {
    const { x0, colW } = kanbanColumnSpan(ci, px);
    return { id: `board-${key}`, x: -BOARD.w / 2 + ((x0 + colW / 2) / px) * BOARD.w, z: -HALF_D + 1.1, facing: NORTH };
  });
}

const elevatorSpot = (): Spot => ({ id: 'elevator', x: 0, z: HALF_D - 1, facing: SOUTH });

/** A metre in from the west and east windows, looking out. */
function windowSpots(west: number[], east: number[]): Spot[] {
  return [...west.map((z, i) => ({ id: `window-w${i}`, x: -HALF_W + 1, z, facing: WEST })), ...east.map((z, i) => ({ id: `window-e${i}`, x: HALF_W - 1, z, facing: EAST }))];
}

/** Where a ping-pong player stands at each end of the table, facing down it (pongErrands.ts). */
export function pongSpots(): Spot[] {
  const t = PONG_TABLE;
  const off = t.len / 2 + t.stand;
  return [
    { id: 'pong-west', x: t.x - off, z: t.z, facing: EAST },
    { id: 'pong-east', x: t.x + off, z: t.z, facing: WEST },
  ];
}

function officeSpots(): Spot[] {
  return [
    ...boardSpots(),
    // the kitchenette counter (Props.tsx): the coffee machine sits 1.1 m north of its middle
    { id: 'coffee', x: HALF_W - 1.45, z: 5.9, facing: EAST },
    // the mug stand, 0.45 m south of the machine
    { id: 'mugs', x: HALF_W - 1.45, z: 6.55, facing: EAST },
    // a step back from the machine and one more behind that, waiting a turn; and two places by the counter for a sip
    // and a chat, face to face
    { id: 'coffee-line', x: HALF_W - 2.35, z: 5.9, facing: EAST },
    { id: 'coffee-line-1', x: HALF_W - 3.25, z: 5.9, facing: EAST },
    { id: 'coffee-sip-0', x: HALF_W - 1.45, z: 7.9, facing: WEST },
    { id: 'coffee-sip-1', x: HALF_W - 2.5, z: 7.9, facing: EAST },
    // the fridge at the counter's south end: in front of it, clear of its door's swing, looking in; two places to wait
    // a turn, and two to stand and eat, face to face
    { id: 'fridge', x: HALF_W - 1.35, z: 8.6, facing: Math.PI / 4 },
    { id: 'fridge-line', x: HALF_W - 2.25, z: 8.75, facing: EAST },
    { id: 'fridge-line-1', x: HALF_W - 3.15, z: 8.6, facing: EAST },
    { id: 'snack-0', x: HALF_W - 2.1, z: 9.6, facing: WEST },
    { id: 'snack-1', x: HALF_W - 2.95, z: 9.45, facing: EAST },
    { id: 'cooler', x: HALF_W - 1.5, z: -9.5, facing: EAST },
    // the couch's seat faces east; you walk up past the south end of the coffee table
    { id: 'couch', x: -HALF_W + 1.9, z: 7.7, facing: WEST, sit: { x: -HALF_W + 1.0, z: 7.3, facing: EAST } },
    ...pongSpots(),
    elevatorSpot(),
    // not the west window at z 8 (the couch) or the east one at z -2 (behind the east wall's desks)
    ...windowSpots([-8, 0], [-8]),
    // in front of each of the shop's big spots, whatever stands there (a vending machine's line, the beer fridge, where
    // to shoot at a hoop from), and out from each wall spot, where to throw at a dartboard from
    ...slotSpots(),
    ...wallSlotSpots(),
  ];
}

/** The lobby: in front of the front desk (where the tour starts), the elevator and the windows. */
function lobbySpots(): Spot[] {
  return [{ id: 'reception', x: RECEPTION.x, z: RECEPTION.z + RECEPTION.d / 2 + 1, facing: NORTH }, elevatorSpot(), ...windowSpots(SIDE_OPENINGS.lobby.west.windows, SIDE_OPENINGS.lobby.east.windows)];
}

/**
 * The CEO's floor: behind their desk, which faces the room (south), where they get up; and for their strolls the
 * lounge, the coffee bar's espresso machine, the globe, the awards wall, the bookcases, the putting green's tee, the
 * fish tank, the chess and pool tables, the week's whiteboard, the elevator and the windows.
 */
function ceoSpots(): Spot[] {
  const g = EXEC_GREEN;
  return [
    { id: 'ceo', x: EXEC_DESK.x, z: EXEC_DESK.z - STAND_BACK, facing: SOUTH },
    { id: 'lounge', x: EXEC_COFFEE.x + 1.3, z: EXEC_COFFEE.z, facing: WEST },
    { id: 'bar', x: EXEC_BAR.x - EXEC_BAR.d / 2 - 0.55, z: EXEC_BAR.z - EXEC_BAR.l / 2 + 0.55, facing: EAST },
    { id: 'globe', x: EXEC_GLOBE.x + 0.9, z: EXEC_GLOBE.z + 0.7, facing: WEST },
    // a step back from the awards wall's shelf, taking it in
    { id: 'awards', x: EXEC_AWARD_SHELF.x + 0.8, z: EXEC_AWARD_SHELF.z - EXEC_AWARD_SHELF.d / 2 - 1.1, facing: SOUTH },
    { id: 'library', x: EXEC_SHELVES.x, z: EXEC_SHELVES.z + EXEC_SHELVES.d / 2 + 0.75, facing: NORTH },
    // on the green's tee, lining up a putt at the hole
    { id: 'putt', x: g.x + g.w / 2 - 0.45, z: g.z, facing: WEST },
    { id: 'fish', x: EXEC_TANK.x, z: EXEC_TANK.z - EXEC_TANK.d / 2 - 0.85, facing: SOUTH },
    // beside the chess table, studying the game; at the pool table's east end
    { id: 'chess', x: EXEC_CHESS.x, z: EXEC_CHESS.z + 1.1, facing: NORTH },
    { id: 'pool', x: EXEC_POOL.x + EXEC_POOL.w / 2 + 0.55, z: EXEC_POOL.z, facing: WEST },
    // between the whiteboard and the table's end chair, reading it
    { id: 'whiteboard', x: EXEC_WEEK.x - 0.95, z: EXEC_WEEK.z, facing: EAST },
    elevatorSpot(),
    // the north-west window's south end (the reading nook has the north end), the middle west one and both east ones
    ...windowSpots([-7.3, SIDE_OPENINGS.ceo.west.windows[1]], SIDE_OPENINGS.ceo.east.windows),
  ];
}

// ---------- the walk grid ----------

/**
 * Everything people steer round: the floor's colliders inside the walls (the balconies are off-limits), the side
 * doorways and, on an office floor, the shop's floor and big spots, filled or not (decor/spots.ts).
 */
export function walkRects(floor: FloorKind): Rect[] {
  const out = (floor === 'office' ? officeColliders() : floor === 'ceo' ? ceoColliders() : lobbyColliders()).filter((r) => Math.abs(r.minX + r.maxX) / 2 < HALF_W + WALL_T);
  for (const side of SIDES) out.push(sideDoorway(floor, side));
  if (floor === 'office') out.push(...reservedRects());
  return out;
}

const cache = new Map<FloorKind, Walkways>();

/** A floor kind's walk grid and named spots (built once, then cached). */
export function walkways(floor: FloorKind): Walkways {
  let w = cache.get(floor);
  if (w) return w;
  // A slightly greedy search: paths get smoothed into straight legs anyway, and it searches far fewer cells.
  const nav = makeNav(walkRects(floor), { planR: WALK_R + 0.1, lineR: WALK_R + 0.03, greed: 1.3 });
  const spots = floor === 'office' ? officeSpots() : floor === 'ceo' ? ceoSpots() : lobbySpots();
  const homes = floor === 'office' ? Array.from({ length: SEATS }, (_, s) => deskSpot(s)) : spots.filter((s) => s.id === 'ceo');
  w = { floor, nav, spots, homes };
  cache.set(floor, w);
  return w;
}

/** The spot called `id` on this floor (desk-N included), or undefined. */
export function spot(w: Walkways, id: string): Spot | undefined {
  return w.spots.find((s) => s.id === id) ?? w.homes.find((s) => s.id === id);
}

/** Whether a person can stand at (x, z). */
export const standable = (w: Walkways, x: number, z: number) => clear(w.nav.rects, x, z, WALK_R);

/**
 * A walk from `from` to `to`: a few straight legs round the furniture, as waypoints after `from` ending at `to`.
 * Null when there's no way through.
 */
export function findPath(w: Walkways, from: Pt, to: Pt): Pt[] | null {
  return planPath(w.nav, from, to);
}

// ---------- getting along ----------

/** Someone else on the floor. */
export interface Body extends Pt {
  id: string;
}

/** A walker this step: where it is and the (unit) direction it wants to go. */
export interface Mover extends Body {
  dx: number;
  dz: number;
}

export interface Steering {
  /** Share of walking speed to go forward at, 0-1. */
  speed: number;
  /** Sideways, as a share of walking speed: + is to the walker's right, (-dz, dx). */
  side: number;
  /** Nothing it can do but stand still and let them pass (replan if it lasts). */
  wait: boolean;
}

const LOOK = 1.8; // how far ahead a walker minds others
const GAP = 0.15; // room it keeps between itself and anyone else

/**
 * Slow down, sidestep or wait for whoever is ahead. Both of two walkers meeting head-on keep right, so they pass;
 * one coming up beside steps away from it. The player is only ever waited for and stepped round, never closed in on:
 * walkers don't collide with the player (and the player's own collisions ignore walkers), so this is the one rule
 * keeping them apart. `open` says whether a person could stand somewhere (walls, furniture).
 */
export function steer(me: Mover, walkers: Body[], player: Pt | null, open: (x: number, z: number) => boolean = () => true): Steering {
  const rx = -me.dz;
  const rz = me.dx;
  const others: [Pt, boolean][] = walkers.filter((o) => o.id !== me.id).map((o) => [o, false]);
  if (player) others.push([player, true]);
  // the nearest one ahead and in its lane
  let b: { ahead: number; lateral: number; min: number; player: boolean } | null = null;
  for (const [o, isPlayer] of others) {
    const ox = o.x - me.x;
    const oz = o.z - me.z;
    const ahead = ox * me.dx + oz * me.dz;
    const lateral = ox * rx + oz * rz;
    const min = WALK_R + (isPlayer ? PLAYER_RADIUS : WALK_R) + GAP;
    if (ahead <= 0 || ahead > LOOK || Math.abs(lateral) >= min) continue;
    if (!b || ahead < b.ahead) b = { ahead, lateral, min, player: isPlayer };
  }
  if (!b) return { speed: 1, side: 0, wait: false };

  // Ease off as they get closer, stopping a gap short; step away from their side (keep right when dead ahead).
  const room = Math.max(0, b.ahead - Math.sqrt(Math.max(0, b.min * b.min - b.lateral * b.lateral)));
  const speed = Math.min(1, room / (LOOK - b.min));
  const pref = Math.abs(b.lateral) < 0.05 ? 1 : -Math.sign(b.lateral);
  const step = 0.4;
  for (const dir of [pref, -pref]) {
    if (dir === -pref && Math.abs(b.lateral) >= 0.05 && !b.player) continue; // don't cut across a walker's path
    if (open(me.x + rx * dir * step, me.z + rz * dir * step)) return { speed, side: dir * 0.7, wait: false };
  }
  return { speed, side: 0, wait: speed === 0 };
}

/** Slowed to under this share of walking speed with nowhere to step aside: as good as standing still. */
export const CRAWL = 0.15;

/**
 * How long a walker has been held up behind someone, after this step (`waited` before it). Waiting outright counts, and
 * so does crawling: slowed nearly to a stop with its sidestep blocked, it inches up until the spot it aims for is too
 * close to walk to (body.ts) and stalls there, a little short of stopping, so it would never count as waiting (nor walk
 * on through). Walking on, or stepping aside, starts the count again.
 */
export const heldUp = (waited: number, s: Steering, dt: number) => (s.wait || (s.side === 0 && s.speed < CRAWL) ? waited + dt : 0);
