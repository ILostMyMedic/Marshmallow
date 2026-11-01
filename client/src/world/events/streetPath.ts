// Where the street events go (scenes/RockBus.tsx and the rest): along the streets either side of the office's block,
// in a lane or pulled over at the kerb outside, slowing to pass the office and stopping where they stop. Each route is
// a drive sampled once into a table, so every tab has it in the same place at the same moment; its footprint holds the
// city's cars back (streetTraffic.ts). Pure, from cityLayout.ts's numbers, so it's tested without a browser.

import { CITY, CORRIDOR_HALF, LANE, STREET_Y } from '../cityLayout';
import type { EventSide } from '../../../../shared/worldEvents';

/** |x| of the centrelines of the streets either side of the office's block (they run along z). */
export const SIDE_STREET = CITY.homeHalfX + CORRIDOR_HALF;
/** The road's surface, in a scene's frame: City.tsx draws the roads just over its street level, below the plaza. */
export const ROAD_Y = STREET_Y + 0.02;
/** The plaza's kerb (City.tsx's plaza is 0.3 m wider than our block each way) and its top. */
export const PLAZA = { x: CITY.homeHalfX + 0.3, z: CITY.homeHalfZ + 0.3, y: -0.02 };
/** How far right of the centreline a truck pulled over at the kerb stands: two wheels up on the pavement, clear of the lane. */
export const KERB_OFF = 4.5;

export const STREET_EVENTS = ['rockbus', 'icecream', 'firetruck', 'foodtruck', 'parade'] as const;
export type StreetEventId = (typeof STREET_EVENTS)[number];
export const isStreetEvent = (id: string): id is StreetEventId => (STREET_EVENTS as readonly string[]).includes(id);

/** What each takes up on the street: width and length (the parade's whole column, front to back). */
export const STREET_SIZE: Record<StreetEventId, { w: number; len: number }> = {
  rockbus: { w: 2.5, len: 11 },
  icecream: { w: 2.3, len: 6.6 },
  firetruck: { w: 2.5, len: 9.4 },
  foodtruck: { w: 2.3, len: 7.2 },
  parade: { w: 3.4, len: 21 },
};

// ---------- a drive along a street ----------

export interface Leg {
  /** Metres from the start where it ends. */
  to: number;
  /** Its cruising speed, m/s. */
  speed: number;
  /** Seconds stopped at its end. */
  stop?: number;
  /** Metres right of the centreline it has moved to by its end, eased along the leg. */
  off?: number;
}

export interface Drive {
  /** Seconds between samples. */
  dt: number;
  /** Metres along from the start, and right of the centreline, at each sample. */
  u: Float32Array;
  off: Float32Array;
  seconds: number;
  length: number;
}

const DT = 0.05;
const smooth = (x: number) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/**
 * The legs driven one after another, already moving at the first one's speed: it speeds up and slows down at `accel`
 * (m/s²), slowing in time for a slower leg or a stop, and eases across to each leg's `off` as it goes.
 */
export function drive(legs: readonly Leg[], { off = LANE, accel = 1.8 }: { off?: number; accel?: number } = {}): Drive {
  const us: number[] = [0];
  const offs: number[] = [off];
  let u = 0;
  let v = legs[0]?.speed ?? 0;
  let leg = 0;
  let from = 0;
  let offFrom = off;
  // the fastest it may go at `x` and still slow in time for every leg's end ahead (up to the next stop)
  const limit = (x: number) => {
    let lim = Infinity;
    for (let j = leg; j < legs.length; j++) {
      const end = legs[j].stop ? 0 : Math.min(legs[j].speed, legs[j + 1]?.speed ?? legs[j].speed);
      lim = Math.min(lim, Math.sqrt(end * end + 2 * accel * Math.max(0, legs[j].to - x)));
      if (legs[j].stop) break;
    }
    return lim;
  };
  for (let guard = 0; leg < legs.length && guard < 200_000; guard++) {
    const L = legs[leg];
    const target = Math.min(L.speed, limit(u));
    v = v < target ? Math.min(target, v + accel * DT) : target;
    u = Math.min(L.to, u + Math.max(v, 0.3) * DT);
    const o = L.off === undefined ? offFrom : offFrom + (L.off - offFrom) * smooth((u - from) / Math.max(1e-6, L.to - from));
    us.push(u);
    offs.push(o);
    if (u < L.to) continue;
    if (L.stop) {
      v = 0;
      for (let s = 0; s < L.stop; s += DT) {
        us.push(u);
        offs.push(o);
      }
    }
    from = L.to;
    offFrom = L.off ?? offFrom;
    leg++;
  }
  return { dt: DT, u: Float32Array.from(us), off: Float32Array.from(offs), seconds: (us.length - 1) * DT, length: legs.at(-1)?.to ?? 0 };
}

