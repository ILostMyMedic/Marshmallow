// Adapted from cubefarm client/src/world/events/scenes/Fireworks.tsx (MIT): the sparks in one draw call, moved in the
// vertex shader from where and when they were launched; the bloom marks cut, and the show split from its event so New
// Year's nights (Seasons.tsx) and the world event (events/scenes/Fireworks.tsx) share it.

// Fireworks over the city: rockets streak up from the streets and burst into spheres, rings and golden willows of
// sparks that fall and fade. Every spark is one point in a single draw call, moved in the vertex shader from where and
// when it was launched (the frame loop only writes the new ones), with a whistle as each goes up and the boom arriving a
// moment after the flash, as far away as it is. A show is a plan of launches (pure and seeded, so every tab sees the
// same one) and a clock; the caller places it at street level.
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { placeAt, play } from '../../ui/eventSfx';
import { mulberry } from './kit';

const SLOTS = 3000;
const GRAVITY = -6;
const ATTRS = ['position', 'aVel', 'aColor', 'aTime', 'aSize'] as const;
const PALETTE = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#ff70a6', '#ffffff', '#c77dff', '#4cc9f0'];

const VERT = /* glsl */ `
attribute vec3 aVel;
attribute vec3 aColor;
attribute vec2 aTime; // start, life
attribute float aSize;
uniform float uTime;
uniform float uScale;
varying vec3 vColor;
varying float vFade;
void main() {
  float age = uTime - aTime.x;
  if (age < 0.0 || age > aTime.y) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  // air drag slows the sparks, then gravity takes them
  float drag = (1.0 - exp(-1.6 * age)) / 1.6;
  vec3 p = position + aVel * drag + vec3(0.0, ${GRAVITY.toFixed(1)} * 0.5 * age * age, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float k = age / aTime.y;
  vFade = (1.0 - k * k) * (0.75 + 0.25 * sin(age * 30.0 + aSize * 50.0));
  vColor = aColor;
  gl_PointSize = aSize * uScale / max(1.0, -mv.z);
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vFade;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.1, 0.5, r)) * vFade;
  gl_FragColor = vec4(vColor * (1.0 + (1.0 - smoothstep(0.0, 0.2, r))), a);
}`;

export type Shape = 'sphere' | 'ring' | 'willow';

/** One rocket: when it goes up (show seconds), where it bursts (street-level metres), what shape and colours, how many sparks. */
export interface Launch {
  at: number;
  x: number;
  y: number;
  z: number;
  shape: Shape;
  color: string;
  color2: string;
  sparks: number;
}

/**
 * The launches of a show `seconds` long from `seed`, starting `from` seconds in: one every second or two over the city
 * on `side` (-1 west, 1 east, 0 each side in turn, where the windows look out), bursting `burst` m up, and (with
 * `finale`) a quick volley at the end.
 */
export function showPlan(seed: number, from: number, seconds: number, opts: { side: number; burst: number; finale: boolean; every?: [number, number] }): Launch[] {
  const r = mulberry(seed);
  const out: Launch[] = [];
  const [gap0, gap1] = opts.every ?? [0.9, 2.2];
  let turn = 1;
  const add = (at: number, big = false) => {
    turn = -turn;
    const side = opts.side || turn;
    const shape: Shape = r() < 0.2 ? 'willow' : r() < 0.35 ? 'ring' : 'sphere';
    const c = PALETTE[Math.floor(r() * PALETTE.length)];
    const away = 140 + r() * 110;
    const a = (r() - 0.5) * 1.6;
    const x = side * away * Math.cos(a);
    const z = away * Math.sin(a);
    out.push({ at, x, y: opts.burst + r() * 35, z, shape, color: shape === 'willow' ? '#ffcf6b' : c, color2: r() < 0.4 ? PALETTE[Math.floor(r() * PALETTE.length)] : c, sparks: big ? 150 : 70 + Math.floor(r() * 50) });
  };
  const end = from + seconds - (opts.finale ? 12 : 0);
  for (let t = from + 1 + r(); t < end; t += gap0 + r() * (gap1 - gap0)) add(t);
  if (opts.finale) for (let i = 0; i < 9; i++) add(from + seconds - 11 + i * 0.35 + r() * 0.2, true);
  return out.sort((a, b) => a.at - b.at);
}

/**
 * A show: the launches `between` two moments, played on `clock` (seconds), `elevation` below the floor you're on (for
 * the sounds' distances). `fade` dims the new ones (0 holds them back); `loud`: the whistles and booms.
 */
