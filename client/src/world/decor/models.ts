// The shop's toon models, each one merged geometry with vertex colours (parts.ts), so an item costs a draw call or two.
// Every model stands in its own frame: the floor at y 0, its front facing +z, its middle at the origin (wall pieces:
// centred on their hanging height, their back on the wall). Textured faces (posters, the neon, the kiosk's screen) and
// glass are Decor.tsx's; the espresso machine and the tournament table are in their kit item's frame.
// Adapted from cubefarm client/src/world/decor/models.ts (MIT): the plant, the fig, the frame, the neon's back and the
// kiosk; the vending machine, the beer fridge, the couch, the beanbags, the espresso machine and the tournament table are new.
import { mix, shade } from '../materials';
import { ball, box, cyl, disc, model, torus, type Part } from './parts';

const LEAF = ['#52b788', '#40916c', '#74c69d', '#2d6a4f'];
const INKY = '#1f1d2b';
const STEEL = '#adb5bd';

// ---------- plants ----------

/** The office's potted plant (Props.tsx Plant), in a pot of the floor's colour. */
export const plantModel = (pot: string) =>
  model(`plant:${pot}`, () => [
    cyl(0.28, 0.22, 0.5, pot, [0, 0.25, 0], undefined, 16),
    cyl(0.29, 0.29, 0.05, shade(pot, -0.1), [0, 0.5, 0], undefined, 16),
    ball(0.36, LEAF[0], [0, 0.8, 0]),
    ball(0.28, LEAF[1], [0.2, 1.05, 0.08]),
    ball(0.25, LEAF[2], [-0.18, 1.12, -0.05]),
    ball(0.2, LEAF[0], [0.02, 1.35, 0]),
  ]);

/** A fiddle-leaf fig: a trunk out of a big pot, glossy leaves in tiers. */
export const figModel = (pot: string) =>
  model(`fig:${pot}`, () => {
    const parts: Part[] = [cyl(0.26, 0.2, 0.5, pot, [0, 0.25, 0], undefined, 16), cyl(0.265, 0.265, 0.05, shade(pot, -0.12), [0, 0.5, 0], undefined, 16), cyl(0.035, 0.05, 1.15, '#7f5539', [0, 1.05, 0])];
    const tiers = [
      [1.15, 5, 0.27],
      [1.45, 5, 0.25],
      [1.75, 4, 0.2],
      [2.0, 3, 0.13],
    ];
    tiers.forEach(([y, n, out], t) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + t * 0.7;
        parts.push({ ...ball(0.17, LEAF[(i + t) % LEAF.length], [Math.cos(a) * out, y, Math.sin(a) * out], [1.15, 0.45, 0.8]), rot: [0.35 * Math.sin(a), -a, 0.35 * Math.cos(a)] });
      }
    });
    return parts;
  });

// ---------- seats ----------

/** The shop's sofa: a two-seater in the lounge couch's shape (Props.tsx Couch), its back to -z. */
export const sofaModel = (color: string) =>
  model(`sofa:${color}`, () => {
    const dark = shade(color, -0.12);
    return [
      box(2.3, 0.42, 0.92, color, [0, 0.25, 0]),
      box(2.3, 0.6, 0.23, dark, [0, 0.7, -0.345]),
      box(0.23, 0.55, 0.92, dark, [-1.035, 0.45, 0]),
      box(0.23, 0.55, 0.92, dark, [1.035, 0.45, 0]),
      box(0.5, 0.4, 0.14, '#ffd166', [-0.5, 0.62, -0.2], [-0.12, 0.08, 0]),
      box(0.5, 0.4, 0.14, '#ef476f', [0.5, 0.62, -0.2], [-0.12, -0.08, 0]),
    ];
  });

/** Two squashy beanbags side by side, turned a little towards each other. */
export const beanbagsModel = (color: string) =>
  model(`beanbags:${color}`, () => {
    const other = mix(color, '#ffd166', 0.55);
    return [-1, 1].flatMap((s) => {
      const c = s < 0 ? color : other;
      const x = s * 0.29;
      const back = { x: x - s * 0.04, z: -0.15 };
      return [
        ball(0.29, c, [x, 0.19, 0.02], [1, 0.62, 1], 16),
        ball(0.21, shade(c, 0.07), [x, 0.31, -0.02], [1, 0.5, 0.85], 14),
        ball(0.24, shade(c, -0.06), [back.x, 0.3, back.z], [1.05, 0.9, 0.55], 14),
      ];
    });
  });

