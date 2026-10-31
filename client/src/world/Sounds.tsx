// What you hear, mounted once inside the Canvas (Game.tsx): the listener kept where you are (on foot, your head; in the
// overview, where you left yourself, so the floor still sounds as it did), the outside's ambience and the room's tone
// for the floor you're on (ui/outsideSfx.ts, ui/roomTone.ts; quiet behind a panel and while the elevator carries you),
// the voices following their speakers' heads (ui/voices.ts), and the working workers typing at their desks in time
// with their hands (ui/typingSfx.ts; only the nearest few). Everything else is played by the thing that makes it.
// Adapted from cubefarm client/src/world/SoundListener.tsx, OutsideSounds.tsx and TypingSounds.tsx (MIT): one
// component for the three; the listener follows you in third person rather than the camera.
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../store';
import { setOutsideQuiet, startOutside, stopOutside } from '../ui/outsideSfx';
import { setRoomToneQuiet, startRoomTone, stopRoomTone } from '../ui/roomTone';
import { listenerAt, setListener } from '../ui/sfx';
import { keyboardFor } from '../ui/keyboards';
import { TYPING_CHANNELS, TYPING_RANGE, placeTypingChannel, typingGeneration, typingSound } from '../ui/typingSfx';
import { followVoices } from '../ui/voices';
import { useRide } from './elevatorRide';
import { kindOf } from './floors';
import { isCelebrating } from './gongState';
import { EYE_HEIGHT, SEATS } from './layout';
import { isHidden, isSeated } from './people';
import { playerAt, rigOwnsCamera } from './rig';
import { TAP_PHASE, assignSlots, hashString, inBurst, keyboardSpot, nearestK, nextKeyDown, nextMouseClick, nextScrollTick, poseFor, strokeAt, strokeVariation, tapSpeed, typingSeed, type PoseName, type Vec3 } from './typing';
import { useView } from './view';

/** The ears: where you stand, facing where you look. Reads the camera's world matrix directly: no allocations per frame. */
function Listener() {
  useFrame(({ camera }) => {
    followVoices();
    if (rigOwnsCamera()) return setListener(playerAt.x, EYE_HEIGHT, playerAt.z, -Math.sin(playerAt.yaw), 0, -Math.cos(playerAt.yaw), 0, 1, 0);
    // Column 3 is the position, column 1 the up axis, and the camera looks down its -Z axis (column 2).
    const e = camera.matrixWorld.elements;
    if (useView.getState().person === 'third') return setListener(playerAt.x, EYE_HEIGHT, playerAt.z, -e[8], -e[9], -e[10], e[4], e[5], e[6]);
    setListener(e[12], e[13], e[14], -e[8], -e[9], -e[10], e[4], e[5], e[6]);
  });
  return null;
}

const LOOKAHEAD = 0.12; // seconds of keystrokes scheduled ahead on the audio clock
const MAX_PEOPLE = 64;

interface Typist {
  seed: number;
  keyboard: number;
  pose: PoseName;
  spot: Vec3;
  until: number; // rhythm time (seconds) scheduled up to
}

