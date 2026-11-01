// Where each of an office floor's shop spots (shared/shop.ts SHOP_SPOTS, by the same ids) is in the room, the most room
// an item there may take, where a bought item stands in it and what it blocks. The floor and big spots are reserved in
// the walk grid whether they're filled or not (walkways.ts builds it once per floor kind), so nothing ever walks through
// a later purchase; each big spot also has named places in front of it for the errands (a vending machine's line). Pure,
// so it's tested (spots.test.ts): clear of the furniture, the walkways, the windows and each other, with every desk and
// named spot still reachable when every spot is full. Decor.tsx draws what a floor has bought.
// Adapted from cubefarm client/src/world/layout.ts DECOR_SLOT_AT and decor/decor.ts (MIT): the slots, placement,
// footprints and reserved rects; the decor box, carrying things about and the slot markers are cut.
import { SHOP_SPOTS, spotOf, type SpotKind } from '../../../../shared/shop';
import type { FloorItem } from '../../../../shared/types';
import { HALF_D, HALF_W, PONG_TABLE, type Rect } from '../layout';

export interface SpotPlace {
  /** The middle of its footprint; a wall spot's middle on the wall's face, `y` up. */
  x: number;
  z: number;
  /** Turns an item's front (its local +z) to face the room. */
  rotY: number;
  /** The most room an item there may take: w across its front, d front to back (a wall spot: w along the wall). */
  w: number;
  d: number;
  y?: number;
}

/** rotY for an item facing that way. */
export const FACE = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 } as const;

const BIG = { w: 2.6, d: 0.95 };
const SMALL = { w: 1.2, d: 0.9 };
const WALL = { w: 1.6, d: 0.08, y: 2.35 };

/** Every spot but the kit's (the default furniture stays where it always was). */
export const SPOT_AT: Record<string, SpotPlace> = {
  // against the north wall between the fig's spot and the cooler; against the south wall by the ping-pong table and the
  // kitchenette
  'big-1': { x: 11.4, z: -HALF_D + BIG.d / 2, rotY: FACE.south, ...BIG },
  'big-2': { x: -12.4, z: HALF_D - BIG.d / 2, rotY: FACE.north, ...BIG },
  'big-3': { x: 8.5, z: HALF_D - BIG.d / 2, rotY: FACE.north, ...BIG },
  // either side of the elevator, the west wall between its windows (south of the couch), the north wall east of the board
  'floor-1': { x: -4.5, z: 11, rotY: FACE.north, ...SMALL },
  'floor-2': { x: 4.5, z: 11, rotY: FACE.north, ...SMALL },
  'floor-3': { x: -HALF_W + SMALL.d / 2, z: 2.9, rotY: FACE.east, ...SMALL },
  'floor-4': { x: 8.6, z: -HALF_D + SMALL.d / 2, rotY: FACE.south, ...SMALL },
  // under the couch and the coffee table, and under the ping-pong table and where its players stand
  'rug-1': { x: -14.05, z: 6.5, rotY: FACE.south, w: 3.5, d: 3.8 },
  'rug-2': { x: PONG_TABLE.x, z: PONG_TABLE.z, rotY: FACE.south, w: 5.4, d: 2.8 },
  // the north wall over the little plant east of the board and past the big spot; the south wall either side of the
  // elevator; the west wall between its windows, over the couch's end
  'wall-1': { x: 7.2, z: -HALF_D, rotY: FACE.south, ...WALL },
  'wall-2': { x: 14.4, z: -HALF_D, rotY: FACE.south, ...WALL },
  'wall-3': { x: -6.5, z: HALF_D, rotY: FACE.north, ...WALL },
  'wall-4': { x: 6.1, z: HALF_D, rotY: FACE.north, ...WALL },
  'wall-5': { x: -HALF_W, z: 4.8, rotY: FACE.east, ...WALL },
};

