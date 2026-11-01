// The roof terrace in its season (Roof.tsx mounts it; seasonLayout.ts has where). In the snow: a drifted white layer
// over the deck (cut out of a texture, so it's opaque and crisp, cleared round the fire and trodden by the door), caps
// on the parapet, the beds, the planters, the picnic table, the hut and the water tank, white tops on the little trees,
// and a snowman in the south-west corner. At Christmas, lights all along the handrail and wreaths on the hut. For
// Halloween, jack-o'-lanterns by the door, on the beds and the picnic table. In summer a paddling pool with a rubber
// duck and a beach umbrella in the same corner. Autumn's leaves and spring's petals lie about the deck, and the little
// trees turn or blossom. A few draw calls in each season, nothing out of it.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { TOON_RAMP } from '../haze';
import { HALF_D } from '../layout';
import { toon } from '../materials';
import { boxesGeometry } from '../shapes';
import { DECKING, FIRE, ROOF_EDGE } from '../roof/roofLayout';
import { FairyLights, GlowHalos, glowMaterial, mergeParts, mulberry, newParts, painted, paintMaterial, pumpkin, snowman, useParts, wreath, type Parts } from './kit';
import { DOOR_PUMPKINS, DOOR_WREATHS, parapetLights, POOL, ROOF_CROWNS, ROOF_LEAF_BALLS, ROOF_TOP_PUMPKINS, roofSnow, SNOWMAN, TANK_CAP, UMBRELLA } from './seasonLayout';
import { useSeason } from './seasonState';

const { x: X, z: Z } = ROOF_EDGE;
const SNOW = '#f4f8ff';

// ---------- the snow ----------