/** When (seconds in) a drive stands still longest, from its stopping to its moving off; null if it never stops. */
export function stopOf(d: Drive): [number, number] | null {
  let best: [number, number] | null = null;
  let from = -1;
  for (let i = 1; i < d.u.length; i++) {
    const still = d.u[i] === d.u[i - 1];
    if (still && from < 0) from = i - 1;
    if ((!still || i === d.u.length - 1) && from >= 0) {
      const to = still ? i : i - 1;
      if (!best || (to - from) * d.dt > best[1] - best[0]) best = [from * d.dt, to * d.dt];
      from = -1;
    }
  }
  return best && best[1] - best[0] > 0.5 ? best : null;
}

export interface DriveSample {
  u: number;
  off: number;
  /** m/s along the street. */
  speed: number;
  /** How far it's turned off straight (radians, > 0 towards its right), from how it's moving across. */
  turn: number;
}

/** Where a drive has got to `t` seconds in (held at its ends). Allocates nothing. */
export function driveAt(d: Drive, t: number, out: DriveSample): DriveSample {
  const n = d.u.length;
  const f = Math.min(n - 1, Math.max(0, t / d.dt));
  const i = Math.min(n - 2, Math.floor(f));
  const k = f - i;
  out.u = d.u[i] + (d.u[i + 1] - d.u[i]) * k;
  out.off = d.off[i] + (d.off[i + 1] - d.off[i]) * k;
  out.speed = f >= n - 1 ? 0 : (d.u[i + 1] - d.u[i]) / d.dt;
  const a = Math.max(0, i - 3);
  const b = Math.min(n - 1, i + 4);
  const du = d.u[b] - d.u[a];
  const dOff = d.off[b] - d.off[a];
  out.turn = du > 0.02 ? Math.atan2(dOff, du) : 0;
  return out;
}

// ---------- on the streets ----------

/** A drive along one of the streets beside the office's block. */
export interface Route {
  side: EventSide;
  /** The street's centreline (x), and which way along z the route heads (+1 south, -1 north). */
  x: number;
  dir: 1 | -1;
  /** Where along z it starts. */
  z0: number;
  drive: Drive;
}

/** The lane nearer the office heads north on the west street and south on the east one (traffic keeps right). */
export function route(side: EventSide, near: boolean, reach: number, legs: readonly Leg[], opts: { off?: number; accel?: number } = {}): Route {
  const s = side === 'west' ? -1 : 1;
  const dir: 1 | -1 = near ? (s as 1 | -1) : (-s as 1 | -1);
  return { side, x: s * SIDE_STREET, dir, z0: -dir * reach, drive: drive(legs, opts) };
}

export interface Pose {
  x: number;
  z: number;
  /** Turns +z to its heading, as carPose's does. */
  yaw: number;
  speed: number;
  /** Metres along from the start. */
  u: number;
}

/** Puts something `u` metres along a route and `off` right of its street's centreline, turned `turn` off straight. */
export function placeOn(r: Route, u: number, off: number, turn: number, out: Pose): Pose {
  out.x = r.x - r.dir * off;
  out.z = r.z0 + r.dir * u;
  out.yaw = (r.dir > 0 ? 0 : Math.PI) - turn;
  out.u = u;
  return out;
}

const sample: DriveSample = { u: 0, off: 0, speed: 0, turn: 0 };

