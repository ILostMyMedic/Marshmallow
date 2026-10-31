// Mia, the guide at the front desk: in the lobby she types at her screen and waves when you come up to the desk; give
// her the word (the front desk panel, ui/FrontDeskPanel.tsx) and she takes you round the building (tour.ts): she leads
// you to the elevator, rides with you, steps out of the cabin on each floor, turns to you and tells you about it in
// speech bubbles (ui/TourCard.tsx has it in full, and the way on). Back in the lobby she goes back to her chair. She's
// drawn on the lobby, and on whichever floor the tour has taken you to; the rides are the elevator's own
// (elevatorRide.ts).
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Worker } from '../../../shared/types';
import { Character } from './Character';
import { CABIN_SPOT, rideTo, useRide } from './elevatorRide';
import { LOBBY } from './floors';
import { HALF_D, RECEPTION_CHAIR } from './layout';
import { placeBody, say, seatBody, setBody } from './people';
import { queueFidget } from './reactionFeed';
import { playerAt } from './rig';
import { Performer } from './stage';
import { currentStop, useTour } from './tourState';
import { useView } from './view';
import { walkways, type FloorKind } from './walkways';

/** The guide, as Character.tsx draws anyone: a person of the office's who isn't on a team. */
export const GUIDE: Worker = {
  id: 'front-desk-guide',
  name: 'Mia',
  floorId: '',
  role: 'worker',
  seed: 271828,
  desk: 0,
  model: '',
  effort: '',
  host: 'local',
  status: 'working',
  task: null,
  activity: null,
  idleSince: null,
  startedAt: null,
  endedAt: null,
  costUsd: 0,
  turns: 0,
  lastError: null,
  sessionId: null,
  leaving: false,
};

const NORTH = -Math.PI / 2; // walkways.ts facings
/** Where she stands to tell you about a floor: a few steps out of the elevator, to one side. */
const PRESENT = { x: 1.7, z: HALF_D - 3.4 };
/** Seconds between her lines, and before she gets going after the doors open. */
const LINE_S = 3.8;
const SETTLE_S = 0.9;
/** Her lead to the elevator (m/s; you walk faster), and how long the walk may take before the doors close on it anyway. */
const LEAD = 1.9;
const LEAD_MAX_S = 12;
/** How near (m) you come to the desk before she waves, and how long before she waves again. */
const WAVE_NEAR = 4;
const WAVE_GAP = 25;

type Phase = 'desk' | 'leading' | 'riding' | 'out' | 'telling' | 'home';

/** The heading (body.ts: a yaw, 0 facing -Z) from (x, z) to you. */
const toYou = (x: number, z: number) => Math.atan2(-(playerAt.x - x), -(playerAt.z - z));

