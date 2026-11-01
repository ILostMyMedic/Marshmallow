// The games' live state, as module state (like pongState.ts): the hoops and dartboards on screen by their shop spot,
// who has a hoop's ball or a board's darts in hand, the throws waiting for them, the player's charge and scores, and
// where a ball or a dart is held (for the holder's right hand to reach for). The hoops and boards on screen
// (Hoop.tsx, Dartboard.tsx) keep it; the player's controls (Player.tsx), the HUD (ui/GameHud.tsx), the errands
// (gameErrands.ts) and the bodies (Me.tsx, Character.tsx) read and add to it. New in Marshmallow.

import type { BodyStyle } from '../../../../shared/types';
import { headTop } from '../bodyStyle';
import { useView, type Held } from '../view';
import { aimVelocity, dartLabel, dartSpeed, DART_THROW, fromBoard, npcDart, turnTotal, type BoardPlace, type DartScore, type Vec3 } from './darts';
import { chargePower, type HoopPlace, type NpcPose } from './hoopPhysics';

/** The player, where a worker's id would be. */
export const PLAYER = 'player';

export type GameKind = 'hoop' | 'darts';

/** The game in the player's hands, or null. */
export function heldGame(h: Held | null = useView.getState().held): Extract<Held, { kind: 'game' }> | null {
  return h?.kind === 'game' ? h : null;
}

const listeners = new Set<() => void>();
let version = 0;

/** Something the HUD shows changed: a score, a turn, the ball in hand. */
export function gamesChanged() {
  version++;
  for (const fn of listeners) fn();
}

