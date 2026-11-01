// Adapted from cubefarm client/src/world/toys/pongState.ts (MIT): the probe's runner registry is cut (pongProbe.ts
// gets the runner from PongMatch.tsx), and `held` is view.ts's instead of the store's.

// The ping-pong match as plain module state: who plays at which end (you or a worker), the game's phase and score, the
// player's paddle and a smash's shake (the view itself is pongCam.ts's), and what each worker at the table does with their feet and paddle. The match runner
// (pongRunner.ts, stepped by PongMatch.tsx) writes here; the errands (pongErrands.ts, through setPongSeats),
// Character.tsx, the table's hanging paddles and the player's controls (Player.tsx) read it.

import type { Gesture } from './body';
import { PONG_PLAYER } from './pong';
import { fromOwn, otherEnd, TABLE, type End, type Swing, type V3 } from './pongPhysics';
import { atGamePoint, newGame, serverOf, type Game, type PointWhy } from './pongRules';
import { useView } from './view';

/** You at an end, or a worker at (or on the way to) one: `ready` once they're there, paddle in hand. */
export type Seat = { kind: 'player' } | { kind: 'worker'; id: string; ready: boolean };

/**
 * waiting: for both ends to be ready · serve: the server has the ball · rally: it's in play · point: a point was just
 * won (the ball still rolling about) · over: the game is over, a rematch on offer for a moment.
 */
export type Phase = 'waiting' | 'serve' | 'rally' | 'point' | 'over';

export interface Match {
  id: number;
  seats: Record<End, Seat | null>;
  game: Game;
  phase: Phase;
  /** The last point (who won it and why), or the game's winner once it's over; null after a let. */
  last: { winner: End; why: PointWhy | 'game' } | null;
  /** Returns in the rally under way, and the longest this game. */
  rally: number;
  longest: number;
  /** The player asked for a rematch (after a game), or to serve (the toss). */
  ask: 'rematch' | 'serve' | null;
}

let match: Match | null = null;
let seq = 1;
const listeners = new Set<() => void>();

/** The match at the table, or null. The runner mutates its phase and score in place; the seats change only here. */
export const pongMatch = () => match;

/** Something the hanging paddles or a scoreboard show changed: a seat, the phase, a point, a return. */
export function pongChanged() {
  cached = null;
  for (const fn of listeners) fn();
}

