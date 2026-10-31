// Adapted from cubefarm client/src/world/sky/Sky.tsx (MIT): the clouds, the weather, the lightning, the bloom marks and
// photo mode's re-run are cut; the fog keeps Marshmallow's distances (the city's own haze, haze.ts, takes its colour).

// The sky outside, following the office's time of day (dayTime.ts, palette.ts): a gradient dome with the sun (big and
// amber at golden hour) and the moon, stars at night, and the scene's fog and background colour. Two draw calls (the
// stars only at night), everything updated through uniforms in one useFrame with no allocations. The whole sky moves
// with the camera and sits at the far end of the depth range, so it's drawn only where nothing else is and never cuts
// through the building or the city.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { dayTime, nightFactor } from '../dayTime';
import { skyAt, sunDirection, type SkyPalette } from './palette';
import { starField } from './skyLayout';

const STARS = 700;
/** The fog's start and end (metres from the eye): the office stays clear; the night pulls the far end in a little. */
const FOG_NEAR = 90;
const FOG_FAR_DAY = 320;
const FOG_FAR_NIGHT = 290;

// On the far plane (z = w): drawn after the building, only where nothing else is.
const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const DOME_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uNight;
varying vec3 vDir;

float disc(float c, float cosR) {
  float aa = fwidth(c);
  return smoothstep(cosR - aa, cosR + aa, c);
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.65, h));
  // haze where the sky meets the ground (and the hazed city), a little darker below the horizon
  col = mix(col, uFog, 0.55 * (1.0 - smoothstep(-0.03, 0.14, h)));
  col *= 1.0 - 0.15 * (1.0 - smoothstep(-0.3, 0.0, h));
  float aboveHorizon = smoothstep(-0.012, 0.008, h);

  // the sun: a soft glow and a hard cartoon disc, both bigger and warmer near the horizon
  float sunUp = smoothstep(-0.12, 0.04, uSunDir.y);
  float low = 1.0 - smoothstep(0.02, 0.45, uSunDir.y);
  float c = dot(d, uSunDir);
  float cp = max(c, 0.0);
  col += uSunColor * sunUp * low * pow(cp, 3.0) * (1.0 - smoothstep(-0.05, 0.4, h)) * 0.5;
  col += uSunColor * sunUp * (pow(cp, 300.0) * 0.3 + pow(cp, 24.0) * (0.12 + 0.25 * low));
  vec3 sunCore = mix(vec3(1.0, 0.36, 0.06), vec3(1.0, 0.93, 0.66), 1.0 - low); // linear: amber low, pale gold high
  col = mix(col, sunCore, disc(c, mix(0.99925, 0.9976, low)) * sunUp * aboveHorizon);

  // the moon, opposite the sun: a cream disc with a few craters and a cool halo
  vec3 m = -uSunDir;
  float mc = dot(d, m);
  float moonUp = uNight * smoothstep(-0.02, 0.06, m.y) * aboveHorizon;
  col += vec3(0.5, 0.58, 0.9) * moonUp * (pow(max(mc, 0.0), 260.0) * 0.4 + pow(max(mc, 0.0), 40.0) * 0.08);
  vec3 tx = normalize(cross(m, vec3(0.0, 1.0, 0.0)) + vec3(0.0001));
  vec3 ty = cross(tx, m);
  vec2 q = vec2(dot(d, tx), dot(d, ty)) / 0.034;
  float crater = max(max(1.0 - smoothstep(0.2, 0.26, length(q - vec2(0.3, 0.28))),
                          1.0 - smoothstep(0.15, 0.2, length(q - vec2(-0.35, -0.08)))),
                      1.0 - smoothstep(0.11, 0.15, length(q - vec2(0.12, -0.45))));
  vec3 moonCol = mix(vec3(0.95, 0.88, 0.66), vec3(0.6, 0.56, 0.46), crater);
  col = mix(col, moonCol, disc(mc, 0.99942) * moonUp);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
