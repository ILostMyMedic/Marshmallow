// Adapted from cubefarm client/src/world/toys/pongState.ts (MIT): workers only. The player's seat, paddle, view and
// clicks, the rematch, the HUD's view of the match and the probe's runner registry are cut.

// The ping-pong match as plain module state: who plays at which end, the game's phase and score, and what each worker
// at the table does with their feet and paddle. The match runner (pongRunner.ts, stepped by PongMatch.tsx) writes
// here; the errands (pongErrands.ts, through setPongSeats), Character.tsx and the table's hanging paddles read it.

import type { Gesture } from './body';
import type { End, V3 } from './pongPhysics';
import { newGame, type Game, type PointWhy } from './pongRules';

/** A worker at (or on the way to) an end; `ready` once they're there, paddle in hand. */
export interface Seat {
  id: string;
  ready: boolean;
}

/**
 * waiting: for both ends to be ready · serve: the server has the ball · rally: it's in play · point: a point was just
 * won (the ball still rolling about) · over: the game is over, the two lingering a moment.
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
}

let match: Match | null = null;
let seq = 1;
const listeners = new Set<() => void>();

/** The match at the table, or null. The runner mutates its phase and score in place; the seats change only here. */
export const pongMatch = () => match;

/** Someone took, readied or left a seat (the table's hanging paddles listen). */
export function pongChanged() {
  for (const fn of listeners) fn();
}

export function subscribePong(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

// ---------- seats ----------

/** The end worker `id` plays (or is on the way to), or null. */
export function seatOf(id: string): End | null {
  if (!match) return null;
  return match.seats.west?.id === id ? 'west' : match.seats.east?.id === id ? 'east' : null;
}

/** Back to waiting with a fresh score: someone left mid-game. */
function reset(m: Match) {
  m.phase = 'waiting';
  m.game = newGame('west');
  m.last = null;
  m.rally = 0;
  m.longest = 0;
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
  match.seats[end] = { id, ready: false };
  pongChanged();
  return end;
}

/** A worker sets off to start a game at `end` of the free table; someone else free then comes to the other end. */
export function startNpcMatch(id: string, end: End): End | null {
  if (match) return null;
  match = { id: seq++, seats: { west: null, east: null }, game: newGame('west'), phase: 'waiting', last: null, rally: 0, longest: 0 };
  match.seats[end] = { id, ready: false };
  pongChanged();
  return end;
}

/** They're at their end, paddle in hand. */
export function readySeat(id: string) {
  const end = seatOf(id);
  const s = end && match?.seats[end];
  if (s && !s.ready) {
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

/** Both ends taken and both there. */
export const bothReady = (m: Match) => !!m.seats.west?.ready && !!m.seats.east?.ready;

/** The table went away (another floor): nobody plays here any more. */
export function resetPong() {
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
  return !!end && !!match?.seats[end]?.ready;
}

/** Whether the paddle hanging at `end` has been taken: someone is playing there. */
export const paddleTaken = (end: End): boolean => !!match?.seats[end]?.ready;