/** Where a route's vehicle (or the parade's front) is `t` seconds in. Allocates nothing. */
export function routeAt(r: Route, t: number, out: Pose): Pose {
  driveAt(r.drive, t, sample);
  placeOn(r, sample.u, sample.off, sample.turn, out);
  out.speed = sample.speed;
  return out;
}

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** The ground a w × len body centred at a pose covers, as a box, stretched `lead` metres ahead of it along its heading. */
export function footprint(p: { x: number; z: number; yaw: number }, w: number, len: number, lead = 0, out: Box = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }): Box {
  const sx = Math.sin(p.yaw);
  const cz = Math.cos(p.yaw);
  const hx = Math.abs(cz) * (w / 2) + Math.abs(sx) * (len / 2);
  const hz = Math.abs(sx) * (w / 2) + Math.abs(cz) * (len / 2);
  out.minX = p.x - hx + Math.min(0, sx * lead);
  out.maxX = p.x + hx + Math.max(0, sx * lead);
  out.minZ = p.z - hz + Math.min(0, cz * lead);
  out.maxZ = p.z + hz + Math.max(0, cz * lead);
  return out;
}

// ---------- each street event's route ----------

/** Where the trucks pull over: by the lobby's west window, and outside the floors' east windows. */
export const STOP_Z: Record<EventSide, number> = { west: 8.5, east: -8 };

/** Drives in, pulls over at the kerb outside the office for `stop` seconds, and drives off. */
function pullOver(side: EventSide, near: boolean, reach: number, speed: number, stop: number): Route {
  const dir = (side === 'west' ? -1 : 1) * (near ? 1 : -1);
  const at = reach + dir * STOP_Z[side];
  return route(side, near, reach, [
    { to: at - 32, speed },
    { to: at, speed: 3, stop, off: KERB_OFF },
    { to: at + 26, speed: 3.5, off: LANE },
    { to: 2 * reach, speed },
  ]);
}

/**
 * The route a street event takes on `side`, `roll` (0-1, from its seed) picking the lane where it may use either: the
 * rock bus and the parade roll slowly past, the ice cream truck pulls over for a while, the food truck pulls over on the
 * office's side for its queue, and the fire engine races by near the middle of the road.
 */
export function streetRoute(id: StreetEventId, side: EventSide, roll: number): Route {
  switch (id) {
    case 'rockbus': {
      const reach = 170;
      return route(side, roll < 0.65, reach, [
        { to: reach - 50, speed: 8 },
        { to: reach + 50, speed: 2.4 },
        { to: 2 * reach, speed: 8 },
      ]);
    }
    case 'icecream':
      return pullOver(side, roll < 0.6, 170, 7, 14);
    case 'foodtruck':
      return pullOver(side, true, 170, 7, 40);
    case 'firetruck': {
      const reach = 220;
      return route(side, roll < 0.5, reach, [{ to: 2 * reach, speed: 17 }], { off: 0.8 });
    }
    case 'parade': {
      const reach = 90;
      return route(side, roll < 0.6, reach, [{ to: 2 * reach + STREET_SIZE.parade.len, speed: 2.2 }]);
    }
  }
}

/** How far ahead of a street event the cars give way: two seconds of it, and never under six metres. */
export const leadOf = (speed: number) => Math.max(6, speed * 2);

/** The middle of a street event's body `t` seconds in: its vehicle, or the middle of the parade's column. */
export function bodyAt(id: StreetEventId, r: Route, t: number, out: Pose): Pose {
  routeAt(r, t, out);
  if (id === 'parade') {
    const back = STREET_SIZE.parade.len / 2;
    out.z -= r.dir * back;
    out.u -= back;
  }
  return out;
}

/** Within this many metres of level with the office, a street event is passing it. */
export const PASSING = 30;

const passes = new Map<StreetEventId, [number, number]>();

/** When (seconds in) a street event's body is first and last within PASSING of level with the office, on its near lane. */
export function passing(id: StreetEventId): [number, number] {
  let p = passes.get(id);
  if (p) return p;
  const r = streetRoute(id, 'west', 0);
  const pose: Pose = { x: 0, z: 0, yaw: 0, speed: 0, u: 0 };
  const { len } = STREET_SIZE[id];
  // the parade's route is its front's; everything else's is its middle
  const back = id === 'parade' ? len : len / 2;
  const front = id === 'parade' ? 0 : len / 2;
  let first = -1;
  let last = -1;
  for (let t = 0; t <= r.drive.seconds; t += 0.25) {
    routeAt(r, t, pose);
    const lo = Math.min(pose.z - r.dir * back, pose.z + r.dir * front);
    const hi = Math.max(pose.z - r.dir * back, pose.z + r.dir * front);
    if (hi < -PASSING || lo > PASSING) continue;
    if (first < 0) first = t;
    last = t;
  }
  p = [first, last];
  passes.set(id, p);
  return p;
}
