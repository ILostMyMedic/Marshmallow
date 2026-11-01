// The city round the building (cityLayout.ts): streets and pavements, the buildings on their blocks with windows on
// every face, roofs, parks and trees, downtown's skyline, the outskirts, the billboards on the nearer roofs
// (Billboards.tsx), the bay and its red bridge far to the west (Bridge.tsx), and a dozen cars driving the nearer
// streets. Every kind of thing is one instanced or merged mesh, so the whole city costs a handful of draw calls. It
// fades into the haze on its own long curve (haze.ts), dims to the night and lights its windows after dusk (the
// clock's uniforms, sky/outdoor.ts), and sits `elevation` below the floor you're on.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Billboards } from './Billboards';
import { Bridge } from './Bridge';
import { carRoutes, CITY, CORRIDOR_HALF, GROUND, STREET_Y, theCity, type CityBox, type CityBuilding } from './cityLayout';
import { trafficPose } from './events/streetTraffic';
import { CITY_HAZE, hazed, hazedToon } from './haze';
import { outdoor } from './sky/outdoor';

const GROUND_COLOR = '#d9d2c4'; // pavements and plazas
const ROAD = '#5b5f6b';
const PLAZA = '#efe6d6';
const KERB = '#c9c0ae';
/** Lane markings are painted this far out; past it they'd only shimmer. */
const DASHES = 220;

const unit = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 16).translate(0, 0.5, 0),
  cone: new THREE.ConeGeometry(0.5, 1, 12).translate(0, 0.5, 0),
};

/**
 * A white toon material that takes each instance's colour, and paints a grid of windows on the sides when asked
 * (fading them out far off, where they'd shimmer). After dusk a share of each building's windows lights up (its `lit`,
 * each window at its own threshold, sky/outdoor.ts's uLights), added after the night's dimming so they glow. Hazed
 * like the rest of the city.
 */
