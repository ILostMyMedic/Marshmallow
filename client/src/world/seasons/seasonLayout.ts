// Where the seasons' things go (seasons/ draws them), as plain numbers: the lobby's Christmas tree, its wreath and the
// pumpkins by the elevator; up on the roof the snowman, the paddling pool and its umbrella, the pumpkins at the hut's
// door; the snow lying on the roof's ledges and beds and on the balconies' rails; the lights along the balconies and
// the parapet; and the trees' colours through the year. What stands on the floor where people walk blocks the player
// (seasonColliders, which Game.tsx adds to the floor's own), kept clear of every walk, seat and doorway (tested). The
// roof's west half north of the fire is left free. Pure. Units are metres in the floor's frame (layout.ts).
import type { SeasonLook, Foliage } from '../../../../shared/seasons';
import { BALCONY, BALCONY_OUT, FLOOR_HEIGHT, HALF_D, PLANTER, SIDES, balconyFurniture, rect, sideSign, type FloorKind, type Rect } from '../layout';
import { BED_H, GARDEN_BEDS, PICNIC, ROOF_EDGE, ROOF_HUT, TREE_PLANTERS, WATER_TANK } from '../roof/roofLayout';

type V3 = [number, number, number];

/** An axis-aligned box: its size and its middle (shapes.ts's BoxSpec, without three.js). */
export interface Slab {
  size: V3;
  at: V3;
}

// ---------- the lobby ----------

/** The Christmas tree in the lobby's south-west, seen through the west window: its foot, height, and presents round it. */
export const XMAS_TREE = { x: -10.2, z: 7.0, h: 3.1, base: 2.6 };
/** Wreaths either side of the floor's sign over the elevator's doors (lobby and roof alike), on the south wall. */
export const DOOR_WREATHS = { xs: [-1.15, 1.15], y: 2.98, z: HALF_D - 0.03, r: 0.24 };
/** Jack-o'-lanterns either side of the elevator's doors (lobby and roof alike): middle and radius. */
export const DOOR_PUMPKINS = [
  { x: -1.95, z: HALF_D - 0.3, r: 0.26 },
  { x: -2.42, z: HALF_D - 0.24, r: 0.17 },
  { x: 1.95, z: HALF_D - 0.3, r: 0.24 },
];
/** On the front desk's ledge (RECEPTION): x along it, the ledge's height. */
export const LEDGE_PUMPKINS = { xs: [-0.55, 0.65], y: 1.11 };

// ---------- the roof ----------

/** The snowman in the south-west corner, looking east at whoever steps out of the elevator. */
export const SNOWMAN = { x: -14.5, z: 10.2, yaw: Math.PI / 2 };
/** Summer's paddling pool in the same corner, and the beach umbrella shading the deck beside it. */
export const POOL = { x: -13.5, z: 9.9, r: 1.25, h: 0.38 };
export const UMBRELLA = { x: -11.4, z: 8.2, h: 2.25, r: 1.4 };

const piece = (x: number, z: number, w: number, d: number) => rect(x, z, w, d);

/**
 * What the season puts in the way on a floor of `kind` (the player bumps into it; people's walks already keep clear of
 * where it stands).
 */
export function seasonColliders(kind: FloorKind | 'roof', look: Pick<SeasonLook, 'christmas' | 'pumpkins' | 'snowCover' | 'summer'>): Rect[] {
  const out: Rect[] = [];
  if (kind === 'lobby') {
    if (look.christmas) out.push(piece(XMAS_TREE.x, XMAS_TREE.z, XMAS_TREE.base, XMAS_TREE.base));
    if (look.pumpkins) out.push(...DOOR_PUMPKINS.map((p) => piece(p.x, p.z, p.r * 2, p.r * 2)));
  } else if (kind === 'roof') {
    if (look.snowCover > 0.5) out.push(piece(SNOWMAN.x, SNOWMAN.z, 1.05, 1.05));
    if (look.summer) out.push(piece(POOL.x, POOL.z, POOL.r * 2, POOL.r * 2), piece(UMBRELLA.x, UMBRELLA.z, 0.2, 0.2));
    if (look.pumpkins) out.push(...DOOR_PUMPKINS.map((p) => piece(p.x, p.z, p.r * 2, p.r * 2)));
  }
  return out;
}

