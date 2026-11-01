// The awards wall in the CEO's office, on the south wall west of the elevator, facing the CEO's desk across the room: a
// framed board with how many awards are won and every award's progress (the company's families as plaques: the icon of
// the highest tier won, greyed while none is, tier pips and the bar to the next with what it pays; then a strip per
// floor with its colour, its won count and its nearest next award), and a low shelf under it standing up the newest
// awards' trophies on plinths in their floor's colour (the company's merge milestones stand on the milestones cabinet
// across the room). E on it, or a click in the overview, opens the awards panel. The board is repainted only when what
// it says changes, and goes with its wall in the overview's cutaway. Six draw calls: the frame and its ink, the face,
// the shelf and its ink, the trophies and theirs. New in Marshmallow.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useStore } from '../store';
import { awardsView, nearestNext, wallTrophies, type AwardsView, type GroupView, type RowView } from '../ui/awards/awards';
import { useCanvasTexture } from './canvasTexture';
import { CUT_PLANES } from './cutaway';
import { fitText, roundRect, SANS } from './draw';
import { useInteractable } from './interact';
import { EXEC_AWARD_SHELF, EXEC_AWARDS } from './layout';
import { toon } from './materials';
import { INK, Outlines } from './Outlines';
import { merged } from './shapes';
import { paint, trophiesGeometry, trophyMaterial } from './trophyModels';
import { GONE_COLOR, trophyLook } from './trophyShelf';

const TEX = { w: 2400, h: Math.round((2400 * EXEC_AWARDS.h) / EXEC_AWARDS.w) };
/** Trophies on the shelf, and how much bigger than in the lobby's cabinet (they're seen from across the room). */
const SHOWN = 9;
const GROW = 1.35;
const WALNUT = '#6b4226';
const NAVY = '#1d2a44';
const PLAQUE = '#2a3a5c';
const STRIP = '#243352';
const TRACK = '#141d31';
const GOLD = '#f6d365';
const GREEN = '#69db7c';
const CREAM = '#e8dcc0';
const DIM = '#5d6b8a';
const COMPANY_PLINTH = '#2b2d42';
const FRAME = toon(WALNUT, { cut: 'room' });
const M = 48; // the board's margin, px

/** A bar from x0 to x1: its track, and filled `fraction` of the way (green once everything is won). */
function bar(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, h: number, fraction: number, done: boolean) {
  ctx.fillStyle = TRACK;
  roundRect(ctx, x0, y, x1 - x0, h, h / 2);
  ctx.fill();
  if (fraction <= 0) return;
  ctx.fillStyle = done ? GREEN : GOLD;
  roundRect(ctx, x0, y, Math.max(h, (x1 - x0) * fraction), h, h / 2);
  ctx.fill();
}

/** An emoji, greyed and faded when `dim`. */
function icon(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, dim: boolean) {
  ctx.save();
  if (dim) {
    ctx.filter = 'grayscale(1)';
    ctx.globalAlpha = 0.35;
  }
  ctx.font = `${size}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** One of the company's families: its best icon, name, tiers won as pips, and the bar to the next tier. */
function plaque(ctx: CanvasRenderingContext2D, r: RowView, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = r.won ? PLAQUE : STRIP;
  roundRect(ctx, x, y, w, h, 22);
  ctx.fill();
  if (r.won) {
    ctx.strokeStyle = 'rgba(246, 211, 101, 0.45)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.textBaseline = 'middle';
  icon(ctx, r.icon, x + 58, y + 64, 78, r.won === 0);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 34px ${SANS}`;
  ctx.fillText(fitText(ctx, r.family.name, w - 124), x + 108, y + 48);
  ctx.fillStyle = CREAM;
  ctx.font = `500 26px ${SANS}`;
  ctx.fillText(`${r.won} of ${r.chips.length} won`, x + 108, y + 88);
  // the tiers as pips, won ones gold
  r.chips.forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(x + 34 + i * 30, y + 132, 10, 0, Math.PI * 2);
    if (c.trophy) {
      ctx.fillStyle = GOLD;
      ctx.fill();
    } else {
      ctx.strokeStyle = DIM;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  });
  bar(ctx, x + 24, x + w - 24, y + 160, 18, r.fraction, !r.next);
  ctx.fillStyle = r.next ? CREAM : GREEN;
  ctx.font = `500 26px ${SANS}`;
  ctx.fillText(fitText(ctx, r.next ? `${r.count} / ${r.next.target} · next +${r.next.reward} 🪙` : `All ${r.chips.length} won ✓`, w - 48), x + 24, y + 206);
}

/**
 * A floor's strip: its colour and number, name and won count, and its nearest next award with a bar. A wide strip (a
 * column of them) says it all on one line; a narrow one puts the next award under the name.
 */
