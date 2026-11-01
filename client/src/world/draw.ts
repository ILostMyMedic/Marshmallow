// Adapted from cubefarm client/src/world/draw.ts (MIT): the terminal, name tags, signs, glass, the facade, the
// whiteboard and the app screen (without its PR channels and screenshots); the browser pane is cut.
import type { ActivityKind, Floor, LogLine, Worker } from '../../../shared/types';
import type { CardTone, KanbanCard, KanbanColumns } from '../kanban';
import type { MonitorCaption, MonitorTone } from '../preview';
import { seededAppearance } from './appearance';

// 2D canvas painters for everything in the office that shows text: the desks' monitors, signs and name tags.

export const MONO = '"JetBrains Mono", Consolas, "Cascadia Mono", monospace';
export const SANS = 'Fredoka, "Segoe UI", system-ui, sans-serif';

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// ---------- terminal ----------

const TERM = {
  bg: '#1b1b29',
  bar: '#2a2a3d',
  text: '#e8e8f2',
  tool: '#8be9fd',
  result: '#8d8da8',
  system: '#bd93f9',
  error: '#ff6b6b',
  manager: '#ffb86c',
  done: '#50fa7b',
  thinking: '#f1fa8c',
};

const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const VERBS = ['Crafting', 'Pondering', 'Tinkering', 'Brewing', 'Noodling', 'Scheming', 'Assembling', 'Percolating'];

const ACTIVITY_VERB: Record<ActivityKind, string> = {
  read: 'Reading',
  edit: 'Editing',
  test: 'Testing',
  build: 'Building',
  browse: 'Browsing',
  git: 'Committing',
  ci: 'Checking CI',
  qa: 'Testing',
  fix: 'Fixing',
  talk: 'Talking',
  run: 'Running',
};

/** The spinner's word for what they're doing. */
export const activityVerb = (kind: ActivityKind | null | undefined) => (kind ? ACTIVITY_VERB[kind] : '');

/** What the title bar says they're on. */
function jobOf(w: Worker) {
  if (w.status === 'idle' || !w.task) return w.role === 'ceo' ? 'running the company' : 'idle';
  const t = w.task;
  if (t.kind === 'qa') return `testing PR #${t.prNumber}`;
  if (t.kind === 'fix') return `fixing PR #${t.prNumber}`;
  return t.issueNumber ? `issue #${t.issueNumber}` : 'idle';
}

