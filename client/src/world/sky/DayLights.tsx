// Adapted from cubefarm client/src/world/sky/DayLights.tsx (MIT): the weather, the lightning and the evening's dimming
// are cut; the roof's softer lamps and the outside's uniforms (outdoor.ts) are new.

// The lights, following the time of day (indoor.ts): one shadow-casting key light that is the sun by day (moving
// across the floor, low, long and warm at golden hour) and a faint cool moon at night, a hemisphere and an ambient fill
// that turn warm when the lamps come on, and the renderer's exposure. It also turns the lamps up (lamps.tsx), moves
// the sun patches and dims the outside to the night. The season and the sky's moments (skyMood.ts) lean on it: a
// brighter summer, a cooler winter lit up from the snow, a green glow under the northern lights. Moved through refs in
// one useFrame with no allocations or re-renders, and skipped while neither the clock nor the mood moves (?daytime,
// 'Always day').
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { dayTime, nightFactor } from '../dayTime';
import { indoorLight, newIndoorLight, newShadowBox, outdoorTint, ROOF_LAMPS, shadowBox } from './indoor';
import { setLamps } from './lamps';
import { outdoor } from './outdoor';
import { skyAt, type SkyPalette } from './palette';
import { skyMood } from './skyMood';
import { setSunPatches } from './SunPatches';

const WARM = new THREE.Color('#ffd6a0');
const COOL = new THREE.Color('#cfe0ff');
const SNOWLIGHT = new THREE.Color('#e8f0ff');

/** How far from the floor's middle the key light sits (beyond every corner of what it lights). */
const DISTANCE = 40;

/** The floor's lights. `roof`: out on the roof terrace, where the lamps warm the night less. */
export function DayLights({ roof = false }: { roof?: boolean }) {
  const gl = useThree((s) => s.gl);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  const state = useMemo(() => ({ light: newIndoorLight(), box: newShadowBox(), palette: {} as SkyPalette, tint: [1, 1, 1] as [number, number, number], t: -1, roof: false, mood: -1 }), []);

  useFrame(() => {
    const h = hemi.current;
    const a = ambient.current;
    const k = key.current;
    if (!h || !a || !k || (dayTime.t === state.t && roof === state.roof && skyMood.version === state.mood)) return;
    state.t = dayTime.t;
    state.roof = roof;
    state.mood = skyMood.version;
    const day = 1 - nightFactor(state.t);
    const L = indoorLight(state.t, state.light, roof ? ROOF_LAMPS : 1);

    const [x, y, z] = L.dir;
    k.position.set(x * DISTANCE, y * DISTANCE, z * DISTANCE);
    k.color.setHex(L.keyColor);
    if (skyMood.warmth) k.color.lerp(skyMood.warmth > 0 ? WARM : COOL, Math.abs(skyMood.warmth) * 0.3 * day);
    k.intensity = L.keyIntensity;
    const b = shadowBox(L.dir, DISTANCE, state.box);
    const cam = k.shadow.camera;
    cam.left = b.left;
    cam.right = b.right;
    cam.top = b.top;
    cam.bottom = b.bottom;
    cam.near = b.near;
    cam.far = b.far;
    cam.updateProjectionMatrix();

    h.color.setHex(L.hemiSky);
    h.groundColor.setHex(L.hemiGround);
    if (skyMood.snow) h.groundColor.lerp(SNOWLIGHT, skyMood.snow * 0.45);
    if (skyMood.glow) h.color.lerp(skyMood.glowColor, skyMood.glow);
    h.intensity = L.hemiIntensity;
    a.color.setHex(L.ambientColor);
    a.intensity = L.ambient;
    gl.toneMappingExposure = L.exposure * (1 + (skyMood.exposure - 1) * day);
    setLamps(L.lamps);
    setSunPatches(L.dir, L.keyColor, L.keyIntensity);

    const p = skyAt(state.t, state.palette);
    const [r, g, bl] = outdoorTint(p, L, state.tint);
    outdoor.uOutdoor.value.setRGB(r, g, bl);
    if (skyMood.glow) outdoor.uOutdoor.value.lerp(skyMood.glowColor, skyMood.glow * 0.35);
    outdoor.uLights.value = p.cityLights;
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={['#fffaf0', '#a48a6a', 0.95]} />
      <ambientLight ref={ambient} intensity={0.18} />
      <directionalLight ref={key} position={[9, 14, 7]} intensity={1.55} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0006} shadow-normalBias={0.03} />
    </>
  );
}