export function TourGuide({ floor }: { floor: number }) {
  const active = useTour((s) => s.active);
  const at = useTour((s) => s.at);
  const run = useMemo(() => ({ phase: 'desk' as Phase, p: null as Performer | null, t: 0, line: 0, waved: -Infinity, stop: -1 }), []);
  // the lobby's walkways round its furniture; elsewhere she only steps straight out of the cabin
  const kind: FloorKind = floor === LOBBY ? 'lobby' : 'office';
  const stop = active ? currentStop() : null;
  // On a floor that isn't the lobby she's only here with you, on the tour.
  const here = floor === LOBBY || (!!stop && stop.floor === floor && run.phase !== 'desk');

  // A new stop (the tour started, or you pressed on): off to the elevator.
  useEffect(() => {
    if (!active) {
      if (run.phase !== 'desk' && run.phase !== 'home') {
        say(GUIDE.id, '👋', 2);
        run.phase = floor === LOBBY ? 'home' : 'desk';
        if (floor !== LOBBY) seatBody(GUIDE.id); // back at her desk, for when you're next in the lobby
        run.p = floor === LOBBY ? new Performer(GUIDE.id, walkways('lobby'), [{ walk: { x: RECEPTION_CHAIR.x + 1.2, z: RECEPTION_CHAIR.z }, face: NORTH }]) : null;
      }
      return;
    }
    if (run.stop === at) return;
    run.stop = at;
    const next = useTour.getState().stops[at];
    if (!next) return;
    say(GUIDE.id, at === 0 ? 'Follow me! 🛗' : 'This way!', 2.4);
    if (floor === LOBBY && at === 0) {
      run.phase = 'leading';
      run.p = new Performer(GUIDE.id, walkways('lobby'), [{ walk: { x: 0.9, z: HALF_D - 1.2 }, face: Math.PI / 2, speed: LEAD }]);
      run.t = 0;
    } else {
      run.phase = 'riding';
      rideTo(next.floor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the floor is read when the stop changes, not tracked
  }, [active, at, run]);

  // Arriving on a floor with the tour: out of the cabin beside you.
  useEffect(() => {
    if (!active || !stop || stop.floor !== floor || run.phase !== 'riding') return;
    run.phase = 'out';
    run.t = 0;
    run.line = 0;
    const w = walkways(kind);
    placeBody(GUIDE.id, CABIN_SPOT.x + 0.8, CABIN_SPOT.z, 0);
    run.p =
      floor === LOBBY
        ? new Performer(GUIDE.id, w, [{ hold: SETTLE_S }, { walk: { x: 0, z: HALF_D - 2.2 }, face: NORTH }])
        : new Performer(GUIDE.id, w, [{ hold: SETTLE_S }, { walk: PRESENT, face: NORTH, straight: true }]); // open floor in front of the elevator on every floor
    // eslint-disable-next-line react-hooks/exhaustive-deps -- arriving is the floor changing
  }, [floor]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    run.t += dt;
    if (run.phase === 'desk') {
      // at her desk in the lobby: a wave when you come up to it
      if (floor !== LOBBY || Math.hypot(playerAt.x - RECEPTION_CHAIR.x, playerAt.z - RECEPTION_CHAIR.z - 2) > WAVE_NEAR || run.t - run.waved < WAVE_GAP) return;
      run.waved = run.t;
      queueFidget(GUIDE.id, 'wave', playerAt.x, playerAt.z);
      say(GUIDE.id, 'Hi! Welcome 👋', 2.6);
      return;
    }
    if (run.phase === 'leading') {
      if (run.t < LEAD_MAX_S && run.p?.tick(dt)) return;
      run.p = null;
      if (run.t > 2.2 && !useRide.getState().phase) {
        const next = currentStop();
        run.phase = 'riding';
        if (next) rideTo(next.floor);
      }
      return;
    }
    if (run.phase === 'out') {
      if (run.p?.tick(dt)) return;
      run.p = null;
      run.phase = 'telling';
      run.t = LINE_S; // the first line straight away
      return;
    }
    if (run.phase === 'telling') {
      const s = currentStop();
      const b = { x: floor === LOBBY ? 0 : PRESENT.x, z: floor === LOBBY ? HALF_D - 2.2 : PRESENT.z };
      setBody(GUIDE.id, { mode: 'standing', x: b.x, z: b.z, heading: toYou(b.x, b.z), gesture: run.line % 2 ? 'talk' : 'none' });
      if (!s || run.t < LINE_S || run.line >= s.say.length) return;
      run.t = 0;
      say(GUIDE.id, s.say[run.line++], LINE_S - 0.3);
      // the last stop is back in the lobby: when she's said her piece, the tour's over and she goes back to her desk
      if (floor === LOBBY && run.line >= s.say.length) useTour.getState().end();
      return;
    }
    if (run.phase === 'home') {
      if (run.p?.tick(dt)) return;
      run.p = null;
      seatBody(GUIDE.id);
      run.phase = 'desk';
      run.t = 0;
    }
  });

  if (!here) return null;
  // Her "chair": the front desk's in the lobby (she faces the way in), the elevator's cabin anywhere else.
  return floor === LOBBY ? (
    <group position={[RECEPTION_CHAIR.x, 0, RECEPTION_CHAIR.z]} rotation={[0, Math.PI, 0]}>
      <Character worker={GUIDE} />
    </group>
  ) : (
    <group position={[CABIN_SPOT.x, 0, CABIN_SPOT.z]}>
      <Character worker={{ ...GUIDE, status: 'idle' }} />
    </group>
  );
}

/** The probe's handle on the tour, for headless checks: start it, move on, end it. */
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__mmTour = {
    get state() {
      const t = useTour.getState();
      return { active: t.active, at: t.at, stop: currentStop()?.title ?? null, floor: useView.getState().floor };
    },
    next: () => useTour.getState().next(),
    end: () => useTour.getState().end(),
  };
}
