// The sounds of the workers around you (peopleSoundRules.ts decides when): their footsteps (footsteps.ts's voices at
// their feet) and the chair rolling and creaking as they get up and sit down. All of it is positional and quiet.
// Character.tsx calls hearBody() every frame, so nothing plays (or piles up) while the 3D view is paused, and nothing
// plays while a panel is open or the elevator carries you.
// Adapted from cubefarm client/src/ui/peopleSounds.ts (MIT): the stickies, the sigh, the yawn and the chats' murmur are cut.

import type { BodyState } from '../world/body';
import { useRide } from '../world/elevatorRide';
import { kindOf } from '../world/floors';
import { useView } from '../world/view';
import { surfaceAt } from './footstepRules';
import { footstepAt, scuffAt } from './footsteps';
import { HURRYING, hearPerson, newHearing, type Frame, type Hearing } from './peopleSoundRules';
import { listenerAt, noise, recordSfx, tone, type Vec3 } from './sfx';

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

// ---------- everyone on the floor ----------

const people = new Map<string, Hearing>();

/** Character.tsx registers each person it draws; the returned function forgets them (a floor change). */
export function hearing(id: string) {
  const h = newHearing();
  people.set(id, h);
  return () => {
    if (people.get(id) === h) people.delete(id);
  };
}

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const frame: Frame = { stage: 'seated', speed: 0, phase: 0, d: 0 };

/** Called by Character.tsx every frame with their body (after stepBody) and the floor's height. Plays what peopleSoundRules.ts asks for. */
export function hearBody(id: string, s: BodyState, floorY = 0) {
  const h = people.get(id);
  if (!h) return;
  const ear = listenerAt();
  frame.stage = s.stage;
  frame.speed = s.speed;
  frame.phase = s.phase;
  frame.d = Math.hypot(ear.x - s.x, ear.y - floorY - 1, ear.z - s.z);
  const events = hearPerson(h, frame, people.values());
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
    }
  }
}