/** A spot's kind, or undefined for an id the shop doesn't know. */
export const kindOf = (id: string): SpotKind | undefined => spotOf(id)?.kind;
const standsOnFloor = (kind: SpotKind | undefined) => kind === 'floor' || kind === 'big';

/** The spots with a place in the room (all but the kit's), in SHOP_SPOTS's order. */
export const PLACED_SPOTS = SHOP_SPOTS.filter((s) => s.kind !== 'kit').map((s) => s.id);

// ---------- items ----------

/** An item's size in its own frame: w across its front, d front to back, h tall. */
export interface ItemSize {
  w: number;
  d: number;
  h: number;
}

/** Every extra's size (a rug fills its spot: itemSize). */
export const ITEM_SIZE: Record<string, ItemSize> = {
  'vending-machine': { w: 1.05, d: 0.85, h: 1.95 },
  'beer-fridge': { w: 0.9, d: 0.8, h: 1.85 },
  sofa: { w: 2.3, d: 0.92, h: 1.0 },
  plant: { w: 0.72, d: 0.72, h: 1.55 },
  fig: { w: 0.9, d: 0.9, h: 2.15 },
  beanbags: { w: 1.15, d: 0.8, h: 0.7 },
  poster: { w: 1.0, d: 0.05, h: 1.3 },
  neon: { w: 1.5, d: 0.06, h: 0.5 },
};

/** What the player bumps into: the pots, not the leaves; everything else, all of it. */
const SOLID: Record<string, { w: number; d: number }> = { plant: { w: 0.5, d: 0.5 }, fig: { w: 0.55, d: 0.55 } };

/** An item's size in `spot`: a rug fills it, less a margin. */
export function itemSize(item: string, spot?: string): ItemSize {
  if (item === 'rug') {
    const s = spot ? SPOT_AT[spot] : undefined;
    return { w: (s?.w ?? 3) - 0.1, d: (s?.d ?? 2) - 0.1, h: 0.01 };
  }
  return ITEM_SIZE[item] ?? { w: 0.6, d: 0.6, h: 1 };
}

/** The front of a spot (its rotY) as a unit direction on the floor. */
const front = (rotY: number) => ({ x: Math.sin(rotY), z: Math.cos(rotY) });

/**
 * Where `item` in `spot` stands: the middle of its footprint (a big one backs onto its wall, a wall one hangs on its wall
 * with y its middle), facing rotY. Null for a spot without a place (the kit's, or an unknown id).
 */
export function placement(spot: string, item: string): { x: number; y: number; z: number; rotY: number } | null {
  const s = SPOT_AT[spot];
  if (!s) return null;
  const size = itemSize(item, spot);
  const kind = kindOf(spot);
  const out = kind === 'big' ? (size.d - s.d) / 2 : kind === 'wall' ? size.d / 2 : 0;
  const f = front(s.rotY);
  return { x: s.x + f.x * out, y: kind === 'wall' ? (s.y ?? WALL.y) : 0, z: s.z + f.z * out, rotY: s.rotY };
}

/** The axis-aligned footprint of a w x d box at (x, z), turned by rotY (a quarter turn swaps its sides). */
export function footprint(x: number, z: number, w: number, d: number, rotY: number): Rect {
  const c = Math.abs(Math.cos(rotY));
  const s = Math.abs(Math.sin(rotY));
  const hx = (w * c + d * s) / 2;
  const hz = (w * s + d * c) / 2;
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}

/** A spot's whole footprint (a wall spot's: the strip of wall it hangs on, d deep). */
export function spotRect(id: string): Rect | null {
  const s = SPOT_AT[id];
  if (!s) return null;
  const f = front(s.rotY);
  const out = kindOf(id) === 'wall' ? s.d / 2 : 0;
  return footprint(s.x + f.x * out, s.z + f.z * out, s.w, s.d, s.rotY);
}

