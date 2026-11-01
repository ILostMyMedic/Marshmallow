// The week's whiteboard by the CEO's meeting table (its rolling stand is in ceoRoom.ts): the last seven days'
// merges as marker bars, the week's merges, PRs opened and issues filed on sticky notes, and the floor that merged the
// most (ceoWeek.ts counts them). Repainted only when what it says changes: one draw call. New in Marshmallow.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useStore } from '../store';
import { useCanvasTexture } from './canvasTexture';
import { companyWeek, type Week } from './ceoWeek';
import { fitText, roundRect, SANS } from './draw';
import { EXEC_WEEK } from './layout';

const TEX = { w: 1024, h: Math.round((1024 * EXEC_WEEK.h) / EXEC_WEEK.w) };
const BLUE = '#1d4ed8';
const RED = '#e63946';
const GREEN = '#2a9d8f';
const GREY = '#8d99ae';

/** A sticky note, a little askew: a big number and what it counts. */
function note(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, tilt: number, n: number, what: string) {
  ctx.save();
  ctx.translate(x + 140, y + 56);
  ctx.rotate(tilt);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.fillRect(-136, -50, 280, 112);
  ctx.fillStyle = color;
  ctx.fillRect(-140, -56, 280, 112);
  ctx.fillStyle = '#1f1d2b';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `700 62px ${SANS}`;
  ctx.fillText(String(n), -118, 2);
  const nw = ctx.measureText(String(n)).width;
  ctx.font = `600 30px ${SANS}`;
  ctx.fillText(fitText(ctx, what, 230 - nw), -118 + nw + 16, 6);
  ctx.restore();
}

function paintWeek(ctx: CanvasRenderingContext2D, week: Week, company: string) {
  const { w, h } = TEX;
  ctx.fillStyle = '#fbfbf8';
  ctx.fillRect(0, 0, w, h);
  // old marker, not quite wiped off
  ctx.strokeStyle = 'rgba(141, 153, 174, 0.12)';
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(620, 560);
  ctx.quadraticCurveTo(760, 500, 960, 570);
  ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = BLUE;
  ctx.font = `700 60px ${SANS}`;
  ctx.fillText('This week', 44, 62);
  ctx.fillStyle = GREY;
  ctx.font = `500 30px ${SANS}`;
  ctx.textAlign = 'right';
  ctx.fillText(fitText(ctx, company, 380), w - 44, 66);
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(44, 104);
  ctx.quadraticCurveTo(200, 96, 330, 106);
  ctx.stroke();

  // merges a day, in green marker; today's label underlined in red
  const base = 500;
  const top = 160;
  const most = Math.max(1, ...week.days.map((d) => d.merged));
  week.days.forEach((d, i) => {
    const x = 52 + i * 78;
    const bh = (d.merged / most) * (base - top - 40);
    if (d.merged) {
      ctx.fillStyle = d.today ? RED : GREEN;
      roundRect(ctx, x, base - bh, 54, bh, 10);
      ctx.fill();
      ctx.fillStyle = '#1f1d2b';
      ctx.textAlign = 'center';
      ctx.font = `700 30px ${SANS}`;
      ctx.fillText(String(d.merged), x + 27, base - bh - 22);
    }
    ctx.fillStyle = d.today ? RED : '#3d405b';
    ctx.textAlign = 'center';
    ctx.font = `${d.today ? 700 : 500} 28px ${SANS}`;
    ctx.fillText(d.label, x + 27, base + 30);
    if (d.today) {
      ctx.strokeStyle = RED;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x + 4, base + 52);
      ctx.lineTo(x + 50, base + 52);
      ctx.stroke();
    }
  });
  ctx.strokeStyle = '#3d405b';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(40, base + 2);
  ctx.lineTo(600, base + 2);
  ctx.stroke();
  if (!week.merged) {
    ctx.fillStyle = GREY;
    ctx.textAlign = 'center';
    ctx.font = `600 34px ${SANS}`;
    ctx.fillText("Let's ship something! 🚀", 320, 330);
  }

  note(ctx, 650, 130, '#ffe066', -0.04, week.merged, 'merged');
  note(ctx, 660, 262, '#ffadc6', 0.03, week.opened, 'PRs opened');
  note(ctx, 646, 394, '#b9fbc0', -0.02, week.filed, 'issues filed');
  ctx.fillStyle = BLUE;
  ctx.textAlign = 'left';
  ctx.font = `600 30px ${SANS}`;
  if (week.best) ctx.fillText(fitText(ctx, `⭐ Top floor: ${week.best.name} (${week.best.merged})`, w - 88), 44, h - 34);
}

export function CeoWeekBoard() {
  const floors = useStore((s) => s.floors);
  const recent = useStore((s) => s.records.recent);
  const company = useStore((s) => s.settings.companyName) || 'Marshmallow';
  // the floors change all the time (issues, PRs); the board only when what it says does
  const week = useMemo(() => companyWeek(floors, recent, Date.now()), [floors, recent]);
  const key = JSON.stringify([company, week]);
  const tex = useCanvasTexture(TEX.w, TEX.h, (ctx) => paintWeek(ctx, week, company), [key]);
  const face = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  face.map = tex;
  useEffect(() => () => face.dispose(), [face]);
  const { x, z, w, h, y } = EXEC_WEEK;
  // the stand faces west, towards the table; the board's face is just in front of its frame
  return (
    <group position={[x, 0, z]} rotation={[0, Math.PI / 2, 0]}>
      <mesh position={[0, y + h / 2, -0.02]} rotation={[0, Math.PI, 0]} material={face}>
        <planeGeometry args={[w, h]} />
      </mesh>
    </group>
  );
}
