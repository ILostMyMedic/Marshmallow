// Adapted from cubefarm client/src/world/camera/OverviewChips.tsx (MIT): the CEO's chip is over their desk on their own
// floor, and the chips show only in the overview.

// The overview's status chips: a small label over every desk with its person's name and what they're doing, the same
// size on screen at any zoom (sizeAttenuation off) and drawn over everything; it goes with them while they're up and
// about (an errand, the CEO's strolls). A click on one opens their terminal (picking.ts).
import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Worker } from '../../../shared/types';
import { useStore } from '../store';
import { useCanvasTexture } from './canvasTexture';
import { roundRect, SANS } from './draw';
import { CEO_FLOOR, kindOf } from './floors';
import { deskPosition, EXEC_DESK } from './layout';
import { CHIP_COLORS, CHIP_LABELS, chipFor, type ChipKind } from './overviewInfo';
import { bodyState, isHidden } from './people';
import { pickables } from './picking';
import { useView, type Focus } from './view';

const CHIP = { w: 320, h: 72, px: 28, y: 2.5 };
/** The chips' scale for the current lens and view size, so a new chip starts the right size. */
const scale = { x: 0.1, y: 0.025 };
/** The lens and the view's size the chips were last drawn for (the probe projects with them). */
const seen: { camera: THREE.Camera | null; w: number; h: number } = { camera: null, w: 0, h: 0 };

function drawChip(ctx: CanvasRenderingContext2D, name: string, kind: ChipKind) {
  const { w, h } = CHIP;
  ctx.clearRect(0, 0, w, h);
  ctx.font = `700 30px ${SANS}`;
  const label = CHIP_LABELS[kind];
  let text = name;
  const room = w - 70 - ctx.measureText(` · ${label}`).width;
  while (text.length > 2 && ctx.measureText(text).width > room) text = `${text.slice(0, -2)}…`;
  const line = `${text} · ${label}`;
  const width = Math.min(w - 8, ctx.measureText(line).width + 64);
  const x0 = (w - width) / 2;
  roundRect(ctx, x0, 6, width, h - 12, (h - 12) / 2);
  ctx.fillStyle = 'rgba(255,253,246,0.96)';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#1f1d2b';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x0 + 28, h / 2, 11, 0, Math.PI * 2);
  ctx.fillStyle = CHIP_COLORS[kind];
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#1f1d2b';
  ctx.textBaseline = 'middle';
  ctx.fillText(line, x0 + 48, h / 2 + 1);
}

/** Where a chip belongs when its person is at their desk (Chip sets it; follow reads it). */
interface Home {
  id: string;
  x: number;
  z: number;
  placed: boolean;
}

/**
 * Each chip over its person: over their desk, or over them wherever they are while they're up and about, eased so
 * standing up doesn't jump it. Someone not drawn here (the CEO off round the floors) keeps theirs at the desk.
 */
function follow(g: THREE.Group, dt: number) {
  const k = 1 - Math.exp(-dt * 10);
  for (const c of g.children) {
    const home = c.userData.home as Home | undefined;
    if (!home) continue;
    const b = bodyState(home.id);
    const up = !!b && b.stage !== 'seated' && !isHidden(home.id);
    const x = up ? b.x : home.x;
    const z = up ? b.z : home.z;
    if (!home.placed) c.position.set(x, CHIP.y, z);
    else c.position.set(c.position.x + (x - c.position.x) * k, CHIP.y, c.position.z + (z - c.position.z) * k);
    home.placed = true;
  }
}

const Chip = memo(function Chip({ worker, x, z }: { worker: Worker; x: number; z: number }) {
  const kind = chipFor(worker);
  const tex = useCanvasTexture(CHIP.w, CHIP.h, (ctx) => drawChip(ctx, worker.name, kind), [worker.name, kind]);
  const material = useMemo(() => new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false }), [tex]);
  useEffect(() => () => material.dispose(), [material]);
  const ref = useRef<THREE.Sprite>(null);
  useEffect(() => {
    const s = ref.current;
    if (!s) return;
    const pick: Focus = { id: `chip-${worker.id}`, label: `Open ${worker.name}'s terminal`, action: { kind: 'terminal', workerId: worker.id } };
    s.userData.pick = pick;
    pickables.add(s);
    return () => void pickables.delete(s);
  }, [worker.id, worker.name]);
  useEffect(() => {
    const s = ref.current;
    if (s) s.userData.home = { id: worker.id, x, z, placed: !!s.userData.home } satisfies Home;
  }, [worker.id, x, z]);
  return <sprite ref={ref} material={material} position={[x, CHIP.y, z]} scale={[scale.x, scale.y, 1]} renderOrder={20} />;
});

/** Chips for everyone with a desk on floor `floor`, in the overview. Keeps them CHIP.px tall on screen whatever the zoom. */
export function OverviewChips({ floor }: { floor: number }) {
  const floors = useStore((s) => s.floors);
  const workers = useStore((s) => s.workers);
  const people = useMemo(() => {
    const kind = kindOf(floor);
    if (floor === CEO_FLOOR) {
      const ceo = Object.values(workers).find((w) => w.role === 'ceo');
      return ceo ? [{ worker: ceo, x: EXEC_DESK.x, z: EXEC_DESK.z }] : [];
    }
    if (kind !== 'office') return [];
    const id = floors.find((f) => f.floor === floor)?.id;
    return Object.values(workers)
      .filter((w) => w.role === 'worker' && w.floorId === id)
      .map((w) => ({ worker: w, ...deskPosition(w.desk) }));
  }, [floor, floors, workers]);
  const group = useRef<THREE.Group>(null);
  const last = useRef({ k: 0, h: 0 });
  useFrame(({ camera, size }, delta) => {
    const g = group.current;
    if (!g) return;
    g.visible = useView.getState().mode === 'overview';
    if (g.visible) follow(g, Math.min(delta, 0.1));
    seen.camera = camera;
    seen.w = size.width;
    seen.h = size.height;
    const k = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5];
    if (k === last.current.k && size.height === last.current.h) return;
    last.current.k = k;
    last.current.h = size.height;
    // with sizeAttenuation off, a sprite's on-screen height is scale × projection[5] × half the view's height
    scale.y = (CHIP.px * 2) / (k * size.height);
    scale.x = (scale.y * CHIP.w) / CHIP.h;
    for (const c of g.children) c.scale.set(scale.x, scale.y, 1);
  });
  return (
    <group ref={group}>
      {people.map((p) => (
        <Chip key={p.worker.id} worker={p.worker} x={p.x} z={p.z} />
      ))}
    </group>
  );
}

// window.__mmChips, for headless checks: each chip's label and where it shows on the canvas (CSS pixels from its top left).
if (typeof window !== 'undefined')
  (window as unknown as Record<string, unknown>).__mmChips = () =>
    [...pickables].map((o) => {
      const p = o.getWorldPosition(new THREE.Vector3());
      if (seen.camera) p.project(seen.camera);
      return { label: (o.userData.pick as Focus).label, x: Math.round(((p.x + 1) / 2) * seen.w), y: Math.round(((1 - p.y) / 2) * seen.h) };
    });
