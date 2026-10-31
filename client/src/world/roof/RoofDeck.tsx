// The roof itself: the paving, the lounge's decking and the warm stone circle round the fire, the parapet with its glass
// railing all round, the hut over the elevator and the stairs (the elevator's doors and cabin are Elevator.tsx's, as on
// every floor), and the building under it all (BuildingBelow.tsx). Static, merged into a few meshes by material.
// Adapted from cubefarm client/src/world/roof/RoofDeck.tsx (MIT): the helipad, the windsock and the night bulbs are cut;
// the railing is glazed like the balconies', and the stone circle is new.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { ELEVATOR, HALF_D } from '../layout';
import { toon, toonMap } from '../materials';
import { INK, Outlines } from '../Outlines';
import { boxesGeometry, type BoxSpec } from '../shapes';
import { paneMaterial } from '../Shell';
import { BuildingBelow } from './BuildingBelow';
import { DECKING, FIRE, ROOF_EDGE, ROOF_HUT } from './roofLayout';
import { deckingTexture, pavingTexture } from './textures';

const { x: X, z: Z, t: T, parapet: P, h: H } = ROOF_EDGE;
const HUT = ROOF_HUT;
const PAVER = 1.2; // metres per paving texture repeat (and per decking repeat)
/** The stone circle under the fire's lounge: its radius and its darker rim's width. */
const CIRCLE = { r: 3.45, rim: 0.2 };

/** A plane lying flat at height y, its UVs in units of `per` metres so a repeating texture keeps its scale. */
function flat(w: number, d: number, per: number) {
  const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / per, (uv.getY(i) * d) / per);
  return g;
}

/** The parapet's runs round the edge (south: either side of the hut), as [x0, x1, z0, z1]. */
const RUNS: [number, number, number, number][] = [
  [-X, X, -Z, -Z + T],
  [-X, -X + T, -Z + T, Z - T],
  [X - T, X, -Z + T, Z - T],
  [-X, HUT.minX, Z - T, Z],
  [HUT.maxX, X, Z - T, Z],
];

/** The parapet, its cap and the cornice under the deck's edge, the railing's posts and rails, and its glass. */
function edgeGeometry() {
  const wall: BoxSpec[] = [];
  const cap: BoxSpec[] = [
    // the cornice: a band round the top of the building, just under the deck
    { size: [2 * X + 0.16, 0.3, 0.08], at: [0, -0.15, -Z - 0.04] },
    { size: [2 * X + 0.16, 0.3, 0.08], at: [0, -0.15, Z + 0.04] },
    { size: [0.08, 0.3, 2 * Z], at: [-X - 0.04, -0.15, 0] },
    { size: [0.08, 0.3, 2 * Z], at: [X + 0.04, -0.15, 0] },
  ];
  const metal: BoxSpec[] = [];
  const glass: BoxSpec[] = [];
  for (const [x0, x1, z0, z1] of RUNS) {
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    wall.push({ size: [w, P, d], at: [cx, P / 2, cz] });
    cap.push({ size: [w + 0.06, 0.07, d + 0.06], at: [cx, P + 0.035, cz] });
    // posts along the parapet's middle, a handrail on top, and glass between them
    const along = w > d;
    const len = along ? w : d;
    const n = Math.max(1, Math.round(len / 1.6));
    for (let k = 0; k <= n; k++) {
      const u = -len / 2 + (k * len) / n;
      metal.push({ size: [0.06, H - P, 0.06], at: [along ? cx + u : cx, P + (H - P) / 2, along ? cz : cz + u] });
    }
    metal.push({ size: along ? [w, 0.07, 0.09] : [0.09, 0.07, d], at: [cx, H, cz] });
    const paneH = H - P - 0.1;
    glass.push({ size: along ? [w, paneH, 0.03] : [0.03, paneH, d], at: [cx, P + 0.07 + paneH / 2, cz] });
  }
  return { wall: boxesGeometry(wall), cap: boxesGeometry(cap), metal: boxesGeometry(metal), glass: boxesGeometry(glass) };
}

const STAIR_DOOR = { half: 0.5, h: 2.2 };

