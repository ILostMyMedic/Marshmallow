// Lives inside the Canvas: the people on the floor you're on talk. Lines come from what happens in the office (the
// server's moments, the store's changes and everyone's new log lines, read by chatterEvents.ts), from a chat at the
// cooler or the couch (ErrandDirector.tsx asks chatSay), from you saying hi (E on someone with nothing to do) and from
// their work. Each line is a timed speech bubble
// (people.ts `say`). At most MAX_SPEAKERS speak at once, the nearest the camera winning; PACE paces the rest. It runs in
// useFrame, so it stops with the render loop, and nothing new starts while a panel covers the view.
// window.__mmChatter shows the recent lines and who's speaking.
// Adapted from cubefarm client/src/world/Chatter.tsx (MIT): the babble voices come with the sound effects, the CEO's
// floor walk is cut, and the chatter level stays lively (no setting yet).
import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Moment } from '../../../shared/types';
import { useStore } from '../store';
import type { BodyState } from './body';
import { onAction } from './actions';
import { CI_SLOW, currentWork, DEMO_CI_SLOW, greeting, lastFile, logNews, momentNews, slowChecks, storeNews, type Said } from './chatterEvents';
import { chatterLine, type ChatterEvent, type ChatTopic } from './chatterLines';
import { admitSpeaker, bubbleSeconds, DROP_NEW, LINE_TTL, MAX_SPEAKERS, mayTalk, PACE, PLAY, type Priority } from './chatterRules';
import { isFree } from './errands';
import type { Pick as AimPick } from './interact';
import { waveHello } from './Me';
import { bodyState, errandOf, isSeated, liveBodies, say, saying } from './people';
import { queueFidget } from './reactionFeed';
import { playerAt } from './rig';
import { momentsSince } from './reactions';
import { useView, type Focus } from './view';

interface Line {
  who: string;
  near?: boolean;
  event: ChatterEvent;
  priority: Priority;
  /** Clock seconds: when it may start, and when it's old news. */
  at: number;
  ttl: number;
}

interface Speaker {
  id: string;
  text: string;
  /** Clock seconds: when the bubble goes. */
  until: number;
  d: number;
}

interface Heard {
  at: number;
  id: string;
  name: string;
  line: string;
  why: ChatterEvent['kind'] | 'say';
  d: number;
}

type StoreState = ReturnType<typeof useStore.getState>;

const pace = PACE.lively;
const RANK: Record<Priority, number> = { greet: 0, event: 1, chat: 2, ambient: 3 };
const MAX_PENDING = 40;
const RECENT = 40;
/** A line isn't picked again while it's among the floor's last few, if there's another way to say it. */
const HEARD = 3;
/** How far (m) a hit on someone counts as aiming at them rather than their desk. */
const AIM_RADIUS = 0.42;
/** People this close (m) take turns: nobody starts a line while a neighbour's is still up (their bubbles would overlap). */
const TURN_RADIUS = 2;

const clock = () => performance.now() / 1000;
const round = (n: number) => Math.round(n * 100) / 100;
const between = ([min, max]: readonly [number, number]) => min + Math.random() * (max - min);

const pending: Line[] = [];
const speakers: (Speaker | null)[] = Array.from({ length: MAX_SPEAKERS }, () => null);
const lastLine = new Map<string, string>();
const lastAt = new Map<string, number>();
let floorLast = -Infinity;
const recent: Heard[] = [];
const logSeen = new Map<string, number>();
const errandSeen = new Map<string, string>();
const ambientAt = new Map<string, number>();
let ceoAt: number | null = null;
const ciSince = new Map<string, number>();
const ciDone = new Set<string>();
let lastMoment: Moment | null = null;
let nextTick = 0;
let nextCi = 0;
/** The camera, where the nearest voices win. */
const ear = new THREE.Vector3();

// ---------- who and where ----------

/** Their mouth, more or less: lower while seated. */
const headY = (b: BodyState) => 1.25 * b.sit + 1.6 * (1 - b.sit);

const distanceTo = (b: BodyState) => Math.hypot(ear.x - b.x, ear.y - headY(b), ear.z - b.z);

const speakingSlot = (id: string) => speakers.findIndex((s) => s?.id === id);

