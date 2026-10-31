// The red suspension bridge far out to the west, and the bay it spans (Bridge.tsx draws them): a stylized Golden Gate
// across the strait between two headlands beyond the city's shore, with its two towers and their stepped portals, the
// main cables hanging between them, the suspenders and the deck, and the hills behind. Pure (plain numbers, and the
// vertices they make), so the tests check it hangs together and stays a few hundred triangles. Units and axes as
// cityLayout.ts: metres, x/z round our building, y up from street level. The bridge runs along z.

import { BAY, type CityBox } from './cityLayout';

export const BRIDGE = {
  /** The deck's centreline. */
  x: -600,
  /** The middle of the main span. */
  z: -30,
  /** Tower to tower, and each side span, tower to anchorage. */
  main: 320,
  side: 110,
  /** The road's top, and how deep the deck's truss is under it. */
  deckY: 25,
  deckDepth: 4.5,
  /** Between the two cables, and the towers' two legs. */
  width: 20,
  towerTop: 112,
  /** The towers' concrete piers stand this high out of the water. */
  pierTop: 7,
};

/** The bay's surface, a step down from the street. */
export const WATER_Y = -1.2;
/** How far a suspender hangs from the next, along the deck. */
export const HANGER_STEP = 16;
/** The side spans' cables sag this far below a straight line. */
const SIDE_SAG = 6;

/**
 * The water, from the shore out past the horizon (the camera's far plane, 900 m, cuts it off well before its edge).
 * Everything that stands up out of it stays inside 840 m of the building, so the far plane never slices a hill.
 */
export const SEA = { minX: -1500, maxX: BAY.shore, minZ: -1500, maxZ: 1500 };

/** The two headlands the bridge lands on, north and south of the strait: convex outlines (x, z), at street level. */
export const HEADLANDS: readonly (readonly [number, number])[][] = [
  [
    [BAY.shore, -1500],
    [BAY.shore, -272],
    [-560, -266],
    [-700, -290],
    [-1500, -440],
    [-1500, -1500],
  ],
  [
    [BAY.shore, 1500],
    [-1500, 1500],
    [-1500, 360],
    [-780, 240],
    [-600, 212],
    [BAY.shore, 216],
  ],
];

const ORANGE = 0xc8442f;
const ORANGE_DEEP = 0xa9382a;
const CONCRETE = 0xd6cfc2;
const ROAD = 0x6b6f78;
const WATER = 0x5ba7d1;
const LAND = 0xd9d2c4; // the city's ground, so the shore and the headlands meet without a seam
const HILLS_NORTH = [0xb3a86e, 0x9aa565, 0xa39a62];
const HILLS_SOUTH = [0x6f9a58, 0x7da866];

/** A cable or a suspender: a strip through `points` (z, y) at x, `thick` wide. */
export interface Strand {
  x: number;
  points: [number, number][];
  thick: number;
  color: number;
}

export interface BridgeLayout {
  /** The towers (piers, legs, portals, caps), the deck and the anchorages, as cityLayout.ts boxes (y is the bottom). */
  boxes: CityBox[];
  /** The headlands' hills, as cones (w and d are diameters). */
  hills: CityBox[];
  cables: Strand[];
  hangers: Strand[];
  /** Where the towers and the anchorages stand, along z. */
  towers: [number, number];
  anchors: [number, number];
}

const towersZ = (): [number, number] => [BRIDGE.z - BRIDGE.main / 2, BRIDGE.z + BRIDGE.main / 2];
const anchorsZ = (): [number, number] => [BRIDGE.z - BRIDGE.main / 2 - BRIDGE.side, BRIDGE.z + BRIDGE.main / 2 + BRIDGE.side];

/** Where the main cables rest on the towers' saddles, sag to over the middle of the deck, and go into the anchorages. */
export const CABLE = { top: BRIDGE.towerTop - 1.5, low: BRIDGE.deckY + 2.5, anchor: BRIDGE.deckY + 1.5 };

/** The main cables' height at `z`: a parabola across the main span, a slight sag down each side span; NaN off the bridge. */
export function cableY(z: number): number {
  const [tn, ts] = towersZ();
  const [an, as] = anchorsZ();
  if (z >= tn && z <= ts) {
    const u = (z - BRIDGE.z) / (BRIDGE.main / 2);
    return CABLE.low + (CABLE.top - CABLE.low) * u * u;
  }
  if (z >= an && z < tn) return side((z - an) / (tn - an));
  if (z > ts && z <= as) return side((as - z) / (as - ts));
  return NaN;
}

/** Along a side span, 0 at the anchorage and 1 at the tower. */
const side = (u: number) => CABLE.anchor + (CABLE.top - CABLE.anchor) * u - SIDE_SAG * 4 * u * (1 - u);

