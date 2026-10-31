// The CEO's floor's side of the CEO's walks (ceoWalk.ts): when one is due and the CEO is free and in their chair, they
// get up and ride down, out of sight while they're away walking another floor (ritualRunner.ts plays that part), and
// come back up to their desk when the walk's over or work comes in.
// Adapted from cubefarm client/src/world/ritualRunner.ts (MIT): LobbyRitualRunner, from the CEO's own floor.
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../store';
import { awayFor, ceoWalks, tickWalkClock, walkDue, walkStarted } from './ceoWalk';
import { dayTime } from './dayTime';
import { isFree } from './errands';
import { isSeated, onErrand, seatBody, setHidden } from './people';
import { CABIN, DOORS_SECONDS } from './socials';
import { Performer } from './stage';
import { spot, walkways } from './walkways';

const NORTH = -Math.PI / 2; // walkways.ts facings
const BRISK = 1.3;

type Phase = 'here' | 'leaving' | 'away' | 'back';

export function CeoRituals() {
  const run = useMemo(() => ({ phase: 'here' as Phase, who: '', until: 0, p: null as Performer | null }), []);
  // leaving the floor mid-walk: the CEO is back in their chair for next time
  useEffect(
    () => () => {
      if (!run.who) return;
      setHidden(run.who, false);
      seatBody(run.who);
    },
    [run],
  );

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    tickWalkClock(dt);
    const ceo = Object.values(useStore.getState().workers).find((w) => w.role === 'ceo');
    if (!ceo) return;
    const w = walkways('ceo');
    const lift = spot(w, 'elevator')!;
    if (run.phase === 'here') {
      if (!walkDue(dayTime.t * 24) || !isFree(ceo.status) || !isSeated(ceo.id) || onErrand(ceo.id)) return;
      walkStarted();
      run.who = ceo.id;
      run.p = new Performer(ceo.id, w, [{ walk: lift, speed: BRISK }, { walk: CABIN, straight: true, face: NORTH }]);
      run.phase = 'leaving';
    } else if (run.phase === 'leaving') {
      if (run.p?.tick(dt)) return;
      setHidden(ceo.id, true);
      run.until = ceoWalks.watched + awayFor(Math.random());
      run.phase = 'away';
    } else if (run.phase === 'away') {
      if (ceoWalks.watched < run.until && isFree(ceo.status)) return;
      setHidden(ceo.id, false);
      const home = spot(w, 'ceo')!;
      run.p = new Performer(ceo.id, w, [{ place: CABIN, face: NORTH }, { hold: DOORS_SECONDS }, { walk: lift, straight: true, speed: BRISK }, { walk: home, face: home.facing }]);
      run.phase = 'back';
    } else if (!run.p?.tick(dt)) {
      seatBody(ceo.id); // the last step to beside the chair, and sit
      run.p = null;
      run.who = '';
      run.phase = 'here';
    }
  });
  return null;
}