// ---------- the vending machine ----------

/** The vending machine: its size, the glass front (x, y its middle), the tray and the shelves' tops. */
export const VENDING = {
  w: 1.05,
  d: 0.85,
  h: 1.95,
  glass: { x: -0.13, y: 1.13, w: 0.66, h: 1.2 },
  tray: { x: -0.13, y: 0.34 },
  shelves: [0.6, 0.835, 1.07, 1.305, 1.54],
  /** Where the goods stand on a shelf, front to back, and across it. */
  row: { z: 0.12, xs: [-0.38, -0.255, -0.13, -0.005, 0.12] },
};

const CANS = ['#e63946', '#118ab2', '#06d6a0', '#22223b', '#ffd166', '#f8f9fa'];
const BARS = ['#9d0208', '#ff6b35', '#7209b7', '#ffba08', '#3a86ff'];
const BAGS = ['#f77f00', '#fcbf49', '#ef476f', '#80ed99'];

/** The cabinet: back, sides, top and plinth, the control column with its keypad and coin slot, and the tray. */
export const vendingBodyModel = (color: string) =>
  model(`vending:${color}`, () => {
    const { w, d, h, glass: g } = VENDING;
    const front = d / 2;
    const col = { x0: g.x + g.w / 2 + 0.01, x1: w / 2 };
    const cx = (col.x0 + col.x1) / 2;
    const side = shade(color, -0.1);
    const parts: Part[] = [
      box(w, h, 0.05, side, [0, h / 2, -front + 0.025]),
      box(0.07, h, d, side, [-w / 2 + 0.035, h / 2, 0]),
      box(0.07, h, d, side, [w / 2 - 0.035, h / 2, 0]),
      box(w, 0.14, d, shade(color, -0.2), [0, h - 0.07, 0]),
      box(w, 0.12, d, '#2b2d42', [0, 0.06, 0]),
      // under the glass, over it, and the control column beside it
      box(g.w + 0.08, g.y - g.h / 2 - 0.12, 0.06, color, [g.x, (g.y - g.h / 2 + 0.12) / 2, front - 0.03]),
      box(g.w + 0.08, h - 0.14 - (g.y + g.h / 2), 0.06, color, [g.x, (h - 0.14 + g.y + g.h / 2) / 2, front - 0.03]),
      box(col.x1 - col.x0, h - 0.26, d - 0.06, shade(color, 0.05), [cx, (h - 0.26) / 2 + 0.12, 0.03]),
      // the glass's frame
      box(g.w + 0.04, 0.03, 0.03, INKY, [g.x, g.y + g.h / 2 + 0.015, front - 0.005]),
      box(g.w + 0.04, 0.03, 0.03, INKY, [g.x, g.y - g.h / 2 - 0.015, front - 0.005]),
      box(0.03, g.h, 0.03, INKY, [g.x - g.w / 2 - 0.015, g.y, front - 0.005]),
      box(0.03, g.h, 0.03, INKY, [g.x + g.w / 2 + 0.015, g.y, front - 0.005]),
      // the tray: a dark slot behind a swinging flap
      box(0.52, 0.16, 0.02, INKY, [VENDING.tray.x, VENDING.tray.y, front + 0.001]),
      box(0.52, 0.13, 0.02, '#6c757d', [VENDING.tray.x, VENDING.tray.y - 0.02, front + 0.02], [-0.3, 0, 0]),
      // the keypad's panel, its buttons, the coin and note slots, the change cup
      box(0.22, 0.44, 0.015, '#2b2d42', [cx, 1.22, front + 0.008]),
      box(0.07, 0.11, 0.02, '#ffd166', [cx - 0.03, 0.93, front + 0.01]),
      box(0.012, 0.075, 0.024, INKY, [cx - 0.03, 0.93, front + 0.012]),
      box(0.17, 0.028, 0.02, STEEL, [cx, 0.8, front + 0.01]),
      box(0.13, 0.09, 0.05, INKY, [cx, 0.58, front + 0.015]),
      box(0.15, 0.02, 0.06, STEEL, [cx, 0.53, front + 0.02]),
    ];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) parts.push(box(0.045, 0.034, 0.016, r === 3 && c === 2 ? '#06d6a0' : r === 3 && c === 0 ? '#ef476f' : '#e9ecef', [cx + (c - 1) * 0.06, 1.1 + (3 - r) * 0.055 - 0.06, front + 0.018]));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(0.08, 0.03, 0.08, INKY, [sx * (w / 2 - 0.06), 0.015, sz * (front - 0.06)]));
    return parts;
  });

