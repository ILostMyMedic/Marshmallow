// Adapted from cubefarm client/src/world/sky/time.ts (MIT): the sun and the sky's colours (the clock itself is
// dayTime.ts). The daytime fog is Marshmallow's cooler haze, so 'Always day' looks as the office did before the sky.

// What the time of day (dayTime.ts's phase t) does to the outside and the light: the sun's direction and a palette eased
// between key moments (night, dawn, noon, the afternoon, golden hour, blue hour). Pure, so every moment is tested
// without a browser. Colours are 0xrrggbb numbers (THREE.Color.setHex).
import { AFTERNOON_T, SUNRISE_T, SUNSET_T } from '../dayTime';

/** How far the sun's path leans south (+z), so its light comes in through the side windows. */
const SOUTH_TILT = 0.45; // radians

/**
 * Unit vector towards the sun: rises in the east (+x), sets in the west (−x), below the horizon (y < 0) at night.
 * Pass `out` to fill it instead of allocating (frame loops).
 */
export function sunDirection(t: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const a = 2 * Math.PI * (t - SUNRISE_T);
  // Already unit length: cos² + sin²(cos² + sin²) = 1.
  out[0] = Math.cos(a);
  out[1] = Math.sin(a) * Math.cos(SOUTH_TILT);
  out[2] = Math.sin(a) * Math.sin(SOUTH_TILT);
  return out;
}

/** Everything the outside and the light need at one moment. */
export interface SkyPalette {
  zenith: number;
  horizon: number;
  fog: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  ambient: number;
  exposure: number;
  /** 0..1 */
  starsOpacity: number;
  /** How many of the city's windows are lit, 0..1. */
  cityLights: number;
}

type Key = [t: number, palette: SkyPalette];

const NIGHT: SkyPalette = {
  zenith: 0x0d1638,
  horizon: 0x26346b,
  fog: 0x1d2850,
  sunColor: 0x8fa6ff, // moonlight
  sunIntensity: 0.25,
  hemiSky: 0x4a5a9a,
  hemiGround: 0x2a2440,
  ambient: 0.22,
  exposure: 0.9,
  starsOpacity: 1,
  cityLights: 1,
};

/** The afternoon is the office as it was before the sky had a clock (Game.tsx's lights, background and fog). */
const AFTERNOON: SkyPalette = {
  zenith: 0x8ccaf5,
  horizon: 0xbfe3ff,
  fog: 0xe4eef4,
  sunColor: 0xffffff,
  sunIntensity: 1.55,
  hemiSky: 0xfffaf0,
  hemiGround: 0xa48a6a,
  ambient: 0.18,
  exposure: 1,
  starsOpacity: 0,
  cityLights: 0,
};

const KEYS: Key[] = [
  [0, NIGHT],
  [0.2, { ...NIGHT, horizon: 0x2c3a74 }],
  // dawn blue hour, then a pink-peach sunrise
  [0.235, { zenith: 0x24336e, horizon: 0x6a72b0, fog: 0x4e5590, sunColor: 0xff9a7a, sunIntensity: 0.35, hemiSky: 0x6f78b8, hemiGround: 0x3a3048, ambient: 0.2, exposure: 0.92, starsOpacity: 0.5, cityLights: 0.7 }],
  [0.27, { zenith: 0x6f8fd0, horizon: 0xffb4a0, fog: 0xf0c4b4, sunColor: 0xffb48a, sunIntensity: 0.8, hemiSky: 0xffe0d0, hemiGround: 0x7a6560, ambient: 0.18, exposure: 0.96, starsOpacity: 0, cityLights: 0.15 }],
  [0.33, { zenith: 0x86c0f0, horizon: 0xcfe6ff, fog: 0xeceae8, sunColor: 0xfff1e0, sunIntensity: 1.35, hemiSky: 0xfff6ee, hemiGround: 0x9c8670, ambient: 0.18, exposure: 1, starsOpacity: 0, cityLights: 0 }],
  [0.5, { zenith: 0x7cc2f7, horizon: 0xc4e6ff, fog: 0xe8eef0, sunColor: 0xffffff, sunIntensity: 1.65, hemiSky: 0xfffcf4, hemiGround: 0xa48a6a, ambient: 0.18, exposure: 1, starsOpacity: 0, cityLights: 0 }],
  [AFTERNOON_T, AFTERNOON],
  // golden hour, warm orange and pink, peaking at sunset
  [0.71, { zenith: 0x7fa8e0, horizon: 0xffc888, fog: 0xf6d6b0, sunColor: 0xffc070, sunIntensity: 1.35, hemiSky: 0xffe6c0, hemiGround: 0x9a7458, ambient: 0.18, exposure: 1.02, starsOpacity: 0, cityLights: 0 }],
  [SUNSET_T, { zenith: 0x5f6fb8, horizon: 0xff9a6a, fog: 0xf2a88a, sunColor: 0xff8a50, sunIntensity: 0.9, hemiSky: 0xffb8a0, hemiGround: 0x6e5060, ambient: 0.19, exposure: 1, starsOpacity: 0, cityLights: 0.25 }],
  // blue hour
  [0.775, { zenith: 0x2a3a80, horizon: 0x7a6ab8, fog: 0x5a5a96, sunColor: 0xb0a0ff, sunIntensity: 0.35, hemiSky: 0x7a7ac0, hemiGround: 0x3a3050, ambient: 0.21, exposure: 0.94, starsOpacity: 0.35, cityLights: 0.8 }],
  [0.81, NIGHT],
  [1, NIGHT],
];

const frac = (x: number) => x - Math.floor(x);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smoothstep = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** Mixes two 0xrrggbb colours channel by channel. */
export function lerpColor(a: number, b: number, k: number): number {
  const ch = (shift: number) => Math.round(lerp((a >> shift) & 0xff, (b >> shift) & 0xff, k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

const COLORS = ['zenith', 'horizon', 'fog', 'sunColor', 'hemiSky', 'hemiGround'] as const;
const NUMBERS = ['sunIntensity', 'ambient', 'exposure', 'starsOpacity', 'cityLights'] as const;

/**
 * The palette at phase t, eased between the key moments (noon, golden hour, blue hour, night, dawn).
 * Pass `out` to fill it instead of allocating (frame loops).
 */
export function skyAt(t: number, out = {} as SkyPalette): SkyPalette {
  const x = frac(t);
  let i = 1;
  while (i < KEYS.length - 1 && KEYS[i][0] <= x) i++;
  const [t0, a] = KEYS[i - 1];
  const [t1, b] = KEYS[i];
  const k = smoothstep(t0, t1, x);
  for (const c of COLORS) out[c] = lerpColor(a[c], b[c], k);
  for (const n of NUMBERS) out[n] = lerp(a[n], b[n], k);
  return out;
}
