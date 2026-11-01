// The games' errands: now and then an idle worker on a floor with a hoop shoots a few baskets, or on a floor with a
// dartboard throws a turn of darts. Scripted errands (errands.ts) on the hoops and boards on screen (games/gameState.ts):
// for hoops, a ball from the rack, a few steps out to the free-throw spot, the ball up over the head and away (the
// player's own shot maths, wobbled: games/hoopPhysics.ts aimHoop), a cheer or a shrug, and back to the rack for the next;
// for darts, three throws from the oche (games/darts.ts npcDart) and the total said out loud. Manners: one worker per
// hoop or board, never one the player is using, a shrug and back to work if the player takes their ball, and no shot
// while the player is in the way. Imported by ErrandDirector.tsx, which registers them.
// Adapted from cubefarm client/src/world/toyErrands.ts (MIT): the hoops errand's stages, its shot counts and manners;
// the darts errand is new, and catch with the beach ball is cut.

import type { Gesture } from './body';
import { afterHours, fanciesBeer } from './beerBreak';
import { dayTime } from './dayTime';
import { machineSpot } from './decor/machines';
import { slotSpotIds } from './decor/spots';
import { isFree, registerErrand, type Act, type ErrandScript } from './errands';
import { boardAt, boardsOnScreen, courtAt, courtsOnScreen, PLAYER, setToyHand, styleTall, workerDropsBall, workerLeavesBoard, workerTakesBall, workerTakesDarts, workerThrowsDart } from './games/gameState';
import { aimHoop, headingToHoop, hoopRim, npcHoldPoint, npcShot, type HoopPlace } from './games/hoopPhysics';
import type { Pt } from './nav';
import { say } from './people';
import { parseBodyStyle } from './bodyStyle';
import { useStore } from '../store';
import { spot as spotById, walkways } from './walkways';

/**
 * The slices of restless moments (the number fanciesCoffee reads) that go to the games: after the vending machine's,
 * where the beer's is after hours (the beer wins those while its fridge is open), so never a coffee, a snack or a can.
 */
export const GAME_SHARE = { hoops: [0.62, 0.77], darts: [0.77, 0.9] } as const;
/** Shots per visit to the hoop; darts are thrown three to a turn. */
export const SHOTS = { min: 3, max: 5 };
/** How close (m) the player may be to a shot's line before they wait, and how long (s) they wait before giving up. */
export const PLAYER_GAP = 1.1;
const PATIENCE = 8;
/** How likely a game wins over the other idle errands wanted at the same moment. */
const WEIGHT = 2;

/** Does this restless moment fancy `game`? Its number falls in the game's slice, and isn't the beer's while that's on. */
export function fanciesGame(game: keyof typeof GAME_SHARE, restless: number, beerOpen = false) {
  const f = (restless * 97.31) % 1;
  const [lo, hi] = GAME_SHARE[game];
  return f >= lo && f < hi && !(beerOpen && fanciesBeer(restless));
}

/** Whether the player is clear of a throw from `a` to `b` (on the floor plan): at least `gap` m from the line. */
export function clearOfPlayer(a: Pt, b: Pt, player: Pt, gap = PLAYER_GAP): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((player.x - a.x) * dx + (player.z - a.z) * dz) / len2)) : 0;
  return Math.hypot(player.x - (a.x + dx * t), player.z - (a.z + dz * t)) >= gap;
}

const between = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const beerOpen = () => machineSpot('beer') !== null && afterHours(dayTime.t);
const tallNow = () => styleTall(parseBodyStyle(useStore.getState().settings.bodyStyle));

/** Which worker is playing at each hoop or board (by spot), from the moment they set off. */
const plays = new Map<string, string>();

/** A hoop on screen that nobody is using or on their way to, or null. */
const freeCourt = () => courtsOnScreen().find((c) => !c.holder && !plays.has(c.spot)) ?? null;
/** A dartboard on screen that nobody is using or on their way to, or null. */
const freeBoard = () => boardsOnScreen().find((b) => !b.holder && !plays.has(b.spot)) ?? null;

/** A script's act (one object, reused every frame), its stage and how long it has been in it. */
class Hands<S extends string> {
  act: Act = { do: 'stand', x: 0, z: 0, heading: 0, gesture: 'none' };
  t = 0;
  constructor(public stage: S) {}
  go(stage: S) {
    this.stage = stage;
    this.t = 0;
  }
  stand(heading: number, gesture: Gesture): Act {
    return Object.assign(this.act, { do: 'stand', heading, gesture } as const);
  }
  walk(x: number, z: number, heading: number, gesture: Gesture): Act {
    return Object.assign(this.act, { do: 'walk', x, z, heading, gesture } as const);
  }
  done(): Act {
    this.act.do = 'done';
    return this.act;
  }
}