export function FireworksShow({ between, clock, elevation, loud = true, fade = () => 1 }: { between: (from: number, to: number) => Launch[]; clock: () => number; elevation: number; loud?: boolean; fade?: () => number }) {
  const gl = useThree((st) => st.gl);
  const show = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const attr = (size: number) => new THREE.BufferAttribute(new Float32Array(SLOTS * size), size).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr(3));
    geo.setAttribute('aVel', attr(3));
    geo.setAttribute('aColor', attr(3));
    geo.setAttribute('aTime', attr(2));
    geo.setAttribute('aSize', attr(1));
    (geo.attributes.aTime.array as Float32Array).fill(-1e5);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uScale: { value: 400 } },
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 5;
    return { geo, mat, points, cursor: -1, slot: 0, rnd: mulberry(13), c1: new THREE.Color(), c2: new THREE.Color() };
  }, []);
  useEffect(
    () => () => {
      show.geo.dispose();
      show.mat.dispose();
    },
    [show],
  );

  /** Writes one spark into the next slot of the ring. */
  const spark = (x: number, y: number, z: number, vx: number, vy: number, vz: number, c: THREE.Color, start: number, life: number, size: number) => {
    const i = show.slot;
    show.slot = (show.slot + 1) % SLOTS;
    const a = show.geo.attributes;
    (a.position.array as Float32Array).set([x, y, z], i * 3);
    (a.aVel.array as Float32Array).set([vx, vy, vz], i * 3);
    (a.aColor.array as Float32Array).set([c.r, c.g, c.b], i * 3);
    (a.aTime.array as Float32Array).set([start, life], i * 2);
    (a.aSize.array as Float32Array)[i] = size;
  };

  useFrame(({ camera }) => {
    const t = clock();
    const cam = camera as THREE.PerspectiveCamera;
    show.mat.uniforms.uTime.value = t;
    show.mat.uniforms.uScale.value = (gl.domElement.height * 0.5) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    // joined late (or back from a hidden tab): what went up a while ago is long gone
    if (show.cursor < 0 || t < show.cursor || t - show.cursor > 4) show.cursor = t - 0.001;
    const due = between(show.cursor, t);
    show.cursor = t;
    let wrote = false;
    const level = fade();
    for (const L of due) {
      if (level <= 0.01) continue;
      const rise = 1.5 + show.rnd() * 0.4;
      const burst = L.at + rise;
      const c1 = show.c1.set(L.color).multiplyScalar(level);
      const c2 = show.c2.set(L.color2).multiplyScalar(level);
      // the rocket and its little trail, up to where it bursts (the speed that gets there through the drag and gravity)
      const up = (L.y - 0.5 * GRAVITY * rise * rise) / ((1 - Math.exp(-1.6 * rise)) / 1.6);
      for (let k = 0; k < 6; k++) spark(L.x, 0, L.z, 0, up, 0, c1, L.at + k * 0.04, rise - k * 0.04, k ? 0.9 : 1.6);
      const r = show.rnd;
      for (let k = 0; k < L.sparks; k++) {
        let vx: number;
        let vy: number;
        let vz: number;
        if (L.shape === 'ring') {
          const a = (k / L.sparks) * Math.PI * 2;
          vx = Math.cos(a) * 0.25;
          vy = Math.cos(a) * 0.9;
          vz = Math.sin(a);
        } else {
          // a random direction on the sphere
          const u = r() * 2 - 1;
          const a = r() * Math.PI * 2;
          const q = Math.sqrt(1 - u * u);
          vx = Math.cos(a) * q;
          vy = u;
          vz = Math.sin(a) * q;
        }
        const speed = L.shape === 'willow' ? 14 : 25 + r() * 6;
        spark(L.x, L.y, L.z, vx * speed, vy * speed + (L.shape === 'willow' ? 3 : 0), vz * speed, k % 2 ? c2 : c1, burst, L.shape === 'willow' ? 3.6 : 2 + r() * 0.6, L.shape === 'willow' ? 2.4 : 3.2);
      }
      wrote = true;
      if (!loud) continue;
      const heard = placeAt(L.x, L.y - elevation, L.z, 220);
      play('whistle', { gain: heard.gain * level, pan: heard.pan, pitch: 0.85 + show.rnd() * 0.3 });
      // the bang comes as far behind the flash as the burst is away
      const away = Math.hypot(L.x - camera.position.x, L.y - elevation - camera.position.y, L.z - camera.position.z) / 343;
      play('boom', { gain: heard.gain * level, pan: heard.pan, delay: rise + away });
    }
    if (wrote) for (const name of ATTRS) show.geo.attributes[name].needsUpdate = true;
  });

  return <primitive object={show.points} />;
}

/** The launches of `plan` in (from, to]. */
export const launchesBetween = (plan: readonly Launch[], from: number, to: number) => plan.filter((l) => l.at > from && l.at <= to);