/** A tower's legs: three sections, each thinner than the one below (w across the deck, d along it). */
const LEG = [
  { top: 50, w: 4.6, d: 7.6 },
  { top: 82, w: 3.9, d: 6.4 },
  { top: BRIDGE.towerTop, w: 3.2, d: 5.2 },
];
/** The struts between the legs, bottom up: one under the deck, four portals above it, the last at the very top. */
const PORTALS = [
  { y: BRIDGE.deckY - BRIDGE.deckDepth - 7, h: 4, step: false },
  { y: 44, h: 6, step: true },
  { y: 76, h: 6, step: true },
  { y: 96, h: 5, step: true },
  { y: BRIDGE.towerTop - 6, h: 6, step: true },
];

const legAt = (y: number) => LEG.find((l) => y < l.top) ?? LEG[LEG.length - 1];

/** The bridge and its hills. */
export function bridgeLayout(): BridgeLayout {
  const boxes: CityBox[] = [];
  const { x, width, deckY, deckDepth, pierTop, towerTop } = BRIDGE;
  const towers = towersZ();
  const anchors = anchorsZ();
  const box = (bx: number, y: number, z: number, w: number, h: number, d: number, color: number) => boxes.push({ x: bx, y, z, w, h, d, color });

  for (const z of towers) {
    box(x, WATER_Y - 0.5, z, width + 12, pierTop - WATER_Y + 0.5, 18, CONCRETE);
    for (const lx of [x - width / 2, x + width / 2]) {
      let y = pierTop;
      for (const l of LEG) {
        box(lx, y, z, l.w, l.top - y, l.d, ORANGE);
        y = l.top;
      }
      box(lx, towerTop, z, LEG[2].w + 0.4, 2.2, LEG[2].d + 0.6, ORANGE_DEEP); // the cable saddle's housing
    }
    for (const p of PORTALS) {
      const leg = legAt(p.y);
      box(x, p.y, z, width, p.h, leg.d * 0.55, ORANGE);
      // the stepped Art Deco panel set into each portal above the deck
      if (p.step) box(x, p.y - 1.2, z, width - 5, p.h + 2.4, leg.d * 0.32, ORANGE_DEEP);
    }
  }
  // the deck's truss, end to end into the anchorages, with the road on top
  const deckFrom = anchors[0] - 6;
  const deckTo = anchors[1] + 6;
  box(x, deckY - deckDepth, (deckFrom + deckTo) / 2, width + 2, deckDepth, deckTo - deckFrom, ORANGE_DEEP);
  box(x, deckY, (deckFrom + deckTo) / 2, width - 2, 0.3, deckTo - deckFrom, ROAD);
  for (const z of anchors) box(x, 0, z, width + 10, deckY + 4, 22, CONCRETE);

  const cables: Strand[] = [];
  const hangers: Strand[] = [];
  for (const cx of [x - width / 2, x + width / 2]) {
    const points: [number, number][] = [];
    const span = (from: number, to: number, n: number) => {
      for (let i = 0; i <= n; i++) {
        const z = from + ((to - from) * i) / n;
        if (!points.length || points[points.length - 1][0] !== z) points.push([z, cableY(z)]);
      }
    };
    span(anchors[0], towers[0], 5);
    span(towers[0], towers[1], 16);
    span(towers[1], anchors[1], 5);
    cables.push({ x: cx, points, thick: 1.4, color: ORANGE });
    // suspenders from the cable to the deck, wherever there's a few metres between them
    for (let z = anchors[0] + HANGER_STEP; z < anchors[1]; z += HANGER_STEP) {
      if (Math.min(...towers.map((t) => Math.abs(z - t))) < 8) continue;
      const top = cableY(z);
      if (top - deckY > 2.5)
        hangers.push({
          x: cx,
          points: [
            [z, deckY],
            [z, top],
          ],
          thick: 0.8,
          color: ORANGE,
        });
    }
  }

  const hill = (hx: number, hz: number, r: number, h: number, color: number) => ({ x: hx, z: hz, y: 0, w: r * 2, h, d: r * 2, color });
  const hills = [
    hill(-640, -410, 70, 65, HILLS_NORTH[0]),
    hill(-520, -470, 60, 42, HILLS_NORTH[1]),
    hill(-700, -330, 55, 50, HILLS_NORTH[2]),
    hill(-660, 300, 60, 18, HILLS_SOUTH[0]),
    hill(-540, 330, 50, 14, HILLS_SOUTH[1]),
    hill(-760, 250, 40, 22, HILLS_SOUTH[0]),
  ];
  return { boxes, hills, cables, hangers, towers, anchors };
}

// ---------- vertices ----------

type V3 = [number, number, number];

/** Triangles to draw, with flat normals and a colour (0xrrggbb) per vertex. */
export interface MeshData {
  positions: number[];
  normals: number[];
  colors: number[];
  /** How many triangles. */
  triangles: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Collects triangles, each wound to face along its normal. */
class Builder implements MeshData {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  triangles = 0;