/** A worker's terminal as their monitor shows it: their log, newest at the bottom, a spinner while they work. */
export function drawTerminal(ctx: CanvasRenderingContext2D, w: number, h: number, worker: Worker, lines: readonly LogLine[], now: number) {
  ctx.fillStyle = TERM.bg;
  ctx.fillRect(0, 0, w, h);

  // title bar
  const barH = 24;
  ctx.fillStyle = TERM.bar;
  ctx.fillRect(0, 0, w, barH);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(14 + i * 16, barH / 2, 5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#b8b8cc';
  ctx.font = `600 12px ${MONO}`;
  ctx.textBaseline = 'middle';
  const host = worker.role === 'ceo' ? 'hq' : worker.host === 'box' ? 'cloud' : 'marshmallow';
  ctx.fillText(`${worker.name.toLowerCase()}@${host} — ${jobOf(worker)} — claude`, 66, barH / 2 + 1);

  const busy = worker.status === 'working' || worker.status === 'preparing';
  if (!busy && lines.length <= 1) {
    drawScreensaver(ctx, 0, barH, w, h - barH, worker, now);
    return;
  }

  // log lines, newest at the bottom
  const fontSize = 11;
  const lh = 14;
  ctx.font = `${fontSize}px ${MONO}`;
  const charW = ctx.measureText('M').width;
  const cols = Math.max(10, Math.floor((w - 16) / charW));
  const footer = busy ? 22 : 6;
  const maxRows = Math.floor((h - barH - 8 - footer) / lh);
  const rows: { text: string; kind: LogLine['kind'] }[] = [];
  for (let i = lines.length - 1; i >= 0 && rows.length < maxRows; i--) {
    const l = lines[i];
    const chunks: string[] = [];
    const text = l.text || ' ';
    for (let p = 0; p < text.length; p += cols) chunks.push(text.slice(p, p + cols));
    for (let c = chunks.length - 1; c >= 0 && rows.length < maxRows; c--) rows.unshift({ text: chunks[c], kind: l.kind });
  }
  let y = barH + 8 + lh / 2;
  for (const r of rows) {
    if (r.kind === 'tool' && r.text.startsWith('⏺')) {
      ctx.fillStyle = TERM.done;
      ctx.fillText('⏺', 8, y);
      ctx.fillStyle = TERM.tool;
      ctx.fillText(r.text.slice(1), 8 + charW, y);
    } else {
      ctx.fillStyle = TERM[r.kind] ?? TERM.text;
      ctx.fillText(r.text, 8, y);
    }
    y += lh;
  }

  if (busy) {
    const frame = Math.floor(now / 120) % SPINNER.length;
    const verb = worker.status === 'preparing' ? 'Setting up the desk' : activityVerb(worker.activity?.kind) || VERBS[Math.floor(now / 6000) % VERBS.length];
    const secs = worker.startedAt ? Math.max(0, Math.floor((now - worker.startedAt) / 1000)) : 0;
    ctx.fillStyle = '#ff9e64';
    ctx.font = `600 ${fontSize}px ${MONO}`;
    ctx.fillText(`${SPINNER[frame]} ${verb}… (${Math.floor(secs / 60)}m ${secs % 60}s)`, 8, h - 11);
  }
}

function drawScreensaver(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, worker: Worker, now: number) {
  const t = now / 1000;
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#26264a');
  g.addColorStop(1, '#3b2a55');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const bx = x + w / 2 + Math.sin(t * 0.7) * w * 0.22;
  const by = y + h / 2 + Math.cos(t * 0.9) * h * 0.16;
  ctx.textAlign = 'center';
  ctx.font = `48px ${SANS}`;
  ctx.fillText('✻', bx, by - 16);
  ctx.fillStyle = '#ffd6a5';
  ctx.font = `600 20px ${SANS}`;
  ctx.fillText(`${worker.name} is free`, bx, by + 26);
  ctx.fillStyle = '#b8b8dd';
  ctx.font = `14px ${SANS}`;
  ctx.fillText(worker.role === 'ceo' ? 'thinking about the company…' : 'waiting for work…', bx, by + 48);
  ctx.textAlign = 'left';
}

// ---------- name tags and signs ----------

/** The icon a name tag leads with: what they're doing. */
export function tagIcon(w: Worker): string {
  if (w.needsSignIn) return '🔑';
  if (w.status === 'working') {
    const k = w.activity?.kind;
    return k === 'browse' ? '🌐' : k === 'run' || k === 'test' || k === 'build' ? '▶️' : k ? '⌨️' : '💭';
  }
  if (w.status === 'preparing') return '📦';
  if (w.status === 'done') return '✅';
  if (w.status === 'error') return '❗';
  if (w.status === 'stopped') return '⏸️';
  return w.role === 'ceo' ? '🏛️' : '☕';
}

/** A worker's name tag: an icon for what they're doing, their name and what they're on, ringed in their colour. */
export function drawTag(ctx: CanvasRenderingContext2D, w: number, h: number, worker: Worker, color: string) {
  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 4, 4, w - 8, h - 8, (h - 8) / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.textBaseline = 'middle';
  ctx.font = `38px ${SANS}`;
  ctx.fillText(tagIcon(worker), 22, h / 2 + 2);
  ctx.fillStyle = '#23263a';
  ctx.font = `700 40px ${SANS}`;
  const t = worker.status !== 'idle' ? worker.task : null;
  let label =
    worker.role === 'ceo'
      ? `${worker.name} · CEO`
      : t?.kind === 'fix' && t.prNumber
        ? `${worker.name} · 🔧 PR #${t.prNumber}`
        : t?.kind === 'qa' && t.prNumber
          ? `${worker.name} · 🧪 PR #${t.prNumber}`
          : t?.issueNumber
            ? `${worker.name} · #${t.issueNumber}`
            : worker.name;
  while (label.length > 4 && ctx.measureText(label).width > w - 96) label = `${label.slice(0, -2)}…`;
  ctx.fillText(label, 78, h / 2 + 2);
}

export function drawSign(ctx: CanvasRenderingContext2D, w: number, h: number, lines: { text: string; size: number; color?: string; weight?: number }[], bg: string, fg = '#ffffff') {
  roundRect(ctx, 0, 0, w, h, 28);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const total = lines.reduce((s, l) => s + l.size * 1.25, 0);
  let y = h / 2 - total / 2;
  for (const l of lines) {
    y += (l.size * 1.25) / 2;
    ctx.fillStyle = l.color ?? fg;
    ctx.font = `${l.weight ?? 700} ${l.size}px ${SANS}`;
    let text = l.text;
    while (text.length > 3 && ctx.measureText(text).width > w - 40) text = `${text.slice(0, -2)}…`;
    ctx.fillText(text, w / 2, y);
    y += (l.size * 1.25) / 2;
  }
  ctx.textAlign = 'left';
}

/** Window glass: a faint blue tint you see straight through, with two diagonal glints. */
export function drawGlass(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = 'rgba(205, 236, 255, 0.16)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
  for (const [x0, bw] of [
    [0.18, 0.07],
    [0.3, 0.025],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(w * x0, h);
    ctx.lineTo(w * (x0 + bw), h);
    ctx.lineTo(w * (x0 + bw + 0.22), 0);
    ctx.lineTo(w * (x0 + 0.22), 0);
    ctx.fill();
  }
}

/**
 * One bay of the building's outside, one storey tall, for the floors above and below yours: the wall, a window,
 * and the slab between floors along the top. `wall` is the fraction of the storey that's wall (the rest is slab).
 */
export function drawFacade(ctx: CanvasRenderingContext2D, w: number, h: number, wall: number, win: { x0: number; x1: number; y0: number; y1: number }) {
  ctx.fillStyle = '#f6ecda';
  ctx.fillRect(0, 0, w, h);
  const slab = h * (1 - wall);
  ctx.fillStyle = '#dccbb0';
  ctx.fillRect(0, 0, w, slab);
  ctx.fillStyle = '#b9a68a';
  ctx.fillRect(0, slab - 3, w, 3);
  // fractions of the storey, from its floor up
  const x0 = w * win.x0;
  const x1 = w * win.x1;
  const top = h - h * win.y1;
  const bottom = h - h * win.y0;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x0 - 5, top - 5, x1 - x0 + 10, bottom - top + 12);
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, '#8fc9ef');
  g.addColorStop(1, '#c4e6fb');
  ctx.fillStyle = g;
  ctx.fillRect(x0, top, x1 - x0, bottom - top);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.beginPath();
  ctx.moveTo(x0 + (x1 - x0) * 0.15, bottom);
  ctx.lineTo(x0 + (x1 - x0) * 0.25, bottom);
  ctx.lineTo(x0 + (x1 - x0) * 0.45, top);
  ctx.lineTo(x0 + (x1 - x0) * 0.35, top);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect((x0 + x1) / 2 - 3, top, 6, bottom - top);
  ctx.fillStyle = '#1f1d2b';
  ctx.fillRect(x0 - 5, bottom + 5, x1 - x0 + 10, 2);
}

