// The building under the roof: its outer walls down to the street with every storey's windows, the balconies along the
// west and east sides with the canopy over the highest ones (the lobby's patio on the ground), so from the parapet you
// look down the building you're on. The elevator's shaft down the south side is the hut's (RoofDeck.tsx). Static and
// merged: five draw calls.
// Adapted from cubefarm client/src/world/Outside.tsx (MIT): BuildingBelow, with Marshmallow's balconies and facade
// (client/src/world/Outside.tsx); the balcony furniture and lamps are cut.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { drawFacade } from '../draw';
import { BALCONY, BALCONY_OUT, FLOOR_HEIGHT, HALF_D, HALF_W, SIDES, WALL_H, WALL_T, WINDOW, sideSign } from '../layout';
import { toon, toonMap } from '../materials';
import { boxesGeometry, merged, type BoxSpec } from '../shapes';
import { paneMaterial } from '../Shell';

const DEEP = BALCONY_OUT - HALF_W; // a slab, from under the doorway to the railing's outside
const LEN = BALCONY.maxZ - BALCONY.minZ;
const MID_Z = (BALCONY.minZ + BALCONY.maxZ) / 2;
const IN = HALF_W + WALL_T;
const BAY = 5; // the facade's window repeat along the walls, metres

/**
 * The balconies of every storey below the roof (`roof` storeys up): a slab, glass and rails on each side; the patio on
 * the ground; and at the roof's own level just the slab, the canopy over the storey below's.
 */
function balconyGeometry(roof: number) {
  const { rail, railT, slab, minZ, maxZ, depth } = BALCONY;
  const slabs: BoxSpec[] = [];
  const patio: BoxSpec[] = [];
  const glass: BoxSpec[] = [];
  const rails: BoxSpec[] = [];
  for (let f = 0; f <= roof; f++) {
    const y = (f - roof) * FLOOR_HEIGHT;
    for (const side of SIDES) {
      const s = sideSign(side);
      (f === 0 ? patio : slabs).push({ size: [DEEP, slab, LEN], at: [s * (HALF_W + DEEP / 2), y - slab / 2, MID_Z] });
      if (f === roof) continue;
      const out = s * (BALCONY_OUT - railT / 2);
      const across = s * (IN + (depth - railT) / 2);
      const paneH = rail - 0.14;
      glass.push({ size: [0.03, paneH, LEN - railT * 2], at: [out, y + 0.06 + paneH / 2, MID_Z] });
      rails.push({ size: [railT + 0.03, 0.07, LEN], at: [out, y + rail - 0.035, MID_Z] });
      for (const z of [minZ + railT / 2, maxZ - railT / 2]) {
        glass.push({ size: [depth - railT, paneH, 0.03], at: [across, y + 0.06 + paneH / 2, z] });
        rails.push({ size: [depth, 0.07, railT + 0.03], at: [s * (IN + depth / 2), y + rail - 0.035, z] });
        for (const x of [IN + 0.05, IN + depth / 2]) rails.push({ size: [0.07, rail, 0.07], at: [s * x, y + rail / 2, z] });
      }
      for (let k = 0; k <= 10; k++) rails.push({ size: [0.07, rail, 0.07], at: [out, y + rail / 2, minZ + railT / 2 + (k * (LEN - railT)) / 10] });
    }
  }
  return { slabs: boxesGeometry(slabs), patio: boxesGeometry(patio), glass: boxesGeometry(glass), rails: boxesGeometry(rails) };
}

let facadeTex: THREE.CanvasTexture | null = null;
function facadeTexture() {
  if (facadeTex) return facadeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const { y, h } = WINDOW;
  drawFacade(c.getContext('2d')!, 256, 256, WALL_H / FLOOR_HEIGHT, { x0: 0.12, x1: 0.88, y0: (y - h / 2) / FLOOR_HEIGHT, y1: (y + h / 2) / FLOOR_HEIGHT });
  facadeTex = new THREE.CanvasTexture(c);
  facadeTex.colorSpace = THREE.SRGBColorSpace;
  facadeTex.wrapS = facadeTex.wrapT = THREE.RepeatWrapping;
  facadeTex.anisotropy = 8;
  return facadeTex;
}

/** The outer walls from the street up to the deck (`elevation` below it), as one textured ring. */
function facadeGeometry(elevation: number) {
  const X = HALF_W + WALL_T;
  const Z = HALF_D + WALL_T;
  const faces = [
    { len: 2 * X, rot: 0, x: 0, z: Z },
    { len: 2 * X, rot: Math.PI, x: 0, z: -Z },
    { len: 2 * Z, rot: Math.PI / 2, x: X, z: 0 },
    { len: 2 * Z, rot: -Math.PI / 2, x: -X, z: 0 },
  ];
  return merged(
    faces.map((f) => {
      const g = new THREE.PlaneGeometry(f.len, elevation);
      const uv = g.attributes.uv;
      // in metres, so the windows line up with the storeys
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * f.len) / BAY, (uv.getY(i) * elevation) / FLOOR_HEIGHT);
      return g.rotateY(f.rot).translate(f.x, -elevation / 2, f.z);
    }),
  );
}

/** Everything of the building below the deck, for a roof `elevation` above the street. */
export function BuildingBelow({ elevation }: { elevation: number }) {
  const roof = Math.round(elevation / FLOOR_HEIGHT);
  const shell = useMemo(() => balconyGeometry(roof), [roof]);
  const facade = useMemo(() => facadeGeometry(elevation), [elevation]);
  useEffect(() => () => Object.values(shell).forEach((g) => g.dispose()), [shell]);
  useEffect(() => () => facade.dispose(), [facade]);
  return (
    <group>
      <mesh geometry={facade} material={toonMap('roof-facade', facadeTexture())} />
      <mesh geometry={shell.slabs} material={toon('#d6d0c4')} />
      <mesh geometry={shell.patio} material={toon('#e3b98f')} />
      <mesh geometry={shell.rails} material={toon('#5c677d')} />
      <mesh geometry={shell.glass} material={paneMaterial('above')} renderOrder={1} />
    </group>
  );
}