function strip(ctx: CanvasRenderingContext2D, g: GroupView, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = STRIP;
  roundRect(ctx, x, y, w, h, 16);
  ctx.fill();
  const cy = y + h / 2;
  const wide = w > 1500;
  ctx.beginPath();
  ctx.arc(x + 36, cy, wide ? 25 : 23, 0, Math.PI * 2);
  ctx.fillStyle = g.color;
  ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = `700 26px ${SANS}`;
  ctx.fillText(String(g.floor ?? ''), x + 36, cy + 1);
  const next = nearestNext(g);
  const what = next ? `${next.next!.icon} ${next.family.name}: ${next.count} / ${next.next!.target} · +${next.next!.reward} 🪙` : 'Every award won! 🎉';
  const barX = x + w * (wide ? 0.64 : 0.6);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${wide ? 34 : 28}px ${SANS}`;
  if (wide) {
    const name = fitText(ctx, g.name, w * 0.2);
    ctx.fillText(name, x + 76, cy + 1);
    const after = x + 76 + ctx.measureText(name).width + 18;
    ctx.fillStyle = GOLD;
    ctx.font = `600 28px ${SANS}`;
    ctx.fillText(`${g.won}/${g.total} won`, after, cy + 1);
    ctx.fillStyle = next ? CREAM : GREEN;
    ctx.font = `500 28px ${SANS}`;
    const from = Math.max(after + 190, x + w * 0.33);
    ctx.fillText(fitText(ctx, what, barX - from - 20), from, cy + 1);
    bar(ctx, barX, x + w - 24, cy - 10, 20, next ? next.fraction : 1, !next);
    return;
  }
  const textW = barX - (x + 74) - 16;
  const name = fitText(ctx, g.name, textW * 0.62);
  ctx.fillText(name, x + 74, y + 22);
  const nameW = ctx.measureText(name).width;
  ctx.fillStyle = GOLD;
  ctx.font = `600 24px ${SANS}`;
  ctx.fillText(`${g.won}/${g.total} won`, x + 74 + nameW + 14, y + 23);
  ctx.fillStyle = next ? CREAM : GREEN;
  ctx.font = `500 23px ${SANS}`;
  ctx.fillText(fitText(ctx, what, textW), x + 74, y + h - 20);
  bar(ctx, barX, x + w - 22, cy - 9, 18, next ? next.fraction : 1, !next);
}

/** The board: the header, the company's plaques, then the floors' strips. */
function paintWall(ctx: CanvasRenderingContext2D, v: AwardsView) {
  const { w, h } = TEX;
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(246, 211, 101, 0.55)';
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, w - 36, h - 36);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = GOLD;
  ctx.font = `700 62px ${SANS}`;
  ctx.fillText('🏅 Awards', M, 70);
  ctx.fillStyle = CREAM;
  ctx.font = `500 27px ${SANS}`;
  ctx.fillText("Each one a trophy that pays coins: a floor's to that floor, the company's to every floor", M, 120);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 54px ${SANS}`;
  ctx.fillText(`${v.won} of ${v.total} won`, w - M, 72);
  ctx.fillStyle = 'rgba(246, 211, 101, 0.4)';
  ctx.fillRect(M, 146, w - 2 * M, 3);

  const label = (text: string, right: string, y: number) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = GOLD;
    ctx.font = `700 25px ${SANS}`;
    ctx.fillText(text, M, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = CREAM;
    ctx.font = `500 25px ${SANS}`;
    ctx.fillText(right, w - M, y);
  };

  label('THE COMPANY', `🪙 ${v.paid.everyFloor} paid to every floor`, 178);
  const rows = v.company.rows;
  const gap = 16;
  const pw = (w - 2 * M - gap * (rows.length - 1)) / rows.length;
  rows.forEach((r, i) => plaque(ctx, r, M + i * (pw + gap), 198, pw, 232));

  label('THE FLOORS', `🪙 ${v.paid.floors} paid to the floors`, 462);
  const top = 482;
  const room = h - 30 - top;
  if (!v.floors.length) {
    ctx.textAlign = 'center';
    ctx.fillStyle = CREAM;
    ctx.font = `600 36px ${SANS}`;
    ctx.fillText('Connect a repository: each floor wins awards of its own', w / 2, top + room / 2);
    return;
  }
  const cols = v.floors.length <= 3 ? 1 : v.floors.length <= 6 ? 2 : 3;
  const perCol = 3;
  const fits = cols * perCol;
  const shown = v.floors.length > fits ? v.floors.slice(0, fits - 1) : v.floors;
  const sh = (room - gap * (perCol - 1)) / perCol;
  const sw = (w - 2 * M - gap * (cols - 1)) / cols;
  const at = (i: number) => ({ x: M + Math.floor(i / perCol) * (sw + gap), y: top + (i % perCol) * (sh + gap) });
  shown.forEach((g, i) => {
    const p = at(i);
    strip(ctx, g, p.x, p.y, sw, sh);
  });
  if (shown.length < v.floors.length) {
    const p = at(shown.length);
    ctx.fillStyle = STRIP;
    roundRect(ctx, p.x, p.y, sw, sh, 16);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = CREAM;
    ctx.font = `600 28px ${SANS}`;
    ctx.fillText(`+${v.floors.length - shown.length} more floors: E for every award`, p.x + sw / 2, p.y + sh / 2);
  }
}

