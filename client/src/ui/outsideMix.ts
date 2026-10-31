// The outside ambience's pure decisions (no WebAudio, so they're unit tested): how loud and how muffled the outside is
// from where you stand (out on a balcony or up on the roof, inside by an open side door or a window, or deep in the
// office), which layers the time of day brings (birds by day, the city at dusk, crickets at night, more wind on the
// roof), how often its bursts may come, and the shape of each bird call and cricket phrase. outsideSfx.ts plays them.
// Adapted from cubefarm client/src/ui/outsideMix.ts (MIT): much louder indoors (a muffled bed rather than near silence),
// the windows, the lobby's street, the CEO's floor and the fire's crackle are new; the clock is dayTime.ts's.

import { nightFactor } from '../world/dayTime';
import type { FloorKindOf } from '../world/floors';
import { BALCONY, HALF_D, HALF_W, SIDE_OPENINGS, SIDES, WALL_T, WINDOW, sideSign, type Side } from '../world/layout';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// ---------- where you stand ----------

/** The outside deep inside the office, through the walls and the glass: a muffled but clearly present bed. */
export const LEAK = 0.45;
export const LEAK_CLARITY = 0.45;
/** The lobby is on the street: a little more of it comes in. */
export const LOBBY_LEAK = 0.55;
/** The most the outside gets indoors, right by a wide-open side door. */
export const DOOR_LEVEL = 0.85;
/** How clear (0 muffled, 1 open air) the outside sounds through a wide-open door, from right beside it. */
export const DOOR_CLARITY = 0.7;
/** Beyond this distance (metres) from an open door, it adds nothing. */
export const DOOR_REACH = 8;
/** Right at a window: louder and clearer than deep inside, the birds coming through the glass. */
export const WINDOW_LEVEL = 0.8;
export const WINDOW_CLARITY = 0.6;
/** Beyond this distance (metres) from a window's glass, it adds nothing. */
export const WINDOW_REACH = 4.5;
/** The lowpass cutoff (Hz) with the outside fully muffled (clarity 0) and in the open (clarity 1). */
export const MUFFLED_HZ = 320;
export const OPEN_HZ = 14000;
/** Bursts (bird calls, cars, crickets) are only scheduled above this level: deep inside, just the faint bed. */
export const BURST_LEVEL = 0.08;
/** How much windier it is up on the roof than on a balcony. */
export const ROOF_WIND = 1.6;
/** On the lobby's street: how much more of the city, and of its traffic. */
export const STREET = { city: 1.25, cars: 1.6 };

const BALCONY_IN = HALF_W + WALL_T;

export interface OutsideHearing {
  /** 0-1 gain on the whole ambience. */
  level: number;
  /** 0 muffled to 1 open air: the lowpass cutoff (cutoffHz). */
  clarity: number;
  /**
   * Where it comes from while you're inside (the open door or the window you hear it through), for panning; null out
   * on a balcony or deep inside, where it's all around.
   */
  from: { x: number; z: number } | null;
}

/**
 * How the outside sounds for a listener at (x, z) on a floor of `kind`, with each side door `open` 0-1. Out on a
 * balcony (or the lobby's patio) it's full and clear, rising as you step through the doorway; inside it comes through
 * an open door, fuller the nearer you are, or louder through the glass by a window; deep inside it's a muffled bed
 * (a little more in the lobby, on the street). The roof is all outside, but for the elevator cabin.
 */