let snowTex: THREE.CanvasTexture | null = null;
/** The snow lying on the deck, as coverage in its alpha: drifts by the parapet, bare round the fire, trodden by the door. */
function snowTexture() {
  if (snowTex) return snowTex;
  const W = 512;
  const H = Math.round((W * Z) / X);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const px = (x: number) => ((x + X) / (2 * X)) * W;
  const pz = (z: number) => ((z + Z) / (2 * Z)) * H;
  const m = W / (2 * X); // pixels a metre
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillRect(0, 0, W, H);
  const r = mulberry(31);
  // takes `amount` of the snow away at the middle of a disc, fading out to its edge (the material cuts out below half)
  const melt = (x: number, z: number, rad: number, amount: number, solid = false) => {
    const g = ctx.createRadialGradient(px(x), pz(z), 0, px(x), pz(z), rad * m);
    g.addColorStop(0, `rgba(0,0,0,${amount})`);
    g.addColorStop(solid ? 0.8 : 0, `rgba(0,0,0,${amount})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px(x), pz(z), rad * m, 0, Math.PI * 2);
    ctx.fill();
  };
  // bare patches here and there, more of them down the middle where people walk
  for (let i = 0; i < 60; i++) melt((r() * 2 - 1) * (X - 2), (r() * 2 - 1) * (Z - 2), 0.5 + r() * 1.5, 0.9);
  for (let z = -Z + 2; z < Z; z += 0.8) melt((r() - 0.5) * 2.4, z, 0.6 + r() * 0.7, 0.75);
  // the fire melts its circle, and the door's threshold is trodden clear
  melt(FIRE.x, FIRE.z, 4.4, 1, true);
  melt(0, HALF_D, 2.2, 1, true);
  // deeper along the parapet, where it drifts
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(255,255,255,1)';
  const edge = 0.9 * m;
  ctx.fillRect(0, 0, W, edge);
  ctx.fillRect(0, 0, edge, H);
  ctx.fillRect(W - edge, 0, edge, H);
  ctx.fillRect(0, H - edge * 0.6, W, edge * 0.6);
  snowTex = new THREE.CanvasTexture(c);
  snowTex.anisotropy = 4;
  return snowTex;
}

let snowMat: THREE.MeshToonMaterial | null = null;
const snowMaterial = () => (snowMat ??= new THREE.MeshToonMaterial({ color: SNOW, map: snowTexture(), alphaTest: 0.5, gradientMap: TOON_RAMP }));

function RoofSnow({ snowmanToo }: { snowmanToo: boolean }) {
  const geo = useMemo(() => {
    const layer = new THREE.PlaneGeometry(2 * X, 2 * Z).rotateX(-Math.PI / 2).translate(0, 0.075, 0);
    const caps: THREE.BufferGeometry[] = [new THREE.ConeGeometry(TANK_CAP.r * 0.82, 0.55, 24).translate(TANK_CAP.x, TANK_CAP.y + 0.62, TANK_CAP.z)];
    // a white cap on each little tree's crown
    for (const c of ROOF_CROWNS) caps.push(new THREE.SphereGeometry(c.r * 1.04, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.36).translate(c.x, c.y + 0.02, c.z));
    return { layer, ledges: boxesGeometry(roofSnow()), caps: mergeParts(caps) };
  }, []);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  const man = useParts(() => {
    const p = newParts();
    if (snowmanToo) snowman(p, [SNOWMAN.x, 0.07, SNOWMAN.z], SNOWMAN.yaw);
    return p;
  }, [snowmanToo]);
  return (
    <group>
      <mesh geometry={geo.layer} material={snowMaterial()} receiveShadow />
      <mesh geometry={geo.ledges} material={toon(SNOW)} receiveShadow />
      <mesh geometry={geo.caps} material={toon(SNOW)} />
      {snowmanToo && <mesh geometry={man.lit} material={paintMaterial()} castShadow receiveShadow />}
    </group>
  );
}

// ---------- the festive and the summery ----------

/** Paints each triangle of `g` (made unindexed) one of `colors` by the wedge of the circle round y it sits in. */
function striped(g: THREE.BufferGeometry, colors: string[], wedges: number): THREE.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  const pos = flat.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const cs = colors.map((c) => new THREE.Color(c));
  for (let t = 0; t < pos.count; t += 3) {
    const x = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
    const z = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
    const k = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * wedges) % wedges;
    const c = cs[k % cs.length];
    for (let v = 0; v < 3; v++) col.set([c.r, c.g, c.b], (t + v) * 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return flat;
}

function summerParts(p: Parts) {
  const { x, z, r, h } = POOL;
  p.lit.push(painted(new THREE.TorusGeometry(r - 0.17, 0.17, 10, 32).rotateX(Math.PI / 2).translate(x, 0.17, z), '#3a86ff'));
  p.lit.push(painted(new THREE.TorusGeometry(r - 0.16, 0.15, 10, 32).rotateX(Math.PI / 2).translate(x, h + 0.02, z), '#f1faee'));
  p.lit.push(painted(new THREE.CylinderGeometry(r - 0.2, r - 0.2, 0.04, 32).translate(x, h - 0.06, z), '#7fd8f6'));
  // a rubber duck afloat
  p.lit.push(painted(new THREE.SphereGeometry(0.13, 12, 8).scale(1.25, 0.85, 1).translate(x + 0.3, h + 0.02, z - 0.2), '#ffd60a'));
  p.lit.push(painted(new THREE.SphereGeometry(0.08, 10, 8).translate(x + 0.4, h + 0.15, z - 0.2), '#ffd60a'));
  p.lit.push(painted(new THREE.ConeGeometry(0.03, 0.08, 6).rotateZ(-Math.PI / 2).translate(x + 0.5, h + 0.14, z - 0.2), '#f77f00'));
  // the umbrella: a pole, a striped canopy and a finial; a beach ball beside the pool
  const u = UMBRELLA;
  p.lit.push(painted(new THREE.CylinderGeometry(0.035, 0.035, u.h + 0.1, 8).translate(u.x, (u.h + 0.1) / 2, u.z), '#f1faee'));
  p.lit.push(painted(new THREE.CylinderGeometry(0.22, 0.26, 0.08, 12).translate(u.x, 0.04, u.z), '#495057'));
  p.lit.push(striped(new THREE.ConeGeometry(u.r, 0.55, 16, 1, true).translate(0, u.h, 0), ['#ef476f', '#fefae0'], 16).translate(u.x, 0, u.z));
  p.lit.push(painted(new THREE.SphereGeometry(0.05, 8, 6).translate(u.x, u.h + 0.3, u.z), '#ef476f'));
  p.lit.push(striped(new THREE.SphereGeometry(0.2, 16, 10), ['#ef476f', '#ffd166', '#118ab2', '#f1faee'], 8).translate(x + 1.9, 0.2, z - 1.0));
}

function christmasParts(p: Parts) {
  // wreaths on the hut, either side of the sign over the elevator's doors
  for (const x of DOOR_WREATHS.xs) wreath(p, [x, DOOR_WREATHS.y, DOOR_WREATHS.z], DOOR_WREATHS.r);
}

/** Where the roof's pumpkins' candles glow: in front of the carved faces. */
const ROOF_CANDLES: [number, number, number][] = [
  ...DOOR_PUMPKINS.map((q): [number, number, number] => [q.x, q.r * 0.8, q.z - q.r * 0.9]),
  ...ROOF_TOP_PUMPKINS.filter((_, i) => i % 2 === 0).map((q): [number, number, number] => [q.x, q.y + q.r * 0.8, q.z + q.r * 0.9]),
];

function pumpkinParts(p: Parts) {
  for (const q of DOOR_PUMPKINS) pumpkin(p, [q.x, 0, q.z], q.r, Math.PI + q.x * 0.15);
  ROOF_TOP_PUMPKINS.forEach((q, i) => pumpkin(p, [q.x, q.y, q.z], q.r, 0.3 * (i - 1), i % 2 === 0));
}

// ---------- what lies about: autumn's leaves, spring's petals, and the trees' tops ----------

const LEAVES = ['#e07a2f', '#c8442f', '#f2b632', '#b5652b', '#d9922e'];
const PETALS = ['#f7b6d2', '#fcd5e5', '#ffffff', '#f4a7c8'];

/** Leaves (or petals) lying about the deck, thickest round the trees and along the parapet; and the trees' tops turned. */
function litterParts(p: Parts, colors: string[], size: number, count: number, crowns: string[] | null) {
  const r = mulberry(colors.length * 17 + count);
  const c = new THREE.Color();
  const spots = [...ROOF_CROWNS.map((t) => ({ x: t.x, z: t.z, s: 1.6 })), { x: 0, z: 0, s: 14 }];
  for (let i = 0; i < count; i++) {
    const s = spots[i % 3 === 0 ? Math.floor(r() * ROOF_CROWNS.length) : ROOF_CROWNS.length];
    let x = s.x + (r() * 2 - 1) * s.s;
    let z = s.z + (r() * 2 - 1) * s.s * 0.8;
    // some blown against the parapet
    if (i % 5 === 0) z = -Z + 0.45 + r() * 0.5;
    x = Math.max(-X + 0.4, Math.min(X - 0.4, x));
    z = Math.max(-Z + 0.4, Math.min(Z - 0.4, z));
    const y = x > DECKING.minX && x < DECKING.maxX && z > DECKING.minZ && z < DECKING.maxZ ? 0.066 : 0.008;
    c.set(colors[Math.floor(r() * colors.length)]);
    p.lit.push(painted(new THREE.CircleGeometry(size * (0.7 + r() * 0.6), 5).scale(1, 0.6, 1).rotateX(-Math.PI / 2).rotateY(r() * Math.PI * 2).translate(x, y + i * 0.00002, z), c));
  }
  // the trees' crowns turned (or in bloom): a coat over each ball of leaves, and a few puffs of another colour on top
  if (crowns)
    [...ROOF_CROWNS, ...ROOF_LEAF_BALLS].forEach((t, i) => {
      p.lit.push(painted(new THREE.SphereGeometry(t.r * 1.05, 14, 10).translate(t.x, t.y, t.z), crowns[i % crowns.length]));
      for (let k = 0; k < 3; k++) {
        const a = r() * Math.PI * 2;
        p.lit.push(painted(new THREE.SphereGeometry(t.r * (0.32 + r() * 0.12), 10, 8).translate(t.x + Math.cos(a) * t.r * 0.8, t.y + t.r * (0.2 + r() * 0.5), t.z + Math.sin(a) * t.r * 0.8), crowns[(i + k + 1) % crowns.length]));
      }
    });
}

function Painted({ build, deps }: { build: (p: Parts) => void; deps: readonly unknown[] }) {
  const geo = useParts(() => {
    const p = newParts();
    build(p);
    return p;
  }, deps);
  return (
    <group>
      <mesh geometry={geo.lit} material={paintMaterial()} castShadow receiveShadow />
      <mesh geometry={geo.glow} material={glowMaterial()} />
    </group>
  );
}

/** The roof's seasonal things, or nothing out of season. */
export function RoofSeason() {
  const snow = useSeason((l) => l.snowCover);
  const christmas = useSeason((l) => l.christmas);
  const pumpkins = useSeason((l) => l.pumpkins);
  const summer = useSeason((l) => l.summer);
  const foliage = useSeason((l) => l.foliage);
  const lights = useMemo(() => (christmas ? parapetLights() : []), [christmas]);
  return (
    <group>
      {snow > 0 && <RoofSnow snowmanToo={snow > 0.5} />}
      {christmas && (
        <>
          <Painted build={christmasParts} deps={[]} />
          <FairyLights at={lights} size={0.04} halo={0.38} />
        </>
      )}
      {pumpkins && (
        <>
          <Painted build={pumpkinParts} deps={[]} />
          <GlowHalos at={ROOF_CANDLES} color="#ff9a2e" size={0.8} />
        </>
      )}
      {summer && <Painted build={summerParts} deps={[]} />}
      {foliage === 'autumn' && <Painted build={(p) => litterParts(p, LEAVES, 0.1, 160, ['#e07a2f', '#f2b632', '#c8442f'])} deps={['autumn']} />}
      {foliage === 'blossom' && <Painted build={(p) => litterParts(p, PETALS, 0.045, 140, ['#f7b6d2', '#fcd5e5', '#ffffff'])} deps={['blossom']} />}
    </group>
  );
}
