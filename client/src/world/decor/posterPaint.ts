// Paints a repo poster (poster.ts decides its design) onto a canvas: the style's art in a panel at the top, the repo's
// short name in big type under it, the floor and the owner, and a bar and legend of its languages (a quiet line of dots
// for a repository without any yet). Every random choice comes from the plan's seed, so a repaint looks the same, and
// the rug's pattern comes from the same seeds. New in Marshmallow.
import { roundRect, SANS } from '../draw';
import { blend, rng, type PosterPlan } from './poster';

type Ctx = CanvasRenderingContext2D;
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The size the poster is painted at (its frame is 1 by 1.3 m). */
export const POSTER_PX = { w: 512, h: 666 };

const pick = <T>(list: readonly T[], i: number) => list[((i % list.length) + list.length) % list.length];

function bauhaus(ctx: Ctx, b: Box, p: PosterPlan, r: () => number) {
  const n = 3;
  const cw = b.w / n;
  const ch = b.h / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x = b.x + i * cw;
      const y = b.y + j * ch;
      const c = pick(p.palette.accents, i + j * n + Math.floor(r() * 3));
      const shape = Math.floor(r() * 5);
      ctx.fillStyle = c;
      ctx.beginPath();
      if (shape === 0) ctx.arc(x + cw / 2, y + ch / 2, Math.min(cw, ch) * 0.42, 0, Math.PI * 2);
      else if (shape === 1) {
        // a quarter circle from a corner
        const k = Math.floor(r() * 4);
        const cx = x + (k & 1 ? cw : 0);
        const cy = y + (k & 2 ? ch : 0);
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, Math.min(cw, ch), (k * Math.PI) / 2, (k * Math.PI) / 2 + Math.PI / 2);
      } else if (shape === 2) {
        ctx.moveTo(x, y + ch);
        ctx.lineTo(x + cw / 2, y);
        ctx.lineTo(x + cw, y + ch);
      } else if (shape === 3) ctx.rect(x + cw * 0.15, y + ch * 0.15, cw * 0.7, ch * 0.7);
      else {
        ctx.arc(x + cw / 2, y + ch, cw / 2, Math.PI, 0);
      }
      ctx.fill();
    }
}

function waves(ctx: Ctx, b: Box, p: PosterPlan, r: () => number) {
  const bands = 6 + p.count;
  for (let k = bands; k >= 0; k--) {
    const base = b.y + (k / bands) * b.h * 1.05;
    const amp = 8 + r() * 18;
    const freq = 1.5 + r() * 2.5;
    const phase = p.turn + k * 0.7;
    ctx.fillStyle = pick(p.palette.accents, k);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y + b.h);
    for (let x = 0; x <= b.w; x += 8) ctx.lineTo(b.x + x, base + Math.sin((x / b.w) * Math.PI * 2 * freq + phase) * amp);
    ctx.lineTo(b.x + b.w, b.y + b.h);
    ctx.closePath();
    ctx.fill();
  }
}

function sunburst(ctx: Ctx, b: Box, p: PosterPlan, r: () => number) {
  const cx = b.x + b.w * (0.3 + p.shift * 0.4);
  const cy = b.y + b.h * 0.95;
  const rays = 14 + p.count * 2;
  const far = Math.hypot(b.w, b.h) * 1.1;
  for (let k = 0; k < rays; k++) {
    const a0 = Math.PI + (k / rays) * Math.PI;
    const a1 = Math.PI + ((k + 0.5) / rays) * Math.PI;
    ctx.fillStyle = pick(p.palette.accents, k);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a0) * far, cy + Math.sin(a0) * far);
    ctx.lineTo(cx + Math.cos(a1) * far, cy + Math.sin(a1) * far);
    ctx.fill();
  }
  ctx.fillStyle = p.palette.bg;
  ctx.beginPath();
  ctx.arc(cx, cy, b.h * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pick(p.palette.accents, Math.floor(r() * 5));
  ctx.beginPath();
  ctx.arc(cx, cy, b.h * 0.27, 0, Math.PI * 2);
  ctx.fill();
}