/** One thing on a shelf, standing at (x, y, z): a can, a bar on its end or a bag of crisps. */
function goods(kind: number, x: number, y: number, z: number, k: number): Part[] {
  if (kind === 0) {
    const c = CANS[k % CANS.length];
    return [cyl(0.034, 0.034, 0.11, c, [x, y + 0.055, z], undefined, 10), cyl(0.035, 0.035, 0.035, c === '#f8f9fa' ? '#e63946' : '#f8f9fa', [x, y + 0.06, z], undefined, 10)];
  }
  if (kind === 1) {
    const c = BARS[k % BARS.length];
    return [box(0.085, 0.15, 0.025, c, [x, y + 0.075, z + 0.03]), box(0.087, 0.035, 0.027, '#ffd166', [x, y + 0.1, z + 0.03])];
  }
  const c = BAGS[k % BAGS.length];
  return [{ ...ball(0.055, c, [x, y + 0.085, z + 0.02], [0.95, 1.35, 0.45], 10) }, box(0.08, 0.02, 0.03, shade(c, -0.15), [x, y + 0.165, z + 0.02])];
}

/** What shows through the glass, lit from inside: shelf lips, rows of cans, bars and crisps, their price tags; the keypad's little screen and the sign over the glass. */
export const vendingGoodsModel = () =>
  model('vending-goods', () => {
    const { d, glass: g, shelves, row } = VENDING;
    const front = d / 2;
    const parts: Part[] = [];
    shelves.forEach((y, r) => {
      parts.push(box(g.w - 0.04, 0.022, 0.04, '#ced4da', [g.x, y - 0.011, row.z + 0.1]));
      row.xs.forEach((x, i) => {
        parts.push(...goods(r % 3 === 1 ? 1 : r % 3 === 2 ? 2 : 0, x, y, row.z, r * 5 + i));
        parts.push(box(0.045, 0.016, 0.004, '#ffffff', [x, y - 0.011, row.z + 0.122]));
      });
    });
    const cx = (g.x + g.w / 2 + 0.01 + VENDING.w / 2) / 2;
    parts.push(box(0.16, 0.05, 0.004, '#7CFFB2', [cx, 1.38, front + 0.017]));
    parts.push(box(g.w - 0.06, 0.05, 0.004, '#fff3b0', [g.x, g.y + g.h / 2 + 0.06, front + 0.002]));
    return parts;
  });

// ---------- the beer fridge ----------

/** The beer fridge: its size, the glass door's opening (from y0 to y1), its hinge on the +x side, and the shelves. */
export const BEER_FRIDGE = { w: 0.9, d: 0.8, h: 1.85, y0: 0.14, y1: 1.65, shelves: [0.42, 0.74, 1.06, 1.38] };

/** The cabinet, open at the front: back, sides, the header in the floor's colour and the plinth with its grille. */
export const beerBodyModel = (color: string) =>
  model(`beer:${color}`, () => {
    const { w, d, h, y0, y1 } = BEER_FRIDGE;
    const cab = '#343a40';
    return [
      box(w, h, 0.05, cab, [0, h / 2, -d / 2 + 0.025]),
      box(0.05, h, d, cab, [-w / 2 + 0.025, h / 2, 0]),
      box(0.05, h, d, cab, [w / 2 - 0.025, h / 2, 0]),
      box(w, h - y1, d, color, [0, (h + y1) / 2, 0]),
      box(w, y0, d, '#212529', [0, y0 / 2, 0]),
      box(w - 0.16, 0.05, 0.012, '#495057', [0, y0 / 2, d / 2 + 0.004]),
    ];
  });

const BOTTLES = [
  { body: '#7f4f24', label: '#ffd166', cap: '#ced4da' },
  { body: '#2d6a4f', label: '#f4f1de', cap: '#e63946' },
  { body: '#9c6644', label: '#e9c46a', cap: '#ffd166' },
];

