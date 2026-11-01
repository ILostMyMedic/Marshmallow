// Adapted from cubefarm client/src/world/weather/Precipitation.tsx (MIT): its snow (the flakes in a box that travels
// with you, wrapped and kept out of the building); the rain, the far curtain and the weather cut (a deeper box of flakes
// costs less to fill than a curtain across the whole view), the box round the building in the overview, and autumn's
// leaves and spring's petals new.

// What falls past the windows in the season (seasonLook's `fall`): snow in December and January (lighter in February),
// tumbling leaves in autumn, blossom petals in spring. Every flake, leaf or petal is placed and moved in the vertex
// shader from a fixed seed and the clock, so the frame loop only sets a few uniforms; they fill a box that travels a
// little ahead of you (round the building in the overview), wrapped round it so they stay put as it moves, faded at its
// edges and close to your eyes, and never inside the building's column (its rooms and its covered balconies) or the
// roof's hut. One draw call, lit by the sky, fewer when the adaptive resolution has stepped down.
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { FallKind } from '../../../../shared/seasons';
import { dayTime, nightFactor } from '../dayTime';
import { BALCONY_OUT, HALF_D, WALL_T } from '../layout';
import { MAX_DPR } from '../perf';
import { ROOF_HUT } from '../roof/roofLayout';
import { skyAt, type SkyPalette } from '../sky/palette';
import { useView } from '../view';
import { mulberry } from './kit';

/** Each kind's look: how many at most (walking, and round the building), size, fall speed, sway, spin, colours. */
const KINDS: Record<FallKind, { count: [number, number]; size: number; fall: number; sway: number; spin: number; wind: [number, number]; colors: string[]; opacity: number }> = {
  snow: { count: [2800, 4200], size: 0.13, fall: 1.1, sway: 0.45, spin: 0, wind: [0.25, 0.1], colors: ['#ffffff', '#f4f8ff', '#ffffff', '#eef4ff'], opacity: 0.92 },
  leaves: { count: [420, 700], size: 0.22, fall: 1.25, sway: 0.9, spin: 1, wind: [0.9, 0.35], colors: ['#e07a2f', '#c8442f', '#f2b632', '#9c5a2b'], opacity: 1 },
  petals: { count: [300, 800], size: 0.09, fall: 0.6, sway: 0.7, spin: 1, wind: [0.5, 0.2], colors: ['#f7b6d2', '#fcd5e5', '#ffffff', '#f4a7c8'], opacity: 0.95 },
};
const KIND_INDEX: Record<FallKind, number> = { snow: 0, leaves: 1, petals: 2 };

