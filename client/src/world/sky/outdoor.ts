// The outside's share of the time of day, as shader uniforms every outdoor material holds (haze.ts, City.tsx's
// windows): how far to dim what the office's lights light out there (indoor.ts outdoorTint), how many of the city's
// windows are lit, and how much snow lies on the city (the season's, seasons/SnowCover.tsx). DayLights.tsx writes the
// first two when the clock moves; nothing recompiles and nothing re-renders.
import * as THREE from 'three';

export const outdoor = {
  /** Multiplies the outside's lit colour: white by day, a dim blue at night. */
  uOutdoor: { value: new THREE.Color(1, 1, 1) },
  /** How many of the city's windows are lit, 0 by day to 1 at night. */
  uLights: { value: 0 },
  /** How much snow lies on what faces up out there (roofs, the ground, the trees), 0-1. */
  uSnow: { value: 0 },
};