/** Pumpkins sitting on things up on the roof (the garden beds, the picnic table): no collider needed. */
export const ROOF_TOP_PUMPKINS: { x: number; y: number; z: number; r: number }[] = [
  ...GARDEN_BEDS.map((b, i) => ({ x: b.minX + 0.6 + i * 0.3, y: BED_H, z: (b.minZ + b.maxZ) / 2 + 0.15, r: 0.2 })),
  { x: PICNIC.x - 0.5, y: PICNIC.h + 0.035, z: PICNIC.z, r: 0.17 },
];

// ---------- lying snow ----------

const { x: X, z: Z, t: T, parapet: P, h: H } = ROOF_EDGE;
/** The parapet's runs round the roof (south: either side of the hut), as RoofDeck.tsx draws them: [x0, x1, z0, z1]. */
export const PARAPET_RUNS: [number, number, number, number][] = [
  [-X, X, -Z, -Z + T],
  [-X, -X + T, -Z + T, Z - T],
  [X - T, X, -Z + T, Z - T],
  [-X, ROOF_HUT.minX, Z - T, Z],
  [ROOF_HUT.maxX, X, Z - T, Z],
];

/** Snow along the roof's ledges: the parapet's cap and handrail, the beds, the planters, the picnic table, the hut's roof. */
export function roofSnow(): Slab[] {
  const out: Slab[] = [];
  for (const [x0, x1, z0, z1] of PARAPET_RUNS) {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const along = x1 - x0 > z1 - z0;
    out.push({ size: [x1 - x0 + 0.04, 0.07, z1 - z0 + 0.04], at: [cx, P + 0.1, cz] });
    out.push({ size: along ? [x1 - x0, 0.05, 0.11] : [0.11, 0.05, z1 - z0], at: [cx, H + 0.055, cz] });
  }
  for (const b of GARDEN_BEDS) out.push({ size: [b.maxX - b.minX + 0.06, 0.08, b.maxZ - b.minZ + 0.06], at: [(b.minX + b.maxX) / 2, BED_H + 0.03, (b.minZ + b.maxZ) / 2] });
  for (const p of TREE_PLANTERS) out.push({ size: [p.w + 0.06, 0.07, p.w + 0.06], at: [p.x, p.h + 0.03, p.z] });
  out.push({ size: [PICNIC.w, 0.05, 0.8], at: [PICNIC.x, PICNIC.h + 0.055, PICNIC.z] });
  for (const dz of [-1, 1]) out.push({ size: [PICNIC.w, 0.04, 0.3], at: [PICNIC.x, 0.49, PICNIC.z + dz * (PICNIC.d / 2 - 0.15)] });
  const hut = ROOF_HUT;
  out.push({ size: [hut.maxX - hut.minX + 0.36, 0.12, hut.maxZ - HALF_D + 0.36], at: [(hut.minX + hut.maxX) / 2, hut.h + 0.26, (HALF_D + hut.maxZ) / 2] });
  return out;
}

/** The water tank's hat, for its snowy cap: the tank's middle, the cone's radius, and where its top is. */
export const TANK_CAP = { x: WATER_TANK.x, z: WATER_TANK.z, r: WATER_TANK.r * 1.12, y: WATER_TANK.legs + WATER_TANK.h };

/** The roof's little trees' crowns (Garden.tsx), for their snowy, turning or blossoming tops: middle and radius. */
export const ROOF_CROWNS = TREE_PLANTERS.map((p) => ({ x: p.x, y: p.h + 1.75, z: p.z, r: 0.75 }));
/** The two smaller balls of leaves on each of them (Garden.tsx's too). */
export const ROOF_LEAF_BALLS = TREE_PLANTERS.flatMap((p) => [
  { x: p.x + 0.45, y: p.h + 1.45, z: p.z + 0.2, r: 0.5 },
  { x: p.x - 0.4, y: p.h + 1.5, z: p.z - 0.25, r: 0.45 },
]);

