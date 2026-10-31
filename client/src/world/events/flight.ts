// How high a world event has to fly to clear the city's rooftops on its way. The scenes fly straight across the view,
// and downtown's towers stand in the way of some of those lines (cubefarm's flew through them): so each takes a profile
// along its path, never under the height it wants, at least a margin over any roof near the line, climbing ahead of
// the towers and easing down after them. Pure, from cityLayout.ts's numbers, so it's tested without a browser.

import type { CityBox, CityLayout } from '../cityLayout';

const solids = (layout: CityLayout): CityBox[] => [...layout.buildings, ...layout.boxes, ...layout.cylinders, ...layout.cones];

/** How far (x, z) is from the footprint of `c`, 0 inside it. */
const reach = (c: CityBox, x: number, z: number) => Math.hypot(Math.max(0, Math.abs(x - c.x) - c.w / 2), Math.max(0, Math.abs(z - c.z) - c.d / 2));

/** The highest top of anything in the city within `radius` of (x, z); 0 over open ground. */
export function ceilingWithin(layout: CityLayout, x: number, z: number, radius: number): number {
  let top = 0;
  for (const c of solids(layout)) if (c.y + c.h > top && reach(c, x, z) < radius) top = c.y + c.h;
  return top;
}

export interface FlightPath {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface FlightOpts {
  /** The height it would fly at over open ground. */
  base: number;
  /** How far over the rooftops it keeps, and how wide its path is (anything within `pad` of the line counts). */
  margin: number;
  pad: number;
  samples?: number;
  /** The steepest it climbs or sinks, metres per metre along the path. */
  slope?: number;
}

/** Heights to fly at along the path, `samples` evenly spaced from its start to its end. */
export function flightProfile(layout: CityLayout, path: FlightPath, opts: FlightOpts): Float32Array {
  const n = Math.max(2, opts.samples ?? 48);
  const slope = opts.slope ?? 0.35;
  const len = Math.hypot(path.x1 - path.x0, path.z1 - path.z0);
  // only what's near the line can matter
  const lo = { x: Math.min(path.x0, path.x1) - opts.pad, z: Math.min(path.z0, path.z1) - opts.pad };
  const hi = { x: Math.max(path.x0, path.x1) + opts.pad, z: Math.max(path.z0, path.z1) + opts.pad };
  const near = solids(layout).filter((c) => c.x + c.w / 2 > lo.x && c.x - c.w / 2 < hi.x && c.z + c.d / 2 > lo.z && c.z - c.d / 2 < hi.z);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const x = path.x0 + (path.x1 - path.x0) * k;
    const z = path.z0 + (path.z1 - path.z0) * k;
    let top = 0;
    for (const c of near) if (c.y + c.h > top && reach(c, x, z) < opts.pad) top = c.y + c.h;
    y[i] = Math.max(opts.base, top > 0 ? top + opts.margin : 0);
  }
  // no steeper than `slope`: it starts climbing before a tower and comes down slowly after it
  const step = (slope * len) / (n - 1);
  for (let i = 1; i < n; i++) y[i] = Math.max(y[i], y[i - 1] - step);
  for (let i = n - 2; i >= 0; i--) y[i] = Math.max(y[i], y[i + 1] - step);
  return y;
}

/**
 * The longest stretch of a crossing along z at `x` (from -reach to reach) where nothing within `pad` stands taller
 * than `limit`: a slow, low flier keeps to it, so it passes in front of downtown's towers rather than climbing over
 * them. The whole crossing when the stretch would be too short to bother (the profile copes then).
 */
export function clearStretch(layout: CityLayout, x: number, reach: number, limit: number, pad: number): [number, number] {
  const step = 10;
  let best: [number, number] = [0, -Infinity];
  let from: number | null = null;
  for (let z = -reach; z <= reach + 1e-6; z += step) {
    const open = ceilingWithin(layout, x, z, pad) <= limit;
    if (open && from === null) from = z;
    const end = open ? z : z - step;
    if (from !== null && end - from > best[1] - best[0]) best = [from, end];
    if (!open) from = null;
  }
  return best[1] - best[0] < reach * 0.6 ? [-reach, reach] : best;
}

/** The profile's height `k` of the way along (0-1), between its samples. */
export function along(profile: Float32Array, k: number): number {
  const f = Math.min(1, Math.max(0, k)) * (profile.length - 1);
  const i = Math.min(profile.length - 2, Math.floor(f));
  return profile[i] + (profile[i + 1] - profile[i]) * (f - i);
}
