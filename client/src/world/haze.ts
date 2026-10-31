// The haze out over the city: the far buildings, the bay and its bridge, the billboards and the world events fade into
// the scene fog's colour with distance, on a much longer curve than the fog's own (Game.tsx tunes that for the office,
// and it would swallow everything past 320 m). Patched into three.js's own materials in place of their fog, so it costs
// nothing extra and follows the fog's colour; with no fog in the scene there's no haze either.
import * as THREE from 'three';

export interface Haze {
  /** Metres from the eye where it starts, and where it's at its fullest. */
  near: number;
  far: number;
  /** How much of the horizon's colour at its fullest, 0-1. */
  strength: number;
}

/** The city's: the outskirts and the bay are nearly lost in it; the skyline a couple of hundred metres off is clear. */
export const CITY_HAZE: Haze = { near: 100, far: 900, strength: 0.92 };
/** The bridge's and the hills': lighter, so the red towers still read as red from 650 m away. */
export const BRIDGE_HAZE: Haze = { near: 100, far: 900, strength: 0.55 };
/** The world events': lighter still, so a plane or a blimp stands out against the buildings behind it. */
export const EVENT_HAZE: Haze = { near: 100, far: 900, strength: 0.4 };

/** How hazy something `d` metres away is, 0-1: the shader's curve, eased so the near city stays crisp. */
export function hazeAt(h: Haze, d: number): number {
  const k = Math.min(1, Math.max(0, (d - h.near) / (h.far - h.near)));
  return k * (2 - k) * h.strength;
}

const FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  float hazeK = clamp((length(vHazePos) - uHaze.x) / (uHaze.y - uHaze.x), 0.0, 1.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, hazeK * (2.0 - hazeK) * uHaze.z);
#endif`;

/**
 * Gives `m` the haze `h` in place of the fog (keeping any shader patch it already has). The values are uniforms, so
 * every hazed material of a kind shares one program.
 */
export function hazed<T extends THREE.Material>(m: T, h: Haze): T {
  const before = m.onBeforeCompile;
  const key = m.customProgramCacheKey();
  const uHaze = { value: new THREE.Vector3(h.near, h.far, h.strength) };
  if ('fog' in m) m.fog = true;
  m.onBeforeCompile = (shader, renderer) => {
    before.call(m, shader, renderer);
    shader.uniforms.uHaze = uHaze;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHazePos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvHazePos = mvPosition.xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uHaze;\nvarying vec3 vHazePos;').replace('#include <fog_fragment>', FRAGMENT);
  };
  m.customProgramCacheKey = () => `${key}|haze`;
  return m;
}

// The office's three-step toon ramp (materials.ts), for the hazed toon colours below.
const ramp = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
ramp.minFilter = THREE.NearestFilter;
ramp.magFilter = THREE.NearestFilter;
ramp.generateMipmaps = false;
ramp.needsUpdate = true;

/** The office's toon ramp, for materials made elsewhere that should shade like the rest. */
export const TOON_RAMP = ramp;

const cache = new Map<string, THREE.MeshToonMaterial>();

/**
 * A cel-shaded colour under a haze, shared by everything that colour (never disposed, like materials.ts's).
 * `vertexColors`: white, tinted by each vertex's colour.
 */
export function hazedToon(color: string, h: Haze, opts: { vertexColors?: boolean; side?: THREE.Side; opacity?: number } = {}): THREE.MeshToonMaterial {
  const key = `${color}|${h.near}|${h.far}|${h.strength}|${opts.vertexColors ? 1 : 0}|${opts.side ?? ''}|${opts.opacity ?? ''}`;
  let m = cache.get(key);
  if (!m) {
    m = hazed(
      new THREE.MeshToonMaterial({
        color,
        gradientMap: ramp,
        vertexColors: opts.vertexColors ?? false,
        side: opts.side ?? THREE.FrontSide,
        transparent: opts.opacity !== undefined && opts.opacity < 1,
        opacity: opts.opacity ?? 1,
      }),
      h,
    );
    cache.set(key, m);
  }
  return m;
}
