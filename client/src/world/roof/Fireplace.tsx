// The fireplace in the middle of the west half's lounge: a round stone fire pit with logs in it and toon flames that
// lick and flicker, sparks drifting up, a warm glow over it and on the stones round it, and wooden benches with
// cushions on three sides (roofLayout.ts has the numbers; people on a roof break sit on them, RoofPeople.tsx). Faked
// light only (a real one would recompile every material in view). New in Marshmallow.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { glow, toon } from '../materials';
import { INK, Outlines } from '../Outlines';
import { merged } from '../shapes';
import { FIRE, FIRE_BENCH, FIRE_BENCHES } from './roofLayout';
import { glowTexture } from './textures';

/** The flames, round the middle of the pit: where (from its middle), how big, and their colour; the bigger the further out. */
const FLAMES: { x: number; z: number; s: number; colour: string }[] = [
  { x: 0.13, z: 0.06, s: 1.1, colour: '#ff7b22' },
  { x: -0.13, z: 0.08, s: 0.95, colour: '#ff7b22' },
  { x: 0.02, z: -0.14, s: 1.05, colour: '#ff7b22' },
  { x: 0.05, z: 0.02, s: 0.8, colour: '#ffb703' },
  { x: -0.06, z: -0.04, s: 0.72, colour: '#ffb703' },
  { x: 0, z: 0, s: 0.46, colour: '#fff1b8' },
];
/** A flame's outline, turned round its middle: a teardrop, 0.6 m tall at full size. */
const PROFILE: [number, number][] = [
  [0, 0],
  [0.13, 0.05],
  [0.17, 0.16],
  [0.13, 0.32],
  [0.07, 0.47],
  [0, 0.6],
];
const SPARKS = 14;
const BASE = FIRE.h + 0.02; // the flames' and sparks' floor: on the logs

/** A box in a bench's own frame (sitters face -z, its length along x, `tilt` leaning its top back), put where it stands. */
function benchBox(m: THREE.Matrix4, size: [number, number, number], at: [number, number, number], tilt = 0) {
  return new THREE.BoxGeometry(...size).rotateX(tilt).translate(...at).applyMatrix4(m);
}

function benchesGeometry() {
  const wood: THREE.BufferGeometry[] = [];
  const cushions: THREE.BufferGeometry[] = [];
  const { len, d, seat } = FIRE_BENCH;
  const m = new THREE.Matrix4();
  for (const b of FIRE_BENCHES) {
    m.makeRotationY(b.heading).setPosition(b.x, 0, b.z);
    wood.push(benchBox(m, [len, 0.07, d - 0.04], [0, 0.385, 0])); // the seat's boards
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) wood.push(benchBox(m, [0.08, 0.35, 0.08], [sx * (len / 2 - 0.12), 0.175, sz * (d / 2 - 0.08)])); // legs
      wood.push(benchBox(m, [0.08, 0.06, d - 0.02], [sx * (len / 2 - 0.04), 0.64, 0])); // the arms
      wood.push(benchBox(m, [0.06, 0.2, 0.06], [sx * (len / 2 - 0.04), 0.52, -d / 2 + 0.08])); // and their front posts
    }
    wood.push(benchBox(m, [len, 0.42, 0.06], [0, 0.74, d / 2 - 0.05], 0.12)); // the backrest
    cushions.push(benchBox(m, [len - 0.16, 0.08, d - 0.14], [0, seat - 0.04, -0.02])); // the seat's cushion
    cushions.push(benchBox(m, [len - 0.24, 0.3, 0.09], [0, 0.72, d / 2 - 0.13], 0.12)); // and the back's
  }
  return { wood: merged(wood), cushions: merged(cushions) };
}

/** A seeded wobble, so the stones sit the same way every visit. */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function pitGeometry() {
  const { x, z, r, h } = FIRE;
  const rnd = rand(11);
  const stones: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 15; k++) {
    const a = (k / 15) * Math.PI * 2;
    const s = 0.12 + rnd() * 0.03;
    stones.push(
      new THREE.DodecahedronGeometry(s, 0)
        .scale(1.2, 0.65, 1)
        .rotateY(a + rnd())
        .translate(x + Math.cos(a) * (r - 0.09), h - 0.03, z + Math.sin(a) * (r - 0.09)),
    );
  }
  const logs: THREE.BufferGeometry[] = [0, 1, 2].map((k) =>
    new THREE.CylinderGeometry(0.065, 0.07, 0.82, 8)
      .rotateZ(Math.PI / 2)
      .rotateY((k * Math.PI * 2) / 3 + 0.4)
      .translate(x, h - 0.02 + k * 0.05, z),
  );
  return {
    body: new THREE.CylinderGeometry(r * 0.95, r, h - 0.05, 28).translate(x, (h - 0.05) / 2, z),
    stones: merged(stones),
    ash: new THREE.CircleGeometry(r - 0.15, 24).rotateX(-Math.PI / 2).translate(x, h - 0.04, z),
    embers: new THREE.CircleGeometry(0.32, 20).rotateX(-Math.PI / 2).translate(x, h - 0.03, z),
    logs: merged(logs),
  };
}

