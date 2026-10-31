// Roof breaks: now and then an idle worker rides the elevator up to the roof for a sit in a deck chair or by the fire,
// or a look through the binoculars, and the CEO goes up to take a call. Who is up there is kept here, shared by the
// floors' errand (roofErrand.ts: into the elevator and, a while later, back out of it) and the roof's own visitors
// (RoofPeople.tsx: out of the elevator, to their seat and back), so whoever you follow up finds them there. The rules
// are pure; times are Date.now() ms.
// Adapted from cubefarm client/src/world/roof/roofBreaks.ts (MIT): a visit takes any seat (a chair, the fire, a lookout)
// rather than a deck chair, a look through the binoculars is shorter, and a few more may be up at once.

import type { SeatKind } from './roofLayout';

export type VisitKind = 'break' | 'call';

export interface RoofVisit {
  id: string;
  kind: VisitKind;
  /** When they step out of the elevator up top, and when they head back down. */
  arrive: number;
  leave: number;
  /** Their seat on a break (roofLayout.ts ROOF_SEATS); '' for a call. */
  seat: string;
}

export const ROOF_BREAK = {
  /** Seconds up there sitting down, looking through the binoculars, and on a call. */
  stay: [50, 100] as const,
  look: [25, 45] as const,
  call: [35, 70] as const,
  /** Seconds the elevator takes between a floor and the roof. */
  ride: 4,
  /** At most this many on a break at once; the CEO's call comes on top. */
  max: 4,
  /** How likely a roof break is among the idle errands someone fancies (rare), and the CEO's call among theirs. */
  weight: 0.2,
  callWeight: 0.35,
};

const SECOND = 1000;

/** Whether a visit is still on at `now`: on the way up, up there, or riding back down. */
export const visitOn = (v: RoofVisit, now: number) => now < v.leave + ROOF_BREAK.ride * SECOND;

/** Where a visit is at `now`: riding up, up on the roof, or heading back down (and then gone). */
export function visitStage(v: RoofVisit, now: number): 'riding' | 'up' | 'down' {
  if (now < v.arrive) return 'riding';
  return now < v.leave ? 'up' : 'down';
}

/** A seat for a new visitor: one nobody is in or heading for (the player's included), or null when all are taken. */
export function freeSeat<T extends { id: string }>(visits: readonly RoofVisit[], seats: readonly T[], playerSeat: string | null, rand: number): T | null {
  const taken = new Set(visits.filter((v) => v.kind === 'break').map((v) => v.seat));
  if (playerSeat !== null) taken.add(playerSeat);
  const free = seats.filter((s) => !taken.has(s.id));
  return free.length ? free[Math.min(free.length - 1, Math.floor(rand * free.length))] : null;
}

/** Whether there's room up there for another visit of this kind (someone already up can't go again). */
export function roomFor(visits: readonly RoofVisit[], id: string, kind: VisitKind, now: number): boolean {
  const on = visits.filter((v) => visitOn(v, now));
  if (on.some((v) => v.id === id)) return false;
  return kind === 'call' ? !on.some((v) => v.kind === 'call') : on.filter((v) => v.kind === 'break').length < ROOF_BREAK.max;
}

/**
 * A new visit for `id`, stepping out up top `ride` seconds from now (the elevator) and staying a while (`rand` in
 * [0, 1) picks the seat and how long). Null when there's no room or no free seat.
 */
export function planVisit(
  visits: readonly RoofVisit[],
  id: string,
  kind: VisitKind,
  now: number,
  rand: number,
  o: { seats: readonly { id: string; kind: SeatKind }[]; playerSeat: string | null; ride?: number; stay?: number },
): RoofVisit | null {
  if (!roomFor(visits, id, kind, now)) return null;
  const on = visits.filter((v) => visitOn(v, now));
  const seat = kind === 'break' ? freeSeat(on, o.seats, o.playerSeat, rand) : null;
  if (kind === 'break' && !seat) return null;
  const [lo, hi] = kind === 'call' ? ROOF_BREAK.call : seat?.kind === 'lookout' ? ROOF_BREAK.look : ROOF_BREAK.stay;
  const arrive = now + (o.ride ?? ROOF_BREAK.ride) * SECOND;
  return { id, kind, arrive, leave: arrive + Math.round((o.stay ?? lo + rand * (hi - lo)) * SECOND), seat: seat?.id ?? '' };
}

// ---------- a word or two ----------

/** What people up here say, by where they are: an emoji in a bubble. */
export const ROOF_EMOJI: Record<SeatKind | 'call', readonly string[]> = {
  chair: ['😎', '💬', '😄', '🌤️', '👍', '🍹'],
  fire: ['🔥', '😄', '💬', '🤣', '☕', '🙌', '✨', '👍'],
  lookout: ['👀', '🏙️', '😮', '🔭'],
  call: ['📞', '💬'],
};

/** One of `kind`'s emoji (`rand` in [0, 1)). */
export const roofEmoji = (kind: SeatKind | 'call', rand: number) => {
  const list = ROOF_EMOJI[kind];
  return list[Math.min(list.length - 1, Math.floor(rand * list.length))];
};

/** Who says something now: someone settled with company within `near` metres to talk to (`rand` picks); null if nobody. */
export function chatPick(people: readonly { id: string; x: number; z: number }[], rand: number, near = 4.5): string | null {
  let n = 0;
  const company = (p: { x: number; z: number }) => people.some((o) => o !== p && Math.hypot(o.x - p.x, o.z - p.z) <= near);
  for (const p of people) if (company(p)) n++;
  if (!n) return null;
  let k = Math.min(n - 1, Math.floor(rand * n));
  for (const p of people) if (company(p) && k-- === 0) return p.id;
  return null;
}

// ---------- who's up there now ----------

const visits = new Map<string, RoofVisit>();

/** Every visit still on (stale ones are dropped as they're read), into `out` when given (it's cleared first). */
export function roofVisits(now = Date.now(), out: RoofVisit[] = []): RoofVisit[] {
  out.length = 0;
  for (const [id, v] of visits) {
    if (visitOn(v, now)) out.push(v);
    else visits.delete(id);
  }
  return out;
}

/** `id`'s visit while it's on, or null. */
export function roofVisit(id: string, now = Date.now()): RoofVisit | null {
  const v = visits.get(id);
  return v && visitOn(v, now) ? v : null;
}

export function startVisit(v: RoofVisit) {
  visits.set(v.id, v);
}

/** Over: they're back down (or never got there). */
export function endVisit(id: string) {
  visits.delete(id);
}

/** Changes a visit (heading down early when work comes in, another seat). */
export function updateVisit(id: string, patch: Partial<Omit<RoofVisit, 'id'>>) {
  const v = visits.get(id);
  if (v) visits.set(id, { ...v, ...patch });
}