/** A bottle standing at (x, y, z): body, label, shoulder, neck and cap. */
function bottle(x: number, y: number, z: number, k: number): Part[] {
  const b = BOTTLES[k % BOTTLES.length];
  return [
    cyl(0.032, 0.032, 0.15, b.body, [x, y + 0.075, z], undefined, 10),
    cyl(0.033, 0.033, 0.06, b.label, [x, y + 0.07, z], undefined, 10),
    cyl(0.013, 0.032, 0.045, b.body, [x, y + 0.172, z], undefined, 10),
    cyl(0.013, 0.013, 0.05, b.body, [x, y + 0.218, z], undefined, 8),
    cyl(0.016, 0.016, 0.012, b.cap, [x, y + 0.248, z], undefined, 8),
  ];
}

/** Inside, lit: wire shelves, rows of bottles (and a row of cans), and the amber light along the header. */
export const beerGoodsModel = () =>
  model('beer-goods', () => {
    const { w, d, h, y1, shelves } = BEER_FRIDGE;
    const parts: Part[] = [];
    shelves.forEach((y, r) => {
      parts.push(box(w - 0.1, 0.014, d - 0.16, '#dee2e6', [0, y - 0.007, -0.02]));
      for (let i = 0; i < 6; i++) {
        const x = -0.3 + i * 0.12;
        if (r === 1) parts.push(cyl(0.032, 0.032, 0.115, i % 2 ? '#ffd166' : '#e9ecef', [x, y + 0.058, 0.02], undefined, 10), cyl(0.033, 0.033, 0.04, '#e63946', [x, y + 0.06, 0.02], undefined, 10));
        else parts.push(...bottle(x, y, 0.02 - (i % 2) * 0.12, r * 6 + i));
      }
    });
    parts.push(box(w - 0.22, 0.06, 0.006, '#ffb703', [0, (h + y1) / 2, d / 2 + 0.004]));
    return parts;
  });

/** The glass door's frame and handle, in the door's frame: its hinge at the origin, the door running to -x. */
export const beerDoorModel = () =>
  model('beer-door', () => {
    const { w, y0, y1 } = BEER_FRIDGE;
    const dw = w - 0.02;
    const cab = '#2b2d42';
    const t = 0.05;
    return [
      box(dw, t, 0.04, cab, [-dw / 2, y1 - t / 2, 0.02]),
      box(dw, t, 0.04, cab, [-dw / 2, y0 + t / 2, 0.02]),
      box(t, y1 - y0, 0.04, cab, [-t / 2, (y0 + y1) / 2, 0.02]),
      box(t, y1 - y0, 0.04, cab, [-dw + t / 2, (y0 + y1) / 2, 0.02]),
      box(0.03, 0.55, 0.035, STEEL, [-dw + 0.07, (y0 + y1) / 2, 0.065]),
      box(0.03, 0.03, 0.03, STEEL, [-dw + 0.07, (y0 + y1) / 2 + 0.26, 0.045]),
      box(0.03, 0.03, 0.03, STEEL, [-dw + 0.07, (y0 + y1) / 2 - 0.26, 0.045]),
    ];
  });

// ---------- on the walls ----------

/** A picture frame on the wall; the picture itself is a textured plane in front of it. */
export const frameModel = (w: number, h: number) => model(`frame:${w}x${h}`, () => [box(w, h, 0.04, '#5c3d2e', [0, 0, -0.005]), box(w - 0.07, h - 0.07, 0.045, '#f8f9fa', [0, 0, -0.0025])]);

/** The neon's dark backboard on four stand-offs; its tubes are a textured plane in front. */
export const neonBackModel = (w: number, h: number) =>
  model(`neon-back:${w}x${h}`, () => [
    box(w, h, 0.02, '#22223b', [0, 0, 0.01]),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sy) => cyl(0.014, 0.014, 0.04, STEEL, [sx * (w / 2 - 0.06), sy * (h / 2 - 0.06), -0.01], [Math.PI / 2, 0, 0], 8))),
  ]);

// ---------- the lobby's kiosk ----------

/** The kiosk's screen: its middle and size, tilted back. */
export const KIOSK_SCREEN = { y: 1.5, z: -0.02, w: 0.92, h: 0.62, tilt: -0.16 };