let mats: { halo: THREE.SpriteMaterial; ground: THREE.MeshBasicMaterial; sparks: THREE.PointsMaterial } | null = null;
/** The glows' and sparks' materials: shared, made once and kept like toon()'s. */
function fireMaterials() {
  if (mats) return mats;
  const map = glowTexture();
  const lit = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false } as const;
  mats = {
    halo: new THREE.SpriteMaterial({ map, color: '#ffa040', opacity: 0.5, ...lit }),
    ground: new THREE.MeshBasicMaterial({ map, color: '#ff8c3a', opacity: 0.22, ...lit }),
    sparks: new THREE.PointsMaterial({ size: 0.07, vertexColors: true, ...lit }),
  };
  return mats;
}

/** The flames, the glow and the sparks: all moved in one frame callback, nothing made per frame. */
function Fire() {
  const flames = useRef<(THREE.Mesh | null)[]>([]);
  const halo = useRef<THREE.Sprite>(null);
  const built = useMemo(() => {
    const sparks = new THREE.BufferGeometry();
    sparks.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SPARKS * 3), 3));
    sparks.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(SPARKS * 3), 3));
    const r = rand(5);
    return {
      flame: new THREE.LatheGeometry(
        PROFILE.map(([px, py]) => new THREE.Vector2(px, py)),
        10,
      ),
      ground: new THREE.CircleGeometry(2.4, 32).rotateX(-Math.PI / 2).translate(FIRE.x, 0.02, FIRE.z),
      sparks,
      // each spark: its bearing, how far out it rises, how fast, and where in its rise it starts
      paths: Array.from({ length: SPARKS }, () => ({ a: r() * Math.PI * 2, out: 0.05 + r() * 0.2, speed: 0.35 + r() * 0.4, phase: r() })),
    };
  }, []);
  useEffect(() => () => [built.flame, built.ground, built.sparks].forEach((g) => g.dispose()), [built]);
  const m = fireMaterials();

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    for (let i = 0; i < FLAMES.length; i++) {
      const mesh = flames.current[i];
      if (!mesh) continue;
      const f = FLAMES[i];
      const ph = i * 1.7;
      const lick = Math.sin(t * 7.3 + ph);
      mesh.scale.set(f.s * (1 - 0.1 * lick), f.s * (1 + 0.22 * lick + 0.1 * Math.sin(t * 13.1 + ph * 2)), f.s * (1 - 0.1 * lick));
      mesh.rotation.set(0.1 * Math.sin(t * 4.1 + ph * 1.3), 0, 0.12 * Math.sin(t * 3.7 + ph));
    }
    const flicker = 0.8 + 0.12 * Math.sin(t * 9.1) + 0.08 * Math.sin(t * 23.7);
    if (halo.current) halo.current.scale.setScalar(1.9 * (0.94 + 0.06 * flicker));
    m.halo.opacity = 0.5 * flicker;
    m.ground.opacity = 0.22 * flicker;
    const pos = built.sparks.attributes.position as THREE.BufferAttribute;
    const col = built.sparks.attributes.color as THREE.BufferAttribute;
    for (let k = 0; k < SPARKS; k++) {
      const p = built.paths[k];
      const life = (t * p.speed + p.phase) % 1;
      const a = p.a + life * 2.2;
      const out = p.out + life * 0.25;
      pos.setXYZ(k, FIRE.x + Math.cos(a) * out, BASE + 0.12 + life * 1.6, FIRE.z + Math.sin(a) * out);
      const fade = 1 - life; // additive: fading to black is fading out
      col.setXYZ(k, fade, 0.7 * fade, 0.25 * fade);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });

  return (
    <group>
      <group position={[FIRE.x, BASE, FIRE.z]}>
        {FLAMES.map((f, i) => (
          <mesh key={i} ref={(el) => void (flames.current[i] = el)} geometry={built.flame} material={glow(f.colour)} position={[f.x, 0, f.z]} />
        ))}
      </group>
      <sprite ref={halo} material={m.halo} position={[FIRE.x, BASE + 0.5, FIRE.z]} scale={1.9} renderOrder={2} />
      <mesh geometry={built.ground} material={m.ground} renderOrder={2} />
      <points geometry={built.sparks} material={m.sparks} frustumCulled={false} renderOrder={2} />
    </group>
  );
}

export function Fireplace() {
  const pit = useMemo(pitGeometry, []);
  const benches = useMemo(benchesGeometry, []);
  useEffect(() => () => [...Object.values(pit), ...Object.values(benches)].forEach((g) => g.dispose()), [pit, benches]);
  return (
    <group>
      <mesh geometry={pit.body} material={toon('#8d8579')} castShadow receiveShadow>
        <Outlines thickness={0.02} color={INK} />
      </mesh>
      <mesh geometry={pit.stones} material={toon('#a7a197')} castShadow>
        <Outlines thickness={0.015} color={INK} />
      </mesh>
      <mesh geometry={pit.ash} material={toon('#3a2e2a')} />
      <mesh geometry={pit.embers} material={glow('#ff5a1f')} />
      <mesh geometry={pit.logs} material={toon('#7a5230')} castShadow>
        <Outlines thickness={0.012} color={INK} />
      </mesh>
      <Fire />
      <mesh geometry={benches.wood} material={toon('#a0683f')} castShadow receiveShadow>
        <Outlines thickness={0.015} color={INK} />
      </mesh>
      <mesh geometry={benches.cushions} material={toon('#e76f51')} castShadow receiveShadow />
    </group>
  );
}
