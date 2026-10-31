// Adapted from cubefarm client/src/world/toys/roombaBrain.ts (MIT): its navigation section, which people's walkways use.

// The walk grid over the floor's rects, and paths across it: A* over 0.2 m cells kept clear of everything, string-pulled
// into a few straight legs. Pure.

import { FLOOR_D, FLOOR_W, HALF_D, HALF_W, type Rect } from './layout';

export interface Pt {
  x: number;
  z: number;
}

/** How far a path keeps off everything, by default. */
export const NAV_R = 0.2;
const PLAN_R = NAV_R + 0.1; // paths keep a little further off
const CELL = 0.2;

export interface Nav {
  rects: Rect[];
  cols: number;
  rows: number;
  /** 1 where a path may not go (too close to something). */
  blocked: Uint8Array;
  /** How far grid cells keep off everything, and how far a smoothed straight leg must. */
  planR: number;
  lineR: number;
  /** How much A* trusts its estimate: 1 finds the shortest grid path, more searches fewer cells. */
  greed: number;
}

/** Whether a circle of radius r at (x, z) is clear of every rect. */
export function clear(rects: Rect[], x: number, z: number, r = NAV_R) {
  if (Math.abs(x) > HALF_W - r || Math.abs(z) > HALF_D - r) return false;
  // what collide() would push it out of; checked directly, since paths ask this thousands of times
  for (const b of rects) if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return false;
  return true;
}

/** The walk grid over `rects`. People (walkways.ts) pass their own radii. */
export function makeNav(rects: Rect[], { planR = PLAN_R, lineR = NAV_R + 0.04, greed = 1 }: { planR?: number; lineR?: number; greed?: number } = {}): Nav {
  const cols = Math.round(FLOOR_W / CELL);
  const rows = Math.round(FLOOR_D / CELL);
  const blocked = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) blocked[j * cols + i] = clear(rects, cellX(i), cellZ(j), planR) ? 0 : 1;
  return { rects, cols, rows, blocked, planR, lineR, greed };
}

const cellX = (i: number) => -HALF_W + (i + 0.5) * CELL;
const cellZ = (j: number) => -HALF_D + (j + 0.5) * CELL;
const toCol = (x: number, cols: number) => Math.min(cols - 1, Math.max(0, Math.floor((x + HALF_W) / CELL)));
const toRow = (z: number, rows: number) => Math.min(rows - 1, Math.max(0, Math.floor((z + HALF_D) / CELL)));

/** Whether the straight line a → b is clear of everything by r. */
export function segmentClear(rects: Rect[], a: Pt, b: Pt, r = NAV_R + 0.04) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.08));
  // every sample k = 1..n once, coarse to fine, so a blocked line is usually found in a few checks
  let top = 1;
  while (top * 2 <= n) top *= 2;
  for (let stride = top; stride >= 1; stride >>= 1) {
    for (let k = stride; k <= n; k += stride) {
      if (stride !== top && k % (stride * 2) === 0) continue;
      if (!clear(rects, a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n, r)) return false;
    }
  }
  return true;
}

/** The nearest cell a path may use, searching outwards from (i, j). */
function nearestOpen(nav: Nav, i: number, j: number, avoid: (c: number) => boolean): number {
  const { cols, rows, blocked } = nav;
  for (let ring = 0; ring < 12; ring++) {
    let best = -1;
    let bestD = Infinity;
    for (let dj = -ring; dj <= ring; dj++) {
      for (let di = -ring; di <= ring; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
        const c = jj * cols + ii;
        if (blocked[c] || avoid(c)) continue;
        const d = di * di + dj * dj;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/**
 * A* over the grid from `from` to `to`, string-pulled into a few straight legs. Returns the waypoints after `from`
 * (ending at `to`), or null when there's no way through. `avoid` is a circle to keep out of (the player).
 */
export function planPath(nav: Nav, from: Pt, to: Pt, avoid: (Pt & { r: number }) | null = null): Pt[] | null {
  const { cols, rows, blocked } = nav;
  const avoidR = avoid ? avoid.r + nav.planR : 0;
  const avoided = (c: number) => !!avoid && Math.hypot(cellX(c % cols) - avoid.x, cellZ(Math.floor(c / cols)) - avoid.z) < avoidR;
  const start = nearestOpen(nav, toCol(from.x, cols), toRow(from.z, rows), avoided);
  const goal = nearestOpen(nav, toCol(to.x, cols), toRow(to.z, rows), () => false);
  if (start < 0 || goal < 0) return null;

  const n = cols * rows;
  const g = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gi = goal % cols;
  const gj = Math.floor(goal / cols);
  const h = (c: number) => {
    const dx = Math.abs((c % cols) - gi);
    const dz = Math.abs(Math.floor(c / cols) - gj);
    return nav.greed * (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz));
  };
  // binary heap of [f, cell]
  const heap: [number, number][] = [];
  const push = (f: number, c: number) => {
    heap.push([f, c]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top[1];
  };
  const open = (i: number, j: number) => i >= 0 && j >= 0 && i < cols && j < rows && !blocked[j * cols + i] && !avoided(j * cols + i);

  g[start] = 0;
  push(h(start), start);
  let found = false;
  while (heap.length) {
    const c = pop();
    if (closed[c]) continue;
    closed[c] = 1;
    if (c === goal) {
      found = true;
      break;
    }
    const i = c % cols;
    const j = Math.floor(c / cols);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        if (!open(i + di, j + dj)) continue;
        if (di && dj && (!open(i + di, j) || !open(i, j + dj))) continue; // no cutting corners
        const nb = (j + dj) * cols + i + di;
        const cost = g[c] + (di && dj ? Math.SQRT2 : 1);
        if (cost < g[nb]) {
          g[nb] = cost;
          came[nb] = c;
          push(cost + h(nb), nb);
        }
      }
    }
  }
  if (!found) return null;

  const cells: Pt[] = [];
  for (let c = goal; c >= 0; c = came[c]) cells.push({ x: cellX(c % cols), z: cellZ(Math.floor(c / cols)) });
  cells.reverse();
  cells.push({ x: to.x, z: to.z });

  // String-pulling: from each corner, jump to the furthest point still in a straight line of sight.
  const out: Pt[] = [];
  let at: Pt = from;
  let k = 0;
  while (k < cells.length) {
    let far = k;
    for (let m = cells.length - 1; m > k; m--) {
      if (segmentClear(nav.rects, at, cells[m], nav.lineR)) {
        far = m;
        break;
      }
    }
    at = cells[far];
    out.push(at);
    k = far + 1;
  }
  return out;
}
