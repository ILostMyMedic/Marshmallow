// Adapted from cubefarm client/src/world/sky/indoor.ts (MIT): the weather's gloom is cut; the roof's softer lamps, the
// city's dimming and a shadow box that takes in the balconies and the roof's hut are new.

// What the time of day does to the light (DayLights.tsx applies it): the sun through the side windows, long and warm at
// golden hour; at night a faint cool moon and the ceiling lamps' warm fill, so the office feels cozy and never dark.
// The city shares those lights, so outdoorTint says how far to dim it back to the night outside. Pure, and
// allocation-free when given an `out`, so the frame loop can call it every frame.
import { BALCONY_OUT, ELEVATOR, HALF_D, WALL_H } from '../layout';
import { lerpColor, skyAt, sunDirection, type SkyPalette } from './palette';

export interface IndoorLight {
  /** Unit vector towards the light that casts the shadows: the sun, or the moon (opposite it) at night. */
  dir: [number, number, number];
  keyColor: number;
  keyIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  ambientColor: number;
  ambient: number;
  exposure: number;
  /** How far the lamps are on: 0 by day, 1 at night (their warm fill, the halos, the desk lamps, the string lights). */
  lamps: number;
}

/** The lowest the shadow-casting light goes (sine of its elevation): golden-hour shadows ~5× as long as things are tall. */
export const MIN_ELEVATION = 0.2;
/** The key light fades out as the sun or moon reaches the horizon, so swapping one for the other never pops. */
const HORIZON_FADE = 0.08;
const HEMI_DAY = 0.95;
const HEMI_NIGHT = 1.05;
/** The ceiling lamps' warm light, mixed into the fill at night (the undersides keep a little of the night's blue). */
const LAMP_SKY = 0xffe2b0;
const LAMP_GROUND = 0x8c6a50;
const LAMP_AMBIENT = 0xffd49c;
const LAMP_MIX = 0.88;
const LAMP_GROUND_MIX = 0.5;
const AMBIENT_LAMPS = 0.14;
/** The sun's height (y of its direction) at which the lamps are fully on, and fully off. */
const LAMPS_FULL = -0.12;
const LAMPS_OFF = 0.12;
/** Out on the roof only the string lights and the fire warm the night: this much of the lamps' fill. */
export const ROOF_LAMPS = 0.45;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

export function newIndoorLight(): IndoorLight {
  return { dir: [0, 1, 0], keyColor: 0, keyIntensity: 0, hemiSky: 0, hemiGround: 0, hemiIntensity: 0, ambientColor: 0, ambient: 0, exposure: 1, lamps: 0 };
}

const palette = {} as SkyPalette;
const sun: [number, number, number] = [0, 0, 0];

/** The light at phase t. `fill`: how much of the lamps' warm fill reaches it (1 indoors, ROOF_LAMPS out on the roof). */
export function indoorLight(t: number, out = newIndoorLight(), fill = 1): IndoorLight {
  const p = skyAt(t, palette);
  sunDirection(t, sun);
  // on as the sun sets (before the sky is dark), off once it's up
  const lamps = 1 - smoothstep(LAMPS_FULL, LAMPS_OFF, sun[1]);
  const warm = lamps * fill;

  // the sun by day, the moon opposite it by night, held at least MIN_ELEVATION up
  const s = sun[1] >= 0 ? 1 : -1;
  const y = Math.max(MIN_ELEVATION, s * sun[1]);
  const flat = Math.hypot(sun[0], sun[2]);
  const k = (s * Math.sqrt(1 - y * y)) / flat;
  out.dir[0] = sun[0] * k;
  out.dir[1] = y;
  out.dir[2] = sun[2] * k;
  out.keyColor = p.sunColor;
  out.keyIntensity = p.sunIntensity * smoothstep(0, HORIZON_FADE, Math.abs(sun[1]));

  out.hemiSky = lerpColor(p.hemiSky, LAMP_SKY, warm * LAMP_MIX);
  out.hemiGround = lerpColor(p.hemiGround, LAMP_GROUND, warm * LAMP_GROUND_MIX);
  out.hemiIntensity = HEMI_DAY + (HEMI_NIGHT - HEMI_DAY) * warm;
  out.ambientColor = lerpColor(0xffffff, LAMP_AMBIENT, warm);
  out.ambient = p.ambient + AMBIENT_LAMPS * warm;
  out.exposure = p.exposure;
  out.lamps = lamps;
  return out;
}

// ---------- the city's dimming ----------

/** sRGB channel (0-255) to linear light, as three.js reads a hex colour. */
const linear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const channel = (c: number, i: number) => linear((c >> (16 - 8 * i)) & 0xff);

/**
 * How much to dim the outside (the city, the bridge, the fliers), per channel, so lights warmed by the lamps `l` light it
 * as the sky `p` alone would: 1 by day, a dim blue at night. The fill only (hemisphere and ambient); the key is the same.
 */
export function outdoorTint(p: SkyPalette, l: IndoorLight, out: [number, number, number] = [1, 1, 1]): [number, number, number] {
  for (let i = 0; i < 3; i++) {
    const sky = ((channel(p.hemiSky, i) + channel(p.hemiGround, i)) / 2) * HEMI_DAY + p.ambient;
    const lit = ((channel(l.hemiSky, i) + channel(l.hemiGround, i)) / 2) * l.hemiIntensity + channel(l.ambientColor, i) * l.ambient;
    out[i] = lit > 0 ? clamp01(sky / lit) : 1;
  }
  return out;
}

// ---------- shadow camera ----------

export interface ShadowBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
}

export const newShadowBox = (): ShadowBox => ({ left: 0, right: 0, top: 0, bottom: 0, near: 0, far: 0 });

/** What the shadows must cover, with a little room round it: the floor and its balconies, and the roof's hut. */
const MARGIN = 0.5;
export const SHADOW_BOUNDS = { x: BALCONY_OUT + MARGIN, minZ: -HALF_D - MARGIN, maxZ: HALF_D + ELEVATOR.depth + 0.4 + MARGIN, y: WALL_H + MARGIN };

/**
 * The tightest orthographic shadow camera round SHADOW_BOUNDS for a light at `dir * distance` looking at the origin
 * (three's lookAt with +y up), so the shadow map's texels are spent on the floor whatever the sun's angle.
 */
export function shadowBox(dir: readonly [number, number, number], distance: number, out = newShadowBox()): ShadowBox {
  const [zx, zy, zz] = dir;
  // camera x = up × z, camera y = z × x
  const xl = Math.hypot(zz, zx) || 1;
  const xx = zz / xl;
  const xz = -zx / xl;
  const yx = zy * xz;
  const yy = zz * xx - zx * xz;
  const yz = -zy * xx;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const b = SHADOW_BOUNDS;
  for (let i = 0; i < 8; i++) {
    const cx = i & 1 ? b.x : -b.x;
    const cy = i & 2 ? b.y : 0;
    const cz = i & 4 ? b.maxZ : b.minZ;
    const px = cx * xx + cz * xz;
    const py = cx * yx + cy * yy + cz * yz;
    const pz = cx * zx + cy * zy + cz * zz;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
    minZ = Math.min(minZ, pz);
    maxZ = Math.max(maxZ, pz);
  }
  out.left = minX;
  out.right = maxX;
  out.bottom = minY;
  out.top = maxY;
  out.near = Math.max(0.1, distance - maxZ);
  out.far = distance - minZ;
  return out;
}