/** Someone else within TURN_RADIUS of `b` is speaking. */
function neighbourSpeaking(id: string, b: BodyState) {
  for (const s of speakers) {
    const o = s && s.id !== id ? bodyState(s.id) : undefined;
    if (o && Math.hypot(o.x - b.x, o.z - b.z) < TURN_RADIUS) return true;
  }
  return false;
}

/** The nearest other worker on the floor to someone, who isn't speaking already. */
function nearestTo(id: string): string | null {
  const b0 = bodyState(id);
  if (!b0) return null;
  const workers = useStore.getState().workers;
  let best: string | null = null;
  let bd = Infinity;
  for (const [other, b] of liveBodies()) {
    if (other === id || !workers[other] || speakingSlot(other) >= 0) continue;
    const d = Math.hypot(b.x - b0.x, b.z - b0.z);
    if (d < bd) {
      bd = d;
      best = other;
    }
  }
  return best;
}

// ---------- speaking ----------

/** Ends a line early: its bubble goes (unless something else is in it by now). */
function cut(slot: number) {
  const sp = speakers[slot];
  if (sp && saying(sp.id)?.text === sp.text) say(sp.id, null);
  speakers[slot] = null;
}

/**
 * A slot for a line from `d` metres away: a free one, the farthest speaker's (cut off) when this one is nearer, or -1.
 * `force`: a full house cuts off the farthest anyway (someone answering you).
 */
function takeSlot(d: number, force = false): number {
  const active = speakers.flatMap((s, slot) => (s ? [{ d: s.d, slot }] : []));
  let r = admitSpeaker(active, d);
  if (r === DROP_NEW && force) r = active.reduce((far, s, i) => (s.d > active[far].d ? i : far), 0);
  if (r === DROP_NEW) return -1;
  if (r === PLAY) return speakers.findIndex((s) => !s);
  cut(active[r].slot);
  return active[r].slot;
}

/** Says a line (an event to put in words, or the words) in slot `slot`, as a speech bubble. */
function speak(id: string, what: ChatterEvent | string, priority: Priority, slot: number, d: number, seconds?: number) {
  const t = clock();
  const w = useStore.getState().workers[id];
  const heard = recent.slice(-HEARD).map((r) => r.line);
  const text = typeof what === 'string' ? what : chatterLine(what, Math.random, lastLine.get(id) ?? null, heard);
  const secs = seconds ?? bubbleSeconds(text);
  say(id, text, secs);
  speakers[slot] = { id, text, until: t + secs, d };
  lastLine.set(id, text);
  lastAt.set(id, t);
  if (priority !== 'greet') floorLast = t;
  recent.push({ at: Math.round(performance.now()), id, name: w?.name ?? id, line: text, why: typeof what === 'string' ? 'say' : what.kind, d: round(d) });
  if (recent.length > RECENT) recent.splice(0, recent.length - RECENT);
}

/** Lines wait at most `ttl` seconds (LINE_TTL) for their turn. */
function queue(s: Said, ttl = LINE_TTL) {
  const at = clock() + s.delay;
  pending.push({ who: s.who, near: s.near, event: s.event, priority: s.priority, at, ttl: at + ttl });
  if (pending.length > MAX_PENDING) pending.splice(0, pending.length - MAX_PENDING);
}

// ---------- what happened ----------

/** The store changed: the new moments, the office's changes and everyone's new log lines (none before the first snapshot). */
function onStore(s: StoreState, prev: StoreState) {
  const fresh = s.loaded && prev.loaded;
  if (s.logs !== prev.logs) {
    for (const [id, lines] of Object.entries(s.logs)) {
      if (lines === prev.logs[id] || !lines.length) continue;
      const seen = logSeen.get(id);
      logSeen.set(id, lines[lines.length - 1].id);
      const w = s.workers[id];
      if (!fresh || seen === undefined || !w) continue;
      for (const x of logNews(
        w,
        lines.filter((l) => l.id > seen),
        Date.now(),
      ))
        queue(x);
    }
  }
  if (s.moments !== prev.moments) {
    if (fresh) for (const m of momentsSince(s.moments, lastMoment)) for (const x of momentNews(m, s.workers)) queue(x);
    lastMoment = s.moments.at(-1) ?? null;
  }
  if (!fresh) return;
  if (s.workers !== prev.workers || s.qa !== prev.qa || s.floors !== prev.floors) for (const x of storeNews(prev, s, (id) => lastFile(s.logs[id] ?? []))) queue(x);
}