/** A mirrored pixel pattern, like an identicon. */
function pixels(ctx: Ctx, b: Box, p: PosterPlan, r: () => number) {
  const cols = 8;
  const size = b.w / cols;
  const rows = Math.floor(b.h / size);
  const y0 = b.y + (b.h - rows * size) / 2;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols / 2; i++) {
      if (r() < 0.38) continue;
      ctx.fillStyle = pick(p.palette.accents, Math.floor(r() * p.palette.accents.length));
      const g = size * 0.08;
      for (const col of [i, cols - 1 - i]) {
        roundRect(ctx, b.x + col * size + g, y0 + j * size + g, size - g * 2, size - g * 2, size * 0.18);
        ctx.fill();
      }
    }
}

/** Isometric blocks stacked on a grid, three shades a side. */
function blocks(ctx: Ctx, b: Box, p: PosterPlan, r: () => number) {
  const s = b.w / 7;
  const hx = s * 0.866;
  const ox = b.x + b.w / 2;
  const oy = b.y + b.h * 0.3;
  const cube = (gx: number, gy: number, gz: number, c: string) => {
    const x = ox + (gx - gy) * hx;
    const y = oy + (gx + gy) * s * 0.5 - gz * s;
    const top = blend(c, '#ffffff', 0.25);
    const left = c;
    const right = blend(c, '#000000', 0.25);
    const face = (pts: number[][], fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.fill();
    };
    face([[x, y], [x + hx, y + s / 2], [x, y + s], [x - hx, y + s / 2]], top);
    face([[x - hx, y + s / 2], [x, y + s], [x, y + 2 * s], [x - hx, y + 1.5 * s]], left);
    face([[x + hx, y + s / 2], [x, y + s], [x, y + 2 * s], [x + hx, y + 1.5 * s]], right);
  };
  for (let gx = 0; gx < 4; gx++)
    for (let gy = 0; gy < 4; gy++) {
      const h = Math.floor(r() * 3);
      for (let gz = 0; gz <= h; gz++) if (r() > 0.15 || gz === 0) cube(gx - 1.5, gy - 1.5, gz, pick(p.palette.accents, gx + gy + gz));
    }
}