export function outsideHearing(kind: FloorKindOf, x: number, z: number, open: Readonly<Record<Side, number>>): OutsideHearing {
  if (kind === 'roof') return z > HALF_D ? { level: DOOR_LEVEL, clarity: DOOR_CLARITY, from: { x: 0, z: HALF_D } } : { level: 1, clarity: 1, from: null };
  let level = kind === 'lobby' ? LOBBY_LEAK : LEAK;
  let clarity = LEAK_CLARITY;
  let from: OutsideHearing['from'] = null;
  let best = 0;
  for (const side of SIDES) {
    const s = sideSign(side);
    const wallX = s * (HALF_W + WALL_T / 2);
    // From the inside face of the wall to a step out onto the balcony.
    const out = z >= BALCONY.minZ && z <= BALCONY.maxZ ? smoothstep(HALF_W, BALCONY_IN + 0.6, s * x) : 0;
    const openings = SIDE_OPENINGS[kind][side];
    // Measured from the indoor side: once you're in the doorway it's as near as it gets.
    const inward = Math.max(0, s * (wallX - x));
    const near = clamp01(1 - Math.hypot(inward, z - openings.door) / DOOR_REACH) ** 2;
    const through = clamp01(open[side]) * near;
    level = Math.max(level, out, DOOR_LEVEL * through);
    clarity = Math.max(clarity, out, DOOR_CLARITY * through);
    let heard = Math.max(out, DOOR_LEVEL * through);
    if (heard > best) {
      best = heard;
      from = out < 1 ? { x: wallX, z: openings.door } : null;
    }
    for (const wz of openings.windows) {
      const glass = clamp01(1 - Math.hypot(inward, Math.max(0, Math.abs(z - wz) - WINDOW.w / 2)) / WINDOW_REACH);
      level = Math.max(level, WINDOW_LEVEL * glass);
      clarity = Math.max(clarity, WINDOW_CLARITY * glass);
      heard = WINDOW_LEVEL * glass;
      if (heard > best) {
        best = heard;
        from = { x: wallX, z: wz };
      }
    }
  }
  return { level, clarity, from };
}

/** The muffling lowpass's cutoff for a clarity, sliding evenly in pitch from MUFFLED_HZ to OPEN_HZ. */
export const cutoffHz = (clarity: number) => MUFFLED_HZ * (OPEN_HZ / MUFFLED_HZ) ** clamp01(clarity);

// ---------- what time of day it is ----------

export interface OutsideLayers {
  /** 0-1 levels of each layer (the wind goes over 1 on the roof, the city in the lobby). */
  wind: number;
  city: number;
  birds: number;
  crickets: number;
  /** The city hum's lowpass (Hz): deeper at night. */
  cityHz: number;
  /** Cars going by, on average, per minute. */
  carsPerMin: number;
}

/**
 * The layers at day phase t (0 midnight, 0.5 noon): birds by day with a dawn chorus, the city loudest at dusk, crickets
 * and a quieter, deeper city at night; on the roof, more wind; in the lobby, more street.
 */
export function outsideLayers(t: number, kind: FloorKindOf = 'office'): OutsideLayers {
  const night = nightFactor(t);
  const x = t - Math.floor(t);
  const dusk = 1 - smoothstep(0.015, 0.06, Math.abs(x - 0.765));
  const dawn = 1 - smoothstep(0.01, 0.05, Math.abs(x - 0.27));
  const street = kind === 'lobby';
  return {
    wind: lerp(1, 0.8, night) * (kind === 'roof' ? ROOF_WIND : 1),
    city: clamp01(lerp(0.75, 0.45, night) + 0.25 * dusk) * (street ? STREET.city : 1),
    birds: clamp01((1 - night) * (1 - 0.6 * dusk) + 0.3 * dawn),
    crickets: smoothstep(0.35, 1, night),
    cityHz: lerp(240, 120, night),
    carsPerMin: (lerp(2.5, 0.6, night) + 1.5 * dusk) * (street ? STREET.cars : 1),
  };
}

// ---------- bursts, rate-limited ----------

/** Shortest gaps (seconds) between bird calls, cars and cricket phrases (per cricket), whatever the dice say. */
export const MIN_GAP = { bird: 2.5, car: 8, cricket: 1.2 } as const;

/** Seconds until the next bird call (one of a few birds about), for `birds` 0-1 and a roll in [0, 1); Infinity without birds. */
export function nextBirdIn(birds: number, roll: number): number {
  if (birds < 0.05) return Infinity;
  return MIN_GAP.bird + (1.5 + 8 * clamp01(roll)) / birds;
}

/** Seconds until the next car goes by: random arrivals at `perMin` a minute, never closer than MIN_GAP.car. */
export function nextCarIn(perMin: number, roll: number): number {
  if (perMin <= 0) return Infinity;
  return Math.max(MIN_GAP.car, (-Math.log(1 - Math.min(clamp01(roll), 0.999)) * 60) / perMin);
}

/** Seconds of rest before a cricket's next phrase, for `crickets` 0-1; Infinity without crickets. */
export function nextCricketIn(crickets: number, roll: number): number {
  if (crickets < 0.05) return Infinity;
  return MIN_GAP.cricket + (0.5 + 4 * clamp01(roll)) / crickets;
}

