// The city's cars giving way to the street events (streetPath.ts): each street event holds the ground it covers, and
// a little ahead of it, and City.tsx asks trafficPose where each car is instead of carPose. A car coming up behind a
// slow one queues behind it, one crossing its path waits at the junction, and a fire engine's siren has the cars ahead
// of it pull over to the kerb. A car is held back by putting it later on its loop (its lag), so it carries on from
// where it waited once the way is clear. Pure apart from what's held and each car's lag, so it's tested without a
// browser.

import { carPose, LANE, type CarRoute } from '../cityLayout';
import { bodyAt, footprint, leadOf, STREET_SIZE, type Box, type Pose, type Route, type StreetEventId } from './streetPath';

/** What a street event holds: the ground it covers (and ahead of it), and for a siren, where it is on its street. */
export interface Hold extends Box {
  siren?: { line: number; dir: 1 | -1; z: number };
}

const body: Pose = { x: 0, z: 0, yaw: 0, speed: 0, u: 0 };

/** The ground street event `id` holds `t` seconds along route `r`: its body and the lead ahead of it, and the fire engine's siren. */
export function holdOf(id: StreetEventId, r: Route, t: number, out: Hold = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }): Hold {
  bodyAt(id, r, t, body);
  const { w, len } = STREET_SIZE[id];
  footprint(body, w, len, leadOf(body.speed), out);
  if (id !== 'firetruck') out.siren = undefined;
  else if (out.siren) Object.assign(out.siren, { line: r.x, dir: r.dir, z: body.z });
  else out.siren = { line: r.x, dir: r.dir, z: body.z };
  return out;
}

interface Held extends Hold {
  /** Frames it has been held for: on the first, a car under it is moved out of the way. */
  frames: number;
}

/** Front to back, a car stays this far from a street event; side to side, this far. */
export const GAP = 1.6;
export const SIDE_GAP = 0.15;
/** A car the siren comes up behind moves this far over to the kerb, starting when it's FAR off and all the way over by NEAR. */
export const PULL = { by: 1.6, near: 50, far: 100 };

const holds = new Map<number, Held>();

/** Holds ground for street event `key` (every frame, as it moves), or lets it go (null). */
export function holdStreet(key: number, hold: Hold | null) {
  if (!hold) {
    holds.delete(key);
    return;
  }
  const h = holds.get(key);
  if (h) {
    h.minX = hold.minX;
    h.maxX = hold.maxX;
    h.minZ = hold.minZ;
    h.maxZ = hold.maxZ;
    h.siren = hold.siren;
    h.frames++;
  } else holds.set(key, { ...hold, frames: 1 });
}

/** What's held now. */
export const streetHolds = (): readonly Hold[] => [...holds.values()];

interface At {
  x: number;
  z: number;
}

const smoothstep = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** How far over to the kerb (metres, 0 to PULL.by) a car at `at` pulls for a siren on its street going its way. */
export function pullFor(car: CarRoute, at: At, siren: NonNullable<Hold['siren']>): number {
  if (car.axis !== 'z' || car.line !== siren.line || car.dir !== siren.dir) return 0;
  return PULL.by * (1 - smoothstep(PULL.near, PULL.far, Math.abs(at.z - siren.z)));
}

/**
 * How far along its heading (m, < 0 back) a car at `at`, last seen at `from`, has to move to keep clear of `hold`: 0
 * when it's clear or beside it. A car coming up to it stops at the edge it came from; one already in its way when it
 * first appears is moved to the nearer edge; one it moved onto (crossing ahead of it) is let through, which the ground
 * held ahead of it leaves time for.
 */
export function clearance(car: CarRoute, at: At, from: At | null, hold: Hold, fresh = false): number {
  const along = car.axis === 'z' ? at.z : at.x;
  const across = car.axis === 'z' ? at.x : at.z;
  const [lo0, hi0, alo, ahi] = car.axis === 'z' ? [hold.minZ, hold.maxZ, hold.minX, hold.maxX] : [hold.minX, hold.maxX, hold.minZ, hold.maxZ];
  if (across + car.w / 2 <= alo - SIDE_GAP || across - car.w / 2 >= ahi + SIDE_GAP) return 0;
  const lo = lo0 - GAP - car.len / 2;
  const hi = hi0 + GAP + car.len / 2;
  if (along <= lo || along >= hi) return 0;
  let to: number;
  const was = from ? (car.axis === 'z' ? from.z : from.x) : null;
  // (a car held at an edge last frame is still coming from that side, give or take the rounding)
  if (fresh || was === null) to = along - lo < hi - along ? lo : hi;
  else if (was <= lo + 0.05) to = lo;
  else if (was >= hi - 0.05) to = hi;
  else return 0;
  return (to - along) * car.dir;
}

const lags: number[] = [];
const last: (At | null)[] = [];

/** carPose for car `index`, giving way to the street events: their sirens, and the ground they hold. Allocates nothing. */
export function trafficPose(car: CarRoute, index: number, time: number, out: { x: number; z: number; yaw: number }) {
  const lag = lags[index] ?? 0;
  carPose(car, time - lag, out);
  if (holds.size) {
    pullOver(car, out);
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (const h of holds.values()) {
        const move = clearance(car, out, last[index] ?? null, h, h.frames <= 2);
        if (!move) continue;
        lags[index] = (lags[index] ?? 0) - move / car.speed;
        carPose(car, time - lags[index], out);
        pullOver(car, out);
        moved = true;
      }
      if (!moved) break;
    }
  }
  const seen = last[index];
  if (seen) {
    seen.x = out.x;
    seen.z = out.z;
  } else last[index] = { x: out.x, z: out.z };
  return out;
}

function pullOver(car: CarRoute, out: At) {
  for (const h of holds.values()) {
    if (!h.siren) continue;
    const by = pullFor(car, out, h.siren);
    if (!by) continue;
    // keeping right, the kerb is further right: -x heading south, +x heading north
    if (car.axis === 'z') out.x = car.line - car.dir * (LANE + by);
  }
}

/** Forgets every hold and every car's lag (tests). */
export function resetTraffic() {
  holds.clear();
  lags.length = 0;
  last.length = 0;
}