/** What `item` in `spot` blocks; null for what you walk over or past (rugs, wall art) and for a spot without a place. */
export function itemRect(spot: string, item: string): Rect | null {
  if (!standsOnFloor(kindOf(spot))) return null;
  const p = placement(spot, item);
  if (!p) return null;
  const solid = SOLID[item] ?? itemSize(item, spot);
  return footprint(p.x, p.z, solid.w, solid.d, p.rotY);
}

/** What a floor's plan blocks: every bought item standing on the floor (the player's colliders). */
export function planRects(plan: readonly FloorItem[]): Rect[] {
  return plan.map((i) => itemRect(i.spot, i.item)).filter((r): r is Rect => !!r);
}

/** Every floor and big spot, filled or not: people plan their walks round these (walkways.ts). */
export function reservedRects(): Rect[] {
  return PLACED_SPOTS.filter((id) => standsOnFloor(kindOf(id))).map((id) => spotRect(id)!);
}

/** The bought extras of a plan that have a place in the room (the kit is drawn where it always was). */
export const placedItems = (plan: readonly FloorItem[] | undefined) => (plan ?? []).filter((i) => SPOT_AT[i.spot] && kindOf(i.spot) !== 'kit');

/** The tier of a kit item on a floor (1 when the plan doesn't say). */
export const kitTier = (plan: readonly FloorItem[] | undefined, item: string) => plan?.find((i) => i.item === item)?.tier ?? 1;

// ---------- where people stand at a big spot ----------

/** A named place for walkways.ts (its Spot, without the import): where to stand and which way to face (0 east, π/2 south). */
export interface SlotSpot {
  id: string;
  x: number;
  z: number;
  facing: number;
}

/** In a spot's own frame: u along its front (its local +x), v out from it into the room. */
function local(s: SpotPlace, u: number, v: number) {
  const c = Math.cos(s.rotY);
  const n = Math.sin(s.rotY);
  return { x: s.x + u * c + v * n, z: s.z - u * n + v * c };
}

/** walkways.ts's facing for a direction on the floor. */
const facingOf = (dx: number, dz: number) => Math.atan2(dz, dx);

/** How far out from a big spot's front edge its front place is, and where the line and the two places to stand and drink are. */
export const SLOT_REACH = { front: 0.55, line: { u: 0.9, v: 0.95 }, sip: { u: [-1.0, -1.95], v: 1.1 } };

/**
 * Each big spot's places, whatever stands in it: `<id>-front` (at the machine, facing it), `<id>-line` (waiting a turn,
 * off to one side) and `<id>-sip-0`/`-1` (face to face on the other side, to drink or eat at).
 */
export function slotSpots(): SlotSpot[] {
  const out: SlotSpot[] = [];
  for (const id of PLACED_SPOTS.filter((x) => kindOf(x) === 'big')) {
    const s = SPOT_AT[id];
    const f = front(s.rotY);
    const toward = facingOf(-f.x, -f.z);
    const along = { x: Math.cos(s.rotY), z: -Math.sin(s.rotY) };
    const edge = s.d / 2;
    const at = (u: number, v: number) => local(s, u, v);
    const { line, sip } = SLOT_REACH;
    out.push({ id: `${id}-front`, ...at(0, edge + SLOT_REACH.front), facing: toward });
    out.push({ id: `${id}-line`, ...at(line.u, edge + line.v), facing: toward });
    out.push({ id: `${id}-sip-0`, ...at(sip.u[0], edge + sip.v), facing: facingOf(-along.x, -along.z) });
    out.push({ id: `${id}-sip-1`, ...at(sip.u[1], edge + sip.v), facing: facingOf(along.x, along.z) });
  }
  return out;
}

/**
 * The walk spots of big spot `id`, by their errand names. The far place to drink at is handed out first, so whoever
 * comes second never has to squeeze past the first standing at the near one.
 */
export const slotSpotIds = (id: string) => ({ front: `${id}-front`, line: [`${id}-line`] as readonly string[], eat: [`${id}-sip-1`, `${id}-sip-0`] as readonly string[] });
