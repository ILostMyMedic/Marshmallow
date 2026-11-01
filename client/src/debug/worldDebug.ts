// Words for the debug page's world events: the catalogue in its groups, how long is left of what's on, when the
// director picks next, and a line for each event in the office's log of what ran.
import { EVENTS, parseEventId, type EventDef, type EventSide, type WorldRun } from '../../../shared/worldEvents';

export type EventGroup = 'Everyday' | 'Big' | 'Street' | 'Night';

/** The catalogue as the page lists it: the sky's everyday sights, its big ones (a crowd at the windows), the street's, then the night's. */
export function eventGroups(): { title: EventGroup; hint: string; events: EventDef[] }[] {
  const all = Object.values(EVENTS);
  const day = all.filter((e) => !e.nightOnly);
  return [
    { title: 'Everyday', hint: 'in the sky, alongside anything else', events: day.filter((e) => !e.street && !e.big) },
    { title: 'Big', hint: 'in the sky: free workers go to the windows, and one ends any other big one', events: day.filter((e) => !e.street && e.big) },
    { title: 'Street', hint: 'down the street beside the office: one at a time', events: day.filter((e) => e.street) },
    { title: 'Night', hint: 'the director picks these only at night, by the season (the northern lights most in winter, fireworks at New Year); started here they show best at night', events: all.filter((e) => e.nightOnly) },
  ];
}

/** What a button's tooltip says about an event. */
export const eventHint = (e: EventDef) => `${e.tier}${e.big ? ', draws a crowd' : ''}${e.toast ? ', with a note' : ''}${e.nightOnly ? ', at night' : ''} · ${e.seconds} s`;

/** A span of seconds, short: "45 s", "3 min 05 s". */
export function span(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

/** Seconds left of a run at `now` (epoch ms), never below 0. */
export const timeLeft = (run: Pick<WorldRun, 'startedAt' | 'seconds'>, now: number) => Math.max(0, run.startedAt / 1000 + run.seconds - now / 1000);

/** When the director picks the next event. */
export function nextPick(nextAt: number, now: number): string {
  if (!nextAt) return 'not scheduled yet';
  const s = (nextAt - now) / 1000;
  return s <= 1 ? 'any moment now' : `in ${span(s)}`;
}

/** An event's label from its id, or the id when it's no longer in the catalogue. */
export const labelOf = (id: string) => {
  const known = parseEventId(id);
  return known ? EVENTS[known].label : id;
};

/** One event in the office's log of what ran (GET /api/world/log). */
export interface WorldLogEntry {
  key: number;
  id: string;
  side: EventSide;
  forced: boolean;
  startedAt: number;
  endsAt: number;
}

/** What the log says about one event: who started it, and how long it ran or whether it's still on. */
export function logLine(e: WorldLogEntry, now: number): string {
  const who = e.forced ? 'on demand' : 'the director';
  if (e.endsAt > now) return `${labelOf(e.id)} · ${e.side} · ${who} · still on`;
  const ran = (e.endsAt - e.startedAt) / 1000;
  const known = parseEventId(e.id);
  const early = known && ran < EVENTS[known].seconds - 0.5;
  return `${labelOf(e.id)} · ${e.side} · ${who} · ${early ? `ended early after ${span(ran)}` : `ran ${span(ran)}`}`;
}
