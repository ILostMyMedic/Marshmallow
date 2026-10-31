// Adapted from cubefarm client/src/world/events/kit.ts (MIT): the haze is haze.ts's, and the bloom marks are cut.

// What every world event's scene shares: toon materials that light like the office's but fade into the city's haze
// with distance (the scene's own fog would swallow anything past 320 m), glowing ones for lights and flames, and a few
// pure easing helpers. Materials are cached and shared across scenes (a handful in all); geometries belong to scenes.
import * as THREE from 'three';
import { EYE_HEIGHT } from '../layout';
import { EVENT_HAZE, hazedToon } from '../haze';
import type { EventRun } from './eventsState';

/** A cel-shaded colour for an event's body, lit by the office's light and hazed (lightly) with distance. */
export function toonOut(color: string, opts: { opacity?: number; side?: THREE.Side } = {}): THREE.Material {
  return hazedToon(color, EVENT_HAZE, opts);
}

const glows = new Map<string, THREE.MeshBasicMaterial>();

/** A flat, self-lit colour (lights, flames, beams): additive when `add`, never hazed or tone mapped. */
export function glowOut(color: string, opts: { opacity?: number; add?: boolean } = {}): THREE.MeshBasicMaterial {
  const key = `${color}|${opts.opacity ?? ''}|${opts.add ? 1 : 0}`;
  let m = glows.get(key);
  if (!m) {
    const see = opts.opacity !== undefined || !!opts.add;
    m = new THREE.MeshBasicMaterial({
      color,
      fog: false,
      toneMapped: false,
      transparent: see,
      opacity: opts.opacity ?? 1,
      depthWrite: !see,
      blending: opts.add ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    glows.set(key, m);
  }
  return m;
}

// ---------- easing ----------

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smooth = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** 0 → 1 over [a, b] of t, eased. */
export const span = (t: number, a: number, b: number) => smooth((t - a) / (b - a));
/** Fades in over the first `fade` seconds and out over the last, 0-1. */
export const inOut = (t: number, seconds: number, fade = 3) => Math.min(clamp01(t / fade), clamp01((seconds - t) / fade));

/** -1 for the west side, 1 for the east. */
export const sign = (side: 'west' | 'east') => (side === 'west' ? -1 : 1);

/** What every scene gets: its run (read `run.t` in the frame loop) and how far above the street your floor is. */
export interface SceneProps {
  run: EventRun;
  /** Street level is y 0 in a scene; your floor is this far above it (the scene's group is lowered by it). */
  elevation: number;
}

/** Your eye's height above the street. */
export const eyeAbove = (elevation: number) => elevation + EYE_HEIGHT;