/** Errands worth a word as they start: off for a coffee, or looking over a busy teammate's shoulder. */
function errandNews(st: StoreState) {
  for (const id of liveBodies().keys()) {
    const e = errandOf(id);
    const key = e ? `${e.name}:${e.phase}` : '';
    if (errandSeen.get(id) === key) continue;
    errandSeen.set(id, key);
    if (key === 'coffee:leaving' && Math.random() < 0.6) queue({ who: id, event: { kind: 'coffee' }, delay: 0.4, priority: 'event' });
    if (key === 'visit:there' && e) {
      const host = st.workers[e.spot.replace(/^visit-/, '')];
      if (host) queue({ who: id, event: { kind: 'visit', host: host.name, issue: host.task?.issueNumber ?? null }, delay: 2.5, priority: 'event' });
    }
  }
}

/** Small talk: busy people about their work, and the CEO musing in the lobby. */
function smallTalk(st: StoreState, t: number) {
  const now = Date.now();
  for (const id of liveBodies().keys()) {
    const w = st.workers[id];
    if (!w || w.role === 'ceo' || !(w.status === 'working' || w.status === 'preparing') || !pace.ambient) continue;
    const due = ambientAt.get(id);
    if (due !== undefined && t < due) continue;
    ambientAt.set(id, t + between(pace.ambient));
    const work = due !== undefined && currentWork(st.logs[id] ?? [], now);
    if (work) queue({ who: id, event: { kind: 'work', ...work }, delay: 0, priority: 'ambient' });
  }
  const ceo = Object.values(st.workers).find((w) => w.role === 'ceo');
  if (!ceo || !liveBodies().has(ceo.id)) {
    ceoAt = null;
    return;
  }
  if (ceoAt === null) ceoAt = t + between(pace.ceo);
  else if (t >= ceoAt) {
    ceoAt = t + between(pace.ceo);
    queue({ who: ceo.id, event: { kind: 'ceo', busy: ceo.status === 'working' || ceo.status === 'preparing' }, delay: 0, priority: 'ambient' });
  }
}

/** Starts whatever lines may start now: the most important first, then the oldest. */
function startLines(t: number) {
  pending.sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.at - b.at);
  for (let k = 0; k < pending.length; ) {
    const line = pending[k];
    if (t > line.ttl) {
      pending.splice(k, 1);
      continue;
    }
    if (t < line.at) {
      k++;
      continue;
    }
    const id = line.near ? nearestTo(line.who) : line.who;
    const b = id ? bodyState(id) : undefined;
    // Not on this floor (or nobody to say it): they're not here to say it.
    if (!id || !b) {
      pending.splice(k, 1);
      continue;
    }
    // Nobody talks over a bubble something else put up (a chat's, a ritual's, a snack's).
    const busy = speakingSlot(id) >= 0 || !!saying(id) || neighbourSpeaking(id, b);
    if (busy || !mayTalk(line.priority, pace, t, lastAt.get(id) ?? -Infinity, floorLast)) {
      k++;
      continue;
    }
    const d = distanceTo(b);
    const slot = takeSlot(d);
    if (slot < 0) {
      k++;
      continue;
    }
    pending.splice(k, 1);
    speak(id, line.event, line.priority, slot, d);
  }
}

function think(t: number) {
  const st = useStore.getState();
  if (t >= nextCi) {
    nextCi = t + 1;
    for (const x of slowChecks(st.floors, st.workers, ciSince, ciDone, Date.now(), st.demo ? DEMO_CI_SLOW : CI_SLOW)) queue(x);
  }
  errandNews(st);
  smallTalk(st, t);
  // A panel over the view, or another tab: nothing new starts, and the news goes stale.
  if (useView.getState().overlay || document.hidden) return;
  startLines(t);
}

// ---------- asked for by others ----------

/**
 * A chat at the cooler or the couch (ErrandDirector.tsx): a line on the topic for `seconds`. They take turns: while
 * someone in the huddle is still talking, this one waits to say it (or lets it go when the moment passes). When nearer
 * voices fill the floor, the topic's emoji shows instead.
 */
