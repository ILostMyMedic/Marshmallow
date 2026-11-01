// The lobby's trophy cabinet against the west wall: the trophies the office has won, its awards (trophyShelf.ts lays
// them out, the company's on the top shelf and the floors' below, each on a plinth in its floor's colour; when there
// are more than it holds, the grandest stay), a plaque under each, and a card saying the first merge goes here while
// it's empty. E on it (or a click in the overview) lists them all (ui/TrophiesPanel.tsx). A trophy won while you're in the lobby pops confetti out of it. Seven draw calls: the cabinet
// and its ink, the glass, the trophies and their ink, the plaques and the sign (the card while empty, the confetti while
// it flies).
// Adapted from cubefarm client/src/world/decor/RewardsCorner.tsx (MIT): the trophy shelf's cups and plaques, as one
// vertex-coloured geometry, from the office database's trophies.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Moment } from '../../../shared/types';
import { useStore } from '../store';
import { confettiPop } from '../ui/sfx';
import { TROPHIES_OVERLAY } from '../ui/TrophiesPanel';
import { useCanvasTexture } from './canvasTexture';
import { drawSign, roundRect, SANS } from './draw';
import { useInteractable } from './interact';
import { TROPHIES } from './layout';
import { toon } from './materials';
import { INK, Outlines } from './Outlines';
import { momentsSince } from './reactions';
import { merged } from './shapes';
import { paint, trophiesGeometry, trophyMaterial, type Placed } from './trophyModels';
import { floorName, GONE_COLOR, plaqueLines, shelfLayout, trophyLook } from './trophyShelf';

const { x: CX, z: CZ, w: W, l: L, h: H } = TROPHIES;
/** The shelves' tops, top first: the company's, then the floors' two (the bottom one is the base). */
const SHELF_Y = [1.43, 0.78, 0.12];
const PER_SHELF = 14;
const SPACING = (L - 0.5) / PER_SHELF;
const WOOD = '#9c6b45';
const COMPANY_PLINTH = '#2b2d42';
/** The plaques: strips along the shelves' front edges, each a row of one canvas (its pixels square on the strip). */
const STRIP = { l: L - 0.12, h: 0.09 };
const PLAQUE = { w: 3072, row: Math.round((3072 * STRIP.h) / STRIP.l) };

/** Along a shelf, from the left as you face the cabinet (west, so your left is +z): the cabinet's z for slot `slot` of `of`. */
const slotZ = (slot: number, of: number) => -(slot - (of - 1) / 2) * SPACING;

/** The cabinet's wood (base, top, sides, a light back so the metal stands out, and the shelves) as one geometry. */
function cabinetGeometry() {
  const inner = H - 0.18;
  const box = (sx: number, sy: number, sz: number) => new THREE.BoxGeometry(sx, sy, sz);
  return merged([
    paint(box(W, 0.12, L), WOOD, [0, 0.06, 0]),
    paint(box(W, 0.06, L), WOOD, [0, H - 0.03, 0]),
    ...[-1, 1].map((s) => paint(box(W, inner, 0.05), WOOD, [0, 0.12 + inner / 2, s * (L / 2 - 0.025)])),
    paint(box(0.03, inner, L - 0.1), '#f3e3c3', [-W / 2 + 0.03, 0.12 + inner / 2, 0]),
    ...SHELF_Y.slice(0, 2).map((y) => paint(box(W - 0.08, 0.1, L - 0.1), '#c89f78', [-0.02, y - 0.05, 0])),
  ]);
}

/** The plaque strips, their UVs each picking its shelf's row of the canvas. */
function plaqueGeometry() {
  return merged(
    SHELF_Y.map((y, r) => {
      const g = new THREE.PlaneGeometry(STRIP.l, STRIP.h);
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setY(i, (2 - r + uv.getY(i)) / 3);
      // the base's front is flush with the cabinet, the shelves' a little back
      return g.rotateY(Math.PI / 2).translate(r === 2 ? W / 2 + 0.004 : W / 2 - 0.058, y - (r === 2 ? 0.06 : 0.05), 0);
    }),
  );
}