// ---------- the whiteboard (adapted from cubefarm draw.ts: drawKanban, drawNote) ----------

/** `text` in at most `maxLines` lines no wider than `maxWidth`, the last one cut short with … if it all doesn't fit. */
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

/** Shorten text with an ellipsis until it fits in max pixels, in the context's current font. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, max: number) {
  let t = text;
  while (t.length > 2 && ctx.measureText(t).width > max) t = `${t.slice(0, -2)}…`;
  return t;
}

const COLS: { key: keyof KanbanColumns; title: string; chip: string; note: string }[] = [
  { key: 'backlog', title: '📋 Backlog', chip: '#ffd166', note: '#fff3b0' },
  { key: 'progress', title: '🔨 In progress', chip: '#4cc9f0', note: '#cfeefd' },
  { key: 'qa', title: '🔍 In QA', chip: '#ff9f68', note: '#ffe3cf' },
  { key: 'ready', title: '✅ Ready to merge', chip: '#80ed99', note: '#d8f9df' },
  { key: 'merged', title: '🎉 Merged', chip: '#c77dff', note: '#eadcff' },
];
/** The board's columns, left to right. */
export const KANBAN_KEYS: (keyof KanbanColumns)[] = COLS.map((c) => c.key);
/** A toned card's sticky colour on the board. */
const TONE: Record<CardTone, string> = { warn: '#ffd8a8', bad: '#ffc9c9', good: '#d8f9df' };

