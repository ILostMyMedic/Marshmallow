// What the season and the sky's moments do to the light, on top of the time of day (DayLights.tsx folds it in): a
// little brighter in summer, warmer in autumn, cooler in winter with the snow throwing light back up from below, and a
// faint green while the northern lights are out (events/scenes/Aurora.tsx). A mutable ref with a version, so DayLights
// only recomputes when something here changes.
import * as THREE from 'three';

export const skyMood = {
  /** Multiplies the day's exposure (eased out at night). */
  exposure: 1,
  /** -1 cool to 1 warm: tints the sun. */
  warmth: 0,
  /** How much snow lies outside, 0-1: the light bounced up off it. */
  snow: 0,
  /** How much of `glowColor` the sky's light takes (the aurora's), 0-1. */
  glow: 0,
  glowColor: new THREE.Color('#5dffb0'),
  /** Bumped by every change. */
  version: 0,
};

type Mood = Pick<typeof skyMood, 'exposure' | 'warmth' | 'snow' | 'glow'>;

/** Changes part of the mood; DayLights picks it up next frame. Values within a hair of what's there change nothing. */
export function setSkyMood(patch: Partial<Mood>) {
  let changed = false;
  for (const [k, v] of Object.entries(patch) as [keyof Mood, number][]) {
    if (Math.abs(skyMood[k] - v) < 0.004) continue;
    skyMood[k] = v;
    changed = true;
  }
  if (changed) skyMood.version++;
}
