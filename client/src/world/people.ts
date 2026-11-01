// Adapted from cubefarm client/src/world/people.ts (MIT): body targets, speech bubbles, errands, mugs, food and
// snacks in hand, and who's out of sight; without the faces, the hand-sent errands or cubefarm's full probe.

// The people controller: where each worker's body should be (body.ts). Nobody listed here sits at their desk. Plain
// module state, read by Character.tsx every frame, so moving someone never re-renders React.
// window.__mmPeople.list() reports where everyone is and which errand (errands.ts) they're on, for QA and Playwright;
// place(), pose(), say(), mug(), snack() and food() stage someone for a check (a gesture, a bubble, something in hand).

import { WALK_SPEED, type BodyMode, type BodyState, type BodyTarget, type Gesture } from './body';
import type { SnackId } from './fridge';
import type { Food } from './ritualSchedule';

const targets = new Map<string, BodyTarget>();
const live = new Map<string, BodyState>();
const busy = new Map<string, ErrandInfo>();
const said = new Map<string, Saying>();
let teleports = 0;
let director: (() => unknown) | null = null;

/** The errand someone is on, as the probe shows it. */
export interface ErrandInfo {
  name: string;
  phase: string;
  spot: string;
}

/** This worker's body target, or undefined to stay (or go back to being) seated. */
export const bodyTarget = (id: string) => targets.get(id);

/** Sends someone to stand or walk somewhere. Fields left out keep their current value, except `strafe`, which only lasts while it's asked for. */
export function setBody(id: string, patch: Partial<Omit<BodyTarget, 'teleport'>>) {
  const t = targets.get(id) ?? { mode: 'walking' as BodyMode, x: 0, z: 0, heading: 0, speed: WALK_SPEED, gesture: 'none' as Gesture, teleport: 0 };
  targets.set(id, { ...t, strafe: false, ...patch });
}

/** Stands someone at (x, z) straight away, facing heading (a new hire inside the elevator, say). */
export function placeBody(id: string, x: number, z: number, heading = 0) {
  setBody(id, { mode: 'standing', x, z, heading });
  targets.set(id, { ...targets.get(id)!, teleport: ++teleports });
}

/** Back to their chair: they walk to the standing spot beside it and sit down. */
export const seatBody = (id: string) => void targets.delete(id);

/** A speech bubble: what someone says (an emoji or a short line), performance.now() when they started and when it ends. */
export interface Saying {
  text: string;
  at: number;
  /** performance.now() when it goes away by itself; absent: until hidden. */
  until?: number;
}

const sayListeners = new Set<(id: string, text: string | null) => void>();

/** Hears every bubble as it goes up (its text) or comes down (null): ui/voices.ts says them out loud. */
export function onSay(fn: (id: string, text: string | null) => void) {
  sayListeners.add(fn);
  return () => void sayListeners.delete(fn);
}

/** Shows a speech bubble over someone (null hides it), for `seconds` or until hidden. Character.tsx draws it. */
export function say(id: string, text: string | null, seconds?: number) {
  const at = performance.now();
  if (text) said.set(id, { text, at, until: seconds ? at + seconds * 1000 : undefined });
  else said.delete(id);
  for (const fn of sayListeners) fn(id, text);
}

/** What someone is saying now, if anything. */
export function saying(id: string) {
  const s = said.get(id);
  if (s?.until !== undefined && performance.now() >= s.until) {
    said.delete(id);
    return undefined;
  }
  return s;
}

/** Everyone you can see on the current floor, as they are now (the elevator opens for anyone near its doors). */
export function* bodies() {
  for (const [id, s] of live) if (!hidden.has(id)) yield s;
}

/** Character.tsx registers each person's live state, so the probe and the errands can read it. */
export function trackBody(id: string, s: BodyState) {
  live.set(id, s);
  return () => {
    if (live.get(id) === s) live.delete(id);
  };
}

/** Everyone drawn on the current floor, by worker id. */
export const liveBodies = (): ReadonlyMap<string, BodyState> => live;

/** Someone's live body (where they are now), while they're drawn on the current floor. */
export const bodyState = (id: string) => live.get(id);

/** The errand director (ErrandDirector.tsx) says who is on which errand; null when they're at their desk. */
export function setErrand(id: string, info: ErrandInfo | null) {
  if (info) busy.set(id, info);
  else busy.delete(id);
}

/** Whether the errand director has them out on an errand (rather than something else moving them). */
export const onErrand = (id: string) => busy.has(id);

/** The errand someone is on, and how far along, while they're on one. */
export const errandOf = (id: string): Readonly<ErrandInfo> | undefined => busy.get(id);

const claimers = new Set<(id: string) => void>();

/** The errand director lets go of anyone claimed by something that beats an errand (the gong run). */
export function onClaim(fn: (id: string) => void) {
  claimers.add(fn);
  return () => void claimers.delete(fn);
}

/** Takes someone off their errand there and then; their body target goes too, for the caller to set the next. */
export function claimBody(id: string) {
  for (const fn of claimers) fn(id);
  busy.delete(id);
  targets.delete(id);
}

