// The deck chairs on the decking: striped canvas slung on wooden frames, facing north over the garden to the city, with
// little round tables between them. Visitors on a roof break (RoofPeople.tsx) lean back in them. Three draw calls for
// all of it.
// Adapted from cubefarm client/src/world/roof/DeckChairs.tsx (MIT): sitting in one yourself (the perch), its creak and
// the probe are cut.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { toon, toonMap } from '../materials';
import { INK, Outlines } from '../Outlines';
import { merged } from '../shapes';
import { DECK_CHAIRS, SIDE_TABLES } from './roofLayout';
import { stripeTexture } from './textures';

type V3 = [number, number, number];

const COLOURS = ['#e63946', '#3a86ff', '#ffb703', '#2a9d8f'];
// Chair-space (origin on the deck under the sitter's hips, facing −z): the canvas hangs from the front bar down to the
// low point of the seat and up to the top bar, tipped back RECLINE from upright.
/** How far back a deck chair (and whoever sits in it) leans, radians. */
export const RECLINE = 0.45;
const SEAT_LOW: V3 = [0, 0.22, 0.12];
const FRONT_BAR: V3 = [0, 0.45, -0.42];
const TOP_BAR: V3 = [0, SEAT_LOW[1] + 0.86 * Math.cos(RECLINE + 0.05), SEAT_LOW[2] + 0.86 * Math.sin(RECLINE + 0.05)];
const HALF = 0.28; // half the canvas's width
const SIDE = 0.31; // the frame's sides

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** A square bar `t` thick from a to b. */
function bar(a: V3, b: V3, t = 0.045) {
  const from = new THREE.Vector3(...a);
  const to = new THREE.Vector3(...b);
  const dir = to.clone().sub(from);
  const g = new THREE.BoxGeometry(t, t, dir.length());
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

/** A strip of canvas from a to b, HALF either side, striped across and tinted `colour`. */
function sling(a: V3, b: V3, colour: THREE.Color) {
  const g = new THREE.BufferGeometry();
  const p = [a[0] - HALF, a[1], a[2], a[0] + HALF, a[1], a[2], b[0] - HALF, b[1], b[2], b[0] + HALF, b[1], b[2]];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: 4 }, () => [colour.r, colour.g, colour.b]).flat(), 3));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  g.computeVertexNormals();
  return g;
}

function chairsGeometry() {
  const frame: THREE.BufferGeometry[] = [];
  const canvas: THREE.BufferGeometry[] = [];
  DECK_CHAIRS.xs.forEach((x, i) => {
    const z = DECK_CHAIRS.z + 0.05; // the seat, where its sitter sits (roofLayout.ts ROOF_SEATS)
    const at = (v: V3): V3 => [v[0] + x, v[1], v[2] + z];
    for (const sx of [-SIDE, SIDE]) {
      const o: V3 = [sx, 0, 0];
      frame.push(bar(at(add(FRONT_BAR, o)), at(add(SEAT_LOW, o))));
      frame.push(bar(at(add(SEAT_LOW, o)), at(add(TOP_BAR, o))));
      frame.push(bar(at([sx, 0, FRONT_BAR[2]]), at([sx, FRONT_BAR[1] + 0.02, FRONT_BAR[2]]))); // front leg
      frame.push(bar(at([sx, 0, 0.62]), at([sx, 0.64, 0.34]))); // the back strut
      frame.push(bar(at([sx * 1.07, 0.56, -0.48]), at([sx * 1.07, 0.56, 0.2]), 0.07)); // armrest
      frame.push(bar(at([sx * 1.07, 0.56, -0.44]), at([sx, 0.3, -0.42]))); // its support
    }
    frame.push(bar(at([-SIDE, TOP_BAR[1], TOP_BAR[2]]), at([SIDE, TOP_BAR[1], TOP_BAR[2]]), 0.06));
    frame.push(bar(at([-SIDE, FRONT_BAR[1], FRONT_BAR[2]]), at([SIDE, FRONT_BAR[1], FRONT_BAR[2]]), 0.06));
    const c = new THREE.Color(COLOURS[i % COLOURS.length]);
    canvas.push(sling(at(FRONT_BAR), at(SEAT_LOW), c), sling(at(SEAT_LOW), at(TOP_BAR), c));
  });
  const tables = merged(
    SIDE_TABLES.flatMap((t) => [
      new THREE.CylinderGeometry(t.r, t.r, 0.05, 20).translate(t.x, 0.55, t.z),
      new THREE.CylinderGeometry(0.04, 0.05, 0.53, 8).translate(t.x, 0.27, t.z),
      new THREE.CylinderGeometry(0.2, 0.22, 0.03, 16).translate(t.x, 0.075, t.z),
    ]),
  );
  return { frame: merged(frame), canvas: merged(canvas), tables };
}

/** The striped canvas, tinted per chair by its vertex colours, seen from both sides. */
function canvasMaterial() {
  const m = toonMap('roof-deckchair-canvas', stripeTexture());
  if (!m.vertexColors) {
    m.vertexColors = true;
    m.side = THREE.DoubleSide;
    m.needsUpdate = true;
  }
  return m;
}

export function DeckChairs() {
  const geo = useMemo(chairsGeometry, []);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  return (
    <group>
      <mesh geometry={geo.frame} material={toon('#c08552')} castShadow>
        <Outlines thickness={0.012} color={INK} />
      </mesh>
      <mesh geometry={geo.canvas} material={canvasMaterial()} castShadow receiveShadow />
      <mesh geometry={geo.tables} material={toon('#e9ecef')} castShadow receiveShadow />
    </group>
  );
}
