// Who is up on the roof (roofBreaks.ts): someone on a break steps out of the elevator, strolls to their seat and settles
// in (leaning back in a deck chair, on a bench by the fire, or stood at a lookout's binoculars), trading the odd emoji
// with whoever's near, until their time's up (or work comes in, and they hurry off) and they go back down; the CEO paces
// the south railing on a call. While you're up here, now and then someone free comes up on their own, a few at most.
// Their bodies are people.ts's, like everyone's; this only drives them.
// Adapted from cubefarm client/src/world/roof/RoofPeople.tsx (MIT): the probe, the night's emoji and the elevator's
// ding are cut; the benches, the lookouts, the name tags and the chatter are new.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import type { Worker } from '../../../../shared/types';
import { useStore } from '../../store';
import { seededAppearance } from '../appearance';
import { smooth, type Gesture } from '../body';
import { Character } from '../Character';
import { NameTag } from '../Desk';
import { HURRY_SPEED, isFree, nextWaypoint } from '../errands';
import { lookingThrough } from '../lookout';
import { clear, type Pt } from '../nav';
import { bodyState, bodyTarget, placeBody, say, seatBody, setBody } from '../people';
import { playerAt } from '../rig';
import { CABIN, DOORS_SECONDS } from '../socials';
import { steer, WALK_R, WALK_SPEED, type Body, type Mover } from '../walkways';
import { RECLINE } from './DeckChairs';
import { chatPick, endVisit, freeSeat, planVisit, roofEmoji, roofVisits, startVisit, updateVisit, visitStage, type RoofVisit, type VisitKind } from './roofBreaks';
import { CALL_HEADING, CALL_SPOTS, findRoofPath, FIRE_STAND, LIFT, lookoutSeat, roofNav, ROOF_SEATS, seatById, type RoofSeat } from './roofLayout';

const NORTH = 0; // body headings: 0 faces −z
const HIP = 0.5; // a desk chair's seat height (Character.tsx), where the recline pivots
const SINK = 0.16; // a deck chair sits that much lower
/** Seconds between rolls for someone coming up while you're here, and the chances per roll. */
const ROLL = { every: 6, breakChance: 0.2, callChance: 0.06, ride: 2.5 };
const ALREADY_UP = 3000; // ms: a visit that started this long before you got here is already settled in
/** Seconds between someone settled saying something (one of them, if they've company), and how long a bubble lasts. */
const CHAT = { every: [3.5, 7] as const, seconds: 2.6 };

type Stage = 'riding' | 'doors' | 'walk' | 'sitting' | 'seated' | 'looking' | 'call' | 'leave';

interface Walker {
  id: string;
  kind: VisitKind;
  /** Their seat on a break; null on a call. */
  seat: RoofSeat | null;
  stage: Stage;
  t: number;
  path: Pt[];
  wp: number;
  /** Pacing on a call, or pointing at a lookout: which way round it is, and seconds left before the next change. */
  leg: number;
  hold: number;
  hurry: boolean;
  /** Seconds waited for the player in the way; then they walk on through for a moment. */
  waited: number;
  ghost: number;
}

/** A walk from `from` to `to` round the furniture (straight there when the grid has no way). */
const route = (from: Pt, to: Pt): Pt[] => findRoofPath(from, to) ?? [to];
const standable = (x: number, z: number) => clear(roofNav().rects, x, z, WALK_R);
/** The player's lookout as a seat, while they look through one. */
const playerSeat = () => {
  const lens = lookingThrough();
  return lens ? lookoutSeat(lens.id) : null;
};

/** Someone in a deck chair: they lean back with it while they sit. */
function Lounger({ worker, seat, children }: { worker: Worker; seat: RoofSeat; children: ReactNode }) {
  const tilt = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = tilt.current;
    if (!g) return;
    const st = bodyState(worker.id);
    const k = st ? smooth(st.sit) : bodyTarget(worker.id) ? 0 : 1;
    g.rotation.x = RECLINE * k;
    g.position.y = HIP - SINK * k;
  });
  return (
    <group position={[seat.x, 0, seat.z]} rotation={[0, seat.heading, 0]}>
      <group ref={tilt} position={[0, HIP - SINK, 0]} rotation={[RECLINE, 0, 0]}>
        <group position={[0, -HIP, 0]}>
          <Character worker={worker} seatedTag={TAG_OVER_HEAD}>
            {children}
          </Character>
        </group>
      </group>
    </group>
  );
}

