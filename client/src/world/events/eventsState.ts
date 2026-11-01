// Adapted from cubefarm client/src/world/events/eventsState.ts (MIT): the weather, the time of day and Settings are cut,
// the director moved to the office (server/db/world.ts), and the rare ones' note goes to view.ts's toast.

// The world events on now, as the office runs them for every tab (the snapshot's `world`, then its 'world' events). A
// run's clock is the wall clock since it started (the server only takes connections from this machine, so tab and
// server share a clock): a tab that joins mid-event joins it at that point, and a hidden tab finds it moved on. Scenes
// read `run.t` in their frame loop; React sees the list change only when an event starts or ends (WorldEvents.tsx
// mounts a scene per run).
// QA: `?event=blimp` asks the office for one a couple of seconds in; window.__mmEvents shows what's on and can
// trigger() one for every tab.
import { create } from 'zustand';
import { EVENTS, parseEventId, parseEventParam, type EventId, type WorldRun } from '../../../../shared/worldEvents';
import { command, query } from '../../api';
import { useStore } from '../../store';
import type { Side } from '../layout';
import { useView } from '../view';

/** One event as this tab draws it. */
export interface EventRun extends WorldRun {
  /** Seconds since it started, moved on every frame. */
  t: number;
  /** Seconds __mmEvents.seek moved it on, in this tab only. */
  skew: number;
}

/** A rare one's note shows only while there's this much of it left to see. */
const TOAST_LEFT_S = 10;

const state = {
  runs: [] as EventRun[],
  /** Render seconds since the office came up on screen. */
  shown: 0,
  /** ?event=: asked for once the office has rendered a couple of seconds. */
  pending: (() => {
    try {
      return parseEventParam(window.location.search);
    } catch {
      return null;
    }
  })() as EventId | null,
};

const useRuns = create<{ runs: EventRun[] }>(() => ({ runs: [] }));

/** For React: the events running now (changes only as they start and end). */
export const useEventRuns = () => useRuns((s) => s.runs);

const publish = () => useRuns.setState({ runs: [...state.runs] });

/** The big event on now, if any: what free workers go to the windows to watch. */
export const bigEvent = (): EventRun | null => state.runs.find((r) => EVENTS[r.id].big) ?? null;

/** Every event running now. */
export const runningEvents = (): readonly EventRun[] => state.runs;

const elapsed = (r: Pick<EventRun, 'startedAt'> & { skew?: number }, now: number) => (now - r.startedAt) / 1000 + (r.skew ?? 0);

/**
 * Draws what the office says is on: a run this tab hasn't drawn joins at its point (a rare one with its note), and one
 * no longer on goes. The store's world changing calls it; tests call it directly.
 */
export function showRuns(world: readonly WorldRun[], now = Date.now()) {
  const kept = state.runs.filter((r) => world.some((w) => w.key === r.key));
  const fresh: EventRun[] = world
    .filter((w) => !state.runs.some((r) => r.key === w.key) && elapsed(w, now) < w.seconds)
    .map((w) => ({ key: w.key, id: w.id, side: w.side, seed: w.seed, startedAt: w.startedAt, seconds: w.seconds, forced: w.forced, t: elapsed(w, now), skew: 0 }));
  if (kept.length === state.runs.length && !fresh.length) return;
  state.runs = [...kept, ...fresh];
  for (const r of fresh) if (EVENTS[r.id].toast && r.seconds - r.t > TOAST_LEFT_S) useView.getState().showToast(`👀 Something's happening outside, ${r.side} side!`);
  publish();
}

let world = useStore.getState().world.running;
showRuns(world);
useStore.subscribe((s) => {
  if (s.world.running === world) return;
  world = s.world.running;
  showRuns(world);
});

/** Moves each run to now (WorldEvents.tsx, every frame); one whose time is up goes without waiting for the office's word. */
export function stepEvents(dt: number, now = Date.now()) {
  let ended = false;
  for (let i = state.runs.length - 1; i >= 0; i--) {
    const r = state.runs[i];
    r.t = elapsed(r, now);
    if (r.t < r.seconds) continue;
    state.runs.splice(i, 1);
    ended = true;
  }
  if (ended) publish();
  state.shown += dt;
  if (state.pending && state.shown > 2 && useStore.getState().loaded) {
    const id = state.pending;
    state.pending = null;
    void command('POST', '/api/world/trigger', { event: id }).catch((err: Error) => console.warn(`?event=${id}: ${err.message}`));
  }
}

// ---------- the probe ----------

const view = (r: EventRun) => ({ key: r.key, id: r.id, side: r.side, t: Math.round(r.t * 10) / 10, seconds: r.seconds, big: EVENTS[r.id].big, forced: r.forced });

/** For QA and headless checks: what's on, what's next and what ran, and trigger('blimp', 'west') starts one for every tab. */
export const eventsProbe: Record<string, unknown> = {
  /** When the office's director picks the next event. */
  get schedule() {
    return { nextIn: Math.max(0, Math.round((useStore.getState().world.nextAt - Date.now()) / 1000)) };
  },
  get current() {
    return state.runs.map(view);
  },
  /** The same as `current`: what's running now. */
  list() {
    return state.runs.map(view);
  },
  /** What ran lately, newest first, from the office's log (a promise). */
  history() {
    return query('/api/world/log');
  },
  get catalog() {
    return Object.values(EVENTS).map((e) => ({ id: e.id, label: e.label, tier: e.tier, big: e.big, street: e.street, seconds: e.seconds }));
  },
  /** Starts an event now for every tab ('plane', 'blimp', 'duck'…), on 'west' or 'east' (either by default): a promise of it, or null for an unknown name. */
  async trigger(name: string, side?: Side) {
    const id = parseEventId(name);
    return id ? command('POST', '/api/world/trigger', { event: id, side: side === 'west' || side === 'east' ? side : undefined }) : null;
  },
  /** Ends the running event with this name (or all of them), for every tab. */
  end(name?: string) {
    return command('POST', '/api/world/end', name ? { event: name } : {});
  },
  /** Jumps a running event to `t` seconds in, in this tab only (to see its middle without waiting for it). */
  seek(name: string, t: number) {
    const r = state.runs.find((x) => x.id === parseEventId(name));
    if (r && Number.isFinite(t)) {
      r.t = Math.max(0, Math.min(r.seconds - 0.5, t));
      r.skew = r.t - (Date.now() - r.startedAt) / 1000;
    }
    return r ? view(r) : null;
  },
  /** Has the office's director pick the next event this many seconds from now (watch it choose). */
  soon(seconds = 1) {
    return command('POST', '/api/world/soon', { seconds });
  },
};

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__mmEvents = eventsProbe;