/** A stand in the lobby's orange, a counter ledge, a tilted screen in a dark housing and a big coin on top. */
export const kioskModel = () =>
  model('shop-kiosk', () => {
    const s = KIOSK_SCREEN;
    return [
      box(1.1, 0.08, 0.62, '#2b2d42', [0, 0.04, 0]),
      box(0.62, 1.05, 0.44, '#ff8a5b', [0, 0.6, -0.04]),
      box(0.66, 0.06, 0.46, shade('#ff8a5b', -0.12), [0, 0.15, -0.04]),
      box(0.86, 0.05, 0.3, '#c68b59', [0, 1.12, 0.06]),
      box(s.w + 0.1, s.h + 0.1, 0.1, '#2b2d42', [0, s.y, s.z - 0.05], [s.tilt, 0, 0]),
      cyl(0.06, 0.08, 0.2, '#2b2d42', [0, 1.2, -0.08]),
      cyl(0.17, 0.17, 0.05, '#ffd43b', [0, 2.06, -0.05], [Math.PI / 2, 0, 0], 22),
      torus(0.17, 0.014, '#f4a261', [0, 2.06, -0.022]),
      disc(0.11, '#f4a261', [0, 2.06, -0.023]),
      box(0.04, 0.12, 0.04, '#2b2d42', [0, 1.86, -0.05]),
    ];
  });

// ---------- upgrades of the kit ----------

/**
 * The espresso machine, in the coffee machine's frame (CoffeeMachine.tsx: on the counter top, its front facing -x, the
 * mug's slot at x -0.25 under a spout `spout` up): a chrome body, two group heads with their portafilters (the working
 * one over the slot), a steam wand, a pressure gauge, and cups warming on top.
 */
