// The CEO's office's four pictures (layout.ts EXEC_ART), painted side by side on one canvas so all their faces are one
// draw call (ceoRoom.ts picturesGeometry maps each frame to its cell): a sunset over hills, a bold abstract, a
// rocket on its way to the moon and a portrait of the company's marshmallow. New in Marshmallow.
import { roundRect, SANS } from './draw';

/** The canvas: two columns and two rows of cells, each PICTURE_ASPECT wide. */
export const PICTURES_TEX = { w: 1024, h: 640, cols: 2, rows: 2 };
const CW = PICTURES_TEX.w / PICTURES_TEX.cols;
const CH = PICTURES_TEX.h / PICTURES_TEX.rows;

function sunset(ctx: CanvasRenderingContext2D) {
  const sky = ctx.createLinearGradient(0, 0, 0, CH);
  sky.addColorStop(0, '#ff8fa3');
  sky.addColorStop(0.65, '#ffd29d');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = 'rgba(255, 241, 168, 0.45)';
  ctx.beginPath();
  ctx.arc(350, 150, 78, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff1a8';
  ctx.beginPath();
  ctx.arc(350, 150, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  for (const [x, y, s] of [
    [110, 70, 1],
    [430, 60, 0.7],
  ]) {
    ctx.beginPath();
    ctx.ellipse(x, y, 52 * s, 18 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 30 * s, y - 12 * s, 34 * s, 18 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const hill = (color: string, y: number, amp: number, phase: number) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, CH);
    for (let x = 0; x <= CW; x += 16) ctx.lineTo(x, y - Math.sin(x / 90 + phase) * amp);
    ctx.lineTo(CW, CH);
    ctx.fill();
  };
  hill('#8fd694', 210, 26, 1);
  hill('#52b788', 250, 18, 3);
  // a little house and a tree on the near hill
  ctx.fillStyle = '#fdfdfd';
  ctx.fillRect(120, 214, 46, 34);
  ctx.fillStyle = '#e63946';
  ctx.beginPath();
  ctx.moveTo(112, 216);
  ctx.lineTo(143, 190);
  ctx.lineTo(174, 216);
  ctx.fill();
  ctx.fillStyle = '#6b4226';
  ctx.fillRect(386, 218, 8, 30);
  ctx.fillStyle = '#2d6a4f';
  ctx.beginPath();
  ctx.arc(390, 208, 22, 0, Math.PI * 2);
  ctx.fill();
}

function abstract(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#fdfaf3';
  ctx.fillRect(0, 0, CW, CH);
  const blocks: [number, number, number, number, string][] = [
    [0, 0, 170, 140, '#e63946'],
    [330, 0, 182, 90, '#ffd166'],
    [170, 200, 160, 120, '#1d4ed8'],
    [420, 230, 92, 90, '#ffd166'],
    [0, 260, 90, 60, '#264653'],
  ];
  for (const [x, y, w, h, c] of blocks) {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  }
  ctx.fillStyle = '#1f1d2b';
  for (const x of [170, 330, 420]) ctx.fillRect(x - 6, 0, 12, CH);
  for (const y of [140, 200, 260]) ctx.fillRect(0, y - 6, CW, 12);
  ctx.fillRect(90 - 6, 200, 12, CH - 200);
  ctx.fillRect(330, 90 - 6, CW - 330, 12);
  ctx.fillRect(420, 230 - 6, CW - 420, 12);
}

function rocket(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#1d2a44';
  ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 60; i++) {
    const x = (i * 97) % CW;
    const y = (i * 61 + (i % 7) * 13) % CH;
    ctx.globalAlpha = 0.4 + (i % 3) * 0.25;
    ctx.fillRect(x, y, 3, 3);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#f1f3f5';
  ctx.beginPath();
  ctx.arc(420, 80, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ced4da';
  for (const [x, y, r] of [
    [400, 66, 11],
    [440, 98, 8],
    [436, 62, 6],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // the trail: dashes curving up from the bottom left
  ctx.strokeStyle = 'rgba(255, 209, 102, 0.8)';
  ctx.lineWidth = 6;
  ctx.setLineDash([16, 14]);
  ctx.beginPath();
  ctx.moveTo(30, CH - 10);
  ctx.quadraticCurveTo(120, 240, 230, 190);
  ctx.stroke();
  ctx.setLineDash([]);
  // the rocket, nose towards the moon
  ctx.save();
  ctx.translate(270, 165);
  ctx.rotate(0.9);
  ctx.fillStyle = '#ff9f1c';
  ctx.beginPath();
  ctx.moveTo(-16, 46);
  ctx.lineTo(0, 92);
  ctx.lineTo(16, 46);
  ctx.fill();
  ctx.fillStyle = '#e63946';
  ctx.beginPath();
  ctx.moveTo(-26, 50);
  ctx.lineTo(-22, 18);
  ctx.lineTo(22, 18);
  ctx.lineTo(26, 50);
  ctx.fill();
  ctx.fillStyle = '#fdfdfd';
  ctx.beginPath();
  ctx.moveTo(-22, 46);
  ctx.lineTo(-22, -10);
  ctx.quadraticCurveTo(0, -70, 22, -10);
  ctx.lineTo(22, 46);
  ctx.fill();
  ctx.fillStyle = '#e63946';
  ctx.beginPath();
  ctx.moveTo(-18, -22);
  ctx.quadraticCurveTo(0, -70, 18, -22);
  ctx.fill();
  ctx.fillStyle = '#48cae4';
  ctx.beginPath();
  ctx.arc(0, 6, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function portrait(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#ffd6e0';
  ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = '#ffc2d1';
  for (let x = -CH; x < CW; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, CH);
    ctx.lineTo(x + CH, 0);
    ctx.lineTo(x + CH + 18, 0);
    ctx.lineTo(x + 18, CH);
    ctx.fill();
  }
  // an oval gold frame round the sitter
  ctx.fillStyle = '#f6d365';
  ctx.beginPath();
  ctx.ellipse(CW / 2, CH / 2, 128, 142, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9b5de5';
  ctx.beginPath();
  ctx.ellipse(CW / 2, CH / 2, 112, 126, 0, 0, Math.PI * 2);
  ctx.fill();
  // the marshmallow: a puffy rounded block with a face and a little crown
  const x = CW / 2;
  const y = CH / 2 + 22;
  ctx.fillStyle = '#fff8f0';
  roundRect(ctx, x - 62, y - 66, 124, 132, 38);
  ctx.fill();
  ctx.fillStyle = '#1f1d2b';
  for (const dx of [-22, 22]) {
    ctx.beginPath();
    ctx.arc(x + dx, y - 8, 8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#1f1d2b';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y + 10, 16, 0.2, Math.PI - 0.2);
  ctx.stroke();
  ctx.fillStyle = '#ffadc6';
  for (const dx of [-40, 40]) {
    ctx.beginPath();
    ctx.ellipse(x + dx, y + 12, 11, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.moveTo(x - 32, y - 70);
  ctx.lineTo(x - 36, y - 104);
  ctx.lineTo(x - 14, y - 84);
  ctx.lineTo(x, y - 110);
  ctx.lineTo(x + 14, y - 84);
  ctx.lineTo(x + 36, y - 104);
  ctx.lineTo(x + 32, y - 70);
  ctx.fill();
  ctx.fillStyle = '#6b4226';
  ctx.font = `700 22px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('THE FOUNDER', x, CH - 14);
}

/** The pictures in EXEC_ART's order, a cell each, left to right and top to bottom. */
const PAINTERS = [sunset, abstract, rocket, portrait];

/** Paints every picture into its cell. */
export function paintPictures(ctx: CanvasRenderingContext2D) {
  PAINTERS.forEach((paint, i) => {
    ctx.save();
    ctx.translate((i % PICTURES_TEX.cols) * CW, Math.floor(i / PICTURES_TEX.cols) * CH);
    ctx.beginPath();
    ctx.rect(0, 0, CW, CH);
    ctx.clip();
    paint(ctx);
    ctx.restore();
  });
}
