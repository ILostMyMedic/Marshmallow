// When the workers around the office make a sound, kept free of WebAudio so it can be tested: a step each half walk
// cycle (only from the few walkers nearest you, so a busy floor stays calm), and the chair as they get up or sit down.
// peopleSounds.ts plays them.
// Adapted from cubefarm client/src/ui/peopleSoundRules.ts (MIT): the gestures' sounds (stickies, sighs, yawns) and the
// chats' murmur (the babble voices) are cut.

import type { Stage } from '../world/body';
import { createStepTracker, trackSteps, type StepTracker } from './footstepRules';

/** Only this many walkers, the nearest, are heard stepping at once. */
export const MAX_WALKERS = 3;
/** Steps farther away than this aren't played at all (metres). */
export const HEAR_RANGE = 12;
/** Faster than this is a walk, not a shuffle on the spot (m/s). */
export const WALKING = 0.15;
/** At or above this they're hurrying: brisker steps (m/s). */
export const HURRYING = 1.8;

/** What one person's frame asks to play. */
export type PersonEvent = 'step' | 'scuff' | 'rise' | 'sit' | 'seated';

/** One person as the sounds see them, kept between frames. */
export interface Hearing {
  /** Distance from the listener (metres). */
  d: number;
  walking: boolean;
  stage: Stage;
  steps: StepTracker;
  /** What this frame asks to play (refilled every frame, so nothing is allocated). */
  out: PersonEvent[];
}

export const newHearing = (): Hearing => ({ d: Infinity, walking: false, stage: 'seated', steps: createStepTracker(), out: [] });

/** This frame's body, as body.ts left it, and how far they are from the listener. */
export interface Frame {
  stage: Stage;
  speed: number;
  phase: number;
  d: number;
}

/** How many other walkers are nearer the listener than `h`. */
export function nearerWalkers(people: Iterable<Hearing>, h: Hearing) {
  let n = 0;
  for (const o of people) if (o !== h && o.walking && o.d < h.d) n++;
  return n;
}

/** Advance one person by a frame, with everyone on the floor in `people`. Returns what to play in `h.out`. */
export function hearPerson(h: Hearing, f: Frame, people: Iterable<Hearing>): PersonEvent[] {
  const out = h.out;
  out.length = 0;
  h.d = f.d;
  h.walking = f.stage === 'up' && f.speed > WALKING;

  // the chair: rolled back as they get up, rolled in and settled into as they sit
  if (h.stage === 'seated' && f.stage !== 'seated') out.push('rise');
  else if (h.stage !== 'sitting' && h.stage !== 'seated' && f.stage === 'sitting') out.push('sit');
  else if (h.stage === 'sitting' && f.stage === 'seated') out.push('seated');
  h.stage = f.stage;

  const step = trackSteps(h.steps, f.phase, h.walking);
  if (step && h.d <= HEAR_RANGE && nearerWalkers(people, h) < MAX_WALKERS) out.push(step);
  return out;
}