/**
 * Snow along the balconies' outer rails, every floor from the street up to yours (`floor` storeys up; the ones above
 * are cut away in the overview), and on your floor's planters. In your floor's frame.
 */
export function balconySnow(kind: FloorKind, floor: number): Slab[] {
  const out: Slab[] = [];
  const len = BALCONY.maxZ - BALCONY.minZ;
  const mid = (BALCONY.minZ + BALCONY.maxZ) / 2;
  for (let f = 1; f <= floor; f++) {
    const y = (f - floor) * FLOOR_HEIGHT + BALCONY.rail;
    for (const side of SIDES) out.push({ size: [BALCONY.railT + 0.07, 0.05, len], at: [sideSign(side) * (BALCONY_OUT - BALCONY.railT / 2), y + 0.025, mid] });
  }
  for (const side of SIDES)
    for (const p of balconyFurniture(kind, side).planters) out.push({ size: [PLANTER.w + 0.08, 0.06, PLANTER.l + 0.08], at: [(p.minX + p.maxX) / 2, PLANTER.h + 0.03, (p.minZ + p.maxZ) / 2] });
  return out;
}

/** The lights along the balconies' outer rails, every floor up to yours (`floor` storeys up): a bulb every 0.5 m. */
export function balconyLights(floor: number): V3[] {
  const out: V3[] = [];
  const n = Math.round((BALCONY.maxZ - BALCONY.minZ) / 0.5);
  for (let f = 0; f <= floor; f++) {
    const y = (f - floor) * FLOOR_HEIGHT + BALCONY.rail - 0.06;
    for (const side of SIDES) {
      const x = sideSign(side) * (BALCONY_OUT + 0.02);
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n;
        // in swags between the posts, a post every tenth of the rail
        const sag = 0.08 * Math.sin(Math.PI * ((u * 10) % 1));
        out.push([x, y - sag, BALCONY.minZ + u * (BALCONY.maxZ - BALCONY.minZ)]);
      }
    }
  }
  return out;
}

/** The lights along the roof's handrail, all the way round: a bulb every 0.55 m. */
export function parapetLights(): V3[] {
  const out: V3[] = [];
  for (const [x0, x1, z0, z1] of PARAPET_RUNS) {
    const along = x1 - x0 > z1 - z0;
    const len = along ? x1 - x0 : z1 - z0;
    const n = Math.max(2, Math.round(len / 0.55));
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n;
      out.push(along ? [x0 + u * (x1 - x0), H - 0.07, (z0 + z1) / 2] : [(x0 + x1) / 2, H - 0.07, z0 + u * (z1 - z0)]);
    }
  }
  return out;
}

// ---------- the trees ----------

const BLOSSOM = [0xf7b6d2, 0xfcd5e5, 0xf4a7c8, 0xfff0f5];
const AUTUMN = [0xe07a2f, 0xc8442f, 0xf2b632, 0xb5652b, 0xd9922e];
const TURNING = [0x7fae4a, 0xc9a43a, 0x5fa84f, 0xd98a2e];
const WINTRY = [0x4f7f5a, 0x5b8a63, 0x47735a];

/** A tree crown's colour (`color`, as the city has it) in the season, the `i`-th tree picking from the season's own. */
export function foliageColor(color: number, foliage: Foliage, i: number): number {
  const k = Math.abs(i * 7 + (color % 13));
  switch (foliage) {
    case 'blossom':
      // most trees in bloom, a few just green
      return k % 5 === 4 ? color : BLOSSOM[k % BLOSSOM.length];
    case 'autumn':
      return AUTUMN[k % AUTUMN.length];
    case 'turning':
      return TURNING[k % TURNING.length];
    case 'wintry':
      return WINTRY[k % WINTRY.length];
    case 'green':
      return color;
  }
}

/** A park lawn's colour in the season: greenest in summer, straw in autumn. */
export function lawnColor(color: number, foliage: Foliage): number {
  return foliage === 'autumn' ? 0xb7b65a : foliage === 'turning' ? 0xa3bd62 : foliage === 'wintry' ? 0x9db08a : color;
}
