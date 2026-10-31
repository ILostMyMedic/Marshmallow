// The sounds of the workers around you (peopleSoundRules.ts decides when): their footsteps (footsteps.ts's voices at
// their feet), the chair rolling and creaking as they get up and sit down, and a soft "blah blah" now and then while
// they stand chatting (not over a line they're saying out loud, voices.ts). All of it is positional and quiet.
// Character.tsx calls hearBody() every frame, so nothing plays (or piles up) while the 3D view is paused, and nothing
// plays while a panel is open or the elevator carries you.
// Adapted from cubefarm client/src/ui/peopleSounds.ts (MIT): the stickies, the sigh and the yawn are cut.

import type { BodyState } from '../world/body';
import { useRide } from '../world/elevatorRide';
import { kindOf } from '../world/floors';
import { useView } from '../world/view';
import { surfaceAt } from './footstepRules';
import { footstepAt, scuffAt } from './footsteps';
import { chatters, HURRYING, hearPerson, newHearing, type Crowd, type Frame, type Hearing } from './peopleSoundRules';
import { listenerAt, noise, recordSfx, tone, type Vec3 } from './sfx';
import { voicing } from './voices';

// ---------- the voices ----------

const r = () => Math.random();

/** The chair's casters: a short low rumble with a couple of ticks. */
export function chairRoll(pos: Vec3) {
  const into = recordSfx('chair:roll', { group: 'people', pos, peak: 0.022 });
  const o = { group: 'people', pos, into } as const;
  noise({ ...o, dur: 0.38, peak: 0.022, freq: 320 + r() * 60, to: 170, q: 0.7, attack: 0.08 });
  [0.06, 0.19].forEach((at) => noise({ ...o, at: at + r() * 0.04, dur: 0.025, peak: 0.006, filter: 'bandpass', freq: 2200 + r() * 600, q: 3, attack: 0.002 }));
}

/** The seat's creak as the weight comes on or off: a thin rising squeak over a little body. */
export function chairCreak(pos: Vec3) {
  const into = recordSfx('chair:creak', { group: 'people', pos, peak: 0.012 });
  const o = { group: 'people', pos, into } as const;
  const f = 200 + r() * 70;
  tone({ ...o, freq: f, to: f * 1.35, type: 'sawtooth', dur: 0.2, peak: 0.006, attack: 0.04 });
  noise({ ...o, dur: 0.18, peak: 0.012, filter: 'bandpass', freq: 1300 + r() * 300, q: 6, attack: 0.05 });
}

/** Two to four soft cartoon "blah" syllables (no words): one murmur of a chat, heard across that part of the floor. */
export function murmur(pos: Vec3) {
  const into = recordSfx('chat:blah', { group: 'people', pos, peak: 0.024, reach: 'far' });
  const o = { group: 'people', pos, into, reach: 'far' } as const;
  const base = 170 + r() * 110; // everyone has their own voice, more or less
  const n = 2 + Math.floor(r() * 3);
  for (let i = 0, at = 0; i < n; i++, at += 0.16 + r() * 0.08) {
    const f = base * (0.9 + r() * 0.25);
    const dur = 0.1 + r() * 0.07;
    tone({ ...o, at, freq: f, to: f * (i === n - 1 ? 0.82 : 1.04), type: 'triangle', dur, peak: 0.022, attack: 0.02 });
    tone({ ...o, at, freq: f * 3.1, to: f * 2.6, dur: dur * 0.8, peak: 0.006, attack: 0.02 }); // the open "ah"
  }
}

// ---------- everyone on the floor ----------

const people = new Map<string, Hearing>();
const crowd: Crowd = { people: [], lastMurmur: -Infinity };

/** Character.tsx registers each person it draws; the returned function forgets them (a floor change). */
export function hearing(id: string) {
  const h = newHearing();
  people.set(id, h);
  crowd.people = [...people.values()];
  return () => {
    if (people.get(id) === h) people.delete(id);
    crowd.people = [...people.values()];
  };
}

/** How many on this floor are standing chatting now (roomTone.ts's murmur grows with it). */
export const chattingNow = () => chatters(crowd.people);

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const frame: Frame = { stage: 'seated', x: 0, z: 0, speed: 0, phase: 0, d: 0 };

/** Called by Character.tsx every frame with their body (after stepBody) and the floor's height. Plays what peopleSoundRules.ts asks for. */
export function hearBody(id: string, s: BodyState, dt: number, floorY = 0) {
  const h = people.get(id);
  if (!h) return;
  const ear = listenerAt();
  frame.stage = s.stage;
  frame.x = s.x;
  frame.z = s.z;
  frame.speed = s.speed;
  frame.phase = s.phase;
  frame.d = Math.hypot(ear.x - s.x, ear.y - floorY - 1, ear.z - s.z);
  const events = hearPerson(h, frame, crowd, dt, performance.now() / 1000, Math.random());
  if (!events.length) return;
  const view = useView.getState();
  if (view.overlay || useRide.getState().phase === 'dark') return; // you're busy elsewhere, not listening to the floor
  for (const e of events) {
    switch (e) {
      case 'step':
      case 'scuff': {
        const feet = at(s.x, floorY + 0.05, s.z);
        const surface = surfaceAt(view.floor === null ? 'office' : kindOf(view.floor), s.x, s.z);
        if (e === 'step') footstepAt(surface, feet, s.speed >= HURRYING, h.steps.foot);
        else scuffAt(surface, feet);
        break;
      }
      case 'rise':
        chairCreak(at(s.seatX, floorY + 0.45, s.seatZ));
        chairRoll(at(s.seatX, floorY + 0.2, s.seatZ));
        break;
      case 'sit':
        chairRoll(at(s.seatX, floorY + 0.2, s.seatZ));
        break;
      case 'seated':
        chairCreak(at(s.seatX, floorY + 0.45, s.seatZ));
        break;
      case 'murmur':
        if (!voicing(id)) murmur(at(s.x, floorY + 1.5, s.z));
        break;
    }
  }
}