  tri(a: V3, b: V3, c: V3, n: V3, color: number) {
    const [p, q] = dot(cross(sub(b, a), sub(c, a)), n) >= 0 ? [b, c] : [c, b];
    for (const v of [a, p, q]) {
      this.positions.push(...v);
      this.normals.push(...n);
      this.colors.push(color);
    }
    this.triangles++;
  }

  quad(a: V3, b: V3, c: V3, d: V3, n: V3, color: number) {
    this.tri(a, b, c, n, color);
    this.tri(a, c, d, n, color);
  }
}

/** A box's six faces. */
function addBox(m: Builder, b: CityBox) {
  const x0 = b.x - b.w / 2;
  const x1 = b.x + b.w / 2;
  const z0 = b.z - b.d / 2;
  const z1 = b.z + b.d / 2;
  const y0 = b.y;
  const y1 = b.y + b.h;
  m.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], b.color);
  m.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], b.color);
  m.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], b.color);
  m.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], b.color);
  m.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], b.color);
  m.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], b.color);
}

/** A strand as a strip facing east (towards the city) and, for the thick cables, another facing up (for the roof). */
function addStrand(m: Builder, s: Strand, flat: boolean) {
  const t = s.thick / 2;
  for (let i = 1; i < s.points.length; i++) {
    const [za, ya] = s.points[i - 1];
    const [zb, yb] = s.points[i];
    if (za === zb) {
      // a vertical one: as wide along z as it is thick
      m.quad([s.x, ya, za - t], [s.x, ya, za + t], [s.x, yb, zb + t], [s.x, yb, zb - t], [1, 0, 0], s.color);
      continue;
    }
    m.quad([s.x, ya - t, za], [s.x, yb - t, zb], [s.x, yb + t, zb], [s.x, ya + t, za], [1, 0, 0], s.color);
    if (flat) m.quad([s.x - t, ya, za], [s.x - t, yb, zb], [s.x + t, yb, zb], [s.x + t, ya, za], [0, 1, 0], s.color);
  }
}

const HILL_SIDES = 10;

/** A hill: a cone's sides (its base is in the ground), each facet flat. */
function addHill(m: Builder, h: CityBox) {
  const apex: V3 = [h.x, h.y + h.h, h.z];
  for (let i = 0; i < HILL_SIDES; i++) {
    const a0 = (i / HILL_SIDES) * Math.PI * 2;
    const a1 = ((i + 1) / HILL_SIDES) * Math.PI * 2;
    const p: V3 = [h.x + (Math.cos(a0) * h.w) / 2, h.y, h.z + (Math.sin(a0) * h.d) / 2];
    const q: V3 = [h.x + (Math.cos(a1) * h.w) / 2, h.y, h.z + (Math.sin(a1) * h.d) / 2];
    let n = cross(sub(q, p), sub(apex, p));
    if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
    const l = Math.hypot(...n);
    m.tri(apex, p, q, [n[0] / l, n[1] / l, n[2] / l], h.color);
  }
}

/** A flat, convex outline at height y, facing up. */
function addFlat(m: Builder, outline: readonly (readonly [number, number])[], y: number, color: number) {
  const [x0, z0] = outline[0];
  for (let i = 2; i < outline.length; i++) m.tri([x0, y, z0], [outline[i - 1][0], y, outline[i - 1][1]], [outline[i][0], y, outline[i][1]], [0, 1, 0], color);
}

/** The bridge's own triangles and its hills', all one mesh. */
export function bridgeMesh(layout: BridgeLayout): MeshData {
  const m = new Builder();
  for (const b of layout.boxes) addBox(m, b);
  for (const c of layout.cables) addStrand(m, c, true);
  for (const h of layout.hangers) addStrand(m, h, false);
  for (const h of layout.hills) addHill(m, h);
  return m;
}

/** The bay's water, the headlands and the embankment along the city's shore, one mesh under the city's own haze. */
export function bayMesh(): MeshData {
  const m = new Builder();
  addFlat(
    m,
    [
      [SEA.minX, SEA.minZ],
      [SEA.maxX, SEA.minZ],
      [SEA.maxX, SEA.maxZ],
      [SEA.minX, SEA.maxZ],
    ],
    WATER_Y,
    WATER,
  );
  for (const h of HEADLANDS) addFlat(m, h, 0, LAND);
  // the city's shore between the headlands: a stone face down to the water
  addBox(m, { x: BAY.shore - 0.75, y: WATER_Y - 0.2, z: (HEADLANDS[0][1][1] + HEADLANDS[1][5][1]) / 2, w: 1.5, h: -WATER_Y + 0.22, d: HEADLANDS[1][5][1] - HEADLANDS[0][1][1], color: CONCRETE });
  return m;
}
