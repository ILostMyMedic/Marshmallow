// Adapted from cubefarm client/src/world/pongErrands.ts (MIT): without the probe's invitations, and with the match's
// seats handed in (setPongSeats) instead of imported, so the errands stay pure until the match state is wired up.

// Ping-pong errands: someone free walks over to play whoever is waiting at the table (you, after you pick up a
// paddle, or a teammate who fancied a game), and now and then an idle person starts a game themselves. Once they're
// at their end, the match runner plays the match and moves them (through the seats' `npcPong`); the script here just
// carries that out, and walks them back when the game is over, they're replaced, or work calls.
// Manners: only free people come (errands never pull anyone busy away), within the floor's walker cap.

import type { Gesture } from './body';
import { isFree, registerErrand, type Act, type ErrandPeer, type ErrandScript } from './errands';
import { say } from './people';
import { otherEnd, type End } from './pongPhysics';

/** What a worker at the table is told to do by the match runner: where to step, facing, how fast, and their hands. */
export interface PongMove {
  x: number;
  z: number;
  heading: number;
  speed: number;
  gesture: Gesture;
}

/** The match's seats, as the errands use them (cubefarm's toys/pongState.ts has these, by these names). */
export interface PongSeats {
  /** The end worker `id` plays (or is on the way to), or null. */
  seatOf(id: string): End | null;
  /** The end that's waiting for someone to come and play (nobody on the way yet), or null. */
  wantsOpponent(): End | null;
  /** Nobody at the table at all. */
  tableFree(): boolean;
  /** A worker heading over to take the waiting end: that end, or null when it's gone. */
  claimSeat(id: string): End | null;
  /** A worker sets off to start a game at `end` of the free table: that end, or null when it's taken. */
  startNpcMatch(id: string, end: End): End | null;
  /** They're at their end, paddle in hand. */
  readySeat(id: string): void;
  /** They leave the table (their errand ended, however): the end is free and the game stops. */
  leaveSeat(id: string): void;
  /** What the runner has them do now; null while there's nobody to play yet. */
  npcPong(id: string): PongMove | null;
}

let seats: PongSeats | null = null;

/** The table's wiring hands in the match's seats while a table is on screen (null: none, and nobody plays). */
export function setPongSeats(s: PongSeats | null) {
  seats = s;
}

/**
 * Restless people share out what they do by their roll (ErrandState.roll): this slice starts a game. cubefarm's was
 * 0.5-0.62, its toys (hoops, a beach ball) taking 0-0.5; with no toys here, ping-pong has their share too.
 */
export const PONG_SHARE = [0.3, 0.62] as const;
/** How likely a rolled game wins over the other idle errands wanted at the same moment (coffee, the fridge, a stretch…). */
const START_WEIGHT = 3;
/** Seconds someone sits after getting back before they'd come and play again. */
const REST = 2;
/** How long a game may keep someone at the table, playing the player (s), and two workers playing each other. */
const PATIENCE = { player: 1800, npc: 900 };
/** Seconds a starter waits at the table for someone to come and play. */
export const WAITING = 30;

const rolled = (roll: number | undefined) => roll !== undefined && roll >= PONG_SHARE[0] && roll < PONG_SHARE[1];

/** Faces down the table from `end`: body.ts heading 0 faces -Z, so west (looking +x) is -π/2. */
const facing = (end: End) => (end === 'west' ? -Math.PI / 2 : Math.PI / 2);

/** One person at the table, from when they get to their end until they leave it (the script starts as they set off). */
function atTable(t: PongSeats, id: string): ErrandScript {
  const act: Act = { do: 'stand', x: 0, z: 0, heading: 0, gesture: 'none' };
  let bye = 0;
  let waited = 0;
  const stand = (h: number, gesture: Gesture) => Object.assign(act, { do: 'stand', heading: h, gesture } as const);
  return {
    tick(me) {
      const end = t.seatOf(id);
      if (!end) {
        // the game's over, the player took this end, or the other one left: a shrug, and back to the desk
        if (bye === 0) say(id, null);
        if ((bye += me.dt) > 1.2) return Object.assign(act, { do: 'done' } as const);
        return stand(act.heading, 'shrug');
      }
      t.readySeat(id);
      const cmd = t.npcPong(id);
      if (!cmd) {
        // nobody at the other end yet (a starter waiting): stand ready, but not for ever
        if (t.wantsOpponent() === otherEnd(end) && (waited += me.dt) > WAITING) t.leaveSeat(id);
        return stand(facing(end), 'paddle');
      }
      waited = 0;
      return Object.assign(act, { do: 'step', x: cmd.x, z: cmd.z, heading: cmd.heading, gesture: cmd.gesture, speed: cmd.speed } as const);
    },
    end() {
      say(id, null);
      t.leaveSeat(id);
    },
  };
}

/** Whether anyone else on the floor is free to come and play. */
const someoneElseFree = (id: string, others: readonly ErrandPeer[] | undefined) => !!others?.some((o) => o.id !== id && o.role !== 'ceo' && isFree(o.status));

// Answering a game: the player (or a teammate) is at the table waiting for someone.
registerErrand({
  name: 'pong',
  weight: 40,
  speed: 1.6,
  patience: PATIENCE.player,
  when: (w, s) => s.floor === 'office' && isFree(w.status) && s.seatedFor >= REST && (seats?.wantsOpponent() ?? null) !== null,
  spot: ['pong-west', 'pong-east'],
  where: () => {
    const end = seats?.wantsOpponent();
    return end ? [`pong-${end}`] : [];
  },
  claim: (id) => (seats?.claimSeat(id) ?? null) !== null,
  steps: [],
  script: (w) => (seats?.seatOf(w.id) ? atTable(seats, w.id) : null),
});

// Fancying a game: an idle, restless person goes to the free table, and someone else free comes to play them.
let startAt: End = 'west';
registerErrand({
  name: 'pong-start',
  weight: START_WEIGHT,
  when: (w, s) =>
    s.floor === 'office' && isFree(w.status) && !!seats?.tableFree() && s.seatedFor >= s.restless && rolled(s.roll) && someoneElseFree(w.id, s.others),
  spot: ['pong-west', 'pong-east'],
  where: () => {
    startAt = Math.random() < 0.5 ? 'west' : 'east';
    return [`pong-${startAt}`];
  },
  claim: (id) => (seats?.startNpcMatch(id, startAt) ?? null) !== null,
  patience: PATIENCE.npc,
  steps: [],
  script: (w) => (seats?.seatOf(w.id) ? atTable(seats, w.id) : null),
});
