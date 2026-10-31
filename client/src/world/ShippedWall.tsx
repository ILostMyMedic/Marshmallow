// The lobby's shipped wall: a big screen on the east wall, facing the trophy cabinet across the room, with the latest
// merges (each with its floor, who built and tested it, and when) and each floor's total (shipped.ts says what).
// Painted on one canvas, repainted only when what it says changes; on the east wall, so the overview cuts it away with
// the wall (cutaway.ts). E on it lists everything (ui/TrophiesPanel.tsx). Three draw calls: the frame, its ink, the
// screen. New: not in cubefarm.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useStore } from '../store';
import { TROPHIES_OVERLAY } from '../ui/TrophiesPanel';
import { useCanvasTexture } from './canvasTexture';
import { CUT_PLANES } from './cutaway';
import { fitText, roundRect, SANS } from './draw';
import { useInteractable } from './interact';
import { SHIPPED_WALL } from './layout';
import { toon } from './materials';
import { INK, Outlines } from './Outlines';
import { floorTotals, prs, wallRows, type FloorTotal, type WallRow } from './shipped';

const TEX = { w: 1920, h: Math.round((1920 * SHIPPED_WALL.h) / SHIPPED_WALL.w) };
/** Merges listed, and floors totalled. */
const ROWS = 9;
const TOTALS = 7;
const FRAME = toon('#2b2d42', { cut: 'room' });
const GREY = '#9aa0b8';
const LINE = '#2f365a';

function paintWall(ctx: CanvasRenderingContext2D, rows: readonly WallRow[], totals: readonly FloorTotal[], total: number) {
  const { w, h } = TEX;
  ctx.fillStyle = '#1d2238';
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd166';
  ctx.font = `700 64px ${SANS}`;
  ctx.fillText('🚢 Shipped', 56, 72);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 56px ${SANS}`;
  ctx.fillText(`${prs(total)} merged`, w - 56, 74);
  ctx.fillStyle = LINE;
  ctx.fillRect(56, 128, w - 112, 4);
  if (!rows.length) {
    ctx.textAlign = 'center';
    ctx.fillStyle = GREY;
    ctx.font = `600 56px ${SANS}`;
    ctx.fillText('Nothing shipped yet', w / 2, h / 2 + 20);
    ctx.font = `500 36px ${SANS}`;
    ctx.fillText('Every merge goes up here, the first one too.', w / 2, h / 2 + 90);
    return;
  }

  // the latest merges, newest at the top
  const split = 1250;
  const top = 160;
  const rh = (h - top - 24) / ROWS;
  rows.forEach((r, i) => {
    const y = top + i * rh;
    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.arc(76, y + rh * 0.36, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'right';
    ctx.fillStyle = GREY;
    ctx.font = `500 28px ${SANS}`;
    ctx.fillText(r.when, split - 44, y + rh * 0.36);
    const whenW = ctx.measureText(r.when).width;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 33px ${SANS}`;
    ctx.fillText(fitText(ctx, r.title, split - 44 - whenW - 28 - 100), 100, y + rh * 0.36);
    ctx.fillStyle = GREY;
    ctx.font = `500 23px ${SANS}`;
    ctx.fillText(fitText(ctx, `${r.floor} · #${r.pr} · ${r.by}`, split - 144), 100, y + rh * 0.76);
  });
  ctx.fillStyle = LINE;
  ctx.fillRect(split, top, 4, h - top - 36);

  // each floor's total, a bar against the most
  const tx = split + 52;
  const tw = w - 56 - tx;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd166';
  ctx.font = `700 38px ${SANS}`;
  ctx.fillText('By floor', tx, top + 22);
  const most = Math.max(1, ...totals.map((t) => t.total));
  const th = (h - top - 110) / TOTALS;
  totals.slice(0, TOTALS).forEach((t, i) => {
    const y = top + 70 + i * th;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 30px ${SANS}`;
    ctx.fillText(String(t.total), tx + tw, y + 14);
    ctx.textAlign = 'left';
    ctx.font = `600 28px ${SANS}`;
    ctx.fillText(fitText(ctx, t.name, tw - 110), tx, y + 14);
    ctx.fillStyle = '#2c3252';
    roundRect(ctx, tx, y + 36, tw, 14, 7);
    ctx.fill();
    ctx.fillStyle = t.color;
    roundRect(ctx, tx, y + 36, Math.max(14, (tw * t.total) / most), 14, 7);
    ctx.fill();
  });
  if (totals.length > TOTALS) {
    ctx.fillStyle = GREY;
    ctx.font = `500 24px ${SANS}`;
    ctx.fillText(`and ${totals.length - TOTALS} more`, tx, h - 44);
  }
}

export function ShippedWall() {
  const records = useStore((s) => s.records);
  const floors = useStore((s) => s.floors);
  const ref = useInteractable<THREE.Group>({ id: 'shipped-wall', label: 'See what we shipped', action: TROPHIES_OVERLAY }, 5);
  const rows = wallRows(records, floors, Date.now(), ROWS);
  const totals = floorTotals(records, floors);
  // the floors change all the time; the wall only when what it says does
  const key = JSON.stringify([records.total, rows, totals]);
  const tex = useCanvasTexture(TEX.w, TEX.h, (ctx) => paintWall(ctx, rows, totals, records.total), [key]);
  const face = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, clippingPlanes: CUT_PLANES.room }), []);
  face.map = tex;
  useEffect(() => () => face.dispose(), [face]);
  const { x, z, w, h, y } = SHIPPED_WALL;
  return (
    <group ref={ref} position={[x, 0, z]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh position={[0, y + h / 2, 0.02]} material={FRAME}>
        <boxGeometry args={[w + 0.16, h + 0.16, 0.08]} />
        <Outlines thickness={0.018} color={INK} cut="room" />
      </mesh>
      <mesh position={[0, y + h / 2, 0.065]} material={face}>
        <planeGeometry args={[w, h]} />
      </mesh>
    </group>
  );
}
