// Adapted from cubefarm client/src/world/events/director.ts (MIT): the night-only events (fireworks, meteors), the
// kaiju and the hurricane cut, and with them the weather, the day/night rules and Settings' frequency and calm mode;
// one fixed pace instead, quick to the first event so a visit sees one.

// World events outside: the catalogue (from an airliner crossing to a giant rubber duck floating past) and the director
// that picks one every so often. Pure and seeded (no clock of its own: it's stepped with the seconds that passed), so
// the schedule is tested without a server. The office runs it (server/db/world.ts) for every tab at once; each tab
// draws what's on (client/src/world/events/).

export const EVENT_IDS = ['plane', 'helicopter', 'birds', 'balloon', 'blimp', 'skywriting', 'ufo', 'rainbow', 'duck', 'whale'] as const;
export type EventId = (typeof EVENT_IDS)[number];

/** Everyday sights, fun ones, weird ones, and the absurd and rare. */
export type Tier = 'everyday' | 'fun' | 'weird' | 'absurd';

/** The side of the building an event is on: where the windows to watch it from are. */
export type EventSide = 'west' | 'east';

export interface EventDef {
  id: EventId;
  label: string;
  tier: Tier;
  /** Big events draw a crowd at the windows and never overlap each other; everyday ones can run alongside. */
  big: boolean;
  /** How likely, against the others that may happen now. */
  weight: number;
  /** How long it runs, in seconds. */
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

// ---------- what's on, as the office sends it ----------

/** One event as the office runs it: every tab draws it from its start time and seed, so they all see the same. */
export interface WorldRun {
  key: number; // its row in the office's log of events
  id: EventId;
  side: EventSide;
  seed: number; // its own randomness (paths, colours)
  startedAt: number; // epoch ms, on the server's clock
  seconds: number;
  forced: boolean; // started on demand (?event=, __mmEvents) rather than by the director
}

/** The world events on now, and when the director picks the next one (epoch ms). */
export interface WorldView {
  running: WorldRun[];
  nextAt: number;
}

export const EMPTY_WORLD: WorldView = { running: [], nextAt: 0 };

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

/** Seconds to the first event (after the office opens), and between events after that: noticeable, but now and then. */
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
  /** Seconds on the director's clock (the server's: epoch seconds). */
  clock: number;
  nextAt: number;
  running: Running[];
  /** Its random's state (mulberry32's), so a saved schedule picks up where it left off. */
  state: number;
}

const STEP = 0x6d2b79f5;

/** mulberry32's output for a state. */
function mix(a: number): number {
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** mulberry32: a tiny seeded random in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + STEP) >>> 0;
    return mix(a);
  };
}

/** The director's next random number in [0, 1), moving its state on. */
export function roll(d: Director): number {
  d.state = (d.state + STEP) >>> 0;
  return mix(d.state);
}

/** Puts the next event a minute or two away: a new director, or an office opening after its next event was due. */
export function scheduleFirst(d: Director) {
  d.nextAt = d.clock + within(FIRST, roll(d));
}

/** A director starting at `clock`; its first event comes a minute or two in. */
export function newDirector(seed: number, clock = 0): Director {
  const d: Director = { clock, nextAt: clock, running: [], state: seed >>> 0 };
  scheduleFirst(d);
  return d;
}

/**
 * Moves the director on by dt seconds: what has finished drops out, and when the next event is due one is picked
 * (or, when none may happen now, it looks again shortly). Returns the event to start, or null.
 */
export function stepDirector(d: Director, dt: number): EventId | null {
  d.clock += dt;
  for (let i = d.running.length - 1; i >= 0; i--) if (d.running[i].until <= d.clock) d.running.splice(i, 1);
  if (d.clock < d.nextAt) return null;
  const id = pickEvent(d.running, roll(d));
  d.nextAt = d.clock + (id ? within(GAP, roll(d)) : RETRY_SECONDS);
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
