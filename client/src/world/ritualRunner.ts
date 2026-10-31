// The rituals on the floor you're on, a frame at a time (Rituals.tsx mounts one per office floor). ritualSchedule.ts
// decides; this carries it out: when new issues land (the server's `issuesFiled` moments), the CEO rides up, the free
// workers gather round the whiteboard, and the CEO puts each issue up on the board and has them clap; and lunch goes on
// and off. Everything it moved is put back when the floor goes. window.__mmRituals reports it, and can force one.
// Adapted from cubefarm client/src/world/ritualRunner.ts (MIT): the CEO's floor walks, Friday pizza, the evening and
// going home, the voice, the sticky notes and the sounds are cut. Until the sky comes (the day/night clock), the
// office runs on the real clock, so lunch agrees with the wall clock.
import type { Moment, Worker } from '../../../shared/types';
import { useStore } from '../store';
import type { Gesture } from './body';
import { dayPhase } from './dayTime';
import { headingFor } from './errands';
import { closeGathering, openGathering, type Gathering } from './gathering';
import { meals, mealsChanged, resetMeals } from './meals';
import { bodyState, say, seatBody, setBody } from './people';
import { momentsSince } from './reactions';
import { newRitualState, officeClock, PRESENTER, schedule, semicircle, STANDUP_SPOTS, type Decision, type Ritual } from './ritualSchedule';
import { CABIN, DOORS_SECONDS } from './socials';
import { Performer, type Cue } from './stage';
import { spot, walkways } from './walkways';

// walkways.ts facings
const NORTH = -Math.PI / 2;
const SOUTH = Math.PI / 2;
const BRISK = 1.5;
/** A stand-up that hasn't finished in this long (s) is wrapped up: everyone goes back. */
const STANDUP_MAX = 100;

interface Standup {
  /** The new issues, in the order the CEO puts them up, and how many are up. */
  issues: number[];
  shown: number;
  ceo: string;
  g: Gathering;
  performer: Performer;
  stage: 'coming' | 'line' | 'turn' | 'point' | 'talk' | 'clap' | 'done';
  /** Seconds in this stage, and since it started. */
  t: number;
  age: number;
  /** Who nods along until when (age). */
  nods: Map<string, number>;
}

const ceoOf = () => Object.values(useStore.getState().workers).find((w) => w.role === 'ceo') ?? null;

export class OfficeRitualRunner {
  readonly w = walkways('office');
  readonly s = newRitualState();
  /** Who's drawn as a visitor (Rituals.tsx re-renders through `onCast` when it changes). */
  readonly cast = { ceo: false };
  onCast: () => void = () => {};
  standup: Standup | null = null;
  /** Seconds of watching this floor (the ritual clock: it stops with the render). */
  private watched = 0;
  private wait = 0.5;
  /** A forced lunch holds the office's hour at lunchtime until then (the ritual clock's seconds). */
  private lunchUntil = -1;
  private last: Moment | null = useStore.getState().moments.at(-1) ?? null;
  private log: { t: number; what: string }[] = [];

  constructor(
    public floorId: string,
    public workers: Worker[],
  ) {}

  private note(what: string) {
    this.log.push({ t: Math.round(this.watched * 100) / 100, what });
    if (this.log.length > 60) this.log.splice(0, this.log.length - 60);
  }

  /** One frame (`dt` seconds). */
  tick(dt: number) {
    this.watched += dt;
    if (this.standup) this.stepStandup(dt);
    if ((this.wait -= dt) > 0) return;
    this.wait = 0.5;
    this.look();
  }