/** The hut: its front round the elevator's doorway and the stairs' door, its sides and back down the building as the shaft. */
function hutGeometry(elevation: number) {
  const { doorHalf, doorHeight } = ELEVATOR;
  const f = HUT.front;
  const zf = HALF_D + f / 2;
  const s0 = HUT.stairX - STAIR_DOOR.half;
  const s1 = HUT.stairX + STAIR_DOOR.half;
  const piece = (x0: number, x1: number, y0: number, y1: number): BoxSpec => ({ size: [x1 - x0, y1 - y0, f], at: [(x0 + x1) / 2, (y0 + y1) / 2, zf] });
  const walls: BoxSpec[] = [
    piece(HUT.minX, s0, 0, HUT.h),
    piece(s0, s1, STAIR_DOOR.h, HUT.h),
    piece(s1, -doorHalf, 0, HUT.h),
    piece(-doorHalf, doorHalf, doorHeight, HUT.h),
    piece(doorHalf, HUT.maxX, 0, HUT.h),
    // sides and back: they carry on down the building as the shaft
    { size: [0.25, HUT.h + elevation, HUT.maxZ - HALF_D], at: [HUT.minX + 0.125, (HUT.h - elevation) / 2, (HALF_D + HUT.maxZ) / 2] },
    { size: [0.25, HUT.h + elevation, HUT.maxZ - HALF_D], at: [HUT.maxX - 0.125, (HUT.h - elevation) / 2, (HALF_D + HUT.maxZ) / 2] },
    { size: [HUT.maxX - HUT.minX, HUT.h + elevation, 0.25], at: [(HUT.minX + HUT.maxX) / 2, (HUT.h - elevation) / 2, HUT.maxZ - 0.125] },
  ];
  const roof: BoxSpec[] = [
    { size: [HUT.maxX - HUT.minX + 0.3, 0.2, HUT.maxZ - HALF_D + 0.3], at: [(HUT.minX + HUT.maxX) / 2, HUT.h + 0.1, (HALF_D + HUT.maxZ) / 2] },
    { size: [1.4, 0.7, 1.1], at: [HUT.minX + 1.4, HUT.h + 0.55, HUT.maxZ - 1] }, // the lift's machine-room vent
    { size: [0.9, 0.5, 0.9], at: [HUT.maxX - 0.9, HUT.h + 0.45, HALF_D + 0.9] }, // an air-con unit
  ];
  const trim: BoxSpec[] = [
    { size: [HUT.maxX - HUT.minX + 0.04, 0.22, 0.04], at: [(HUT.minX + HUT.maxX) / 2, HUT.h - 0.5, HALF_D - 0.02] }, // a band round the top
    { size: [0.08, STAIR_DOOR.h + 0.08, 0.08], at: [s0 - 0.04, STAIR_DOOR.h / 2, HALF_D - 0.02] }, // the stair door's frame
    { size: [0.08, STAIR_DOOR.h + 0.08, 0.08], at: [s1 + 0.04, STAIR_DOOR.h / 2, HALF_D - 0.02] },
    { size: [STAIR_DOOR.half * 2 + 0.16, 0.08, 0.08], at: [HUT.stairX, STAIR_DOOR.h + 0.04, HALF_D - 0.02] },
    { size: [0.05, 1.6, 0.05], at: [HUT.maxX - 0.6, HUT.h + 0.2 + 0.8, HALF_D + 0.5] }, // an aerial
  ];
  const door: BoxSpec[] = [{ size: [STAIR_DOOR.half * 2, STAIR_DOOR.h, 0.05], at: [HUT.stairX, STAIR_DOOR.h / 2, HALF_D + 0.06] }];
  const handle: BoxSpec[] = [
    { size: [0.05, 0.05, 0.08], at: [HUT.stairX + STAIR_DOOR.half - 0.14, 1.05, HALF_D] },
    { size: [0.5, 0.04, 0.04], at: [HUT.stairX, 1.0, HALF_D + 0.01] }, // a push bar
    { size: [0.3, 0.14, 0.12], at: [HUT.stairX, STAIR_DOOR.h + 0.35, HALF_D - 0.06] }, // the lamp over the door
  ];
  return { walls: boxesGeometry(walls), roof: boxesGeometry(roof), trim: boxesGeometry(trim), door: boxesGeometry(door), handle: boxesGeometry(handle) };
}

/** The deck, the parapet, the hut and the building underneath, `elevation` above the street. */
export function RoofDeck({ elevation }: { elevation: number }) {
  const ground = useMemo(() => {
    const deckW = DECKING.maxX - DECKING.minX;
    const deckD = DECKING.maxZ - DECKING.minZ;
    const decking = new THREE.BoxGeometry(deckW, 0.06, deckD);
    // the top face's UVs in metres, so the boards keep their width
    const uv = decking.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * deckW) / PAVER, (uv.getY(i) * deckD) / PAVER);
    decking.translate((DECKING.minX + DECKING.maxX) / 2, 0.03, (DECKING.minZ + DECKING.maxZ) / 2);
    return {
      paving: flat(2 * X, 2 * Z, PAVER),
      decking,
      circle: new THREE.CircleGeometry(CIRCLE.r, 48).rotateX(-Math.PI / 2).translate(FIRE.x, 0.012, FIRE.z),
      rim: new THREE.RingGeometry(CIRCLE.r, CIRCLE.r + CIRCLE.rim, 48).rotateX(-Math.PI / 2).translate(FIRE.x, 0.01, FIRE.z),
    };
  }, []);
  const edge = useMemo(edgeGeometry, []);
  const hut = useMemo(() => hutGeometry(elevation), [elevation]);
  useEffect(() => () => [...Object.values(ground), ...Object.values(edge)].forEach((g) => g.dispose()), [ground, edge]);
  useEffect(() => () => Object.values(hut).forEach((g) => g.dispose()), [hut]);

  return (
    <group>
      <mesh geometry={ground.paving} material={toonMap('roof-paving', pavingTexture())} receiveShadow />
      <mesh geometry={ground.decking} material={toonMap('roof-decking', deckingTexture())} receiveShadow />
      <mesh geometry={ground.circle} material={toon('#d9c3a5')} receiveShadow />
      <mesh geometry={ground.rim} material={toon('#a8927a')} receiveShadow />
      <mesh geometry={edge.wall} material={toon('#c9c2b4')} receiveShadow castShadow>
        <Outlines thickness={0.02} color={INK} />
      </mesh>
      <mesh geometry={edge.cap} material={toon('#ece6da')} receiveShadow />
      <mesh geometry={edge.metal} material={toon('#5c677d')} castShadow />
      <mesh geometry={edge.glass} material={paneMaterial('above')} renderOrder={1} />
      <mesh geometry={hut.walls} material={toon('#efe3cc')} receiveShadow castShadow>
        <Outlines thickness={0.02} color={INK} />
      </mesh>
      <mesh geometry={hut.roof} material={toon('#8d99ae')} castShadow receiveShadow>
        <Outlines thickness={0.02} color={INK} />
      </mesh>
      <mesh geometry={hut.trim} material={toon('#ff8a5b')} />
      <mesh geometry={hut.door} material={toon('#2a9d8f')} />
      <mesh geometry={hut.handle} material={toon('#dee2e6')} />
      <BuildingBelow elevation={elevation} />
    </group>
  );
}