export function subscribeGames(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Bumped with every change (useSyncExternalStore's snapshot). */
export const gamesVersion = () => version;

/** How tall a body of the office's style is, as a share of the human style's: where hands hold a ball or a dart. */
export const styleTall = (style: BodyStyle) => headTop(style, 1) / headTop('human', 1);

// ---------- hands ----------

const hands = new Map<string, Vec3>();

/** Where `id`'s right hand should be (holding a ball or a dart), or null to let it go. */
export function setToyHand(id: string, p: Vec3 | null) {
  if (p) hands.set(id, p);
  else hands.delete(id);
}

/** Where `id` (a worker, or PLAYER) holds a ball or a dart, for their arm to reach; null when they hold none. */
export const toyHand = (id: string): Vec3 | null => hands.get(id) ?? null;

// ---------- the player's charge ----------

/** When the player started winding up a throw (performance.now()), or null. */
export const charge: { at: number | null } = { at: null };
/** A throw the player just let go, for the hoop or the board in hand to take on its next frame. */
let thrown: { spot: string; game: GameKind; power: number; at: number } | null = null;

/** The mouse went down with a game in hand: start winding up. False with no game in hand (the click is for something else). */
export function startCharge(now = performance.now()): boolean {
  const g = heldGame();
  if (!g) return false;
  if (!ready(g.game, g.spot, now)) return true; // still waiting for the next ball or a new turn
  charge.at = now;
  gamesChanged();
  return true;
}

/** The mouse came up: let go with the power wound up so far. False with no game in hand. */
export function releaseCharge(now = performance.now()): boolean {
  const g = heldGame();
  if (!g) return false;
  if (charge.at === null) return true;
  thrown = { spot: g.spot, game: g.game, power: chargePower(now - charge.at), at: now };
  charge.at = null;
  gamesChanged();
  return true;
}

/** Stops winding up without throwing (the mouse was freed). */
export function cancelCharge() {
  if (charge.at === null) return;
  charge.at = null;
  gamesChanged();
}

/** The power wound up so far (0 to 1), or null when not winding up. */
export const chargeNow = (now = performance.now()) => (charge.at === null ? null : chargePower(now - charge.at));

/** For the hoop or board at `spot`: the throw the player just let go of there, taken (once), or null. */
export function takeThrow(game: GameKind, spot: string, now = performance.now()): number | null {
  const t = thrown;
  if (!t || t.spot !== spot || t.game !== game || now - t.at > 500) return null;
  thrown = null;
  return t.power;
}

/** Whether the player can throw again at the hoop or board at `spot` (a new ball in hand, the board cleared for a turn). */
function ready(game: GameKind, spot: string, now: number) {
  if (game === 'hoop') return (courts.get(spot)?.reloadUntil ?? 0) <= now;
  const b = boards.get(spot);
  return !b || dartsThrown(b) < 3 || ((b.turn?.darts.length ?? 0) >= 3 && b.clearAt <= now);
}

// ---------- the hoops ----------

/** A hoop on screen, by its spot. */
export interface CourtState {
  spot: string;
  place: HoopPlace;
  /** Who has the ball in hand: PLAYER, a worker's id, or nobody (it's on the rack). */
  holder: string | null;
  /** A worker's ball carried or up over their head, and how far it dips as they shoot. */
  pose: NpcPose;
  dip: number;
  /** The charge that would score from where the player holds the ball (for the HUD's meter). */
  ideal: number;
  /** The player's next ball comes to hand at this time (performance.now()), after a shot. */
  reloadUntil: number;
  /** Worker shots waiting for the hoop to throw: from where, how fast (in the room). */
  throws: { who: string; from: Vec3; v: Vec3 }[];
  /** The latest shot to finish: who, and how it went. */
  last: { who: string; made: boolean; swish: boolean; at: number } | null;
}

const courts = new Map<string, CourtState>();

/** A hoop at `spot` came on screen (`existing`: the one it had, back again after a remount). */
export function openCourt(spot: string, place: HoopPlace, existing?: CourtState): CourtState {
  const c: CourtState = existing ?? courts.get(spot) ?? { spot, place, holder: null, pose: 'carry', dip: 0, ideal: 0.5, reloadUntil: 0, throws: [], last: null };
  c.place = place;
  courts.set(spot, c);
  return c;
}

/** The hoop went (another floor, or sold off the plan): its ball goes back in its rack, the player's too. */
export function closeCourt(spot: string) {
  const c = courts.get(spot);
  if (!c) return;
  if (c.holder && c.holder !== PLAYER) setToyHand(c.holder, null);
  courts.delete(spot);
  const g = heldGame();
  if (g?.game === 'hoop' && g.spot === spot) useView.getState().setHeld(null);
}

export const courtAt = (spot: string) => courts.get(spot) ?? null;
export const courtsOnScreen = (): CourtState[] => [...courts.values()];

/** E at a hoop's rack: the ball's yours (taken off a worker, who shrugs); your hands must be free. */
export function takeBall(spot: string) {
  const c = courts.get(spot);
  const view = useView.getState();
  if (!c) return;
  const g = heldGame();
  if (g?.spot === spot) return;
  if (view.held) return view.showToast('🙌 Your hands are full');
  if (c.holder && c.holder !== PLAYER) setToyHand(c.holder, null);
  c.holder = PLAYER;
  c.reloadUntil = 0;
  view.setHeld({ kind: 'game', game: 'hoop', spot });
  view.showToast('🏀 Hold the mouse to wind up, let go to shoot');
  gamesChanged();
}

/** A worker takes the ball off the rack; false when someone has it. */
export function workerTakesBall(spot: string, id: string): boolean {
  const c = courts.get(spot);
  if (!c || c.holder) return false;
  c.holder = id;
  c.pose = 'carry';
  c.dip = 0;
  return true;
}

/** A worker puts the ball back (or the errand ended): off their hands. */
export function workerDropsBall(spot: string, id: string) {
  const c = courts.get(spot);
  if (c?.holder === id) c.holder = null;
  setToyHand(id, null);
}

// ---------- the player's hoop scores ----------

/** The player's shots at a hoop this visit to the office: shots, makes, the streak running and the best streak. */
export interface HoopTally {
  shots: number;
  makes: number;
  streak: number;
  best: number;
}

const tallies = new Map<string, HoopTally>();
const tallyKey = (floorId: string, spot: string) => `${floorId}|${spot}`;

export const hoopTally = (floorId: string, spot: string): HoopTally => tallies.get(tallyKey(floorId, spot)) ?? { shots: 0, makes: 0, streak: 0, best: 0 };

/** One of the player's shots finished: a make (a swish when it touched nothing) or a miss. Returns the tally after it. */
export function countShot(floorId: string, spot: string, made: boolean): HoopTally {
  const t = { ...hoopTally(floorId, spot) };
  t.shots++;
  if (made) {
    t.makes++;
    t.streak++;
    t.best = Math.max(t.best, t.streak);
  } else t.streak = 0;
  tallies.set(tallyKey(floorId, spot), t);
  gamesChanged();
  return t;
}

/** What a make says: a swish, a streak, or a plain make. */
export function makeLine(t: HoopTally, swish: boolean): string {
  if (t.streak >= 3) return `🔥 ${t.streak} in a row!${swish ? ' Swish!' : ''}`;
  return swish ? '🏀 Swish!' : '🏀 In!';
}

// ---------- the dartboards ----------

/** A dartboard on screen, by its spot. */
export interface BoardState {
  spot: string;
  place: BoardPlace;
  /** Who is throwing at it: PLAYER, a worker's id, or nobody (the darts are in their holder on the side). */
  holder: string | null;
  /** Darts waiting for the board to throw: who, from where and how fast (in the room). */
  throws: { who: string; from: Vec3; v: Vec3 }[];
  /** The turn on the board: whose, and the darts that have landed (stuck or not). */
  turn: { who: string; darts: DartScore[] } | null;
  /** Darts thrown and not landed yet (their scores come in as they land). */
  flying: number;
  /** When a finished turn's darts come out of the board (performance.now()). */
  clearAt: number;
  /** The latest finished turn. */
  last: { who: string; points: number; line: string; at: number } | null;
}

const boards = new Map<string, BoardState>();

/** A dartboard at `spot` came on screen (`existing`: the one it had, back again after a remount). */
export function openBoard(spot: string, place: BoardPlace, existing?: BoardState): BoardState {
  const b: BoardState = existing ?? boards.get(spot) ?? { spot, place, holder: null, throws: [], turn: null, flying: 0, clearAt: 0, last: null };
  b.place = place;
  boards.set(spot, b);
  return b;
}

export function closeBoard(spot: string) {
  const b = boards.get(spot);
  if (!b) return;
  if (b.holder && b.holder !== PLAYER) setToyHand(b.holder, null);
  boards.delete(spot);
  const g = heldGame();
  if (g?.game === 'darts' && g.spot === spot) useView.getState().setHeld(null);
}

export const boardAt = (spot: string) => boards.get(spot) ?? null;
export const boardsOnScreen = (): BoardState[] => [...boards.values()];

/** E at a dartboard: its three darts are yours, unless a worker is throwing (you wait your turn). */
export function takeDarts(spot: string) {
  const b = boards.get(spot);
  const view = useView.getState();
  if (!b) return;
  if (heldGame()?.spot === spot) return;
  if (view.held) return view.showToast('🙌 Your hands are full');
  if (b.holder && b.holder !== PLAYER) return view.showToast('🎯 Wait for them to finish their turn');
  b.holder = PLAYER;
  newTurn(b, PLAYER);
  view.setHeld({ kind: 'game', game: 'darts', spot });
  view.showToast('🎯 Aim, hold the mouse to wind up, let go to throw');
  gamesChanged();
}

/** A worker steps up to throw; false while someone else is. */
export function workerTakesDarts(spot: string, id: string): boolean {
  const b = boards.get(spot);
  if (!b || b.holder) return false;
  b.holder = id;
  newTurn(b, id);
  return true;
}

/**
 * A worker lets a dart go from their hand at `from`: where it lands is their casual aim's (darts.ts npcDart), thrown at
 * the ideal speed on the arc there. False when it isn't their turn or they've thrown their three.
 */
export function workerThrowsDart(spot: string, id: string, from: Vec3, rand: () => number = Math.random): boolean {
  const b = boards.get(spot);
  if (!b || b.holder !== id || dartsThrown(b) >= 3) return false;
  const d = npcDart(rand);
  const v = aimVelocity(from, fromBoard(b.place, d.u, d.v), dartSpeed(DART_THROW.ideal), { x: 0, y: 0, z: 0 });
  if (!v) return false;
  b.throws.push({ who: id, from: { ...from }, v });
  b.flying++;
  return true;
}

export function workerLeavesBoard(spot: string, id: string) {
  const b = boards.get(spot);
  if (b?.holder === id) b.holder = null;
  setToyHand(id, null);
}

/** A fresh turn at the board for `who`: last turn's darts out. */
export function newTurn(b: BoardState, who: string) {
  b.turn = { who, darts: [] };
  b.clearAt = 0;
  gamesChanged();
}

/** Darts thrown in this turn so far (landed or in the air). */
export const dartsThrown = (b: BoardState) => (b.turn?.darts.length ?? 0) + b.flying;

/** How long a finished turn's darts stay in the board before they're pulled out (ms). */
export const TURN_SHOWN = 2200;

/**
 * A dart landed (stuck, or off the board: `score` 0): it's added to the turn, and after the third the turn is added up.
 * Returns the finished turn's total and line, or null mid-turn.
 */
export function dartLanded(b: BoardState, who: string, score: DartScore, now = performance.now()): { points: number; line: string } | null {
  b.flying = Math.max(0, b.flying - 1);
  if (!b.turn || b.turn.who !== who) newTurn(b, who);
  b.turn!.darts.push(score);
  gamesChanged();
  if (b.turn!.darts.length < 3) return null;
  const t = turnTotal(b.turn!.darts);
  b.last = { who, points: t.points, line: t.line, at: now };
  b.clearAt = now + TURN_SHOWN;
  if (who === PLAYER) countTurn(t.points);
  return t;
}

/** The player's darts this visit: turns thrown, the best and the last total. */
export interface DartsTally {
  turns: number;
  best: number;
  last: number | null;
}

let darts: DartsTally = { turns: 0, best: 0, last: null };
export const dartsTally = () => darts;

function countTurn(points: number) {
  darts = { turns: darts.turns + 1, best: Math.max(darts.best, points), last: points };
  gamesChanged();
}

/** The darts of the turn under way at the board in hand, as they read ("T20", "5"…). */
export const turnLabels = (b: BoardState | null) => (b?.turn ? b.turn.darts.map(dartLabel) : []);

// Whatever takes the game out of your hands (G, Esc, a floor change, something else picked up) puts its ball back on
// the rack or its darts back in their holder.
useView.subscribe((s, prev) => {
  const was = heldGame(prev.held);
  if (!was || (s.held?.kind === 'game' && s.held.spot === was.spot && s.held.game === was.game)) return;
  charge.at = null;
  setToyHand(PLAYER, null);
  if (was.game === 'hoop') {
    const c = courts.get(was.spot);
    if (c?.holder === PLAYER) c.holder = null;
  } else {
    const b = boards.get(was.spot);
    if (b?.holder === PLAYER) b.holder = null;
  }
  gamesChanged();
});