  /** Every half second: the issues filed here since the last look, and what the scheduler makes of them. */
  private look() {
    const now = this.watched;
    const moments = useStore.getState().moments;
    for (const m of momentsSince(moments, this.last)) {
      if (m.type !== 'issuesFiled' || m.floorId !== this.floorId) continue;
      this.note(`issues filed: ${m.numbers.map((n) => `#${n}`).join(', ')}`);
      const st = this.standup;
      // filed while the CEO is still on the way to the board: they're in this stand-up too
      if (st && (st.stage === 'coming' || st.stage === 'line')) st.issues.push(...m.numbers.filter((n) => !st.issues.includes(n)));
      else for (const n of m.numbers) if (!this.s.fresh.some((f) => f.n === n)) this.s.fresh.push({ n, at: now });
    }
    this.last = moments.at(-1) ?? null;
    const wall = Date.now();
    const clock = officeClock(wall, dayPhase(wall, 'clock'), 'clock');
    if (now < this.lunchUntil) clock.hour = 12.5;
    const decisions = schedule(this.s, { now, clock, standupOn: !!this.standup });
    for (const d of decisions) this.apply(d);
  }

  private apply(d: Decision) {
    if (d.do === 'standup') return this.startStandup(d.issues);
    meals.lunch = d.on;
    if (d.on) meals.ate.clear();
    mealsChanged();
    this.note(d.on ? 'lunch time' : 'lunch is over');
  }

  // ---------- the stand-up ----------

  /** The CEO rides up and the free workers gather at the board; with no CEO in the office, there's nobody to present. */
  private startStandup(issues: number[]): boolean {
    const ceo = ceoOf();
    if (!ceo) {
      this.note('stand-up skipped: no CEO');
      return false;
    }
    const g = openGathering({ name: 'standup', floor: 'office', spots: semicircle(PRESENTER, STANDUP_SPOTS), welcome: (w) => w.role !== 'ceo' });
    const lift = spot(this.w, 'elevator')!;
    const st: Standup = { issues: [...issues], shown: 0, ceo: ceo.id, g, stage: 'coming', t: 0, age: 0, nods: new Map(), performer: null as unknown as Performer };
    g.gestureOf = (id) => ((st.nods.get(id) ?? -1) > st.age ? 'nod' : null);
    const cues: Cue[] = [
      { place: CABIN, face: NORTH },
      { hold: DOORS_SECONDS },
      { walk: lift, straight: true, speed: BRISK },
      { walk: PRESENTER, face: SOUTH, speed: BRISK },
      // a wave while the last of the team gathers
      { until: () => st.g.seats.size > 0 && [...st.g.seats.keys()].every((id) => st.g.there.has(id)), max: 6, face: SOUTH, gesture: 'wave' },
      { run: () => this.present(st) },
      { wait: () => st.stage === 'done' },
      { hold: 0.9, face: SOUTH, gesture: 'wave' },
      { walk: lift, speed: BRISK },
      { walk: CABIN, straight: true },
    ];
    st.performer = new Performer(ceo.id, this.w, cues);
    this.standup = st;
    this.cast.ceo = true;
    this.onCast();
    this.note(`stand-up: ${st.issues.map((n) => `#${n}`).join(', ')}`);
    return true;
  }

  private present(st: Standup) {
    st.stage = 'line';
    st.t = 0;
    st.g.open = false; // whoever's on their way still comes; nobody else sets off
    say(st.ceo, '📋');
  }

  private stepStandup(dt: number) {
    const st = this.standup!;
    st.age += dt;
    st.t += dt;
    if (!st.performer.tick(dt) || st.age > STANDUP_MAX) return this.endStandup();
    const stand = (face: number, gesture: Gesture) => setBody(st.ceo, { mode: 'standing', x: PRESENTER.x, z: PRESENTER.z, heading: headingFor(face), gesture });
    const next = () => {
      st.t = 0;
      if (st.shown < st.issues.length) {
        st.stage = 'turn';
        say(st.ceo, null);
        return;
      }
      st.stage = 'clap';
      st.g.gesture = 'clap';
      say(st.ceo, '👏');
    };
    switch (st.stage) {
      case 'line':
        stand(SOUTH, 'talk');
        if (st.t >= 2.4) next();
        return;
      case 'turn':
        stand(NORTH, 'none');
        if (st.t < 0.35) return;
        // a hand up at the Backlog column, naming the issue, and the team nods along
        stand(NORTH, 'reach');
        say(st.ceo, `#${st.issues[st.shown++]}`, 1.6);
        for (const id of st.g.there) if (Math.random() < 0.75) st.nods.set(id, st.age + 0.9 + Math.random() * 0.8);
        st.stage = 'point';
        st.t = 0;
        return;
      case 'point':
        stand(NORTH, 'reach');
        if (st.t >= 0.9) {
          st.stage = 'talk';
          st.t = 0;
        }
        return;
      case 'talk':
        stand(SOUTH, 'talk');
        if (st.t >= 0.9) next();
        return;
      case 'clap':
        stand(SOUTH, 'cheer');
        if (st.t < 2.8) return;
        st.stage = 'done';
        closeGathering(st.g);
        say(st.ceo, null);
        this.note('stand-up over');
        return;
    }
  }

  private endStandup() {
    const st = this.standup;
    if (!st) return;
    this.standup = null;
    closeGathering(st.g);
    seatBody(st.ceo);
    say(st.ceo, null);
    this.cast.ceo = false;
    this.onCast();
  }

  // ---------- QA ----------

  /** `?ritual=…` or the probe: a stand-up for a few of the floor's open issues, or 90 seconds of lunch. */
  force(kind: Ritual): boolean {
    if (kind === 'standup') {
      if (this.standup) return false;
      const open = useStore.getState().floors.find((f) => f.id === this.floorId)?.issues.map((i) => i.number) ?? [];
      return this.startStandup(open.slice(0, 3));
    }
    this.lunchUntil = this.watched + 90;
    this.wait = 0;
    return true;
  }

  state() {
    const st = this.standup;
    return {
      watched: Math.round(this.watched),
      lunch: { on: meals.lunch, ate: [...meals.ate], eating: Object.fromEntries(meals.spots) },
      standup: st && { stage: st.stage, issues: st.issues, shown: st.shown, ceo: st.ceo, at: bodyState(st.ceo) ?? null, coming: [...st.g.seats.keys()], there: [...st.g.there] },
      fresh: this.s.fresh.map((f) => f.n),
      log: [...this.log],
    };
  }

  dispose() {
    if (this.standup) {
      closeGathering(this.standup.g);
      seatBody(this.standup.ceo);
      say(this.standup.ceo, null);
    }
    this.standup = null;
    resetMeals();
  }
}
