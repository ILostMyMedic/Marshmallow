// Adapted from cubefarm client/src/world/ritualSchedule.ts (MIT): lunch and the stand-up only (no pizza, evening or
// CEO walk), and the stand-up counts the issues the server reports filed instead of diffing the open ones.

// Office rituals, the pure part: when the stand-up (a burst of new issues on the floor) and lunch happen, decided from
// the office clock (dayTime.ts) and what's going on on the floor, plus where everyone stands for them. Rituals.tsx runs
// it on the floor you're on. No three.js, no store: every rule is tested without a browser.

import { kanbanColumnSpan } from './draw';
import { CYCLE_MS, type DayMode } from './dayTime';
import { BOARD, COFFEE_TABLE, HALF_D, HALF_W } from './layout';
import type { Pt } from './nav';
import type { Spot } from './walkways';

export const RITUALS = ['standup', 'lunch'] as const;
export type Ritual = (typeof RITUALS)[number];

/** `?ritual=lunch` forces that ritual on the floor you're on (QA); null when absent or unknown. */
export function parseRitualParam(search: string): Ritual | null {
  const raw = new URLSearchParams(search).get('ritual');
  return RITUALS.includes(raw as Ritual) ? (raw as Ritual) : null;
}

// ---------- the clock ----------

export interface OfficeClock {
  /** The office's hour of the day, 0 to 24: the day's phase (dayTime.ts) times 24. */
  hour: number;
  /** 0 Sunday … 6 Saturday. */
  weekday: number;
  /** The office day, as a key that changes at the office's midnight, and when it began (epoch ms). */
  day: string;
  dayStart: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The office clock at `now` (epoch ms) and day phase `t`. In the 30-minute cycle every cycle is a day of its own (with
 * its own lunch); otherwise days are the viewer's local days. Weekdays are always the real ones.
 */
export function officeClock(now: number, t: number, mode: DayMode): OfficeClock {
  const d = new Date(now);
  const hour = (((t % 1) + 1) % 1) * 24;
  if (mode === 'cycle') {
    const k = Math.floor(now / CYCLE_MS);
    return { hour, weekday: d.getDay(), day: `cycle-${k}`, dayStart: k * CYCLE_MS };
  }
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return { hour, weekday: d.getDay(), day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, dayStart: start };
}

// ---------- lunch ----------

/** Lunch: noon to 1 pm. */
export const LUNCH = { from: 12, to: 13 };

export const isLunch = (h: number) => h >= LUNCH.from && h < LUNCH.to;

// ---------- the stand-up ----------

/**
 * A stand-up: at least `min` issues new to the floor within `window` seconds, the newest `settle` seconds old (the CEO
 * may still be filing), at most one every `gap` seconds; the presenter puts up at most `stickies` of them.
 */
export const STANDUP = { min: 2, window: 120, settle: 4, gap: 150, stickies: 6 };

/** An issue the server reported filed on the floor, seen at `at` (the ritual clock's seconds). */
export interface Fresh {
  n: number;
  at: number;
}

/** Whether the fresh issues (within the window) make a stand-up now. */
export function standupDue(fresh: readonly Fresh[], now: number, lastStandup: number): boolean {
  const recent = fresh.filter((f) => now - f.at <= STANDUP.window);
  if (recent.length < STANDUP.min || now - lastStandup < STANDUP.gap) return false;
  return now - Math.max(...recent.map((f) => f.at)) >= STANDUP.settle;
}

// ---------- the scheduler ----------

/** What the scheduler remembers between looks (one per floor visit). */
export interface RitualState {
  lunch: boolean;
  /** When the last stand-up started (the ritual clock's seconds). */
  standupAt: number;
  fresh: Fresh[];
}

export const newRitualState = (): RitualState => ({ lunch: false, standupAt: -Infinity, fresh: [] });

/**
 * Issues the server just reported filed on this floor (an `issuesFiled` moment's numbers), seen at `now` on the ritual
 * clock. Feed it only the moments that arrive while the floor is on screen: issues filed while you were away are old news.
 */
export function fileIssues(s: RitualState, numbers: readonly number[], now: number) {
  for (const n of numbers) if (!s.fresh.some((f) => f.n === n)) s.fresh.push({ n, at: now });
}

/** What the scheduler looks at. */
export interface Facts {
  /** The ritual clock (seconds of you watching; it stops while the 3D view is paused). */
  now: number;
  clock: OfficeClock;
  /** A stand-up is already under way here: the next waits for it. */
  standupOn: boolean;
}

export type Decision = { do: 'standup'; issues: number[] } | { do: 'lunch'; on: boolean };

/** Everything that starts or changes now, in order; `s` moves on. */
export function schedule(s: RitualState, f: Facts): Decision[] {
  const out: Decision[] = [];
  const lunch = isLunch(f.clock.hour);
  if (lunch !== s.lunch) {
    s.lunch = lunch;
    out.push({ do: 'lunch', on: lunch });
  }
  s.fresh = s.fresh.filter((x) => f.now - x.at <= STANDUP.window);
  if (!f.standupOn && standupDue(s.fresh, f.now, s.standupAt)) {
    out.push({ do: 'standup', issues: s.fresh.map((x) => x.n).sort((a, b) => a - b).slice(-STANDUP.stickies) });
    s.fresh = [];
    s.standupAt = f.now;
  }
  return out;
}

// ---------- where ----------

/** The Backlog column's middle on the whiteboard (x), as drawKanban lays the columns out (any canvas width will do). */
const backlog = kanbanColumnSpan(0, 2560);
const BACKLOG_X = -BOARD.w / 2 + ((backlog.x0 + backlog.colW / 2) / 2560) * BOARD.w;

/** Where the CEO presents a stand-up: at the right edge of the Backlog column, a step out from the board. */
export const PRESENTER: Pt = { x: BACKLOG_X + 1.45, z: -HALF_D + 1.35 };

/** Facing (walkways.ts: 0 east, π/2 south) from `from` towards `to`. */
export const facingTo = (from: Pt, to: Pt) => Math.atan2(to.z - from.z, to.x - from.x);

/**
 * Where the team stands at a stand-up: `n` spots on an arc round the presenter, `r` metres away, spread `spread`
 * radians either side of straight out from the board, each facing the presenter.
 */
export function semicircle(center: Pt, n: number, r = 2.3, spread = 1.05): Spot[] {
  return Array.from({ length: n }, (_, i) => {
    const a = n === 1 ? 0 : -spread + (2 * spread * i) / (n - 1);
    const x = center.x + Math.sin(a) * r;
    const z = center.z + Math.cos(a) * r;
    return { id: `standup-${i}`, x, z, facing: facingTo({ x, z }, center) };
  });
}

/** How many stand at a stand-up, at most. The walker cap (errands.ts) usually lets fewer go. */
export const STANDUP_SPOTS = 6;

const WEST = Math.PI;
const EAST = 0;
const NORTH = -Math.PI / 2;
const SOUTH = Math.PI / 2;

/** Round the coffee table by the couch: lunch. */
export const TABLE_SPOTS: readonly Spot[] = [
  { id: 'table-e0', x: COFFEE_TABLE.x + 1.05, z: 6.1, facing: WEST },
  { id: 'table-e1', x: COFFEE_TABLE.x + 1.05, z: 6.9, facing: WEST },
  { id: 'table-s', x: COFFEE_TABLE.x, z: 7.85, facing: NORTH },
  { id: 'table-n', x: COFFEE_TABLE.x, z: 5.15, facing: SOUTH },
];

/** By the kitchenette's counter, past the coffee machine: lunch too. */
export const KITCHEN_SPOTS: readonly Spot[] = [
  { id: 'kitchen-0', x: HALF_W - 1.55, z: 8.75, facing: EAST },
  { id: 'kitchen-1', x: HALF_W - 1.55, z: 9.6, facing: EAST },
  { id: 'kitchen-2', x: HALF_W - 2.6, z: 9.2, facing: EAST },
];

/** The first spot of `spots` nobody has (`taken`), nearest `from`; null when they're all taken. */
export function freeSpot<T extends Spot>(spots: readonly T[], taken: ReadonlySet<string>, from: Pt): T | null {
  let best: T | null = null;
  let bd = Infinity;
  for (const s of spots) {
    if (taken.has(s.id)) continue;
    const d = Math.hypot(s.x - from.x, s.z - from.z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

// ---------- food ----------

export type Food = 'lunchbox' | 'sandwich' | 'noodles';
const LUNCHES: readonly Food[] = ['lunchbox', 'sandwich', 'noodles'];

/** What someone has for lunch: the same every day (by their id). */
export function lunchOf(id: string): Food {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return LUNCHES[h % LUNCHES.length];
}
