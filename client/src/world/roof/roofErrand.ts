// A roof break, seen from downstairs (roofBreaks.ts): an idle worker (or the CEO, off to take a call) walks to the
// elevator, steps in and rides up out of sight; once their time up there is over they step back out and go back to
// their desk. A scripted errand (errands.ts) that the errand director runs on the floor you're on; RoofPeople.tsx plays
// the same visit up top. Imported by ErrandDirector.tsx, which registers it.
// Adapted from cubefarm client/src/world/roof/roofErrand.ts (MIT): the elevator's ding is cut, and the CEO goes up
// from their own floor rather than the lobby.

import { useStore } from '../../store';
import { isFree, registerErrand, type Act, type Errand, type ErrandScript, type ErrandState, type ErrandWorker } from '../errands';
import { CEO_FLOOR, ROOF } from '../floors';
import { setHidden } from '../people';
import { CABIN, DOORS_SECONDS } from '../socials';
import { useView } from '../view';
import { endVisit, planVisit, ROOF_BREAK, roofVisit, roofVisits, roomFor, startVisit, type VisitKind } from './roofBreaks';
import { ROOF_SEATS } from './roofLayout';

const NORTH = 0; // a body heading facing -z: out through the cabin's doors
const DOORS_SHUT = 0.9; // seconds stood in the cabin before the doors close on them

const kindFor = (role: string): VisitKind => (role === 'ceo' ? 'call' : 'break');

/** Into the cabin and up; a while later back out of it, and then the director walks them home. */
export function rideUp(id: string, kind: VisitKind): ErrandScript {
  let stage: 'in' | 'doors' | 'away' | 'out' = 'in';
  let t = 0;
  const act: Act = { do: 'walk', x: CABIN.x, z: CABIN.z, heading: NORTH, gesture: 'none' };
  const doing = (d: Act['do']) => ((act.do = d), act);
  return {
    tick(me) {
      switch (stage) {
        case 'in':
          if (!me.arrived) return doing('walk');
          stage = 'doors';
          t = 0;
          return doing('stand');
        case 'doors': {
          t += me.dt;
          if (t < DOORS_SHUT) return doing('stand');
          const now = Date.now();
          const v = roofVisit(id) ?? planVisit(roofVisits(now), id, kind, now, Math.random(), { seats: ROOF_SEATS, playerSeat: null });
          if (!v) return doing('done'); // someone took the last seat meanwhile: back out
          startVisit(v);
          setHidden(id, true);
          stage = 'away';
          return doing('stand');
        }
        case 'away': {
          const v = roofVisit(id);
          if (v && Date.now() < v.leave + ROOF_BREAK.ride * 1000) return doing('stand');
          endVisit(id);
          setHidden(id, false);
          stage = 'out';
          t = 0;
          return doing('stand');
        }
        case 'out':
          t += me.dt;
          return doing(t < DOORS_SECONDS ? 'stand' : 'done');
      }
    },
    // However it ends (back down, called back to work, the floor left behind), they're in sight again. Called back to
    // work, they're on their way back down; otherwise the visit carries on up top until its time is up: follow them up
    // and they're there.
    end() {
      setHidden(id, false);
      const w = useStore.getState().workers[id];
      if (stage === 'away' && w && !isFree(w.status)) endVisit(id);
    },
  };
}

const goesUp = (w: ErrandWorker, s: ErrandState, ceo: boolean) =>
  (ceo ? w.role === 'ceo' && s.floor === 'ceo' : w.role !== 'ceo' && s.floor === 'office') &&
  isFree(w.status) &&
  s.seatedFor >= s.restless &&
  roomFor(roofVisits(), w.id, ceo ? 'call' : 'break', Date.now());

const roofErrand = (name: string, ceo: boolean): Errand => ({
  name,
  when: (w, s) => goesUp(w, s, ceo),
  spot: ['elevator'],
  steps: [],
  weight: ceo ? ROOF_BREAK.callWeight : ROOF_BREAK.weight,
  max: 1,
  // the longest stay, the rides and the doors, with time to spare
  patience: Math.max(ROOF_BREAK.stay[1], ROOF_BREAK.call[1]) + 2 * ROOF_BREAK.ride + 30,
  // no room up there by the time they'd go: they sit a while longer
  script: (w) => (roomFor(roofVisits(), w.id, kindFor(w.role), Date.now()) ? rideUp(w.id, kindFor(w.role)) : null),
});

registerErrand(roofErrand('roof', false));
registerErrand(roofErrand('roof-call', true));

// Arriving on a floor starts it fresh, everyone at their desk (ErrandDirector.tsx): nobody from there is still up top.
useView.subscribe((s, prev) => {
  if (s.floor === prev.floor || s.floor === null || s.floor === ROOF) return;
  const office = useStore.getState();
  const repo = office.floors.find((f) => f.floor === s.floor);
  for (const v of roofVisits()) {
    const w = office.workers[v.id];
    if (!w || (w.role === 'ceo' ? s.floor === CEO_FLOOR : !!repo && w.floorId === repo.id)) endVisit(v.id);
  }
});
