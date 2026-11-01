// The northern lights: curtains of green light hanging high over the city on one side and across the north, rippling
// and drifting, violet at their tops, with rays running along them; the sky's light takes a faint green while they're
// out (sky/skyMood.ts). A night-only event (the office starts it only at night, most often in winter), and it fades with
// the dawn all the same. Three ribbons, each one mesh moved entirely in its shader (three draw calls, additive), and a
// soft chime as they appear. New in Marshmallow.
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { placeAt, play } from '../../../ui/eventSfx';
import { seeded } from '../../../../../shared/worldEvents';
import { dayTime, nightFactor } from '../../dayTime';
import { setSkyMood } from '../../sky/skyMood';
import { inOut, sign, type SceneProps } from '../kit';

// A ribbon is a strip (u along it, v up it) bent round an arc in the vertex shader: `uArc` is its middle azimuth, its
// span, radius and the height of its foot; `uTall` how tall it hangs.
const VERT = /* glsl */ `
uniform float uTime;
uniform vec4 uArc; // azimuth, span, radius, foot
uniform float uTall;
uniform float uSeed;
varying vec2 vUv;
void main() {
  vUv = uv;
  float u = uv.x;
  float a = uArc.x + (u - 0.5) * uArc.y;
  // the curtain folds in and out as it drifts, and its hem sways
  float fold = sin(u * 9.0 + uTime * 0.11 + uSeed) * 26.0 + sin(u * 23.0 - uTime * 0.23 + uSeed * 2.0) * 9.0;
  float r = uArc.z + fold;
  float y = uArc.w + uv.y * uTall * (0.85 + 0.15 * sin(u * 5.0 + uTime * 0.07 + uSeed)) + sin(u * 14.0 + uTime * 0.17) * 8.0;
  vec3 p = vec3(sin(a) * r, y, -cos(a) * r);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uFade;
uniform float uSeed;
varying vec2 vUv;
void main() {
  float u = vUv.x;
  float v = vUv.y;
  // rays running along the curtain, and brighter folds drifting slowly
  float rays = 0.55 + 0.45 * sin(u * 210.0 + uTime * 0.9 + sin(u * 41.0 + uTime * 0.31 + uSeed) * 3.0);
  float folds = 0.45 + 0.55 * smoothstep(-0.3, 1.0, sin(u * 13.0 - uTime * 0.12 + uSeed));
  // a bright, crisp hem low down and a long soft fade up
  float hem = smoothstep(0.0, 0.07, v);
  float body = pow(1.0 - v, 1.6) * (0.55 + 0.9 * exp(-v * 7.0));
  float ends = smoothstep(0.0, 0.14, u) * smoothstep(1.0, 0.86, u);
  vec3 green = vec3(0.25, 1.0, 0.55);
  vec3 teal = vec3(0.2, 0.85, 0.75);
  vec3 violet = vec3(0.62, 0.32, 1.0);
  vec3 col = mix(green, teal, smoothstep(0.1, 0.35, v));
  col = mix(col, violet, smoothstep(0.35, 0.85, v));
  float a = hem * body * ends * rays * folds * uFade;
  gl_FragColor = vec4(col * a, 1.0);
}`;

/** The ribbons: [azimuth offset from the side's, span, radius, foot, height, strength]. */
const RIBBONS: [number, number, number, number, number, number][] = [
  [0, 2.4, 470, 150, 170, 0.95],
  [0.35, 1.9, 560, 200, 150, 0.6],
  [-0.9, 2.2, 520, 175, 160, 0.7],
];

export default function Aurora({ run, elevation }: SceneProps) {
  const s = sign(run.side);
  const sky = useMemo(() => {
    const r = seeded(run.seed);
    // the side's azimuth (east +x is π/2, west -π/2), leaning north (azimuth 0 is -z)
    const side = (s * Math.PI) / 2 - s * 0.35;
    const ribbons = RIBBONS.map(([da, span, radius, foot, tall, strength], i) => {
      const geo = new THREE.PlaneGeometry(1, 1, 160, 1);
      geo.translate(0.5, 0.5, 0);
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
        uniforms: {
          uTime: { value: 0 },
          uArc: { value: new THREE.Vector4(i === 2 ? s * 0.25 : side + s * da, span, radius + r() * 40, foot + r() * 30) },
          uTall: { value: tall },
          uSeed: { value: r() * 10 },
          uFade: { value: 0 },
        },
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      return { geo, mat, mesh, strength };
    });
    return { ribbons, chimed: false };
  }, [run.seed, s]);
  useEffect(
    () => () => {
      for (const b of sky.ribbons) {
        b.geo.dispose();
        b.mat.dispose();
      }
      setSkyMood({ glow: 0 });
    },
    [sky],
  );

  useFrame(() => {
    const t = run.t;
    const night = nightFactor(dayTime.t);
    const fade = inOut(t, run.seconds, 14) * night;
    for (const b of sky.ribbons) {
      b.mat.uniforms.uTime.value = t;
      b.mat.uniforms.uFade.value = fade * b.strength;
      b.mesh.visible = fade > 0.002;
    }
    setSkyMood({ glow: 0.16 * fade });
    if (!sky.chimed && t > 2 && night > 0.5) {
      sky.chimed = true;
      const heard = placeAt(s * 300, 200 - elevation, -200, 500);
      play('chime', { gain: Math.max(0.35, heard.gain) * 0.6, pan: heard.pan, pitch: 0.75 });
    }
  });

  return (
    <group>
      {sky.ribbons.map((b, i) => (
        <primitive key={i} object={b.mesh} />
      ))}
    </group>
  );
}