function cityMaterial(windows: boolean) {
  const m = new THREE.MeshToonMaterial({ color: '#ffffff' });
  if (windows)
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uLights = outdoor.uLights;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aSize;\nattribute vec2 aWin;\nvarying vec3 vCity;\nvarying vec3 vCityN;\nvarying vec2 vWin;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCity = position * aSize;\nvCityN = normal;\nvWin = aWin;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uLights;\nvarying vec3 vCity;\nvarying vec3 vCityN;\nvarying vec2 vWin;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec3 cityGlow = vec3(0.0);
          {
            // in metres along the face: a window every 2.8 m across and 3.3 m up, none on the roof or the ground floor's base
            float side = step(abs(vCityN.y), 0.5);
            float u = abs(vCityN.x) > 0.5 ? vCity.z : vCity.x;
            float v = vCity.y;
            float wx = step(0.22, fract(u / 2.8)) * step(fract(u / 2.8), 0.78);
            float wy = step(0.3, fract(v / 3.3)) * step(fract(v / 3.3), 0.78) * step(1.4, v);
            float near = 1.0 - smoothstep(320.0, 560.0, length(vViewPosition));
            float pane = side * wx * wy * near;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.76, 0.88), pane * 0.85);
            // each window comes on at its own share of the lights (a hash of its cell, its face and the building's pattern)
            vec3 cell = vec3(floor(u / 2.8), floor(v / 3.3), vCityN.x * 3.0 + vCityN.z * 7.0 + vWin.y * 13.0);
            float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
            float on = clamp((vWin.x * uLights - h) * 6.0, 0.0, 1.0) * pane;
            cityGlow = mix(vec3(1.0, 0.62, 0.28), vec3(0.95, 0.86, 0.66), step(0.55, fract(h * 7.31))) * on * 0.85;
          }`,
        )
        .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb += cityGlow;\n#include <tonemapping_fragment>');
    };
  return hazed(m, CITY_HAZE);
}

/** One instanced mesh of `geometry` for every box in `items`, each scaled, placed and coloured; `windows` paints them. */
function Instances({ items, geometry, windows = false, shadows = false }: { items: CityBox[]; geometry: THREE.BufferGeometry; windows?: boolean; shadows?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(() => cityMaterial(windows), [windows]);
  const geo = useMemo(() => {
    if (!windows) return geometry;
    const g = geometry.clone();
    g.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(items.flatMap((b) => [b.w, b.h, b.d])), 3));
    g.setAttribute('aWin', new THREE.InstancedBufferAttribute(new Float32Array(items.flatMap((b: Partial<CityBuilding>) => [b.lit ?? 0, b.pattern ?? 0])), 2));
    return g;
  }, [geometry, items, windows]);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    items.forEach((b, i) => {
      m.makeScale(b.w, b.h, b.d).setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setHex(b.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  useEffect(
    () => () => {
      material.dispose();
      if (geo !== geometry) geo.dispose();
    },
    [material, geo, geometry],
  );
  return <instancedMesh ref={ref} args={[geo, material, items.length]} castShadow={shadows} receiveShadow />;
}

/** The streets and their lane markings as flat strips, on the ground, which stops at the bay's shore. */
function Streets({ streetsX, streetsZ, extentX, extentZ }: { streetsX: number[]; streetsZ: number[]; extentX: number; extentZ: number }) {
  const geo = useMemo(() => {
    const roads: THREE.BufferGeometry[] = [];
    const lines: THREE.BufferGeometry[] = [];
    const dz = Math.min(extentZ, DASHES);
    const dx = Math.min(extentX, DASHES);
    for (const x of streetsX) {
      roads.push(new THREE.PlaneGeometry(CITY.roadHalf * 2, extentZ * 2).rotateX(-Math.PI / 2).translate(x, 0.02, 0));
      if (Math.abs(x) < DASHES) for (let z = -dz; z < dz; z += 6) lines.push(new THREE.PlaneGeometry(0.18, 2.6).rotateX(-Math.PI / 2).translate(x, 0.03, z));
    }
    for (const z of streetsZ) {
      roads.push(new THREE.PlaneGeometry(extentX * 2, CITY.roadHalf * 2).rotateX(-Math.PI / 2).translate(0, 0.025, z));
      if (Math.abs(z) < DASHES) for (let x = -dx; x < dx; x += 6) lines.push(new THREE.PlaneGeometry(2.6, 0.18).rotateX(-Math.PI / 2).translate(x, 0.035, z));
    }
    const merge = (parts: THREE.BufferGeometry[]) => {
      const g = new THREE.BufferGeometry();
      const pos: number[] = [];
      const nor: number[] = [];
      for (const p of parts) {
        const q = p.index ? p.toNonIndexed() : p;
        pos.push(...(q.attributes.position.array as Float32Array));
        nor.push(...(q.attributes.normal.array as Float32Array));
        p.dispose();
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      return g;
    };
    return { roads: merge(roads), lines: merge(lines) };
  }, [streetsX, streetsZ, extentX, extentZ]);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  return (
    <group>
      <mesh position={[(GROUND.minX + GROUND.maxX) / 2, 0, (GROUND.minZ + GROUND.maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={hazedToon(GROUND_COLOR, CITY_HAZE)}>
        <planeGeometry args={[GROUND.maxX - GROUND.minX, GROUND.maxZ - GROUND.minZ]} />
      </mesh>
      <mesh geometry={geo.roads} material={hazedToon(ROAD, CITY_HAZE)} receiveShadow />
      <mesh geometry={geo.lines} material={hazedToon('#f4f1e8', CITY_HAZE)} />
    </group>
  );
}

/** Trees round our plaza's edge, clear of the building and its doors. */
function plazaTrees(): { trunks: CityBox[]; crowns: CityBox[] } {
  const trunks: CityBox[] = [];
  const crowns: CityBox[] = [];
  const x = CITY.homeHalfX - 3;
  const z = CITY.homeHalfZ - 3;
  const spots = [
    ...[-x, -x / 2, x / 2, x].flatMap((tx) => [
      [tx, -z],
      [tx, z],
    ]),
    [-x, 0],
    [x, 0],
  ];
  spots.forEach(([tx, tz], i) => {
    const s = 0.9 + ((i * 37) % 10) / 25;
    trunks.push({ x: tx, z: tz, y: 0, w: 0.45, h: 1.6 * s, d: 0.45, color: 0x7a5a3c });
    crowns.push({ x: tx, z: tz, y: 1.3 * s, w: 3.4 * s, h: 4.6 * s, d: 3.4 * s, color: [0x5fa84f, 0x4f9a48, 0x6cb35a][i % 3] });
  });
  return { trunks, crowns };
}

/** The dozen cars and buses on the nearer streets, driving their lanes and giving way to the street events (events/streetTraffic.ts). */
function Cars() {
  const cars = useMemo(() => carRoutes(), []);
  const bodies = useRef<THREE.InstancedMesh>(null);
  const cabins = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => ({ pose: { x: 0, z: 0, yaw: 0 }, m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), c: new THREE.Color() }), []);
  useEffect(() => {
    cars.forEach((car, i) => {
      bodies.current?.setColorAt(i, tmp.c.setHex(car.color));
      cabins.current?.setColorAt(i, tmp.c.set(car.bus ? '#fff3d6' : '#cfe6f5'));
    });
    for (const m of [bodies.current, cabins.current]) if (m?.instanceColor) m.instanceColor.needsUpdate = true;
  }, [cars, tmp]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    cars.forEach((car, i) => {
      trafficPose(car, i, t, tmp.pose);
      tmp.q.setFromAxisAngle(tmp.up, tmp.pose.yaw);
      const bodyH = car.h * (car.bus ? 0.75 : 0.5);
      tmp.m.compose(tmp.p.set(tmp.pose.x, 0.25, tmp.pose.z), tmp.q, tmp.s.set(car.w, bodyH, car.len));
      bodies.current?.setMatrixAt(i, tmp.m);
      const cabinH = car.h - bodyH - 0.2;
      tmp.m.compose(tmp.p.set(tmp.pose.x, 0.25 + bodyH, tmp.pose.z), tmp.q, tmp.s.set(car.w * 0.88, cabinH, car.len * (car.bus ? 0.95 : 0.5)));
      cabins.current?.setMatrixAt(i, tmp.m);
    });
    for (const m of [bodies.current, cabins.current]) if (m) m.instanceMatrix.needsUpdate = true;
  });
  const material = useMemo(() => cityMaterial(false), []);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <group>
      <instancedMesh ref={bodies} args={[unit.box, material, cars.length]} castShadow frustumCulled={false} />
      <instancedMesh ref={cabins} args={[unit.box, material, cars.length]} frustumCulled={false} />
    </group>
  );
}

export function City({ elevation }: { elevation: number }) {
  const city = useMemo(() => theCity(), []);
  const trees = useMemo(() => plazaTrees(), []);
  return (
    <group position={[0, -elevation, 0]}>
      <group position={[0, STREET_Y, 0]}>
        <Streets streetsX={city.streetsX} streetsZ={city.streetsZ} extentX={city.extentX + CORRIDOR_HALF} extentZ={city.extentZ + CORRIDOR_HALF} />
        <Instances items={city.buildings} geometry={unit.box} windows shadows />
        <Instances items={city.boxes} geometry={unit.box} />
        <Instances items={city.cylinders} geometry={unit.cylinder} />
        <Instances items={city.cones} geometry={unit.cone} />
        <Cars />
        <Billboards />
        <Bridge />
      </group>
      {/* our plaza, a step up from the pavement, with its kerb and trees */}
      <mesh position={[0, (STREET_Y - 0.03) / 2, 0]} material={hazedToon(KERB, CITY_HAZE)}>
        <boxGeometry args={[CITY.homeHalfX * 2 + 0.6, -STREET_Y - 0.03, CITY.homeHalfZ * 2 + 0.6]} />
      </mesh>
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} material={hazedToon(PLAZA, CITY_HAZE)} receiveShadow>
        <planeGeometry args={[CITY.homeHalfX * 2 - 0.6, CITY.homeHalfZ * 2 - 0.6]} />
      </mesh>
      <Instances items={trees.trunks} geometry={unit.cylinder} />
      <Instances items={trees.crowns} geometry={unit.cone} />
    </group>
  );
}