/** The low shelf under the board: walnut, a lighter top and six door panels on its front (facing north, -z). */
function shelfGeometry() {
  const { w, d, h } = EXEC_AWARD_SHELF;
  return merged([
    paint(new THREE.BoxGeometry(w, h - 0.05, d), WALNUT, [0, (h - 0.05) / 2, 0]),
    paint(new THREE.BoxGeometry(w + 0.06, 0.05, d + 0.04), '#8a5a36', [0, h - 0.025, 0]),
    ...[-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((i) => paint(new THREE.BoxGeometry(w / 6 - 0.12, h - 0.25, 0.012), '#5a3720', [(i * w) / 6, (h - 0.05) / 2, -d / 2 - 0.006])),
  ]);
}

export function AwardsWall() {
  const stats = useStore((s) => s.awards);
  const trophies = useStore((s) => s.records.trophies);
  const floors = useStore((s) => s.floors);
  const ref = useInteractable<THREE.Group>({ id: 'awards-wall', label: 'See the awards', action: { kind: 'awards' } }, 4.5);

  const view = useMemo(() => awardsView(stats, trophies, floors), [stats, trophies, floors]);
  // the floors change all the time (issues, PRs); the board only when what it says does
  const key = JSON.stringify([
    view.won,
    view.total,
    view.paid,
    [view.company, ...view.floors].map((g) => [g.name, g.color, g.floor, g.won, g.rows.map((r) => [r.won, r.count])]),
  ]);
  const tex = useCanvasTexture(TEX.w, TEX.h, (ctx) => paintWall(ctx, view), [key]);
  const face = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, clippingPlanes: CUT_PLANES.room }), []);
  face.map = tex;

  const body = useMemo(shelfGeometry, []);
  const shown = useMemo(() => wallTrophies(trophies, SHOWN), [trophies]);
  const plinths = shown.map((t) => (t.floorId ? (floors.find((f) => f.id === t.floorId)?.color ?? GONE_COLOR) : COMPANY_PLINTH));
  const ids = JSON.stringify([shown.map((t) => t.id), plinths]);
  const geo = useMemo(() => {
    if (!shown.length) return null;
    const step = (EXEC_AWARD_SHELF.w - 0.6) / (SHOWN - 1);
    return trophiesGeometry(
      shown.map((t, i) => {
        const look = trophyLook(t);
        // oldest on the left as you face the wall (south, so your left is +x), turned to face the room
        return { look: { ...look, scale: look.scale * GROW }, plinth: plinths[i], at: [((shown.length - 1) / 2 - i) * step, EXEC_AWARD_SHELF.h, -0.04], yaw: Math.PI };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt when the trophies on it or their plinths change
  }, [ids]);
  useEffect(() => () => geo?.dispose(), [geo]);
  useEffect(
    () => () => {
      face.dispose();
      body.dispose();
    },
    [face, body],
  );

  const b = EXEC_AWARDS;
  const s = EXEC_AWARD_SHELF;
  return (
    <group ref={ref}>
      {/* the board, its face turned to the room (north, -z) */}
      <group position={[b.x, 0, b.z]}>
        <mesh position={[0, b.y + b.h / 2, -0.02]} material={FRAME}>
          <boxGeometry args={[b.w + 0.16, b.h + 0.16, 0.08]} />
          <Outlines thickness={0.018} color={INK} cut="room" />
        </mesh>
        <mesh position={[0, b.y + b.h / 2, -0.065]} rotation={[0, Math.PI, 0]} material={face}>
          <planeGeometry args={[b.w, b.h]} />
        </mesh>
      </group>
      <group position={[s.x, 0, s.z]}>
        <mesh geometry={body} material={trophyMaterial} castShadow receiveShadow>
          <Outlines thickness={0.018} color={INK} />
        </mesh>
        {geo && (
          <mesh geometry={geo} material={trophyMaterial}>
            <Outlines thickness={0.012} color={INK} />
          </mesh>
        )}
      </group>
    </group>
  );
}