/** Where drawKanban puts column `ci` on a canvas `w` pixels wide: its left edge and width (the stand-up's spots line up with them). */
export function kanbanColumnSpan(ci: number, w: number) {
  const colW = (w - 80) / COLS.length;
  return { x0: 40 + ci * colW, colW };
}

const NOTE = { top: 96, h: 104, gap: 12, perCol: 2 };

/** How many notes fit in a column on a canvas `h` pixels tall (one slot goes to "+N more" when there are more). */
export const kanbanCapacity = (h: number) => Math.floor((h - NOTE.top - 70) / (NOTE.h + NOTE.gap)) * NOTE.perCol;

/** Where drawKanban puts the `i`th note of column `ci` on a `w` wide canvas. */
function kanbanNoteRect(ci: number, i: number, w: number) {
  const { x0, colW } = kanbanColumnSpan(ci, w);
  const nw = (colW - 48) / 2;
  return { x: x0 + 16 + (i % NOTE.perCol) * (nw + 16), y: NOTE.top + 68 + Math.floor(i / NOTE.perCol) * (NOTE.h + NOTE.gap), w: nw, h: NOTE.h };
}

/** The floor's board: its name and sync, then the five columns of sticky notes. */
export function drawKanban(ctx: CanvasRenderingContext2D, w: number, h: number, floor: Floor, cols: KanbanColumns) {
  ctx.fillStyle = '#fbfbf8';
  ctx.fillRect(0, 0, w, h);
  // faint marker smudges
  ctx.fillStyle = 'rgba(120,140,170,0.05)';
  for (let i = 0; i < 6; i++) ctx.fillRect((i * 431) % w, (i * 97) % h, 260, 40);

  ctx.textBaseline = 'middle';
  ctx.font = `500 26px ${SANS}`;
  const synced = floor.lastSync ? `synced ${new Date(floor.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'syncing…';
  const status = `${floor.autoAssign ? '⚡ auto-assign on · ' : ''}${synced}`;
  const statusW = ctx.measureText(status).width;
  ctx.font = `700 46px ${SANS}`;
  const nameW = Math.min(ctx.measureText(floor.fullName).width, w - 160 - statusW);
  ctx.fillStyle = '#2d3142';
  ctx.fillText(fitText(ctx, floor.fullName, nameW), 40, 48);
  ctx.font = `500 26px ${SANS}`;
  ctx.fillStyle = '#6c7086';
  ctx.fillText(status, 40 + nameW + 28, 52);

  const top = NOTE.top;
  COLS.forEach((c, ci) => {
    const { x0, colW } = kanbanColumnSpan(ci, w);
    const cards = cols[c.key];
    roundRect(ctx, x0 + 8, top, colW - 16, 52, 26);
    ctx.fillStyle = c.chip;
    ctx.fill();
    ctx.fillStyle = '#1f2233';
    ctx.font = `600 30px ${SANS}`;
    ctx.fillText(`${c.title}  ${cards.length}`, x0 + 30, top + 27);
    if (ci > 0) {
      ctx.strokeStyle = '#d9dbe3';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x0, top);
      ctx.lineTo(x0, h - 30);
      ctx.stroke();
    }
    const capacity = kanbanCapacity(h);
    const shown = cards.length > capacity ? cards.slice(0, capacity - 1) : cards;
    shown.forEach((card, i) => {
      const n = kanbanNoteRect(ci, i, w);
      drawNote(ctx, n.x, n.y, n.w, n.h, card, card.tone ? TONE[card.tone] : c.note);
    });
    if (cards.length > shown.length) {
      ctx.fillStyle = '#6c7086';
      ctx.font = `600 26px ${SANS}`;
      const n = kanbanNoteRect(ci, shown.length, w);
      ctx.fillText(`+${cards.length - shown.length} more`, n.x + 14, n.y + n.h / 2);
    }
    if (cards.length === 0) {
      ctx.fillStyle = '#b4b7c5';
      ctx.font = `italic 500 26px ${SANS}`;
      ctx.fillText(c.key === 'backlog' ? 'no open issues' : 'nothing here yet', x0 + 30, top + 110);
    }
  });
}

/** One sticky note: its number, its title in two lines, who's on it (a dot in their shirt colour) and its note. */
function drawNote(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, card: KanbanCard, color: string) {
  const tilt = (((card.number * 37) % 7) - 3) * 0.006;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(tilt);
  ctx.translate(-w / 2, -h / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(4, 6, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  ctx.fillRect(0, 0, w, 10);

  ctx.fillStyle = '#2d3142';
  ctx.font = `700 22px ${SANS}`;
  ctx.textBaseline = 'top';
  ctx.fillText(`${card.prNumber ? 'PR ' : ''}#${card.number}`, 14, 12);
  ctx.font = `500 19px ${SANS}`;
  wrap(ctx, card.title, w - 28, 2).forEach((l, i) => ctx.fillText(l, 14, 38 + i * 21));

  ctx.textBaseline = 'middle';
  if (card.worker) {
    ctx.fillStyle = seededAppearance(card.worker).shirt;
    ctx.beginPath();
    ctx.arc(22, h - 15, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2d3142';
    ctx.font = `600 17px ${SANS}`;
    ctx.fillText(card.worker.name, 36, h - 14);
  }
  if (card.note) {
    ctx.font = `500 16px ${SANS}`;
    ctx.fillStyle = '#5c6078';
    ctx.textAlign = 'right';
    ctx.fillText(card.note, w - 12, h - 14);
    ctx.textAlign = 'left';
  }
  ctx.restore();
  ctx.textBaseline = 'middle';
}

// ---------- the app monitor (adapted from cubefarm draw.ts: drawAppScreen) ----------

const APP_TONE: Record<MonitorTone, string> = { off: '#6c6c88', busy: '#f4a261', live: '#ef233c', bad: '#e63946' };

export interface AppScreenInfo {
  floor: number;
  name: string;
  color: string;
  caption: MonitorCaption;
  /** When a running app came up, as the clock shows it. */
  since: string | null;
}

/** The big screen on an office floor's north wall: the floor's app and how it's doing (preview.ts monitorCaption). */
export function drawAppScreen(ctx: CanvasRenderingContext2D, w: number, h: number, info: AppScreenInfo) {
  const c = info.caption;
  ctx.fillStyle = TERM.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // the header: the floor's chip, the repo's name, the state's badge
  const headH = 118;
  ctx.fillStyle = TERM.bar;
  ctx.fillRect(0, 0, w, headH);
  ctx.fillStyle = info.color;
  ctx.fillRect(0, headH - 6, w, 6);
  ctx.font = `700 34px ${SANS}`;
  const chip = `FLOOR ${info.floor}`;
  const chipW = ctx.measureText(chip).width + 44;
  roundRect(ctx, 40, 30, chipW, 54, 27);
  ctx.fillStyle = info.color;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(chip, 62, 58);
  ctx.font = `700 38px ${SANS}`;
  const badgeW = ctx.measureText(c.badge).width + 52;
  roundRect(ctx, w - 40 - badgeW, 28, badgeW, 58, 29);
  ctx.fillStyle = APP_TONE[c.tone];
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(c.badge, w - 40 - badgeW / 2, 58);
  ctx.textAlign = 'left';
  ctx.font = `700 50px ${SANS}`;
  const nameX = 40 + chipW + 26;
  ctx.fillText(fitText(ctx, info.name, w - 40 - badgeW - 26 - nameX), nameX, 58);

  const centred = (text: string, y: number, size: number, color: string, weight = 700, font = SANS) => {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(fitText(ctx, text, w - 100), w / 2, y);
    ctx.textAlign = 'left';
  };
  const footH = 100;
  const midY = headH + (h - headH - footH) / 2;

  if (c.tone === 'off') {
    // a big play button
    const cy = midY - 70;
    ctx.fillStyle = info.color;
    ctx.beginPath();
    ctx.arc(w / 2, cy, 84, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 26, cy - 42);
    ctx.lineTo(w / 2 - 26, cy + 42);
    ctx.lineTo(w / 2 + 44, cy);
    ctx.closePath();
    ctx.fill();
    centred(c.title, midY + 70, 72, '#ffffff');
    centred(c.detail, midY + 145, 38, '#b8b8cc', 600);
    centred(c.footer, h - footH + 50, 32, '#8d8da8', 600);
  } else if (c.tone === 'busy') {
    centred('Getting the app ready…', headH + 80, 46, '#b8b8cc', 600);
    centred(c.title, midY - 20, 72, '#ffffff');
    // a three-step progress bar
    const gap = 18;
    const segW = (w - 200 - gap * 2) / 3;
    for (let i = 0; i < 3; i++) {
      const x = 100 + i * (segW + gap);
      roundRect(ctx, x, midY + 80, segW, 34, 17);
      ctx.fillStyle = i < c.step ? TERM.done : i === c.step ? '#f4a261' : '#3a3a52';
      ctx.fill();
    }
    centred(c.detail, midY + 160, 32, '#b8b8cc', 600);
    centred(c.footer, h - footH + 50, 28, '#8d8da8', 500, MONO);
  } else if (c.tone === 'live') {
    // the "running at" card the live look covers once the app has loaded in it (AppMonitor.tsx)
    const left = 70;
    ctx.font = `600 36px ${SANS}`;
    ctx.fillStyle = '#b8b8cc';
    ctx.fillText('Running at', left, headH + 90);
    ctx.font = `700 76px ${MONO}`;
    ctx.fillStyle = TERM.tool;
    ctx.fillText(fitText(ctx, c.title, w - 2 * left), left, headH + 180);
    if (c.detail) {
      ctx.font = `700 42px ${SANS}`;
      const dW = ctx.measureText(c.detail).width + 48;
      roundRect(ctx, left, headH + 260, dW, 64, 32);
      ctx.fillStyle = info.color;
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(c.detail, left + 24, headH + 293);
    }
    if (info.since) {
      ctx.font = `500 34px ${SANS}`;
      ctx.fillStyle = '#8d8da8';
      ctx.fillText(`up since ${info.since}`, left, headH + 380);
    }
    centred(c.footer, h - footH + 50, 34, TERM.done, 600);
  } else {
    ctx.fillStyle = '#e63946';
    ctx.fillRect(0, midY - 120, w, 130);
    ctx.font = `700 44px ${SANS}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(fitText(ctx, `⚠ ${c.detail}`, w - 100), 50, midY - 55);
    centred(c.title, midY + 90, 56, '#ffffff');
    centred(c.footer, h - footH + 50, 32, '#ffb4ba', 600);
  }
}