export function subscribePong(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

// ---------- seats ----------

const isPlayer = (s: Seat | null | undefined) => s?.kind === 'player';
const isWorker = (s: Seat | null | undefined, id: string) => s?.kind === 'worker' && s.id === id;
/** At their end, paddle in hand: the player is, the moment they pick it up. */
const seatReady = (s: Seat | null | undefined) => s?.kind === 'player' || (s?.kind === 'worker' && s.ready);

/** The end the player is at, or null. */
export const playerEnd = (): End | null => (isPlayer(match?.seats.west) ? 'west' : isPlayer(match?.seats.east) ? 'east' : null);

/** The end worker `id` plays (or is on the way to), or null. */
export function seatOf(id: string): End | null {
  if (!match) return null;
  return isWorker(match.seats.west, id) ? 'west' : isWorker(match.seats.east, id) ? 'east' : null;
}

function newMatch(): Match {
  return { id: seq++, seats: { west: null, east: null }, game: newGame('west'), phase: 'waiting', last: null, rally: 0, longest: 0, ask: null };
}

/** Back to waiting with a fresh score: someone left mid-game, or someone new is about to start. */
function reset(m: Match) {
  m.phase = 'waiting';
  m.game = newGame('west');
  m.last = null;
  m.rally = 0;
  m.longest = 0;
  m.ask = null;
}

/**
 * The player picks up the paddle at `end` (E on it). A free end is theirs; with a worker waiting at it, they take the
 * other; with two workers there (mid-game or about to start), they step in for whoever is at `end`. Returns the end
 * they play.
 */
export function joinPong(end: End): End {
  if (!match) match = newMatch();
  const m = match;
  const here = m.seats[end];
  const there = m.seats[otherEnd(end)];
  if (isPlayer(here)) return end;
  if (isPlayer(there)) return otherEnd(end);
  const mine = here?.kind === 'worker' && !there ? otherEnd(end) : end;
  const out = m.seats[mine];
  if (out?.kind === 'worker' || m.phase !== 'waiting') reset(m);
  if (out?.kind === 'worker') npc.delete(out.id); // they shrug and go back (pongErrands.ts), their paddle with you
  m.seats[mine] = { kind: 'player' };
  centrePaddle();
  pongChanged();
  useView.getState().setHeld({ kind: 'paddle', end: mine });
  return mine;
}

/** The player put the paddle down, however (G, Esc, the elevator): their end is free and the game stops. */
function playerLeft() {
  const m = match;
  const end = playerEnd();
  if (!m || !end) return;
  m.seats[end] = null;
  reset(m);
  if (!m.seats.west && !m.seats.east) match = null;
  autopilot.on = false;
  pongChanged();
}

// Whatever takes the paddle out of your hands (Player.tsx dropping it, something else picked up) ends your game.
useView.subscribe((s, prev) => {
  if (prev.held?.kind === 'paddle' && s.held?.kind !== 'paddle') playerLeft();
});

/** Puts the paddle down (the probe, or the table going away). */
export function leavePong() {
  const view = useView.getState();
  if (view.held?.kind === 'paddle') view.setHeld(null);
  else playerLeft();
}

/** The end that's waiting for someone to come and play (nobody on the way yet), or null. */
export function wantsOpponent(): End | null {
  const m = match;
  if (!m || m.phase !== 'waiting') return null;
  if (m.seats.west && !m.seats.east) return 'east';
  if (m.seats.east && !m.seats.west) return 'west';
  return null;
}

/** Whether the table is free for two workers to start a game: nobody at it at all. */
export const tableFree = () => !match;

/** A worker heading over to take the waiting end. Returns that end, or null when it's gone. */
export function claimSeat(id: string): End | null {
  const end = wantsOpponent();
  if (!end || !match) return null;
  match.seats[end] = { kind: 'worker', id, ready: false };
  pongChanged();
  return end;
}

/** A worker sets off to start a game at `end` of the free table; someone else free then comes to the other end. */
export function startNpcMatch(id: string, end: End): End | null {
  if (match) return null;
  match = newMatch();
  match.seats[end] = { kind: 'worker', id, ready: false };
  pongChanged();
  return end;
}

/** They're at their end, paddle in hand. */
export function readySeat(id: string) {
  const end = seatOf(id);
  const s = end && match?.seats[end];
  if (s && s.kind === 'worker' && !s.ready) {
    s.ready = true;
    pongChanged();
  }
}

/** A worker leaves the table (their errand ended, however): their end is free and the game stops. */
export function leaveSeat(id: string) {
  const m = match;
  const end = seatOf(id);
  npc.delete(id);
  if (!m || !end) return;
  m.seats[end] = null;
  if (m.phase !== 'over') reset(m);
  if (!m.seats.west && !m.seats.east) match = null;
  pongChanged();
}

/** Both ends taken and everyone there. */
export const bothReady = (m: Match) => seatReady(m.seats.west) && seatReady(m.seats.east);

/** A fresh game for the same two (the player clicked for a rematch), `first` serving. */
export function rematch(m: Match, first: End) {
  reset(m);
  m.game = newGame(first);
  pongChanged();
}

/** The table went away (another floor): nobody plays here any more. */
export function resetPong() {
  if (playerEnd()) leavePong();
  match = null;
  npc.clear();
  pongChanged();
}

// ---------- the workers' feet and paddles ----------

/** What a worker at the table does: where they step to, which way they face, their hands, and where their paddle is. */
export interface NpcPong {
  x: number;
  z: number;
  heading: number;
  speed: number;
  gesture: Gesture;
  paddle: V3 | null;
}

const npc = new Map<string, NpcPong>();

/** The runner moves a worker at the table (null: they just stand there). */
export function setNpcPong(id: string, cmd: NpcPong | null) {
  if (cmd) npc.set(id, cmd);
  else npc.delete(id);
}

export const npcPong = (id: string) => npc.get(id) ?? null;

/** Where worker `id`'s paddle is (world), for Character.tsx to reach for; null when they aren't swinging one. */
export const pongPaddle = (id: string): V3 | null => npc.get(id)?.paddle ?? null;

/** Whether worker `id` is at the table with a paddle in hand. */
export function holdsPaddle(id: string): boolean {
  const end = seatOf(id);
  const s = end ? match?.seats[end] : null;
  return s?.kind === 'worker' && s.ready;
}

/** Whether the paddle hanging at `end` has been taken: someone is playing there. */
export const paddleTaken = (end: End): boolean => seatReady(match?.seats[end]);

// ---------- the player's paddle and view ----------

/**
 * The player's paddle in their own frame (pongPhysics ownFrame): to their right (`lat`), behind the end line
 * (`back`, negative over the table), its height, and its velocity (m/s, smoothed), which shapes the shot.
 */
export const paddle = { lat: 0, back: 0.25, y: TABLE.top + 0.2, vLat: 0, vBack: 0, lastLat: 0, lastBack: 0.25 };
const PADDLE_RANGE = { lat: 1.0, backMin: -0.45, backMax: 0.95 };
/** Metres the paddle moves per pixel of mouse movement. */
const PER_PX = 0.0024;

/** Mouse movement while playing (pointer-lock deltas, px): right moves the paddle right, up moves it towards the net. */
export function pongMouse(dx: number, dy: number, sensitivity = 1) {
  paddle.lat = Math.min(PADDLE_RANGE.lat, Math.max(-PADDLE_RANGE.lat, paddle.lat + dx * PER_PX * sensitivity));
  paddle.back = Math.min(PADDLE_RANGE.backMax, Math.max(PADDLE_RANGE.backMin, paddle.back + dy * PER_PX * sensitivity));
}

/** Once a frame (`dt` in seconds): the paddle's velocity from how far it moved. */
export function tickPaddle(dt: number) {
  if (dt <= 0) return;
  const k = 1 - Math.exp(-dt / 0.05);
  paddle.vLat += ((paddle.lat - paddle.lastLat) / dt - paddle.vLat) * k;
  paddle.vBack += ((paddle.back - paddle.lastBack) / dt - paddle.vBack) * k;
  paddle.lastLat = paddle.lat;
  paddle.lastBack = paddle.back;
}

/** The paddle's swing right now: forward is towards the net (the paddle's `back` shrinking). */
export const paddleSwing = (): Swing => (autopilot.on ? autopilot.swing : { forward: -paddle.vBack, right: paddle.vLat });

/** Where the player's paddle is in the world. */
export function paddleAt(end: End): V3 {
  return { ...fromOwn(end, paddle.back, paddle.lat), y: paddle.y };
}

/** Puts the paddle back in the middle, ready (a new game, or picking it up). */
export function centrePaddle() {
  Object.assign(paddle, { lat: 0, back: 0.25, y: TABLE.top + 0.2, vLat: 0, vBack: 0, lastLat: 0, lastBack: 0.25 });
}

/** The probe's autopilot: the runner moves the player's paddle to meet every ball and swings it like this. */
export const autopilot = { on: false, swing: { forward: 1.2, right: 0 } as Swing };

let shake = { at: -Infinity, power: 0 };

/** A smash shakes the view a little. */
export function shakeView(power: number) {
  shake = { at: performance.now(), power };
}

/** This frame's shake to add to the camera at the table (pongCam.ts places it), from a smash (`now` in performance.now() ms). */
export function pongShake(now = performance.now()): V3 {
  const t = (now - shake.at) / 1000;
  const k = t < 0.35 ? shake.power * (1 - t / 0.35) : 0;
  return { x: (Math.random() - 0.5) * 0.05 * k, y: (Math.random() - 0.5) * 0.05 * k, z: (Math.random() - 0.5) * 0.05 * k };
}

/** A click (or F) while playing: toss and serve when it's the player's serve, or a rematch once a game is over. */
export function pongClick() {
  const m = match;
  const end = playerEnd();
  if (!m || !end) return;
  if (m.phase === 'serve' && serverOf(m.game) === end) m.ask = 'serve';
  else if (m.phase === 'over') m.ask = 'rematch';
}

// ---------- what a scoreboard shows ----------

export interface PongView {
  phase: Phase;
  /** Who is at each end: PONG_PLAYER for you, else the worker's id; null for nobody (or nobody yet). */
  west: string | null;
  east: string | null;
  ready: Record<End, boolean>;
  score: Record<End, number>;
  server: End;
  you: End | null;
  last: Match['last'];
  rally: number;
  longest: number;
  gamePoint: boolean;
}

let cached: PongView | null = null;
const seatId = (s: Seat | null) => (s ? (s.kind === 'player' ? PONG_PLAYER : s.id) : null);

/**
 * The match as a scoreboard shows it, or null with nobody at the table: the same object until something changes, so
 * it suits useSyncExternalStore(subscribePong, pongView).
 */
export function pongView(): PongView | null {
  const m = match;
  if (!m) return null;
  if (cached) return cached;
  cached = {
    phase: m.phase,
    west: seatId(m.seats.west),
    east: seatId(m.seats.east),
    ready: { west: seatReady(m.seats.west), east: seatReady(m.seats.east) },
    score: { ...m.game.score },
    server: serverOf(m.game),
    you: playerEnd(),
    last: m.last,
    rally: m.rally,
    longest: m.longest,
    gamePoint: atGamePoint(m.game),
  };
  return cached;
}