/** The director on the current floor reports its summary through the probe while it runs. */
export function trackDirector(report: () => unknown) {
  director = report;
  return () => {
    if (director === report) director = null;
  };
}

/** In their chair and staying there (nobody told to get up, not rising, walking or sitting back down). */
export const isSeated = (id: string) => !targets.has(id) && (live.get(id)?.stage ?? 'seated') === 'seated';

// ---------- mugs ----------

/** A mug someone holds, or one they left on their desk (until `until`, a Date.now() time). */
export interface PersonMug {
  id: string;
  sips: number;
}

const hands = new Map<string, PersonMug>();
const desks = new Map<string, PersonMug & { until: number }>();
const mugListeners = new Set<() => void>();
const changed = () => {
  for (const fn of mugListeners) fn();
};

/** Character.tsx and Desk.tsx redraw when someone's mugs (or food) change (rarely: a mug taken, a sip, back at the desk). */
export function subscribeMugs(fn: () => void) {
  mugListeners.add(fn);
  return () => void mugListeners.delete(fn);
}

/** The mug in someone's hand; null for none. */
export const handMug = (id: string) => hands.get(id) ?? null;

export function setHandMug(id: string, mug: PersonMug | null) {
  if (mug) hands.set(id, mug);
  else hands.delete(id);
  changed();
}

/** A coffee someone brought back to their desk, while it's still there. */
export function deskMug(id: string, now = Date.now()) {
  const d = desks.get(id);
  return d && d.until > now ? d : null;
}

export function setDeskMug(id: string, mug: PersonMug, seconds: number) {
  desks.set(id, { ...mug, until: Date.now() + seconds * 1000 });
  changed();
}

// ---------- food in hand, and out of sight ----------

const food = new Map<string, Food>();
const hidden = new Set<string>();

/** What someone eats at lunch, drawn in their hand; null for nothing. Redraws like the mugs. */
export function setHandFood(id: string, f: Food | null) {
  if ((food.get(id) ?? null) === f) return;
  if (f) food.set(id, f);
  else food.delete(id);
  changed();
}

export const handFood = (id: string) => food.get(id) ?? null;

/** A snack from the fridge in someone's hand (snackBreak.ts), and the sips or bites left of it. */
export interface HandSnack {
  snack: SnackId;
  left: number;
}

const snacks = new Map<string, HandSnack>();

/** Puts a snack in someone's hand (null: none). Redraws like the mugs. */
export function setHandSnack(id: string, s: HandSnack | null) {
  if (!s && !snacks.has(id)) return;
  if (s) snacks.set(id, s);
  else snacks.delete(id);
  changed();
}

export const handSnack = (id: string) => snacks.get(id) ?? null;

/** Everyone with a snack in hand. */
export const snackHolders = () => [...snacks.keys()];

/** Someone Character.tsx shouldn't draw (the CEO off round the floors, say). */
export function setHidden(id: string, on: boolean) {
  if (on) hidden.add(id);
  else hidden.delete(id);
}

export const isHidden = (id: string) => hidden.has(id);

// ---------- the probe ----------

const round = (n: number) => Math.round(n * 100) / 100;
const modeOf = (s: BodyState): BodyMode => (s.stage === 'seated' ? 'seated' : s.speed > 0.05 ? 'walking' : 'standing');

const probe = {
  /** Everyone drawn on the current floor. */
  list() {
    return [...live].map(([id, s]) => ({
      id,
      mode: modeOf(s),
      stage: s.stage,
      x: round(s.x),
      z: round(s.z),
      heading: round(s.heading),
      errand: busy.get(id) ?? null,
      says: saying(id)?.text ?? null,
      target: targets.get(id) ?? null,
      mug: hands.get(id) ?? null,
      food: food.get(id) ?? null,
      snack: snacks.get(id) ?? null,
      hidden: hidden.has(id),
    }));
  },
  /** The errand director on this floor: how many are away, the cap, who is queued. Null on a floor without one. */
  errands() {
    return director?.() ?? null;
  },
  /** For checks: stand someone somewhere doing a gesture (setBody's fields), or send them back to their chair. */
  pose(id: string, patch: Partial<Omit<BodyTarget, 'teleport'>> | null) {
    if (patch) setBody(id, patch);
    else seatBody(id);
  },
  /** For checks: someone stood at (x, z) facing `heading` at once (doing `gesture`). */
  place(id: string, x: number, z: number, heading = 0, gesture: Gesture = 'none') {
    placeBody(id, x, z, heading);
    setBody(id, { gesture });
  },
  /** For checks: a bubble over someone, and a mug in their hand. */
  say: (id: string, text: string | null, seconds?: number) => say(id, text, seconds),
  mug: (id: string, on: boolean) => setHandMug(id, on ? { id: `probe-${id}`, sips: 3 } : null),
  /** For checks: a snack (fridge.ts) or lunch (ritualSchedule.ts) in someone's hand; null takes it away. */
  snack: (id: string, snack: SnackId | null) => setHandSnack(id, snack ? { snack, left: 3 } : null),
  food: (id: string, f: Food | null) => setHandFood(id, f),
};

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__mmPeople = probe;
