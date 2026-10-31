// The billboards on the rooftops round the office (billboardLayout.ts: where they stand and what they say), with the
// office's own news on them: the team at work, today's merges, the open issues, the company's slogan, the floor at work
// and the latest merge. Two out of each side's windows on every floor, two more for the roof. Two draw calls: the six
// faces share one canvas (lit from within, so they glow at night), and their frames and legs are one mesh. Drawn in the city's frame (City.tsx).
// Adapted from cubefarm client/src/world/roof/Billboards.tsx (MIT): the telescope's aiming report cut.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useStore } from '../store';
import { BOARD, BOARDS, billboardSpots, boardTexts, officeNumbers, type BoardText } from './billboardLayout';
import { useCanvasTexture } from './canvasTexture';
import { theCity } from './cityLayout';
import { roundRect, SANS } from './draw';
import { CITY_HAZE, hazed, hazedToon } from './haze';
import { merged } from './shapes';

const CELL = { w: 512, h: 256 };
const COLS = 2;
const ROWS = Math.ceil(BOARDS / COLS);
const FACE_H = Math.round((CELL.w * BOARD.h) / BOARD.w); // the face's height in its cell, at the board's aspect

/** Board k in its cell of the canvas: a coloured panel, a ring of bulbs, the small line, the big one and the line under. */
function drawBoard(ctx: CanvasRenderingContext2D, k: number, b: BoardText) {
  const x = (k % COLS) * CELL.w;
  const y = Math.floor(k / COLS) * CELL.h;
  const w = CELL.w;
  const h = FACE_H;
  ctx.fillStyle = '#2b2d42';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = b.bg;
  roundRect(ctx, x + 7, y + 7, w - 14, h - 14, 13);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i < 24; i++) {
    const u = (i + 0.5) / 24;
    for (const by of [y + 15, y + h - 15]) {
      ctx.beginPath();
      ctx.arc(x + 20 + u * (w - 40), by, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = b.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 27px ${SANS}`;
  ctx.fillText(b.top, x + w / 2, y + 46, w - 60);
  ctx.font = `800 88px ${SANS}`;
  ctx.fillText(b.big, x + w / 2, y + h / 2 + 9, w - 60);
  ctx.font = `600 23px ${SANS}`;
  ctx.fillText(b.under, x + w / 2, y + h - 41, w - 60);
}

/** Where face k's corners land on the shared canvas (its v runs up from the bottom). */
function faceUv(k: number) {
  const u0 = (k % COLS) / COLS;
  const top = 1 - Math.floor(k / COLS) / ROWS;
  return { u0, u1: u0 + 1 / COLS, v1: top, v0: top - FACE_H / (CELL.h * ROWS) };
}

/** The boards' words, as one string: the store changes all the time, the boards only when this does. */
function useBoardKey() {
  return useStore((s) =>
    JSON.stringify(boardTexts(officeNumbers(s.floors, Object.values(s.workers), Object.values(s.qa), s.settings.companyName, Date.now()))),
  );
}

export function Billboards() {
  const spots = useMemo(() => billboardSpots(theCity()), []);
  const key = useBoardKey();
  const atlas = useCanvasTexture(CELL.w * COLS, CELL.h * ROWS, (ctx) => (JSON.parse(key) as BoardText[]).forEach((b, k) => drawBoard(ctx, k, b)), [key]);
  const geo = useMemo(() => {
    const faces: THREE.BufferGeometry[] = [];
    const frames: THREE.BufferGeometry[] = [];
    spots.forEach((s, k) => {
      const place = (g: THREE.BufferGeometry, lx: number, ly: number, lz: number) => g.translate(lx, ly, lz).rotateY(s.yaw).translate(s.x, s.y, s.z);
      const face = new THREE.PlaneGeometry(BOARD.w, BOARD.h);
      const { u0, u1, v0, v1 } = faceUv(k % BOARDS);
      const uv = face.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      faces.push(place(face, 0, 0, 0.2)); // well clear of the frame: from a hundred metres away, closer would flicker
      frames.push(place(new THREE.BoxGeometry(BOARD.w + 0.4, BOARD.h + 0.4, 0.15), 0, 0, 0));
      frames.push(place(new THREE.BoxGeometry(BOARD.w, 0.12, 0.9), 0, -BOARD.h / 2 - 0.1, 0.5)); // the catwalk
      const legH = s.y - BOARD.h / 2 - s.top;
      for (const lx of [-BOARD.w / 3, BOARD.w / 3]) frames.push(place(new THREE.BoxGeometry(0.3, legH, 0.3), lx, -BOARD.h / 2 - legH / 2, -0.1));
    });
    return { faces: merged(faces), frames: merged(frames) };
  }, [spots]);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  // lit from within: the faces keep their brightness when the night dims the rest of the city, so they glow
  const face = useMemo(() => hazed(new THREE.MeshBasicMaterial({ map: atlas, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }), CITY_HAZE, { selfLit: true }), [atlas]);
  useEffect(() => () => face.dispose(), [face]);
  if (!spots.length) return null;
  return (
    <group>
      <mesh geometry={geo.frames} material={hazedToon('#3d405b', CITY_HAZE)} />
      <mesh geometry={geo.faces} material={face} />
    </group>
  );
}
