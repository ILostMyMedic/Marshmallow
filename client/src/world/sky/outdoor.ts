// The outside's share of the time of day, as shader uniforms every outdoor material holds (haze.ts, City.tsx's
// windows): how far to dim what the office's lights light out there (indoor.ts outdoorTint), and how many of the city's
// windows are lit. DayLights.tsx writes them when the clock moves; nothing recompiles and nothing re-renders.
import * as THREE from 'three';

export const outdoor = {
  /** Multiplies the outside's lit colour: white by day, a dim blue at night. */
  uOutdoor: { value: new THREE.Color(1, 1, 1) },
  /** How many of the city's windows are lit, 0 by day to 1 at night. */
  uLights: { value: 0 },
};
