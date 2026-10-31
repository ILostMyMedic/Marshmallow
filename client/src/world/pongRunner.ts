// Adapted from cubefarm client/src/world/toys/pongRunner.ts (MIT): two workers only, on pongSim.ts's plain ball. The
// player's paddle, contact and autopilot, the rematch, the probe's drills, forced rallies and live view, the sounds and
// the leaderboard's report are cut.

// Runs ping-pong on one ball: the serve (a toss and a hit), the rally (the air's pull and the table's bounce from
// pongPhysics.ts, paddles meeting the ball), the umpire's calls and the score (pongRules.ts), the workers' play
// (pongAi.ts) and their cheers and grumbles. Plain TypeScript over the ball's few rigid-body calls (pongSim.ts
// PongBody), stepped before and after every ball step: PongMatch.tsx runs it at the table, the tests on a bare ball.

import type { Gesture } from './body';
import { aiServe, aiShot, atContact, contactFor, missChance, REACH, reachTo, READY, readyPaddle, skillFor, ratingOf, standFor, swingPaddle, type Contact, type Skill, type Wobble } from './pongAi';
import { airStep, fromOwn, halfAt, offLine, otherEnd, overTable, ownFrame, PONG, solveShot, tableBounce, TABLE, type BallState, type End, type Shot, type V3 } from './pongPhysics';
import { newGame, newRally, rallyStep, scorePoint, serverOf, toHit, type Call, type Rally, type RallyEvent } from './pongRules';
import type { PongBody } from './pongSim';
import { bothReady, leaveSeat, pongMatch, setNpcPong, type Match } from './pongState';

export interface RunnerIo {
  /** Where a worker's body really is (people.ts bodyState); null to take them as being where they were sent. */
  bodyAt(id: string): { x: number; z: number } | null;
  /** Speech bubbles over the workers (people.ts say). */
  say?(id: string, text: string | null): void;
  rand?: () => number;
}

const STEP = PONG.step;
const R = PONG.ball.r;
const TOP = TABLE.top;
const NET_TOP = TOP + PONG.net.h;
const HALF_WID = TABLE.wid / 2;

export const TIMING = {
  /** Seconds after a point before the next serve; a let comes back quicker. */
  point: 1.5,
  let: 0.8,
  /** A worker's pause before tossing to serve (plus up to `serveJitter`). */
  serve: 0.9,
  serveJitter: 0.8,
  /** After a game, how long the two linger before going back. */
  linger: 4,
  /** A rally with nothing happening this long is over. */
  stall: 3,
};
/** The toss: up at this speed from the hand, met on the way down at this height over the table. */
const TOSS = { up: 2.2, hitY: TOP + 0.28 };

/** Faces down the table from `end` (body.ts heading). */
const facing = (end: End) => (end === 'west' ? -Math.PI / 2 : Math.PI / 2);
const ENDS: readonly End[] = ['west', 'east'];

interface Plan {
  /** Clock time they start moving for the ball (their reaction), the contact they read, and when it comes. */
  readyAt: number;
  contact: Contact | null;
  hitT: number;
  /** Read again once the ball bounced on their half: whether they'll miss it and what they'll play. */
  decided: boolean;
  willMiss: boolean;
  shot: Shot | null;
  wobble: Wobble | null;
  /** They've swung at this one (hit or whiffed): no second go. */
  swung: boolean;
}

interface AiEnd {
  plan: Plan | null;
  /** The last swing: when, and where it met (or missed) the ball, for the follow-through. */
  swungAt: number;
  metAt: V3 | null;
  stand: { x: number; z: number };
  mood: { gesture: Gesture; until: number } | null;
  sayUntil: number;
}

