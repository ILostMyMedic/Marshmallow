// The company's milestones on the CEO's floor, over the meeting table: a walnut board on the north wall with how much
// the company has shipped, its trophies (icon, title, date) and each floor's total, and a low cabinet under it with
// the trophies themselves standing on top (trophyModels.ts). Seven draw calls: the board's frame and ink, its face,
// the cabinet and its ink, the trophies and theirs. New: not in cubefarm.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useStore } from '../store';
import { useCanvasTexture } from './canvasTexture';
import { CUT_PLANES } from './cutaway';
import { fitText, roundRect, SANS } from './draw';
import { EXEC_MILESTONES, EXEC_TROPHIES } from './layout';
import { toon } from './materials';
import { INK, Outlines } from './Outlines';
import { merged } from './shapes';
import { dateLabel, floorTotals, prs } from './shipped';
import { paint, trophiesGeometry, trophyMaterial } from './trophyModels';
import { milestoneOf, trophyLook } from './trophyShelf';

const TEX = { w: 1600, h: Math.round((1600 * EXEC_MILESTONES.h) / EXEC_MILESTONES.w) };
/** The company's trophies shown: the biggest, which is the newest. */
const SHOWN = 8;
const WALNUT = '#6b4226';
const GOLD = '#f6d365';
const CREAM = '#e0c9a6';
const FRAME = toon(WALNUT, { cut: 'room' });

function paintBoard(ctx: CanvasRenderingContext2D, trophies: readonly { icon: string; title: string; earnedAt: number }[], total: number, floors: string) {
  const { w, h } = TEX;
  ctx.fillStyle = '#4a2c19';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(246, 211, 101, 0.55)';
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, w - 36, h - 36);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = GOLD;
  ctx.font = `700 60px ${SANS}`;
  ctx.fillText('🏆 Milestones', 52, 74);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 54px ${SANS}`;
  ctx.fillText(`${prs(total)} shipped`, w - 52, 76);
  ctx.fillStyle = 'rgba(246, 211, 101, 0.4)';
  ctx.fillRect(52, 124, w - 104, 3);

  if (!trophies.length) {
    ctx.textAlign = 'center';
    ctx.fillStyle = CREAM;
    ctx.font = `600 46px ${SANS}`;
    ctx.fillText('The first merge earns the first trophy', w / 2, h / 2 + 10);
  } else {
    const cols = 4;
    const gap = 18;
    const tw = (w - 104 - gap * (cols - 1)) / cols;
    const th = 170;
    trophies.forEach((t, i) => {
      const tx = 52 + (i % cols) * (tw + gap);
      const ty = 150 + Math.floor(i / cols) * (th + gap);
      ctx.fillStyle = '#5e3a22';
      roundRect(ctx, tx, ty, tw, th, 22);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.font = `68px ${SANS}`;
      ctx.fillText(t.icon, tx + 54, ty + th / 2 + 4);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff3d6';
      ctx.font = `700 30px ${SANS}`;
      ctx.fillText(fitText(ctx, t.title, tw - 112), tx + 100, ty + th / 2 - 22);
      ctx.fillStyle = CREAM;
      ctx.font = `500 27px ${SANS}`;
      ctx.fillText(dateLabel(t.earnedAt), tx + 100, ty + th / 2 + 24);
    });
  }
  if (floors) {
    ctx.textAlign = 'left';
    ctx.fillStyle = CREAM;
    ctx.font = `500 31px ${SANS}`;
    ctx.fillText(fitText(ctx, floors, w - 104), 52, h - 52);
  }
}

/** The cabinet under the board: walnut, a lighter top and four door panels. */
function cabinetGeometry() {
  const { w, d, h } = EXEC_TROPHIES;
  return merged([
    paint(new THREE.BoxGeometry(w, h - 0.05, d), WALNUT, [0, (h - 0.05) / 2, 0]),
    paint(new THREE.BoxGeometry(w + 0.06, 0.05, d + 0.04), '#8a5a36', [0, h - 0.025, 0]),
    ...[-1.5, -0.5, 0.5, 1.5].map((i) => paint(new THREE.BoxGeometry(w / 4 - 0.12, h - 0.25, 0.012), '#5a3720', [(i * w) / 4, (h - 0.05) / 2, d / 2 + 0.006])),
  ]);
}

export function CeoMilestones() {
  const records = useStore((s) => s.records);
  const floors = useStore((s) => s.floors);
  const company = useMemo(
    () =>
      records.trophies
        .filter((t) => !t.floorId)
        .sort((a, b) => milestoneOf(a) - milestoneOf(b))
        .slice(-SHOWN),
    [records.trophies],
  );
  const totals = floorTotals(records, floors)
    .map((t) => `${t.name} ${t.total}`)
    .join('  ·  ');
  const key = JSON.stringify([records.total, totals, company.map((t) => t.id)]);
  const tex = useCanvasTexture(TEX.w, TEX.h, (ctx) => paintBoard(ctx, company, records.total, totals), [key]);
  const face = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, clippingPlanes: CUT_PLANES.room }), []);
  face.map = tex;

  const body = useMemo(cabinetGeometry, []);
  const ids = company.map((t) => t.id).join();
  const geo = useMemo(() => {
    if (!company.length) return null;
    const step = (EXEC_TROPHIES.w - 0.6) / (SHOWN - 1);
    return trophiesGeometry(company.map((t, i) => ({ look: trophyLook(t), plinth: '#2b2d42', at: [(i - (company.length - 1) / 2) * step, EXEC_TROPHIES.h, 0.04], yaw: 0 })));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt when the trophies on it change
  }, [ids]);
  useEffect(() => () => geo?.dispose(), [geo]);
  useEffect(
    () => () => {
      face.dispose();
      body.dispose();
    },
    [face, body],
  );

  const b = EXEC_MILESTONES;
  return (
    <group>
      <group position={[b.x, 0, b.z]}>
        <mesh position={[0, b.y + b.h / 2, 0.02]} material={FRAME}>
          <boxGeometry args={[b.w + 0.16, b.h + 0.16, 0.08]} />
          <Outlines thickness={0.018} color={INK} cut="room" />
        </mesh>
        <mesh position={[0, b.y + b.h / 2, 0.065]} material={face}>
          <planeGeometry args={[b.w, b.h]} />
        </mesh>
      </group>
      <group position={[EXEC_TROPHIES.x, 0, EXEC_TROPHIES.z]}>
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
