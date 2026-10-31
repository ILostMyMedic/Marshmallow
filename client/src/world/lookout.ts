// The roof's lookouts: binoculars on stands at the railing. E on one (the roof registers the 'lookout' action) puts
// your eye to it: Player.tsx moves the camera to its eyepiece, zooms the lens to its field of view and lets you turn
// only as far as the stand allows, until E, G or Esc steps you back. Plain module state, read every frame.

/** Where a lookout's eyepiece is and how it may turn. Headings are yaws (0 facing -Z), angles in radians, fov in degrees. */
export interface Lens {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Where it points when you step up to it. */
  yaw: number;
  pitch: number;
  minYaw: number;
  maxYaw: number;
  minPitch: number;
  maxPitch: number;
  fov: number;
}

let looking: Lens | null = null;

/** The lookout you're looking through, or null. */
export const lookingThrough = (): Lens | null => looking;

/** Puts your eye to a lookout. */
export function lookThrough(lens: Lens) {
  looking = lens;
}

/** Back from the binoculars. */
export function stepBack() {
  looking = null;
}
