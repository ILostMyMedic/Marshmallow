// The view through each lookout's binoculars (Lookouts.tsx draws them; roofLayout.ts places them): the Lens that E on
// one hands to lookout.ts (Player.tsx puts the camera at its eyepiece, zooms to its field of view and keeps your look
// inside its swing), and where each one was last aimed, so its head stays turned there and the next look starts there.
// Pure apart from that memory.
// Adapted from cubefarm client/src/world/roof/Telescope.tsx (MIT): the look's start, limits and remembered aim, without
// the perch, the zoom wheel or the night sky.

import { angleDelta } from '../body';
import type { Lens } from '../lookout';
import { facing, type Lookout } from './roofLayout';

/**
 * Through the binoculars: the eyepiece `eye` high and `back` behind the post, how far the head swings either way and
 * tips down or up (radians, up +), where it rests, and the field of view through the lenses (degrees, vertical, as
 * camera.fov: the player's own is 72).
 */
export const LENS = { eye: 1.47, back: 0.3, swing: 1.05, down: -0.75, up: 0.4, rest: -0.06, fov: 16 };

export interface Aim {
  yaw: number;
  pitch: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The lens of lookout `l` (its id is the lookout's), starting where it was last aimed (`aim`, any yaw: it's unwrapped
 * round the lookout's heading), or at its sight (roofLayout.ts), or straight out and a touch down. The yaw bounds don't wrap: the south one's run past π.
 */
export function lensFor(l: Lookout, aim?: Aim | null): Lens {
  const out = facing(l.heading);
  const minYaw = l.heading - LENS.swing;
  const maxYaw = l.heading + LENS.swing;
  const start = aim ?? l.sight;
  return {
    id: l.id,
    x: l.x - out.x * LENS.back,
    y: LENS.eye,
    z: l.z - out.z * LENS.back,
    yaw: start ? clamp(l.heading + angleDelta(l.heading, start.yaw), minYaw, maxYaw) : l.heading,
    pitch: clamp(start?.pitch ?? LENS.rest, LENS.down, LENS.up),
    minYaw,
    maxYaw,
    minPitch: LENS.down,
    maxPitch: LENS.up,
    fov: LENS.fov,
  };
}

const aims = new Map<string, Aim>();

/** Keeps where lookout `id` points (Lookouts.tsx, from the camera while you look through it). */
export function aimLookout(id: string, yaw: number, pitch: number) {
  const a = aims.get(id);
  if (a) {
    a.yaw = yaw;
    a.pitch = pitch;
  } else aims.set(id, { yaw, pitch });
}

/** Where lookout `id` was last aimed; null when nobody has looked through it yet. */
export const lookoutAim = (id: string): Aim | null => aims.get(id) ?? null;