/** The box round you walking (metres) and how far ahead its middle is; the box round the building in the overview. */
const BOX_WALK = new THREE.Vector3(56, 30, 56);
const AHEAD = 18;
const BOX_OVERVIEW = new THREE.Vector3(84, 46, 84);
/** Seen from the overview's distance they're drawn this much bigger, so they still read. */
const OVERVIEW_SIZE = 2.2;
/** The building and its covered balconies: nothing falls in there. */
const HOLE = new THREE.Vector2(BALCONY_OUT - 0.1, HALF_D + WALL_T + 0.05);
/** The hut over the elevator on the roof. */
const HUT = new THREE.Vector4(ROOF_HUT.minX - 0.1, ROOF_HUT.maxX + 0.1, HALF_D - 0.1, ROOF_HUT.maxZ + 0.1);
/** The clock wraps after this many seconds, so the shader's float maths stays precise all day. */
const WRAP = 600;
const MOST = Math.max(...Object.values(KINDS).map((k) => k.count[1]));

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCam;
uniform vec3 uEye;
uniform vec3 uBox;
uniform vec2 uHole;
uniform float uRoof;
uniform vec4 uHut;
uniform float uHutTop;
uniform float uGround;
uniform float uTime;
uniform float uFall;
uniform float uSway;
uniform float uSpin;
uniform vec2 uWind;
uniform float uSize;
uniform vec3 uPal[4];
varying float vAlpha;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  float speed = uFall * (0.75 + 0.5 * aSeed.w);
  vec3 p = aSeed.xyz * uBox + vec3(uWind.x, -speed, uWind.y) * uTime;
  p = uCam + mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  float ph = aSeed.y * 40.0;
  p.x += sin(uTime * (0.6 + aSeed.w) + ph) * uSway;
  p.z += cos(uTime * (0.45 + aSeed.w * 0.6) + aSeed.x * 40.0) * uSway;
  vec3 d = abs(p - uCam) / (uBox * 0.5);
  vAlpha = (1.0 - smoothstep(0.65, 1.0, max(d.x, max(d.y, d.z)))) * smoothstep(2.0, 4.5, length(p - uEye));
  bool inside = abs(p.x) < uHole.x && abs(p.z) < uHole.y && p.y < uRoof;
  bool hut = p.x > uHut.x && p.x < uHut.y && p.z > uHut.z && p.z < uHut.w && p.y < uHutTop;
  if (inside || hut || p.y < uGround || vAlpha <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vUv = position.xy + 0.5;
  int k = int(floor(fract(aSeed.x * 13.7 + aSeed.z * 7.3) * 4.0));
  vTint = uPal[k];
  // leaves and petals tumble: turning in the view's plane and flipping over
  vec2 q = position.xy;
  float spin = (uTime * (0.8 + 1.6 * aSeed.w) + ph) * uSpin;
  q = mat2(cos(spin), sin(spin), -sin(spin), cos(spin)) * q;
  q.x *= mix(1.0, 0.25 + 0.75 * abs(cos(uTime * (1.1 + aSeed.z) + ph)), uSpin);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  mv.xy += q * uSize * (0.7 + 0.6 * aSeed.w);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uKind;
uniform vec3 uLight;
uniform float uOpacity;
varying float vAlpha;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  vec2 d = vUv - 0.5;
  float a;
  vec3 col = vTint;
  if (uKind < 0.5) {
    a = 1.0 - smoothstep(0.22, 0.5, length(d));
  } else if (uKind < 1.5) {
    // a leaf: pointed at both ends, with a darker midrib
    float w = 0.3 * (1.0 - pow(abs(d.y) * 2.0, 1.6));
    a = 1.0 - smoothstep(w - 0.05, w, abs(d.x));
    col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.03, abs(d.x)));
  } else {
    // a petal: a rounded teardrop
    a = 1.0 - smoothstep(0.3, 0.38, length(vec2(d.x * (1.25 + d.y), d.y)));
  }
  gl_FragColor = vec4(col * uLight, a * vAlpha * uOpacity);
  #include <colorspace_fragment>
}`;

const palette = {} as SkyPalette;

/**
 * What's falling, `amount` 0-1 of it. `elevation`: how far your floor is above the street; `roof`: how far the roof
 * deck is above your floor (0 up there).
 */
export function Falling({ kind, amount, elevation, roof, onRoof }: { kind: FallKind; amount: number; elevation: number; roof: number; onRoof: boolean }) {
  const gl = useThree((s) => s.gl);
  const k = KINDS[kind];
  const stuff = useMemo(() => {
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    const rnd = mulberry(47);
    const seeds = new Float32Array(MOST * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uEye: { value: new THREE.Vector3() },
        uBox: { value: BOX_WALK.clone() },
        uHole: { value: HOLE },
        uRoof: { value: 0 },
        uHut: { value: HUT },
        uHutTop: { value: -1e5 },
        uGround: { value: 0 },
        uTime: { value: 0 },
        uFall: { value: 1 },
        uSway: { value: 0 },
        uSpin: { value: 0 },
        uWind: { value: new THREE.Vector2() },
        uSize: { value: 0.1 },
        uPal: { value: [0, 1, 2, 3].map(() => new THREE.Color()) },
        uKind: { value: 0 },
        uLight: { value: new THREE.Color(1, 1, 1) },
        uOpacity: { value: 1 },
      },
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    return { quad, g, mat, mesh, centre: new THREE.Vector3(), light: new THREE.Color(), sky: new THREE.Color() };
  }, []);
  useEffect(
    () => () => {
      stuff.quad.dispose();
      stuff.g.dispose();
      stuff.mat.dispose();
    },
    [stuff],
  );
  useEffect(() => {
    const u = stuff.mat.uniforms;
    k.colors.forEach((c, i) => (u.uPal.value as THREE.Color[])[i].set(c));
    u.uKind.value = KIND_INDEX[kind];
    u.uFall.value = k.fall;
    u.uSway.value = k.sway;
    u.uSpin.value = k.spin;
    u.uOpacity.value = k.opacity;
    (u.uWind.value as THREE.Vector2).set(k.wind[0], k.wind[1]);
  }, [stuff, kind, k]);

  useFrame(({ camera, clock }) => {
    const overview = useView.getState().mode === 'overview';
    // fewer when the adaptive resolution has stepped down (perf.tsx): the frame is struggling
    const full = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const quality = 0.55 + 0.45 * Math.min(1, gl.getPixelRatio() / full);
    const n = Math.round(k.count[overview ? 1 : 0] * Math.min(1, amount) * quality);
    stuff.g.instanceCount = n;
    stuff.mesh.visible = n > 0;
    const t = clock.elapsedTime % WRAP;
    // lit by the sky: bright by day, a dim blue at night
    const p = skyAt(dayTime.t, palette);
    const night = nightFactor(dayTime.t);
    if (kind === 'snow') stuff.light.setHex(p.hemiSky).multiplyScalar(0.6 + 0.4 * (1 - night));
    else stuff.light.setRGB(1, 1, 1).lerp(stuff.sky.setHex(p.hemiSky), 0.25).multiplyScalar(0.45 + 0.55 * (1 - night));
    const box = overview ? BOX_OVERVIEW : BOX_WALK;
    if (overview) stuff.centre.set(0, 8, 0);
    else {
      camera.getWorldDirection(stuff.centre);
      stuff.centre.y = 0;
      stuff.centre.normalize().multiplyScalar(AHEAD).add(camera.position);
    }
    const u = stuff.mat.uniforms;
    (u.uCam.value as THREE.Vector3).copy(stuff.centre);
    (u.uEye.value as THREE.Vector3).copy(camera.position);
    (u.uBox.value as THREE.Vector3).copy(box);
    u.uSize.value = k.size * (overview ? OVERVIEW_SIZE : 1);
    u.uGround.value = -elevation;
    u.uRoof.value = roof;
    u.uHutTop.value = onRoof ? ROOF_HUT.h + 0.2 : -1e5;
    u.uTime.value = t;
    (u.uLight.value as THREE.Color).copy(stuff.light);
  });

  return <primitive object={stuff.mesh} />;
}
