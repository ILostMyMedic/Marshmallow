// Adapted from cubefarm client/src/world/events/director.ts (MIT): the night-only events (fireworks, meteors), the
// kaiju and the hurricane cut, and with them the weather, the day/night rules and Settings' frequency and calm mode;
// one fixed pace instead, quick to the first event so a visit sees one.

// World events outside: the catalogue (from an airliner crossing to a giant rubber duck floating past) and the director
// that picks one every so often. Pure and seeded (no three.js, no clock of its own: it's stepped with the render's
// seconds, so nothing happens while the office isn't on screen), so the schedule is tested without a browser.
// eventsState.ts runs it; scenes/ draws each event.

export const EVENT_IDS = ['plane', 'helicopter', 'birds', 'balloon', 'blimp', 'skywriting', 'ufo', 'rainbow', 'duck', 'whale'] as const;
export type EventId = (typeof EVENT_IDS)[number];

/** Everyday sights, fun ones, weird ones, and the absurd and rare. */
export type Tier = 'everyday' | 'fun' | 'weird' | 'absurd';

export interface EventDef {
  id: EventId;
  label: string;
  tier: Tier;
  /** Big events draw a crowd at the windows and never overlap each other; everyday ones can run alongside. */
  big: boolean;
  /** How likely, against the others that may happen now. */
  weight: number;
  /** How long it runs, seconds of render time. */
  seconds: number;
  /** The rare ones put a note over the view. */
  toast: boolean;
}

const def = (id: EventId, label: string, tier: Tier, weight: number, seconds: number): EventDef => ({
  id,
  label,
  tier,
  big: tier !== 'everyday',
  weight,
  seconds,
  toast: tier === 'weird' || tier === 'absurd',
});

export const EVENTS: Record<EventId, EventDef> = {
  plane: def('plane', 'An airliner crossing high', 'everyday', 10, 70),
  helicopter: def('helicopter', 'A helicopter circling the block', 'everyday', 6, 60),
  birds: def('birds', 'A flock of birds sweeping past', 'everyday', 8, 26),
  balloon: def('balloon', 'A hot-air balloon drifting by', 'everyday', 5, 95),
  blimp: def('blimp', 'A blimp with the office news', 'fun', 6, 85),
  skywriting: def('skywriting', "Skywriting the floor's name", 'fun', 3, 80),
  ufo: def('ufo', 'A UFO borrowing a car', 'weird', 2, 40),
  rainbow: def('rainbow', 'A rainbow', 'weird', 1, 70),
  duck: def('duck', 'A giant rubber duck floating past', 'absurd', 1, 75),
  whale: def('whale', 'A whale-shaped airship', 'absurd', 1, 85),
};

const ALIASES: Record<string, EventId> = {
  airliner: 'plane',
  jet: 'plane',
  heli: 'helicopter',
  chopper: 'helicopter',
  flock: 'birds',
  bird: 'birds',
  'hot-air-balloon': 'balloon',
  airship: 'blimp',
  skywriter: 'skywriting',
  'sky-writing': 'skywriting',
  saucer: 'ufo',
  'rubber-duck': 'duck',
  'whale-airship': 'whale',
};

/** An event's name as typed (`?event=duck`, __mmEvents.trigger('blimp')), or null when it isn't one. */
export function parseEventId(raw: unknown): EventId | null {
  if (typeof raw !== 'string') return null;
  const k = raw.trim().toLowerCase().replace(/[_\s]+/g, '-');
  return EVENT_IDS.includes(k as EventId) ? (k as EventId) : (ALIASES[k] ?? null);
}

export const parseEventParam = (search: string) => parseEventId(new URLSearchParams(search).get('event'));

// ---------- what happens next ----------

/** One event picked by weight (`roll` in [0, 1)), leaving out what's running and, while a big one runs, every big one. */
export function pickEvent(running: readonly { id: EventId; big: boolean }[], roll: number): EventId | null {
  const bigNow = running.some((r) => r.big);
  const options = Object.values(EVENTS).filter((e) => !running.some((r) => r.id === e.id) && !(bigNow && e.big));
  const total = options.reduce((a, e) => a + e.weight, 0);
  if (total <= 0) return null;
  let r = roll * total;
  for (const e of options) {
    r -= e.weight;
    if (r < 0) return e.id;
  }
  return options[options.length - 1].id;
}

/** Seconds to the first event after you arrive, and between events after that: noticeable, but now and then. */
export const FIRST: [number, number] = [60, 150];
export const GAP: [number, number] = [180, 480];

const within = ([a, b]: [number, number], roll: number) => a + (b - a) * Math.min(1, Math.max(0, roll));

/** When nothing may happen at the moment it's due (every event already on), look again in a bit. */
export const RETRY_SECONDS = 30;

// ---------- the director ----------

export interface Running {
  key: number;
  id: EventId;
  big: boolean;
  /** Director-clock seconds it ends at. */
  until: number;
}

export interface Director {
  /** Seconds of render time the director has run. */
  clock: number;
  nextAt: number;
  running: Running[];
  rand: () => number;
}

/** mulberry32: a tiny seeded random in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A director that has run for no time yet; its first event comes a minute or two in. */
export function newDirector(seed: number): Director {
  const rand = seeded(seed);
  return { clock: 0, nextAt: within(FIRST, rand()), running: [], rand };
}

/**
 * Moves the director on by dt seconds: what has finished drops out, and when the next event is due one is picked
 * (or, when none may happen now, it looks again shortly). Returns the event to start, or null.
 */
export function stepDirector(d: Director, dt: number): EventId | null {
  d.clock += dt;
  for (let i = d.running.length - 1; i >= 0; i--) if (d.running[i].until <= d.clock) d.running.splice(i, 1);
  if (d.clock < d.nextAt) return null;
  const id = pickEvent(d.running, d.rand());
  d.nextAt = d.clock + (id ? within(GAP, d.rand()) : RETRY_SECONDS);
  return id;
}

/** Records an event as running (scheduled or forced), until its time is up. */
export function startRunning(d: Director, key: number, id: EventId, seconds = EVENTS[id].seconds) {
  d.running.push({ key, id, big: EVENTS[id].big, until: d.clock + seconds });
}

/** An event ended early (or was replaced by a forced one). */
export function stopRunning(d: Director, key: number) {
  const i = d.running.findIndex((r) => r.key === key);
  if (i >= 0) d.running.splice(i, 1);
}