/** The working people on this floor (or the CEO on theirs) type, click and scroll out loud. */
function TypingSounds({ floor }: { floor: number }) {
  const st = useMemo(
    () => ({
      people: new Map<string, Typist>(),
      ids: new Array<string>(MAX_PEOPLE).fill(''),
      dist: new Float64Array(MAX_PEOPLE),
      pick: new Int32Array(TYPING_CHANNELS),
      chosen: new Array<string>(TYPING_CHANNELS).fill(''),
      slots: new Array<string | null>(TYPING_CHANNELS).fill(null),
      placed: new Array<string>(TYPING_CHANNELS).fill(''), // who (and where) each channel was last moved to
      placedMouse: new Array<boolean>(TYPING_CHANNELS).fill(false),
      generation: 0, // typingGeneration() when the channels were placed
    }),
    [],
  );

  useFrame(() => {
    const s = useStore.getState();
    const now = performance.now();
    const wall = Date.now(); // the logs carry the server's clock
    const kind = kindOf(floor);
    const floorId = kind === 'office' ? (s.floors.find((f) => f.floor === floor)?.id ?? null) : null;
    let n = 0;
    // Silent behind a panel and while the elevator carries you; the next floor starts fresh.
    if (!useView.getState().overlay && useRide.getState().phase !== 'dark' && (floorId || kind === 'ceo')) {
      const ear = listenerAt();
      for (const id in s.workers) {
        const w = s.workers[id];
        if (kind === 'ceo' ? w.role !== 'ceo' : w.role !== 'worker' || w.floorId !== floorId) continue;
        // Out of their chair (or the whole floor cheering a merge): hands off the keyboard.
        if ((w.status !== 'working' && w.status !== 'preparing') || !isSeated(id) || isHidden(id) || (floorId && isCelebrating(floorId, now))) continue;
        let p = st.people.get(id);
        if (!p) {
          p = { seed: typingSeed(id), keyboard: keyboardFor(hashString(id)), pose: 'relaxed', spot: { x: 0, y: 0, z: 0 }, until: 0 };
          st.people.set(id, p);
        }
        p.pose = poseFor(w.status, w.activity?.kind ?? null, wall - (s.logs[id]?.at(-1)?.t ?? 0), false);
        if (p.pose === 'thinking') continue;
        keyboardSpot(w.role, w.desk % SEATS, p.pose === 'browsing', p.spot);
        const d = Math.hypot(p.spot.x - ear.x, p.spot.y - ear.y, p.spot.z - ear.z);
        if (d > TYPING_RANGE || n >= MAX_PEOPLE) continue;
        st.ids[n] = id;
        st.dist[n] = d;
        n++;
      }
    }
    const k = nearestK(st.dist, n, TYPING_CHANNELS, st.pick);
    for (let i = 0; i < k; i++) st.chosen[i] = st.ids[st.pick[i]];
    assignSlots(st.slots, st.chosen, k);
    // New channels (audio just unlocked, or a new AudioContext) start at the origin: place them all again.
    const generation = typingGeneration();
    if (st.generation !== generation) {
      st.generation = generation;
      st.placed.fill('');
    }

    for (let ch = 0; ch < TYPING_CHANNELS; ch++) {
      const id = st.slots[ch];
      const p = id === null ? undefined : st.people.get(id);
      const w = id === null ? undefined : s.workers[id];
      if (!p || !w || id === null) continue;
      const mouse = p.pose === 'browsing';
      if ((st.placed[ch] !== id || st.placedMouse[ch] !== mouse) && placeTypingChannel(ch, p.spot)) {
        st.placed[ch] = id;
        st.placedMouse[ch] = mouse;
      }
      const tNow = now / 1000 + p.seed;
      const horizon = tNow + LOOKAHEAD;
      // After a gap (paused, out of earshot, another floor) skip what was missed instead of catching up.
      const from = p.until < tNow - 0.05 || p.until > horizon ? tNow : p.until;
      if (mouse) {
        for (let t = nextMouseClick(from); t <= horizon; t = nextMouseClick(t)) {
          if (inBurst(t)) typingSound(ch, 'click', p.keyboard, strokeVariation(t, 5.3, 1), t - tNow, p.spot);
        }
        for (let t = nextScrollTick(from, horizon); t <= horizon; t = nextScrollTick(t, horizon)) {
          typingSound(ch, 'scroll', p.keyboard, strokeVariation(t, 80, 1), t - tNow, p.spot);
        }
      } else {
        const speed = tapSpeed(w.status);
        for (let h = 0; h < 2; h++) {
          const hand = h === 0 ? 0 : 1;
          const phase = hand === 0 ? TAP_PHASE.l : TAP_PHASE.r;
          for (let t = nextKeyDown(from, speed, phase); t <= horizon; t = nextKeyDown(t, speed, phase)) {
            if (inBurst(t)) typingSound(ch, strokeAt(t, speed, hand), p.keyboard, strokeVariation(t, speed, hand), t - tNow, p.spot);
          }
        }
      }
      p.until = horizon;
    }
  });
  return null;
}

/** Every sound that isn't made by a thing in the room, for the floor on screen (`floor`, as Game.tsx shows it). */
export function Sounds({ floor }: { floor: number }) {
  const kind = kindOf(floor);
  const panel = useView((s) => s.overlay !== null);
  const riding = useRide((s) => s.phase === 'dark');
  useEffect(() => {
    setOutsideQuiet(panel || riding);
    setRoomToneQuiet(panel || riding);
  }, [panel, riding]);
  useEffect(() => {
    startOutside(kind);
    startRoomTone(kind);
    return () => {
      stopOutside();
      stopRoomTone();
    };
  }, [kind]);
  return (
    <>
      <Listener />
      <TypingSounds floor={floor} />
    </>
  );
}
