// The lobby in its season (Lobby.tsx mounts it; seasonLayout.ts has where): through December a Christmas tree in the
// south-west with its lights on all day, baubles, a star and presents under it, and a wreath over the elevator's doors;
// for Halloween jack-o'-lanterns by the elevator and on the front desk, grinning brighter as the lamps come on; heart
// balloons at the front desk on Valentine's Day. Each is one lit and one glowing mesh (two draw calls), plus the tree's
// fairy lights (two more), and nothing at all out of season.
import { useMemo } from 'react';
import * as THREE from 'three';
import { RECEPTION } from '../layout';
import { christmasTree, FairyLights, GlowHalos, glowMaterial, heartBalloon, newParts, painted, paintMaterial, present, pumpkin, useParts, wreath, type Parts } from './kit';
import { DOOR_PUMPKINS, DOOR_WREATHS, LEDGE_PUMPKINS, XMAS_TREE } from './seasonLayout';
import { useSeason } from './seasonState';

const PRESENTS: [number, number, number, number, string, string][] = [
  // angle round the tree, distance out, width, height, paper, ribbon
  [0.3, 1.05, 0.42, 0.3, '#e63946', '#ffd166'],
  [1.2, 1.15, 0.34, 0.42, '#3a86ff', '#f1faee'],
  [2.1, 1.0, 0.5, 0.26, '#2a9d8f', '#e63946'],
  [3.3, 1.1, 0.3, 0.3, '#ffd166', '#9b5de5'],
  [4.2, 1.05, 0.46, 0.36, '#f1faee', '#e63946'],
  [5.3, 1.12, 0.36, 0.24, '#9b5de5', '#ffd166'],
];

/** The tree, its skirt and presents; returns where the tree's lights go. */
function christmasParts(p: Parts) {
  const lights = christmasTree(p, [XMAS_TREE.x, 0, XMAS_TREE.z], XMAS_TREE.h, 7);
  p.lit.push(painted(new THREE.CircleGeometry(1.25, 28).rotateX(-Math.PI / 2).translate(XMAS_TREE.x, 0.012, XMAS_TREE.z), '#c1121f'));
  p.lit.push(painted(new THREE.RingGeometry(1.25, 1.36, 28).rotateX(-Math.PI / 2).translate(XMAS_TREE.x, 0.013, XMAS_TREE.z), '#f8f9fa'));
  for (const [a, out, w, h, paper, ribbon] of PRESENTS) present(p, [XMAS_TREE.x + Math.cos(a) * out, 0.014, XMAS_TREE.z + Math.sin(a) * out], w, h, a * 1.7, paper, ribbon);
  return lights;
}

function ChristmasCorner() {
  const geo = useParts(() => {
    const p = newParts();
    christmasParts(p);
    return p;
  }, []);
  // the wreaths go with the south wall when the overview cuts it away
  const wreaths = useParts(() => {
    const p = newParts();
    for (const x of DOOR_WREATHS.xs) wreath(p, [x, DOOR_WREATHS.y, DOOR_WREATHS.z], DOOR_WREATHS.r);
    return p;
  }, []);
  const lights = useMemo(() => {
    const p = newParts();
    const at = christmasParts(p);
    for (const g of [...p.lit, ...p.glow]) g.dispose();
    return at;
  }, []);
  return (
    <group>
      <mesh geometry={geo.lit} material={paintMaterial()} castShadow receiveShadow />
      <mesh geometry={geo.glow} material={glowMaterial()} />
      <mesh geometry={wreaths.lit} material={paintMaterial('room')} />
      <FairyLights at={lights} min={0.65} halo={0.32} />
    </group>
  );
}

const LEDGE_Z = RECEPTION.z + RECEPTION.d / 2 - 0.15;
/** Where the pumpkins' candles glow: in front of their faces. */
const CANDLES: [number, number, number][] = [
  ...DOOR_PUMPKINS.map((q): [number, number, number] => [q.x, q.r * 0.8, q.z - q.r * 0.9]),
  ...LEDGE_PUMPKINS.xs.map((dx, i): [number, number, number] => [RECEPTION.x + dx, LEDGE_PUMPKINS.y + 0.1, LEDGE_Z + 0.12 + i * 0.02]),
];

function Pumpkins() {
  const geo = useParts(() => {
    const p = newParts();
    for (const q of DOOR_PUMPKINS) pumpkin(p, [q.x, 0, q.z], q.r, Math.PI + q.x * 0.15);
    LEDGE_PUMPKINS.xs.forEach((dx, i) => pumpkin(p, [RECEPTION.x + dx, LEDGE_PUMPKINS.y, LEDGE_Z], 0.12 + i * 0.02, (i - 0.5) * 0.4));
    return p;
  }, []);
  return (
    <group>
      <mesh geometry={geo.lit} material={paintMaterial()} castShadow />
      <mesh geometry={geo.glow} material={glowMaterial()} />
      <GlowHalos at={CANDLES} color="#ff9a2e" size={0.7} />
    </group>
  );
}

const HEARTS: [number, number, string, number][] = [
  // along the ledge, how high, colour, tilt
  [-2.0, 1.25, '#ff4d6d', -0.15],
  [-1.85, 1.05, '#ff8fab', 0.2],
  [2.05, 1.2, '#ff4d6d', 0.1],
  [1.9, 0.95, '#ffb3c6', -0.2],
];

function Hearts() {
  const geo = useParts(() => {
    const p = newParts();
    const z = RECEPTION.z + RECEPTION.d / 2 - 0.15;
    for (const [dx, top, c, tilt] of HEARTS) heartBalloon(p, [RECEPTION.x + dx, 1.11, z], top, c, tilt);
    return p;
  }, []);
  return <mesh geometry={geo.lit} material={paintMaterial()} castShadow />;
}

/** The lobby's seasonal things, or nothing out of season. */
export function LobbySeason() {
  const christmas = useSeason((l) => l.christmas);
  const pumpkins = useSeason((l) => l.pumpkins);
  const hearts = useSeason((l) => l.hearts);
  return (
    <group>
      {christmas && <ChristmasCorner />}
      {pumpkins && <Pumpkins />}
      {hearts && <Hearts />}
    </group>
  );
}