/** Contour lines round two or three hills, spread over the panel. */
function topo(ctx: Ctx, b: Box, p: PosterPlan, r: () => number) {
  const n = 2 + (p.count % 2);
  const hills = Array.from({ length: n }, (_, i) => ({
    x: b.x + b.w * (0.2 + ((i + r() * 0.8) / n) * 0.6),
    y: b.y + b.h * (0.25 + r() * 0.5),
    k: 0.7 + r() * 0.6,
  }));
  ctx.lineWidth = 4;
  for (let ring = 1; ring <= (n > 2 ? 8 : 11); ring++) {
    for (const [hi, h] of hills.entries()) {
      ctx.strokeStyle = pick(p.palette.accents, ring + hi);
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.12) {
        const wobble = 1 + 0.18 * Math.sin(a * 3 + p.turn + hi) + 0.08 * Math.sin(a * 7 + ring);
        const rad = ring * 17 * h.k * wobble;
        const x = h.x + Math.cos(a) * rad;
        const y = h.y + Math.sin(a) * rad;
        if (a === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}

/** Arcs nested from the bottom edge, like a rainbow, each band an accent. */
function rainbow(ctx: Ctx, b: Box, p: PosterPlan, r: () => number) {
  const cx = b.x + b.w * (0.25 + p.shift * 0.5);
  const cy = b.y + b.h;
  const bands = 6 + (p.count % 3);
  const step = (Math.max(b.w, b.h) * 0.95) / bands;
  for (let k = bands; k >= 1; k--) {
    ctx.fillStyle = pick(p.palette.accents, k + Math.floor(r() * 2));
    ctx.beginPath();
    ctx.arc(cx, cy, k * step, Math.PI, 0);
    ctx.fill();
  }
  ctx.fillStyle = blend(p.palette.bg, p.palette.accents[0], p.dark ? 0.22 : 0.12);
  ctx.beginPath();
  ctx.arc(cx, cy, step * 0.8, Math.PI, 0);
  ctx.fill();
}

/** A halftone: a grid of dots growing towards one corner, in bands of the accents. */
function dots(ctx: Ctx, b: Box, p: PosterPlan, r: () => number) {
  const n = 9;
  const s = b.w / n;
  const corner = { x: b.x + (p.shift < 0.5 ? 0 : b.w), y: b.y + (r() < 0.5 ? 0 : b.h) };
  const far = Math.hypot(b.w, b.h);
  for (let j = 0; j * s < b.h + s; j++)
    for (let i = 0; i < n; i++) {
      const x = b.x + (i + 0.5) * s;
      const y = b.y + (j + 0.5) * s;
      const k = 1 - Math.hypot(x - corner.x, y - corner.y) / far;
      ctx.fillStyle = pick(p.palette.accents, Math.floor(k * 4 + (i + j) * 0.15));
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, s * 0.48 * k), 0, Math.PI * 2);
      ctx.fill();
    }
}

const ART = { bauhaus, waves, sunburst, pixels, blocks, topo, rainbow, dots };

/** The biggest bold type, up to `max` px, that fits `text` in `width`. */
function fit(ctx: Ctx, text: string, width: number, max: number, min = 28) {
  let size = max;
  ctx.font = `700 ${size}px ${SANS}`;
  while (size > min && ctx.measureText(text).width > width) ctx.font = `700 ${(size -= 4)}px ${SANS}`;
  return size;
}

/** Paints the poster `p` over the whole canvas, w by h. */
export function paintPoster(ctx: Ctx, w: number, h: number, p: PosterPlan) {
  const r = rng(p.seed ^ 0x5bd1e995);
  const { bg, ink, accents } = p.palette;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const pad = w * 0.06;
  const art: Box = { x: pad, y: pad, w: w - pad * 2, h: h * 0.56 };
  ctx.save();
  roundRect(ctx, art.x, art.y, art.w, art.h, w * 0.03);
  ctx.clip();
  ctx.fillStyle = blend(bg, accents[0], p.dark ? 0.22 : 0.12);
  ctx.fillRect(art.x, art.y, art.w, art.h);
  ART[p.style](ctx, art, p, r);
  ctx.restore();

  // the name, the floor and the owner
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = ink;
  const titleY = art.y + art.h + h * 0.12;
  fit(ctx, p.title, w - pad * 2, w * 0.2);
  ctx.fillText(p.title, pad, titleY);
  ctx.fillStyle = accents[0];
  ctx.fillRect(pad, titleY + h * 0.018, w * 0.16, h * 0.01);
  ctx.fillStyle = blend(ink, bg, 0.35);
  ctx.font = `600 ${Math.round(w * 0.042)}px ${SANS}`;
  ctx.fillText([`FLOOR ${p.floor}`, p.owner].filter(Boolean).join('  ·  ').toUpperCase(), pad + w * 0.19, titleY + h * 0.03);

  // the languages: a bar and a legend, or dots for a repository without any yet
  const barY = titleY + h * 0.07;
  const barW = w - pad * 2;
  const barH = h * 0.026;
  if (!p.legend.length) {
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = pick(accents, i);
      ctx.beginPath();
      ctx.arc(pad + barH / 2 + i * barH * 1.7, barY + barH / 2, barH / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = blend(ink, bg, 0.3);
    ctx.font = `500 ${Math.round(w * 0.045)}px ${SANS}`;
    ctx.fillText('a fresh repository, just getting started', pad, barY + barH + h * 0.06);
    return;
  }
  ctx.save();
  roundRect(ctx, pad, barY, barW, barH, barH / 2);
  ctx.clip();
  let x = pad;
  for (const row of p.legend) {
    ctx.fillStyle = row.color;
    ctx.fillRect(x, barY, barW * row.share + 1, barH);
    x += barW * row.share;
  }
  ctx.restore();
  ctx.font = `500 ${Math.round(w * 0.042)}px ${SANS}`;
  p.legend.forEach((row, i) => {
    const cx = pad + (i % 2) * (barW / 2);
    const cy = barY + barH + h * 0.05 + Math.floor(i / 2) * h * 0.05;
    ctx.fillStyle = row.color;
    ctx.beginPath();
    ctx.arc(cx + 9, cy - 8, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ink;
    const name = row.name.length > 13 ? `${row.name.slice(0, 12)}…` : row.name;
    ctx.fillText(`${name} ${row.pct}%`, cx + 26, cy);
  });
}

/**
 * A rug's pattern in the floor's colours, from a seed: a border, a field and a motif (diamonds, stripes or rings), the
 * pile darker at the edge. `px` per metre of rug.
 */
export function paintRug(ctx: Ctx, w: number, h: number, color: string, seed: number) {
  const r = rng(seed);
  const field = blend(color, '#fbf6ec', 0.55);
  const deep = blend(color, '#1f1d2b', 0.35);
  const light = blend(color, '#ffffff', 0.75);
  ctx.fillStyle = deep;
  ctx.fillRect(0, 0, w, h);
  const b = Math.min(w, h) * 0.07;
  ctx.fillStyle = light;
  ctx.fillRect(b * 0.5, b * 0.5, w - b, h - b);
  ctx.fillStyle = field;
  ctx.fillRect(b, b, w - b * 2, h - b * 2);
  const motif = Math.floor(r() * 3);
  const inner = { x: b * 1.6, y: b * 1.6, w: w - b * 3.2, h: h - b * 3.2 };
  ctx.save();
  ctx.beginPath();
  ctx.rect(inner.x, inner.y, inner.w, inner.h);
  ctx.clip();
  if (motif === 0) {
    const s = Math.min(inner.w, inner.h) / (3 + Math.floor(r() * 2));
    for (let y = inner.y; y < inner.y + inner.h + s; y += s)
      for (let x = inner.x; x < inner.x + inner.w + s; x += s) {
        ctx.fillStyle = (Math.round((x + y) / s) & 1) === 0 ? color : deep;
        ctx.beginPath();
        ctx.moveTo(x, y - s * 0.4);
        ctx.lineTo(x + s * 0.4, y);
        ctx.lineTo(x, y + s * 0.4);
        ctx.lineTo(x - s * 0.4, y);
        ctx.fill();
      }
  } else if (motif === 1) {
    const n = 7 + Math.floor(r() * 5);
    const along = inner.w > inner.h;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 3 === 0 ? deep : i % 3 === 1 ? color : light;
      if (along) ctx.fillRect(inner.x + (i / n) * inner.w, inner.y, inner.w / n / 2, inner.h);
      else ctx.fillRect(inner.x, inner.y + (i / n) * inner.h, inner.w, inner.h / n / 2);
    }
  } else {
    const cx = inner.x + inner.w / 2;
    const cy = inner.y + inner.h / 2;
    for (let k = 6; k >= 1; k--) {
      ctx.fillStyle = k % 2 ? color : light;
      ctx.beginPath();
      ctx.ellipse(cx, cy, (inner.w / 2) * (k / 6), (inner.h / 2) * (k / 6), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  // a fringe on the short ends
  ctx.fillStyle = light;
  const along = w > h;
  for (let i = 0; i < 40; i++) {
    const t = (i + 0.5) / 40;
    if (along) {
      ctx.fillRect(0, t * h, b * 0.35, 2);
      ctx.fillRect(w - b * 0.35, t * h, b * 0.35, 2);
    } else {
      ctx.fillRect(t * w, 0, 2, b * 0.35);
      ctx.fillRect(t * w, h - b * 0.35, 2, b * 0.35);
    }
  }
}