/** No desk up here: a seated visitor's name tag floats over their head. */
const TAG_OVER_HEAD: [number, number, number] = [0, 1.75, 0];

/**
 * A visitor, drawn from their seat (their Character's "chair"): a deck chair, a bench by the fire (they get up in front
 * of it), or, never sitting, where they stand at a lookout or pace on a call.
 */
function Visitor({ worker, seat }: { worker: Worker; seat: RoofSeat | null }) {
  const shirt = useMemo(() => seededAppearance({ seed: worker.seed, role: worker.role }).shirt, [worker.seed, worker.role]);
  const tag = <NameTag worker={worker} color={shirt} />;
  if (seat?.kind === 'chair') {
    return (
      <Lounger worker={worker} seat={seat}>
        {tag}
      </Lounger>
    );
  }
  const at = seat ?? { x: CALL_SPOTS[0].x, z: CALL_SPOTS[0].z, heading: CALL_HEADING };
  return (
    <group position={[at.x, 0, at.z]} rotation={[0, at.heading, 0]}>
      <Character worker={worker} standAt={seat?.kind === 'fire' ? FIRE_STAND : undefined} seatedTag={TAG_OVER_HEAD}>
        {tag}
      </Character>
    </group>
  );
}

export function RoofPeople() {
  const workers = useStore((s) => s.workers);
  const [drawn, setDrawn] = useState<{ id: string; seat: RoofSeat | null }[]>([]);
  const walkers = useMemo(() => new Map<string, Walker>(), []);
  // what the frame loop reuses: the visits, the others round a walker, the settled ones who might talk
  const run = useMemo(
    () => ({
      roll: ROLL.every,
      chat: CHAT.every[0] as number,
      mounted: Date.now(),
      dirty: false,
      visits: [] as RoofVisit[],
      pool: [] as Body[],
      others: [] as Body[],
      settled: [] as Body[],
      mover: { id: '', x: 0, z: 0, dx: 0, dz: 0 } as Mover,
    }),
    [],
  );

  // Off the roof: their visits carry on (roofBreaks.ts), but nobody here is driving their bodies any more.
  useEffect(
    () => () => {
      for (const id of walkers.keys()) {
        seatBody(id);
        say(id, null);
      }
      walkers.clear();
    },
    [walkers],
  );

  const show = (w: Walker, on: boolean) => {
    run.dirty = true;
    if (on) walkers.set(w.id, w);
    else walkers.delete(w.id);
  };

  /** Brings someone free up now (a roll while you're here). False when there's no room. */
  const comeUp = (w: Worker) => {
    const kind: VisitKind = w.role === 'ceo' ? 'call' : 'break';
    const v = planVisit(roofVisits(), w.id, kind, Date.now(), Math.random(), { seats: ROOF_SEATS, playerSeat: playerSeat(), ride: ROLL.ride });
    if (v) startVisit(v);
    return !!v;
  };

  /** Off to the elevator and down (briskly when work's come in). */
  const leave = (w: Walker, hurry: boolean, from: Pt) => {
    w.stage = 'leave';
    w.hurry = hurry;
    w.path = [...route(from, LIFT), CABIN];
    w.wp = 0;
    w.waited = w.ghost = 0;
    say(w.id, null);
    if (hurry) updateVisit(w.id, { leave: Date.now() });
  };

  /** At their seat: down into a chair or onto the bench, or up to the binoculars. */
  const settle = (w: Walker) => {
    const seat = w.seat;
    if (!seat) {
      w.stage = 'call';
      w.t = 0;
      return;
    }
    if (seat.kind === 'lookout') {
      setBody(w.id, { mode: 'standing', x: seat.x, z: seat.z, heading: seat.heading, gesture: 'none' });
      w.stage = 'looking';
      w.hold = 3 + Math.random() * 3;
      say(w.id, roofEmoji('lookout', Math.random()), CHAT.seconds);
      return;
    }
    seatBody(w.id); // the last steps to their seat, and down into it
    w.stage = 'sitting';
  };

  /** Who else is about, for steering round: the same objects every frame. */
  const othersThan = (w: Walker) => {
    run.others.length = 0;
    let n = 0;
    for (const o of walkers.values()) {
      const b = o === w ? undefined : bodyState(o.id);
      if (!b) continue;
      const slot = (run.pool[n++] ??= { id: '', x: 0, z: 0 });
      slot.id = o.id;
      slot.x = b.x;
      slot.z = b.z;
      run.others.push(slot);
    }
    return run.others;
  };

  /** One frame along w's path; true once they're at its end and stood still. */
  const follow = (w: Walker, dt: number, gesture: Gesture, face?: number): boolean => {
    const st = bodyState(w.id);
    if (!st) return false;
    w.wp = nextWaypoint(w.path, w.wp, st);
    const goal = w.path[w.wp];
    const last = w.wp === w.path.length - 1;
    const dx = goal.x - st.x;
    const dz = goal.z - st.z;
    const d = Math.hypot(dx, dz);
    if (last && d < 0.08 && st.speed < 0.05) return true;
    const heading = last && face !== undefined ? face : Math.atan2(-dx, -dz);
    // Wait for the player (or anyone) in the way, a few seconds at most, then walk on through.
    if (d > 0.05 && w.ghost <= 0) {
      const m = run.mover;
      m.id = w.id;
      m.x = st.x;
      m.z = st.z;
      m.dx = dx / d;
      m.dz = dz / d;
      const s = steer(m, othersThan(w), playerAt, standable);
      if (s.wait || s.speed < 0.15) {
        w.waited += dt;
        if (w.waited > 3) w.ghost = 2;
        setBody(w.id, { mode: 'standing', x: st.x, z: st.z, heading: st.heading, gesture });
        return false;
      }
    }
    w.waited = 0;
    w.ghost = Math.max(0, w.ghost - dt);
    setBody(w.id, { mode: 'walking', x: goal.x, z: goal.z, heading, speed: w.hurry ? HURRY_SPEED : WALK_SPEED, gesture });
    return false;
  };

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const now = Date.now();
    const office = useStore.getState();

    // Visits that have got here (or were already here when you came up).
    const visits = roofVisits(now, run.visits);
    for (const v of visits) {
      if (walkers.has(v.id) || !office.workers[v.id]) continue;
      const stage = visitStage(v, now);
      if (stage === 'down') continue;
      const seat = v.kind === 'break' ? (seatById(v.seat) ?? null) : null;
      if (v.kind === 'break' && !seat) continue;
      const w: Walker = { id: v.id, kind: v.kind, seat, stage: 'riding', t: 0, path: [], wp: 0, leg: 0, hold: -1, hurry: false, waited: 0, ghost: 0 };
      if (stage === 'up' && (now - v.arrive > ALREADY_UP || now - run.mounted < 1000)) {
        // they were up here before you: where they'd be by now
        if (!seat) {
          placeBody(v.id, CALL_SPOTS[0].x, CALL_SPOTS[0].z, CALL_HEADING);
          setBody(v.id, { gesture: 'call' });
          w.stage = 'call';
        } else if (seat.kind === 'lookout') {
          placeBody(v.id, seat.x, seat.z, seat.heading);
          w.stage = 'looking';
        } else {
          seatBody(v.id);
          w.stage = 'seated';
        }
      }
      show(w, true);
    }

    let found: RoofVisit | undefined;
    for (const w of walkers.values()) {
      const a = office.workers[w.id];
      found = undefined;
      for (const v of visits) if (v.id === w.id) found = v;
      const v = found;
      if (!a || (!v && w.stage === 'riding')) {
        seatBody(w.id);
        say(w.id, null);
        show(w, false);
        continue;
      }
      w.t += dt;
      const st = bodyState(w.id);
      const busy = !isFree(a.status);
      const over = !v || now >= v.leave;
      switch (w.stage) {
        case 'riding': {
          if (!v || now < v.arrive) break;
          // you're at their lookout: another seat, or straight back down if there's none
          if (w.seat?.kind === 'lookout' && w.seat.id === playerSeat()) {
            const other = freeSeat(visits, ROOF_SEATS, playerSeat(), Math.random());
            if (!other) {
              endVisit(w.id);
              show(w, false);
              break;
            }
            w.seat = other;
            updateVisit(w.id, { seat: other.id });
          }
          placeBody(w.id, CABIN.x, CABIN.z, NORTH);
          w.stage = 'doors';
          w.t = 0;
          run.dirty = true; // out of the elevator: drawn from now on
          break;
        }
        case 'doors':
          if (w.t < DOORS_SECONDS) break;
          w.path = [LIFT, ...route(LIFT, w.seat?.front ?? CALL_SPOTS[0])];
          w.wp = 0;
          w.hurry = busy;
          w.stage = 'walk';
          break;
        case 'walk':
          if (busy && !w.hurry && st) leave(w, true, st);
          else if (follow(w, dt, w.seat ? 'none' : 'call', w.seat?.heading ?? CALL_HEADING)) settle(w);
          break;
        case 'sitting':
          if (st?.stage === 'seated') {
            w.stage = 'seated';
            say(w.id, w.seat?.kind === 'fire' ? (Math.random() < 0.5 ? '🔥' : '🙌') : '😎', 3);
          }
          break;
        case 'seated':
          if ((over || busy) && st) leave(w, busy, w.seat?.front ?? st);
          break;
        case 'looking': {
          if ((over || busy) && st) {
            leave(w, busy, st);
            break;
          }
          // a long look out over the city, now and then pointing something out
          w.hold -= dt;
          if (w.hold > 0) break;
          w.leg = 1 - w.leg;
          w.hold = w.leg ? 2 + Math.random() * 1.5 : 5 + Math.random() * 6;
          setBody(w.id, { gesture: w.leg ? 'point' : 'none' });
          if (w.leg && Math.random() < 0.6) say(w.id, roofEmoji('lookout', Math.random()), CHAT.seconds);
          break;
        }
        case 'call': {
          if ((over || busy) && st) {
            leave(w, busy, st);
            break;
          }
          // pace between the two spots, the phone in hand, now and then a word or two
          const spot = CALL_SPOTS[w.leg];
          if (w.path.length !== 1 || w.path[0] !== spot) {
            w.path = [spot];
            w.wp = 0;
          }
          if (!follow(w, dt, 'call', CALL_HEADING)) break;
          if (w.hold < 0) {
            w.hold = 4 + Math.random() * 5; // a while at the railing, looking out
            if (Math.random() < 0.6) say(w.id, roofEmoji('call', Math.random()), 2.5);
          }
          w.hold -= dt;
          if (w.hold <= 0) {
            w.leg = 1 - w.leg;
            w.hold = -1;
          }
          break;
        }
        case 'leave':
          if (follow(w, dt, 'none')) {
            endVisit(w.id);
            seatBody(w.id);
            say(w.id, null);
            show(w, false);
          }
          break;
      }
    }

    // Now and then, one of those settled in says something to whoever's near.
    run.chat -= dt;
    if (run.chat <= 0) {
      run.chat = CHAT.every[0] + Math.random() * (CHAT.every[1] - CHAT.every[0]);
      run.settled.length = 0;
      let n = 0;
      for (const w of walkers.values()) {
        if ((w.stage !== 'seated' && w.stage !== 'looking') || !w.seat) continue;
        const slot = (run.pool[n++] ??= { id: '', x: 0, z: 0 });
        slot.id = w.id;
        slot.x = w.seat.x;
        slot.z = w.seat.z;
        run.settled.push(slot);
      }
      const who = chatPick(run.settled, Math.random());
      const seat = who ? walkers.get(who)?.seat : null;
      if (who && seat) say(who, roofEmoji(seat.kind, Math.random()), CHAT.seconds);
    }

    // Now and then, while you're up here, someone free comes up for a break, or the CEO for a call.
    run.roll -= dt;
    if (run.roll <= 0) {
      run.roll = ROLL.every;
      const up = new Set(visits.map((v) => v.id));
      const free = Object.values(office.workers).filter((a) => !up.has(a.id) && isFree(a.status));
      const team = free.filter((a) => a.role !== 'ceo');
      if (team.length && Math.random() < ROLL.breakChance) comeUp(team[Math.floor(Math.random() * team.length)]);
      const ceo = free.find((a) => a.role === 'ceo');
      if (ceo && Math.random() < ROLL.callChance) comeUp(ceo);
    }

    if (run.dirty) {
      run.dirty = false;
      setDrawn([...walkers.values()].filter((w) => w.stage !== 'riding').map((w) => ({ id: w.id, seat: w.seat })));
    }
  });

  return (
    <group>
      {drawn.map((d) => {
        const w = workers[d.id];
        return w ? <Visitor key={d.id} worker={w} seat={d.seat} /> : null;
      })}
    </group>
  );
}