export class PongRunner {
  /** The runner's clock (s), a step at a time. */
  t = 0;
  private phaseT = 0;
  private matchId = -1;
  private live = false;
  private b: BallState = { p: { x: 0, y: 0, z: 0 }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 } };
  private prevP: V3 = { x: 0, y: 0, z: 0 };
  private rally: Rally = newRally('west');
  private lastEventT = 0;
  private inNet = false;
  private parked = false;
  private serve: { by: End; tossed: boolean; tossAt: number; delay: number; lat: number } | null = null;
  private ai: Record<End, AiEnd> = { west: this.freshAi('west'), east: this.freshAi('east') };
  private skills = new Map<string, Skill>();
  private readonly rand: () => number;

  constructor(
    private body: PongBody,
    private io: RunnerIo,
  ) {
    this.rand = io.rand ?? Math.random;
    this.park();
  }

  private freshAi(end: End): AiEnd {
    return { plan: null, swungAt: -Infinity, metAt: null, stand: fromOwn(end, READY.back, READY.lat), mood: null, sayUntil: 0 };
  }

  private skill(id: string): Skill {
    let s = this.skills.get(id);
    if (!s) this.skills.set(id, (s = skillFor(ratingOf(id))));
    return s;
  }

  // ---------- the ball ----------

  /** Out of play, out of sight: under the table's middle, still (PongMatch.tsx hides it). */
  private park() {
    if (this.parked) return;
    this.parked = true;
    this.live = false;
    this.body.setGravityScale(0, false);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    this.body.setTranslation({ x: TABLE.x, y: -1, z: TABLE.z }, false);
  }

  /** Whether the ball is parked out of sight. */
  get hidden() {
    return this.parked;
  }

  private hold(p: V3) {
    this.parked = false;
    this.live = false;
    this.body.setGravityScale(0, true);
    this.body.setTranslation(p, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  private launch(v: V3, w: V3) {
    this.parked = false;
    this.live = true;
    this.body.setGravityScale(1, true);
    this.body.setLinvel(v, true);
    this.b.w = { ...w };
    this.body.setAngvel(w, true);
  }

  // ---------- each step ----------

  /** Before the ball's step: the match's phases, the air on the ball, the workers' feet and paddles. */
  before() {
    this.t += STEP;
    const m = pongMatch();
    if ((m?.id ?? -1) !== this.matchId) this.newMatch(m);
    if (!m) {
      this.park();
      return;
    }
    switch (m.phase) {
      case 'waiting':
        this.park();
        if (bothReady(m)) this.startGame(m);
        break;
      case 'serve':
        this.serving(m);
        break;
      case 'rally':
        this.inPlay(m);
        break;
      case 'point':
        if (this.t - this.phaseT > (m.last ? TIMING.point : TIMING.let)) this.toServe(m);
        break;
      case 'over':
        this.afterGame(m);
        break;
    }
    this.moveWorkers(m);
    this.prevP = this.body.translation();
  }

  /**
   * After the ball's step: the table's bounce, the net, a dead ball, and paddles meeting it. The ball's own world
   * (pongSim.ts) has no table top: the bounce is done here, exactly as the forecasts do it, so what the players read
   * is what happens.
   */
  after() {
    const m = pongMatch();
    const p = this.body.translation();
    const v = this.body.linvel();
    const onTable = !this.parked && v.y < 0 && p.y <= TOP + R && this.prevP.y > TOP + R - 0.05 && overTable(p.x, p.z);
    if (onTable) this.tableTouch(p, v);
    if (!this.live || !m || m.phase !== 'rally') return;
    if (onTable) {
      this.event(m, { kind: 'bounce', on: halfAt(p.x) });
      if (m.phase !== 'rally') return;
    }
    const nearNet = Math.abs(p.x - TABLE.x) < R + PONG.net.t / 2 + 0.02 && p.y < NET_TOP + R && p.y > TOP && Math.abs(p.z - TABLE.z) < HALF_WID + PONG.net.overhang + R;
    if (nearNet && !this.inNet) this.event(m, { kind: 'net' });
    this.inNet = nearNet;
    if (p.y < TOP - 0.05 && !overTable(p.x, p.z)) this.event(m, { kind: 'dead' });
    else if (this.t - this.lastEventT > TIMING.stall) this.event(m, { kind: 'dead' });
    if (m.phase === 'rally') {
      const turn = toHit(this.rally);
      if (turn) this.contact(m, turn, this.body.translation(), this.body.linvel());
    }
  }

  /** The ball comes down on the table top: it bounces (pongPhysics), or, barely moving, settles on it and rolls. */
  private tableTouch(p: V3, v: V3) {
    const nv = { x: v.x, y: v.y, z: v.z };
    if (-v.y < 0.4 && !this.live) {
      nv.y = 0;
      nv.x *= 0.985;
      nv.z *= 0.985;
    } else tableBounce(nv, this.b.w);
    this.body.setTranslation({ x: p.x, y: TOP + R, z: p.z }, true);
    this.body.setLinvel(nv, true);
    this.body.setAngvel(this.b.w, true);
  }

  // ---------- the match's phases ----------

  private newMatch(m: Match | null) {
    this.matchId = m?.id ?? -1;
    this.ai = { west: this.freshAi('west'), east: this.freshAi('east') };
    this.serve = null;
    for (const end of ENDS) {
      const id = m?.seats[end]?.id;
      if (id) setNpcPong(id, null);
    }
  }

  private setPhase(m: Match, phase: Match['phase']) {
    m.phase = phase;
    this.phaseT = this.t;
  }

  private startGame(m: Match) {
    m.game = newGame(this.rand() < 0.5 ? 'west' : 'east');
    m.last = null;
    m.rally = 0;
    m.longest = 0;
    for (const end of ENDS) this.ai[end].plan = null;
    this.toServe(m);
  }

  private toServe(m: Match) {
    this.serve = null;
    this.live = false;
    m.rally = 0;
    this.setPhase(m, 'serve');
  }

  private serving(m: Match) {
    const by = serverOf(m.game);
    const seat = m.seats[by];
    if (!seat || !bothReady(m)) return;
    if (!this.serve || this.serve.by !== by) this.serve = { by, tossed: false, tossAt: 0, delay: TIMING.serve + this.rand() * TIMING.serveJitter, lat: (this.rand() * 2 - 1) * 0.3 };
    const sv = this.serve;
    if (!sv.tossed) {
      // the ball in hand, in front of them, until they toss it
      this.hold(this.tossSpot(by));
      if (this.t - this.phaseT <= sv.delay) return;
      sv.tossed = true;
      sv.tossAt = this.t;
      this.parked = false;
      this.body.setGravityScale(1, true);
      this.body.setLinvel({ x: 0, y: TOSS.up, z: 0 }, true);
      return;
    }
    const p = this.body.translation();
    const v = this.body.linvel();
    if (v.y < 0 && p.y <= TOSS.hitY) {
      const sol = solveShot(p, by, aiServe(this.skill(seat.id), by, this.rand));
      this.launch(sol.v, sol.w);
      this.swung(by, p);
      this.rally = newRally(by);
      this.event(m, { kind: 'serve', by });
      this.inNet = false;
      this.setPhase(m, 'rally');
      this.planFor(m, otherEnd(by));
    }
  }

  /** Where a worker serving from `end` holds the ball up: in front of them and to the right, where the paddle meets it. */
  private tossSpot(end: End): V3 {
    const st = this.ai[end].stand;
    const o = ownFrame(end, st.x, st.z);
    return { ...fromOwn(end, o.back - 0.32, o.lat + 0.22), y: TOSS.hitY - 0.06 };
  }

  private inPlay(m: Match) {
    if (!this.live) return;
    const v = this.body.linvel();
    this.b.v = { x: v.x, y: v.y, z: v.z };
    airStep(this.b, STEP);
    this.body.setLinvel(this.b.v, true);
    this.body.setAngvel(this.b.w, true);
    for (const end of ENDS) if (m.seats[end]) this.think(end);
  }

  /** They've had their game: a moment to take it in, then back to their desks. */
  private afterGame(m: Match) {
    if (this.t - this.phaseT <= TIMING.linger) return;
    for (const end of ENDS) {
      const id = m.seats[end]?.id;
      if (id) leaveSeat(id);
    }
  }

  // ---------- the umpire ----------

  private event(m: Match, e: RallyEvent) {
    this.lastEventT = this.t;
    const call = rallyStep(this.rally, e);
    if (e.kind === 'bounce' && !call) this.bounced(m, e.on);
    if (call) this.called(m, call);
  }

  private called(m: Match, call: Call) {
    this.live = false;
    for (const end of ENDS) this.ai[end].plan = null;
    if (!('point' in call)) {
      m.last = null;
      this.setPhase(m, 'point');
      return;
    }
    const winner = call.point;
    const over = scorePoint(m.game, winner);
    m.longest = Math.max(m.longest, m.rally);
    m.last = over ? { winner: over, why: 'game' } : { winner, why: call.why };
    this.react(m, winner, !!over);
    this.setPhase(m, over ? 'over' : 'point');
  }

  /** Workers cheer a point won and grumble at one lost, and more so at the end of a game. */
  private react(m: Match, winner: End, game: boolean) {
    for (const end of ENDS) {
      const id = m.seats[end]?.id;
      if (!id) continue;
      const won = end === winner;
      const ai = this.ai[end];
      ai.mood = { gesture: won ? 'cheer' : 'shrug', until: this.t + (game ? 2.6 : 1.1) };
      const chance = game ? 1 : won ? 0.35 : 0.3;
      if (this.io.say && this.rand() < chance) {
        const pick = (xs: string[]) => xs[Math.floor(this.rand() * xs.length)];
        this.io.say(id, game ? (won ? '🏆' : '😩') : won ? pick(['💪', '🎉', '😎', '🙌']) : pick(['😤', '🙈', '🤦', '😬']));
        ai.sayUntil = this.t + (game ? 3 : 1.4);
      }
    }
  }

  /** The ball reached someone's half: the worker there reads it properly now, and decides. */
  private bounced(m: Match, on: End) {
    if (toHit(this.rally) === on && m.seats[on]) this.decide(on, true);
  }

  // ---------- the workers ----------

  /** Someone just hit it towards `end`: the worker there starts reading it once their reaction time is up. */
  private planFor(m: Match, end: End) {
    const seat = m.seats[end];
    if (seat) this.ai[end].plan = { readyAt: this.t + this.skill(seat.id).reaction, contact: null, hitT: 0, decided: false, willMiss: false, shot: null, wobble: null, swung: false };
  }

  /** Where the ball now in play will meet `end`'s paddle. */
  private read(end: End, bounced: boolean): Plan | null {
    const p = this.body.translation();
    const v = this.body.linvel();
    const c = contactFor({ p, v, w: this.b.w }, end, bounced);
    return c ? { readyAt: this.t, contact: c, hitT: this.t + c.t, decided: bounced, willMiss: false, shot: null, wobble: null, swung: false } : null;
  }

  /** A worker's first read, once they've reacted: roughly where it's going (worse players misjudge it more). */
  private think(end: End) {
    const plan = this.ai[end].plan;
    if (!plan || plan.contact || this.t < plan.readyAt) return;
    const id = pongMatch()?.seats[end]?.id;
    if (!id) return;
    const c = contactFor({ p: this.body.translation(), v: this.body.linvel(), w: this.b.w }, end, false);
    if (!c) return;
    const off = (1 - this.skill(id).rating) * 0.18;
    plan.contact = { ...c, p: { ...c.p, z: c.p.z + (this.rand() * 2 - 1) * off } };
    plan.hitT = this.t + c.t;
  }

  /** After the bounce on their half: where it really meets them, whether they'll miss it, and the return they'll play. */
  private decide(end: End, bounced: boolean) {
    const id = pongMatch()?.seats[end]?.id;
    if (!id) return;
    const s = this.skill(id);
    const read = this.read(end, bounced);
    const ai = this.ai[end];
    if (!read?.contact) {
      ai.plan = null;
      return;
    }
    // how far short their feet will be when it arrives
    const from = this.io.bodyAt(id) ?? ai.stand;
    const to = standFor(end, read.contact.p);
    const left = Math.max(0, read.hitT - this.t);
    const stretch = Math.max(0, Math.hypot(to.x - from.x, to.z - from.z) - s.move * left);
    read.willMiss = this.rand() < missChance(s, read.contact, stretch);
    const { shot, wobble } = aiShot(s, end, read.contact.p, this.rand);
    read.shot = shot;
    read.wobble = wobble;
    read.readyAt = Math.min(ai.plan?.readyAt ?? this.t, this.t);
    ai.plan = read;
  }

  private contact(m: Match, end: End, p: V3, v: V3) {
    const seat = m.seats[end];
    if (!seat || !atContact(end, p, v)) return;
    const ai = this.ai[end];
    if (ai.plan?.swung) return;
    if (!ai.plan?.decided) this.decide(end, true);
    const plan = ai.plan;
    const reach = reachTo(end, this.io.bodyAt(seat.id) ?? ai.stand, p);
    this.swung(end, p);
    if (plan) plan.swung = true;
    if (!plan?.shot || plan.willMiss || reach > REACH + 0.25) return; // a whiff: the swing goes through, the ball doesn't come back
    this.strike(m, end, p, plan.shot, plan.wobble);
  }

  /** A paddle sends the ball back with `shot`, off its line by `wobble`. */
  private strike(m: Match, end: End, p: V3, shot: Shot, wobble: Wobble | null) {
    const sol = solveShot(p, end, shot);
    this.launch(wobble ? offLine(sol.v, wobble) : sol.v, sol.w);
    this.inNet = false;
    this.event(m, { kind: 'hit', by: end });
    m.rally++;
    this.planFor(m, otherEnd(end));
  }

  private swung(end: End, at: V3) {
    const ai = this.ai[end];
    ai.swungAt = this.t;
    ai.metAt = { ...at };
  }

  /** Every step: where each worker at the table steps to, how they hold the paddle, and their cheers and grumbles. */
  private moveWorkers(m: Match) {
    const serving = m.phase === 'serve' ? serverOf(m.game) : null;
    for (const end of ENDS) {
      const seat = m.seats[end];
      if (!seat?.ready) continue;
      const id = seat.id;
      if (!m.seats[otherEnd(end)]) {
        // nobody at the other end: they wait on their own (pongErrands.ts gives up after a while), not moved by the match
        setNpcPong(id, null);
        continue;
      }
      const ai = this.ai[end];
      const at = this.io.bodyAt(id) ?? ai.stand;
      let paddle: V3;
      const plan = ai.plan;
      if (serving === end) {
        ai.stand = fromOwn(end, 0.55, this.serve?.lat ?? 0);
        const sv = this.serve;
        const hitAt = sv?.tossed ? sv.tossAt + (2 * TOSS.up) / PONG.gravity + 0.03 : this.t + 1;
        paddle = sv?.tossed ? swingPaddle(end, { ...this.tossSpot(end), y: TOSS.hitY }, this.t, hitAt) : { ...readyPaddle(end, at), y: this.body.translation().y - 0.1 };
      } else if (plan?.contact && this.t >= plan.readyAt) {
        ai.stand = standFor(end, plan.contact.p);
        paddle = swingPaddle(end, plan.contact.p, this.t, plan.hitT);
      } else if (ai.metAt && this.t - ai.swungAt < 0.35) {
        paddle = swingPaddle(end, ai.metAt, this.t, ai.swungAt);
      } else {
        if (m.phase !== 'rally' || toHit(this.rally) !== end) ai.stand = fromOwn(end, READY.back, READY.lat);
        paddle = readyPaddle(end, at);
      }
      const mood = ai.mood && this.t < ai.mood.until ? ai.mood.gesture : null;
      if (ai.sayUntil && this.t > ai.sayUntil) {
        ai.sayUntil = 0;
        this.io.say?.(id, null);
      }
      setNpcPong(id, { x: ai.stand.x, z: ai.stand.z, heading: facing(end), speed: this.skill(id).move, gesture: mood ?? 'paddle', paddle: mood ? null : paddle });
    }
  }

  /** Stops everything (the table is going away). */
  stop() {
    const m = pongMatch();
    for (const end of ENDS) {
      const id = m?.seats[end]?.id;
      if (id) setNpcPong(id, null);
    }
    this.park();
  }
}
