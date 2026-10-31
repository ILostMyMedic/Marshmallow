// Adapted from cubefarm client/src/world/sky/DayLights.tsx (MIT): the weather, the lightning and the evening's dimming
// are cut; the roof's softer lamps and the outside's uniforms (outdoor.ts) are new.

// The lights, following the time of day (indoor.ts): one shadow-casting key light that is the sun by day (moving
// across the floor, low, long and warm at golden hour) and a faint cool moon at night, a hemisphere and an ambient fill
// that turn warm when the lamps come on, and the renderer's exposure. It also turns the lamps up (lamps.tsx), moves
// the sun patches and dims the outside to the night. Moved through refs in one useFrame with no allocations or
// re-renders, and skipped while the clock stands still (?daytime, 'Always day').
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { dayTime } from '../dayTime';
import { indoorLight, newIndoorLight, newShadowBox, outdoorTint, ROOF_LAMPS, shadowBox } from './indoor';
import { setLamps } from './lamps';
import { outdoor } from './outdoor';
import { skyAt, type SkyPalette } from './palette';
import { setSunPatches } from './SunPatches';

/** How far from the floor's middle the key light sits (beyond every corner of what it lights). */
const DISTANCE = 40;

/** The floor's lights. `roof`: out on the roof terrace, where the lamps warm the night less. */
export function DayLights({ roof = false }: { roof?: boolean }) {
  const gl = useThree((s) => s.gl);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  const state = useMemo(() => ({ light: newIndoorLight(), box: newShadowBox(), palette: {} as SkyPalette, tint: [1, 1, 1] as [number, number, number], t: -1, roof: false }), []);

  useFrame(() => {
    const h = hemi.current;
    const a = ambient.current;
    const k = key.current;
    if (!h || !a || !k || (dayTime.t === state.t && roof === state.roof)) return;
    state.t = dayTime.t;
    state.roof = roof;
    const L = indoorLight(state.t, state.light, roof ? ROOF_LAMPS : 1);

    const [x, y, z] = L.dir;
    k.position.set(x * DISTANCE, y * DISTANCE, z * DISTANCE);
    k.color.setHex(L.keyColor);
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
    h.intensity = L.hemiIntensity;
    a.color.setHex(L.ambientColor);
    a.intensity = L.ambient;
    gl.toneMappingExposure = L.exposure;
    setLamps(L.lamps);
    setSunPatches(L.dir, L.keyColor, L.keyIntensity);

    const p = skyAt(state.t, state.palette);
    const [r, g, bl] = outdoorTint(p, L, state.tint);
    outdoor.uOutdoor.value.setRGB(r, g, bl);
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