export const espressoModel = (spout: number) =>
  model(`espresso:${spout}`, () => {
    const chrome = '#dee2e6';
    const front = -0.175;
    const parts: Part[] = [
      box(0.45, 0.48, 0.64, chrome, [0.05, 0.27, 0]),
      box(0.47, 0.03, 0.66, '#495057', [0.05, 0.015, 0]),
      ...[-1, 1].map((s) => box(0.44, 0.38, 0.012, STEEL, [0.05, 0.28, s * 0.322])),
      box(0.012, 0.15, 0.58, '#343a40', [front - 0.004, 0.42, 0]),
      box(0.42, 0.016, 0.6, '#868e96', [0.05, 0.518, 0]),
      ...[-1, 1].map((s) => box(0.42, 0.04, 0.014, '#ced4da', [0.05, 0.545, s * 0.29])),
      // cups upside down on the warmer
      ...[
        [0.0, -0.17],
        [0.12, -0.02],
        [0.0, 0.13],
      ].map(([x, z]) => cyl(0.026, 0.036, 0.055, '#f8f9fa', [x, 0.554, z], undefined, 12)),
      // the gauge
      disc(0.045, '#fff8e1', [front - 0.012, 0.42, 0.19], [0, -Math.PI / 2, 0]),
      torus(0.045, 0.007, STEEL, [front - 0.012, 0.42, 0.19], [0, -Math.PI / 2, 0]),
      box(0.004, 0.034, 0.006, '#e63946', [front - 0.014, 0.43, 0.195], [0.7, 0, 0]),
      // the steam wand and its knob
      cyl(0.008, 0.008, 0.24, '#ced4da', [front - 0.04, 0.27, -0.25], [0, 0, 0.22], 8),
      ball(0.012, '#ced4da', [front - 0.065, 0.155, -0.25], undefined, 8),
      cyl(0.022, 0.022, 0.03, INKY, [front - 0.012, 0.42, -0.25], [0, 0, Math.PI / 2], 12),
      // the second group's own drip tray, and an espresso cup on it
      box(0.2, 0.02, 0.18, '#6c757d', [-0.25, 0.01, 0.22]),
      cyl(0.026, 0.02, 0.04, '#ffffff', [-0.25, 0.04, 0.22], undefined, 12),
    ];
    for (const z of [0, 0.22]) {
      parts.push(box(0.09, 0.05, 0.08, STEEL, [-0.21, spout + 0.08, z]));
      parts.push(cyl(0.055, 0.05, 0.06, STEEL, [-0.25, spout + 0.055, z], undefined, 14));
      parts.push(cyl(0.046, 0.04, 0.03, '#343a40', [-0.25, spout + 0.012, z], undefined, 14));
      parts.push(box(0.15, 0.022, 0.03, INKY, [-0.36, spout + 0.016, z], [0, 0, -0.12]));
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(cyl(0.018, 0.018, 0.02, INKY, [0.05 + sx * 0.18, -0.005, sz * 0.27], undefined, 8));
    return parts;
  });

/** The tournament table's size (PongTable.tsx's, so the match plays on it unchanged) and its colours. */
export interface TableSize {
  len: number;
  wid: number;
  top: number;
  topT: number;
  net: { h: number; overhang: number };
}

/**
 * The tournament ping-pong table, centred under its middle: a bright blue top on a navy apron, a sturdy undercarriage
 * on wheels with a beam in the floor's colour, gold net posts, and the cup of balls.
 */
export const tournamentModel = (t: TableSize, accent: string) =>
  model(`tournament:${accent}`, () => {
    const hx = t.len / 2;
    const hz = t.wid / 2;
    const navy = '#0b2545';
    const steel = '#212529';
    const legH = t.top - t.topT - 0.06 - 0.1;
    const parts: Part[] = [
      box(t.len, t.topT, t.wid, '#1976d2', [0, t.top - t.topT / 2, 0]),
      ...[-1, 1].map((s) => box(t.len, 0.06, 0.03, navy, [0, t.top - t.topT - 0.03, s * (hz - 0.015)])),
      ...[-1, 1].map((s) => box(0.03, 0.06, t.wid - 0.06, navy, [s * (hx - 0.015), t.top - t.topT - 0.03, 0])),
      box(1.9, 0.08, 0.08, accent, [0, 0.42, 0]),
    ];
    for (const sx of [-1, 1]) {
      const x = sx * 0.95;
      parts.push(box(0.07, 0.06, 1.2, steel, [x, 0.2, 0]), box(0.07, 0.06, 1.2, steel, [x, t.top - t.topT - 0.09, 0]));
      for (const sz of [-1, 1]) {
        const z = sz * 0.58;
        parts.push(box(0.075, legH, 0.075, steel, [x, 0.1 + legH / 2, z]));
        parts.push(cyl(0.05, 0.05, 0.04, INKY, [x, 0.05, z], [0, 0, Math.PI / 2], 12));
        parts.push(box(0.05, 0.02, 0.07, '#e63946', [x + sx * 0.06, 0.09, z]));
      }
      parts.push(box(0.05, 0.62, 0.05, '#343a40', [sx * 0.55, 0.44, 0], [0, 0, sx * 0.85]));
    }
    // gold net posts and clamps
    for (const sz of [-1, 1]) {
      parts.push(box(0.035, t.net.h + 0.03, 0.035, '#ffd166', [0, t.top + (t.net.h + 0.03) / 2, sz * (hz + t.net.overhang)]));
      parts.push(box(0.07, 0.04, 0.12, '#ffd166', [0, t.top - 0.012, sz * (hz + 0.04)]));
    }
    // a cup of balls clipped to the north edge by the net
    parts.push(cyl(0.05, 0.045, 0.09, STEEL, [0.25, t.top - 0.03, -hz - 0.05], undefined, 12));
    for (const [x, y, z] of [
      [-0.015, 0.05, 0.01],
      [0.017, 0.055, -0.008],
      [0, 0.075, 0.004],
    ])
      parts.push(ball(0.025, '#ff9f1c', [0.25 + x, t.top - 0.03 + y, -hz - 0.05 + z], undefined, 10));
    return parts;
  });

/** The tournament table's white lines: its edges and the centre line, just over the top. */
export const tournamentLinesModel = (t: TableSize) =>
  model('tournament-lines', () => {
    const hx = t.len / 2;
    const hz = t.wid / 2;
    const y = t.top + 0.0015;
    const l = 0.022;
    return [box(t.len, 0.003, l, '#ffffff', [0, y, hz - l / 2]), box(t.len, 0.003, l, '#ffffff', [0, y, -hz + l / 2]), box(l, 0.003, t.wid, '#ffffff', [hx - l / 2, y, 0]), box(l, 0.003, t.wid, '#ffffff', [-hx + l / 2, y, 0]), box(t.len, 0.003, 0.006, '#ffffff', [0, y, 0])];
  });