// ---------- shooting hoops ----------

type HoopStage = 'take' | 'court' | 'aim' | 'watch' | 'react' | 'shrug';

/** A named place on an office floor (walkways.ts): the free-throw spot or the rack's front at a big spot. */
const placeOf = (id: string): Pt | null => spotById(walkways('office'), id) ?? null;

/** Takes a ball from the rack at big spot `spot`, shoots a few from the free-throw spot, and cheers or shrugs at each. */
export function hoopsScript(id: string, spot: string, shots = between(SHOTS.min, SHOTS.max)): ErrandScript {
  plays.set(spot, id);
  const h = new Hands<HoopStage>('take');
  let made = 0;
  let taken = 0;
  let thrownAt = 0;
  let waited = 0;
  let cheer = false;
  const place = (): HoopPlace | null => courtAt(spot)?.place ?? null;
  return {
    tick(me) {
      h.t += me.dt;
      const c = courtAt(spot);
      const at = place();
      if (!c || !at) return h.done();
      // the player took the ball (or the hoop): a shrug, and back to work
      if (c.holder === PLAYER && h.stage !== 'shrug') h.go('shrug');
      const face = headingToHoop(me.x, me.z, at);
      switch (h.stage) {
        case 'take': {
          // at the rack (they're walked there to start with; after a shot they walk back), stooping for a ball
          const front = placeOf(slotSpotIds(spot).front);
          if (front && Math.hypot(me.x - front.x, me.z - front.z) > 0.35) {
            h.t = 0;
            return h.walk(front.x, front.z, face, 'none');
          }
          if (h.t < 0.55) return h.stand(face, 'stoop');
          if (c.holder !== id && !workerTakesBall(spot, id)) return (h.go('shrug'), h.act);
          h.go('court');
          return h.stand(face, 'hold');
        }
        case 'court': {
          const s = placeOf(slotSpotIds(spot).shoot);
          if (!s) return h.done();
          c.pose = 'carry';
          if (me.arrived && Math.hypot(me.x - s.x, me.z - s.z) < 0.35) h.go('aim');
          return h.walk(s.x, s.z, headingToHoop(s.x, s.z, at), 'hold');
        }
        case 'aim': {
          // ball up, a moment to line it up and a little dip, but only with the player out of the way
          if (!clearOfPlayer(me, hoopRim(at), me.player)) {
            if ((waited += me.dt) > PATIENCE) {
              workerDropsBall(spot, id);
              return h.done();
            }
            h.t = Math.min(h.t, 0.5);
          }
          c.pose = 'shoot';
          c.dip = h.t > 0.75 ? Math.sin(Math.min(1, (h.t - 0.75) / 0.3) * Math.PI) * 0.12 : 0;
          if (h.t >= 1.05) {
            const tall = tallNow();
            const stance = { x: me.x, z: me.z, heading: face };
            c.throws.push({ who: id, from: npcHoldPoint(stance, 'shoot', tall, 0, { x: 0, y: 0, z: 0 }), v: npcShot(stance, at, tall, aimHoop(stance, at, tall, Math.random), { x: 0, y: 0, z: 0 }) });
            workerDropsBall(spot, id);
            thrownAt = performance.now();
            taken++;
            c.dip = 0;
            h.go('watch');
          }
          return h.stand(face, 'stretch');
        }
        case 'watch': {
          const last = c.last;
          if (last && last.who === id && last.at >= thrownAt) {
            cheer = last.made;
            if (cheer) made++;
            h.go('react');
          } else if (h.t > 3) {
            cheer = false;
            h.go('react');
          }
          return h.stand(face, h.t < 0.35 ? 'stretch' : 'none');
        }
        case 'react':
          if (h.t > 1.3) {
            if (taken >= shots) {
              if (made >= 3) say(id, '🏀', 1.6);
              return h.done();
            }
            h.go('take'); // back to the rack for another ball
          }
          return h.stand(face, cheer ? 'cheer' : 'shrug');
        case 'shrug':
          workerDropsBall(spot, id);
          if (h.t > 1.4) return h.done();
          return h.stand(Math.atan2(-(me.player.x - me.x), -(me.player.z - me.z)), 'shrug');
      }
      return h.act;
    },
    end() {
      workerDropsBall(spot, id);
      if (plays.get(spot) === id) plays.delete(spot);
    },
  };
}

// ---------- a turn of darts ----------

type DartStage = 'step' | 'aim' | 'throw' | 'wait' | 'react';