/** Seconds before looking again for a burst that isn't due at all (no birds at night, no crickets by day). */
export const RECHECK = 5;

/** When a burst checked `now` is next due, given its wait: never Infinity, so it comes back when its layer does. */
export function nextDueAt(now: number, wait: number): number {
  return now + (Number.isFinite(wait) ? wait : RECHECK);
}

/** The roof's fire: a crackle every so often (seconds, for a roll in [0, 1)), now and then in a quick run of them. */
export const CRACKLE_GAP = { min: 0.06, max: 0.9 } as const;
export const nextCrackleIn = (roll: number) => Math.min(CRACKLE_GAP.max, CRACKLE_GAP.min + (CRACKLE_GAP.max - CRACKLE_GAP.min) * clamp01(roll) ** 2);

// ---------- the calls themselves ----------

/** One note: starts `at` seconds into the call, glides from `from` to `to` Hz over `dur`, at `peak` (0-1 of the call's level). */
export interface Note {
  at: number;
  dur: number;
  from: number;
  to: number;
  peak: number;
}

/** The longest a bird call may last (seconds): a voice is free again after it. */
export const BIRD_CALL_MAX = 1.6;

/**
 * One bird call from `rand` (a source of [0, 1) numbers): a tweet-tweet, a "pee-oo" whistle, a trill or a warble, with
 * its pitch, count and spacing varied, so no two calls in a row are quite the same.
 */
export function birdCall(rand: () => number): Note[] {
  const notes: Note[] = [];
  const pitch = 0.85 + rand() * 0.35;
  const kind = Math.floor(rand() * 4);
  if (kind === 0) {
    // tweet tweet: a few short rising chirps
    const n = 2 + Math.floor(rand() * 3);
    const gap = 0.12 + rand() * 0.08;
    for (let i = 0; i < n; i++) notes.push({ at: i * gap, dur: 0.06 + rand() * 0.03, from: 2600 * pitch, to: 3900 * pitch, peak: 0.8 + rand() * 0.2 });
  } else if (kind === 1) {
    // pee-oo: up a little, then a long fall
    notes.push({ at: 0, dur: 0.18, from: 3100 * pitch, to: 3500 * pitch, peak: 0.8 });
    notes.push({ at: 0.24 + rand() * 0.06, dur: 0.3, from: 3400 * pitch, to: 2300 * pitch, peak: 1 });
  } else if (kind === 2) {
    // a trill: quick high notes, slightly wobbling
    const n = 6 + Math.floor(rand() * 6);
    for (let i = 0; i < n; i++) {
      const f = (4200 + (i % 2) * 300) * pitch;
      notes.push({ at: i * 0.06, dur: 0.035, from: f, to: f * 0.92, peak: 0.55 + 0.45 * (1 - i / n) });
    }
  } else {
    // a warble: a few notes wandering up and down
    const n = 3 + Math.floor(rand() * 3);
    for (let i = 0, at = 0; i < n; i++) {
      const f = (2800 + rand() * 1600) * pitch;
      const dur = 0.07 + rand() * 0.06;
      notes.push({ at, dur, from: f, to: f * (0.85 + rand() * 0.35), peak: 0.7 + rand() * 0.3 });
      at += dur + 0.03 + rand() * 0.06;
    }
  }
  return notes;
}

/** The longest a cricket phrase may last (seconds). */
export const CRICKET_PHRASE_MAX = 6;

/**
 * One cricket phrase: chirps of 3-4 quick pulses, every half second or so, for a few seconds. Returns the pulses
 * (`from`/`to` are unused offsets, 0: the cricket keeps its pitch).
 */
export function cricketPhrase(rand: () => number): Note[] {
  const pulses: Note[] = [];
  const every = 0.45 + rand() * 0.3;
  const per = 3 + Math.floor(rand() * 2);
  const chirps = Math.floor((2.5 + rand() * 3) / every);
  for (let c = 0; c < chirps; c++) {
    const peak = 0.6 + rand() * 0.4;
    for (let p = 0; p < per; p++) pulses.push({ at: c * every + p * 0.04, dur: 0.022, from: 0, to: 0, peak });
  }
  return pulses.filter((n) => n.at + n.dur <= CRICKET_PHRASE_MAX);
}