export function chatSay(id: string, topic: ChatTopic, pr: number | null, venue: string, seconds: number) {
  const b = bodyState(id);
  if (!b) return;
  const mine = speakingSlot(id);
  if (mine >= 0) cut(mine);
  if (neighbourSpeaking(id, b)) {
    queue({ who: id, event: { kind: 'chat', topic, pr, venue }, delay: 0, priority: 'chat' }, seconds);
    return;
  }
  const d = distanceTo(b);
  const slot = takeSlot(d);
  if (slot < 0) say(id, topic, seconds);
  else speak(id, { kind: 'chat', topic, pr, venue }, 'chat', slot, d, seconds);
}

/** Someone you can say hi to: they've nothing to do and they're here on the floor. */
export function greetable(id: string) {
  const w = useStore.getState().workers[id];
  return !!w && isFree(w.status) && !!bodyState(id);
}

/**
 * You said hi (E on them): you wave, and they answer straight away with a hello or a quip about their work, turning to
 * wave back from their chair. False when they can't answer.
 */
export function greet(id: string): boolean {
  const st = useStore.getState();
  const w = st.workers[id];
  const b = bodyState(id);
  if (!w || !b || !greetable(id)) return false;
  waveHello();
  if (isSeated(id)) queueFidget(id, 'wave', playerAt.x, playerAt.z);
  const mine = speakingSlot(id);
  if (mine >= 0) cut(mine);
  const d = distanceTo(b);
  speak(id, greeting(w, st, st.settings.managerName, Date.now()), 'greet', takeSlot(d, true), d);
  return true;
}

/**
 * For a desk's target (Desk.tsx): aiming at its person, when they've nothing to do, says hi to them instead of using
 * the desk. `desk` ends the hint: what aiming at the desk instead does ("for their terminal").
 */
export function greetPick(id: string, desk: string): AimPick {
  return (point) => {
    const b = bodyState(id);
    if (!b || !greetable(id)) return null;
    const top = headY(b) + 0.45;
    if (Math.hypot(point.x - b.x, point.z - b.z) > AIM_RADIUS || point.y < 0.55 || point.y > top) return null;
    const name = useStore.getState().workers[id]?.name ?? 'them';
    const focus: Focus = { id: `greet-${id}`, label: `Say hi to ${name} 👋 · aim at the desk ${desk}`, action: { kind: 'greet', workerId: id } };
    return focus;
  };
}

// ---------- the component and the probe ----------

export function Chatter() {
  const camera = useThree((s) => s.camera);
  useEffect(() => useStore.subscribe(onStore), []);
  useEffect(() => onAction('greet', (a) => void greet(a.workerId)), []);
  useFrame(() => {
    const t = clock();
    camera.getWorldPosition(ear);
    // Free the slots of lines that are over (or whose speaker left the floor, or whose bubble something else took down: a chat that ended).
    for (let i = 0; i < MAX_SPEAKERS; i++) {
      const sp = speakers[i];
      if (!sp) continue;
      const b = bodyState(sp.id);
      if (!b || t >= sp.until || saying(sp.id)?.text !== sp.text) {
        speakers[i] = null;
        continue;
      }
      sp.d = distanceTo(b);
    }
    if (t < nextTick) return;
    nextTick = t + 0.25;
    think(t);
  });
  return null;
}

if (typeof window !== 'undefined') {
  const workers = () => useStore.getState().workers;
  (window as unknown as Record<string, unknown>).__mmChatter = {
    /** The last lines said on any floor you were on: who, what, why and how far (m). */
    get recent() {
      return recent.map((r) => ({ ...r }));
    },
    /** Who is speaking now. */
    get speakers() {
      const t = clock();
      return speakers.flatMap((s, slot) => (s ? [{ slot, id: s.id, name: workers()[s.id]?.name ?? s.id, line: s.text, d: round(s.d), endsIn: round(s.until - t) }] : []));
    },
    get pending() {
      return pending.map((p) => ({ who: p.who, near: !!p.near, kind: p.event.kind, priority: p.priority }));
    },
    greet,
    /** Makes someone on this floor say `text` now (QA), with the speaker cap; false when they're not here or it's full. */
    say(id: string, text: string) {
      const b = bodyState(id);
      if (!b || speakingSlot(id) >= 0) return false;
      const d = distanceTo(b);
      const slot = takeSlot(d);
      if (slot < 0) return false;
      speak(id, text, 'event', slot, d);
      return true;
    },
  };
}