export function TrophyCabinet() {
  const trophies = useStore((s) => s.records.trophies);
  const floors = useStore((s) => s.floors);
  const ref = useInteractable<THREE.Group>({ id: 'trophy-cabinet', label: 'See the trophies', action: TROPHIES_OVERLAY }, 3.6);

  const { spots } = useMemo(() => shelfLayout(trophies, floors.map((f) => f.id), PER_SHELF), [trophies, floors]);
  const placed = spots.map((s) => {
    const plinth = s.trophy.floorId ? (floors.find((f) => f.id === s.trophy.floorId)?.color ?? GONE_COLOR) : COMPANY_PLINTH;
    const [who, what] = plaqueLines(s.trophy, (id) => floorName(floors, id));
    return { ...s, plinth, who, what };
  });
  // the floors change all the time; the trophies, their plinths and plaques only when this does
  const key = JSON.stringify(placed.map((p) => [p.trophy.id, p.trophy.icon, p.shelf, p.slot, p.of, p.plinth, p.who]));

  const body = useMemo(cabinetGeometry, []);
  const strips = useMemo(plaqueGeometry, []);
  const geo = useMemo(
    () =>
      placed.length
        ? trophiesGeometry(placed.map((p): Placed => ({ look: trophyLook(p.trophy), plinth: p.plinth, at: [0.02, SHELF_Y[p.shelf], slotZ(p.slot, p.of)], yaw: Math.PI / 2 })))
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt when what's on the shelves changes
    [key],
  );
  useEffect(() => () => geo?.dispose(), [geo]);
  useEffect(
    () => () => {
      body.dispose();
      strips.dispose();
    },
    [body, strips],
  );

  const plaques = useCanvasTexture(
    PLAQUE.w,
    PLAQUE.row * 3,
    (ctx) => {
      ctx.fillStyle = '#e9d8a6';
      ctx.fillRect(0, 0, PLAQUE.w, PLAQUE.row * 3);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#5c3d2e';
      for (const p of placed) {
        // canvas left is the strip's left as you face it: +z
        const cx = ((STRIP.l / 2 - slotZ(p.slot, p.of)) / STRIP.l) * PLAQUE.w;
        const top = p.shelf * PLAQUE.row;
        const max = SPACING * (PLAQUE.w / STRIP.l) - 10;
        ctx.font = `700 21px ${SANS}`;
        ctx.fillText(p.who, cx, top + PLAQUE.row * 0.32, max);
        ctx.font = `500 18px ${SANS}`;
        ctx.fillText(p.what, cx, top + PLAQUE.row * 0.74, max);
      }
    },
    [key],
  );
  const n = trophies.length;
  const sign = useCanvasTexture(
    512,
    96,
    (ctx) => {
      ctx.fillStyle = INK;
      roundRect(ctx, 0, 0, 512, 96, 30);
      ctx.fill();
      ctx.fillStyle = '#ffd166';
      ctx.font = `700 46px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n ? `🏆 ${n} troph${n === 1 ? 'y' : 'ies'}` : '🏆 Trophy cabinet', 256, 50);
    },
    [n],
  );
  const card = useCanvasTexture(
    640,
    170,
    (ctx) =>
      drawSign(
        ctx,
        640,
        170,
        [
          { text: '✨ Your first merge', size: 46, color: '#5c3d2e' },
          { text: 'goes here', size: 46, color: '#5c3d2e' },
        ],
        '#fff3c4',
      ),
    [],
  );

  return (
    <group position={[CX, 0, CZ]}>
      <group ref={ref}>
        <mesh geometry={body} material={trophyMaterial} castShadow receiveShadow>
          <Outlines thickness={0.018} color={INK} />
        </mesh>
        <mesh geometry={strips}>
          <meshBasicMaterial map={plaques} />
        </mesh>
        {geo ? (
          <mesh geometry={geo} material={trophyMaterial}>
            <Outlines thickness={0.012} color={INK} />
          </mesh>
        ) : (
          <mesh position={[0.05, SHELF_Y[1] + 0.25, 0]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[1.5, 0.4]} />
            <meshBasicMaterial map={card} transparent />
          </mesh>
        )}
        {/* the glass front, between the base and the top */}
        <mesh position={[W / 2 - 0.02, (0.12 + H - 0.06) / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={toon('#cfe8ef', { transparent: true, opacity: 0.22 })}>
          <planeGeometry args={[L - 0.1, H - 0.18]} />
        </mesh>
      </group>
      <mesh position={[W / 2 + 0.01, H + 0.25, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[1.5, 0.28]} />
        <meshBasicMaterial map={sign} transparent toneMapped={false} />
      </mesh>
      <TrophyConfetti />
    </group>
  );
}

const PIECES = 70;
const LIFE = 2.6;
const PALETTE = ['#ffd166', '#f7c548', '#ff5d8f', '#3bceac', '#3a86ff', '#9b5de5'];

/** Confetti out of the cabinet's top when a trophy is won (the server's moment): one burst at a time, hidden between. */
function TrophyConfetti() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const sim = useMemo(
    () => ({
      age: -1, // < 0: nothing flying
      pos: new Float32Array(PIECES * 3),
      vel: new Float32Array(PIECES * 3),
      rot: new Float32Array(PIECES * 3),
      dummy: new THREE.Object3D(),
      geometry: new THREE.PlaneGeometry(0.09, 0.055),
      material: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }),
    }),
    [],
  );
  useEffect(
    () => () => {
      sim.geometry.dispose();
      sim.material.dispose();
    },
    [sim],
  );
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new THREE.Color();
    for (let i = 0; i < PIECES; i++) m.setColorAt(i, c.set(PALETTE[i % PALETTE.length]));
    m.instanceColor!.needsUpdate = true;
    m.visible = false;
  }, [sim]);

  useEffect(() => {
    const burst = () => {
      const m = mesh.current;
      if (!m || document.hidden) return;
      sim.age = 0;
      for (let i = 0; i < PIECES; i++) {
        const a = (Math.random() - 0.5) * Math.PI;
        const out = 0.8 + Math.random() * 1.4;
        sim.pos.set([W / 2 + 0.1, H + 0.05, (Math.random() - 0.5) * L * 0.6], i * 3);
        // out of the cabinet into the room (+x), never back through the wall
        sim.vel.set([Math.cos(a) * out, 2.4 + Math.random() * 2, Math.sin(a) * out], i * 3);
        sim.rot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
      }
      m.visible = true;
      confettiPop({ x: CX + W / 2, y: H, z: CZ });
    };
    let last: Moment | null = useStore.getState().moments.at(-1) ?? null;
    const unsub = useStore.subscribe((state) => {
      if (state.moments.at(-1) === last) return;
      if (momentsSince(state.moments, last).some((m) => m.type === 'trophy')) burst();
      last = state.moments.at(-1) ?? null;
    });
    return unsub;
  }, [sim]);

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m || sim.age < 0) return;
    const dt = Math.min(delta, 0.05);
    sim.age += dt;
    const done = sim.age >= LIFE;
    const size = done ? 0 : Math.min(1, (LIFE - sim.age) / (LIFE * 0.4));
    const drag = Math.exp(-1.6 * dt);
    for (let i = 0; i < PIECES; i++) {
      const j = i * 3;
      sim.vel[j] *= drag;
      sim.vel[j + 2] *= drag;
      sim.vel[j + 1] = Math.max(sim.vel[j + 1] * drag - 3.2 * dt, -0.9);
      sim.pos[j] += sim.vel[j] * dt;
      sim.pos[j + 1] = Math.max(0.02, sim.pos[j + 1] + sim.vel[j + 1] * dt);
      sim.pos[j + 2] += sim.vel[j + 2] * dt;
      sim.rot[j] += (5 + (i % 7)) * dt;
      sim.rot[j + 1] += (3 + (i % 5)) * dt;
      sim.dummy.position.set(sim.pos[j], sim.pos[j + 1], sim.pos[j + 2]);
      sim.dummy.rotation.set(sim.rot[j], sim.rot[j + 1], sim.rot[j + 2]);
      sim.dummy.scale.setScalar(size);
      sim.dummy.updateMatrix();
      m.setMatrixAt(i, sim.dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    if (done) {
      sim.age = -1;
      m.visible = false;
    }
  });

  return <instancedMesh ref={mesh} args={[sim.geometry, sim.material, PIECES]} frustumCulled={false} />;
}