/** Where a worker's throwing hand is: up beside their head winding up, out in front letting go. */
function dartHand(x: number, z: number, heading: number, up: boolean, tall: number) {
  const ahead = up ? 0.12 : 0.42;
  const right = 0.2;
  return {
    x: x - Math.sin(heading) * ahead + Math.cos(heading) * right,
    y: (up ? 1.62 : 1.5) * tall,
    z: z - Math.cos(heading) * ahead - Math.sin(heading) * right,
  };
}

/** Throws a turn of three darts at the board in wall spot `spot` from the oche, then says what it came to. */
export function dartsScript(id: string, spot: string): ErrandScript {
  plays.set(spot, id);
  const h = new Hands<DartStage>('step');
  let tries = 0;
  return {
    tick(me) {
      h.t += me.dt;
      const b = boardAt(spot);
      if (!b) return h.done();
      const bull = { x: b.place.x, z: b.place.z };
      const face = Math.atan2(-(bull.x - me.x), -(bull.z - me.z));
      const tall = tallNow();
      switch (h.stage) {
        case 'step':
          if (b.holder !== id && !workerTakesDarts(spot, id)) {
            say(id, null);
            return h.done(); // the player got there first
          }
          h.go('aim');
          return h.stand(face, 'none');
        case 'aim':
          setToyHand(id, dartHand(me.x, me.z, face, h.t > 0.35, tall));
          if (!clearOfPlayer(me, bull, me.player, 0.8)) h.t = Math.min(h.t, 0.3);
          if (h.t >= 0.75) h.go('throw');
          return h.stand(face, h.t > 0.35 ? 'windup' : 'none');
        case 'throw': {
          const hand = dartHand(me.x, me.z, face, false, tall);
          setToyHand(id, hand);
          if (h.t >= 0.08) {
            workerThrowsDart(spot, id, hand);
            tries++;
            h.go('wait');
          }
          return h.stand(face, 'strike');
        }
        case 'wait':
          setToyHand(id, null);
          if (h.t < 0.7) return h.stand(face, h.t < 0.25 ? 'strike' : 'none');
          if (tries < 3) {
            h.go('aim');
            return h.stand(face, 'none');
          }
          // all three thrown: once they're in, the turn's total, out loud
          if (b.flying > 0 && h.t < 3) return h.stand(face, 'none');
          h.go('react');
          if (b.last?.who === id) say(id, `🎯 ${b.last.points}`, 2.4);
          return h.stand(face, 'none');
        case 'react': {
          const points = b.last?.who === id ? b.last.points : 0;
          if (h.t > 1.6) {
            workerLeavesBoard(spot, id);
            return h.done();
          }
          return h.stand(face, points >= 60 ? 'cheer' : points >= 26 ? 'nod' : 'shrug');
        }
      }
      return h.act;
    },
    end() {
      workerLeavesBoard(spot, id);
      if (plays.get(spot) === id) plays.delete(spot);
    },
  };
}

// ---------- the registry ----------

/** For QA (games/probe.ts): the next restless worker comes to play, whatever their moment's number says. */
export const invited = { hoops: false, darts: false };

registerErrand({
  name: 'hoops',
  get weight() {
    return invited.hoops ? 50 : WEIGHT;
  },
  max: 1,
  patience: 150,
  when: (w, s) => s.floor === 'office' && w.role !== 'ceo' && isFree(w.status) && s.seatedFor >= s.restless && (invited.hoops || fanciesGame('hoops', s.restless, beerOpen())) && !!freeCourt(),
  spot: ['big-1-front', 'big-2-front', 'big-3-front'],
  where: () => {
    const c = freeCourt();
    return c ? [slotSpotIds(c.spot).front] : [];
  },
  steps: [],
  script: (w) => {
    const c = freeCourt();
    if (c) invited.hoops = false;
    return c ? hoopsScript(w.id, c.spot) : null;
  },
});

registerErrand({
  name: 'darts',
  get weight() {
    return invited.darts ? 50 : WEIGHT;
  },
  max: 1,
  patience: 90,
  when: (w, s) => s.floor === 'office' && w.role !== 'ceo' && isFree(w.status) && s.seatedFor >= s.restless && (invited.darts || fanciesGame('darts', s.restless, beerOpen())) && !!freeBoard(),
  spot: ['wall-1-oche', 'wall-2-oche', 'wall-3-oche', 'wall-4-oche', 'wall-5-oche'],
  where: () => {
    const b = freeBoard();
    return b ? [`${b.spot}-oche`] : [];
  },
  steps: [],
  script: (w) => {
    const b = freeBoard();
    if (b) invited.darts = false;
    return b ? dartsScript(w.id, b.spot) : null;
  },
});

/** For the probe and tests: who is playing where. */
export const gamePlays = () => Object.fromEntries(plays);