uniform float uTime;
uniform float uOpacity;
uniform float uPixel;
varying float vAlpha;
void main() {
  float up = normalize(mat3(modelMatrix) * position).y;
  float twinkle = 0.65 + 0.35 * sin(uTime * (1.2 + aPhase * 2.0) + aPhase * 6.2832);
  vAlpha = uOpacity * twinkle * smoothstep(0.02, 0.15, up);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
  gl_PointSize = aSize * uPixel;
}`;

const STAR_FRAG = /* glsl */ `
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(1.0, 0.97, 0.86, vAlpha * (1.0 - smoothstep(0.32, 0.5, r)));
  #include <colorspace_fragment>
}`;

/** The sky, the fog and the background: mounted once inside the Canvas, in place of a fixed colour and fog. */
export function Sky() {
  const scene = useThree((s) => s.scene);
  const group = useRef<THREE.Group>(null);
  const stars = useRef<THREE.Points>(null);

  // Everything the frame loop touches is allocated once here.
  const sky = useMemo(() => {
    const field = starField(STARS);
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(field.positions, 3));
    starGeometry.setAttribute('aSize', new THREE.BufferAttribute(field.sizes, 1));
    starGeometry.setAttribute('aPhase', new THREE.BufferAttribute(field.phases, 1));
    const sun = sunDirection(0.5);
    // the stars wheel round the same axis as the sun
    const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(sun[0], sun[1], sun[2])).normalize();
    return {
      palette: {} as SkyPalette,
      sun: [0, 0, 0] as [number, number, number],
      axis,
      fog: new THREE.Fog(0xe4eef4, FOG_NEAR, FOG_FAR_DAY),
      background: new THREE.Color(0xbfe3ff),
      domeGeometry: new THREE.SphereGeometry(50, 32, 16),
      dome: new THREE.ShaderMaterial({
        vertexShader: DOME_VERT,
        fragmentShader: DOME_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uZenith: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uFog: { value: new THREE.Color() },
          uSunColor: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uNight: { value: 0 },
        },
      }),
      starGeometry,
      star: new THREE.ShaderMaterial({
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uPixel: { value: 1 } },
      }),
    };
  }, []);

  useEffect(() => {
    const prevFog = scene.fog;
    const prevBackground = scene.background;
    scene.fog = sky.fog;
    scene.background = sky.background;
    return () => {
      scene.fog = prevFog;
      scene.background = prevBackground;
      for (const d of [sky.domeGeometry, sky.dome, sky.starGeometry, sky.star]) d.dispose();
    };
  }, [scene, sky]);

  useFrame(({ camera, clock, gl }) => {
    const g = group.current;
    if (!g) return;
    g.position.copy(camera.position);

    const t = dayTime.t;
    const p = skyAt(t, sky.palette);
    const sun = sunDirection(t, sky.sun);
    const night = nightFactor(t);

    const u = sky.dome.uniforms;
    (u.uZenith.value as THREE.Color).setHex(p.zenith);
    (u.uHorizon.value as THREE.Color).setHex(p.horizon);
    (u.uFog.value as THREE.Color).setHex(p.fog);
    (u.uSunColor.value as THREE.Color).setHex(p.sunColor);
    (u.uSunDir.value as THREE.Vector3).set(sun[0], sun[1], sun[2]);
    u.uNight.value = night;
    sky.fog.color.setHex(p.fog);
    sky.fog.far = FOG_FAR_DAY + (FOG_FAR_NIGHT - FOG_FAR_DAY) * night;
    sky.background.setHex(p.horizon);

    const st = stars.current;
    if (st) {
      st.visible = p.starsOpacity > 0.01;
      if (st.visible) {
        st.quaternion.setFromAxisAngle(sky.axis, 2 * Math.PI * (t - 0.5));
        const su = sky.star.uniforms;
        su.uOpacity.value = p.starsOpacity;
        su.uTime.value = clock.elapsedTime;
        su.uPixel.value = gl.getPixelRatio();
      }
    }
  });

  return (
    <group ref={group}>
      <mesh geometry={sky.domeGeometry} material={sky.dome} frustumCulled={false} renderOrder={1000} />
      <points ref={stars} geometry={sky.starGeometry} material={sky.star} frustumCulled={false} renderOrder={-1} visible={false} />
    </group>
  );
}
