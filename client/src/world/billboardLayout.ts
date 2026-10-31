// Adapted from cubefarm client/src/world/roof/billboardLayout.ts (MIT): seen from every floor's side windows and from the
// roof rather than through the roof's telescope, so they stand round the windows' sides first and at their roofs'
// front edges; six boards, not four (the floor at work and the latest merge as well), with the numbers counted here.

// The billboards on the city's rooftops round the office (Billboards.tsx), with the office's own news on them. Pure:
// where they stand (the nearest bare roofs, east and west first where the windows look, then north and south for the
// roof terrace, each in clear sight) and what they say. Units are cityLayout.ts's.

import { isBusy, type Floor, type PullInfo, type QaRecord, type Worker } from '../../../shared/types';
import type { CityBox, CityLayout } from './cityLayout';
import { EYE_HEIGHT, FLOOR_HEIGHT, HALF_W } from './layout';

/** A board's face (w × h) on legs above its building's roof. */
export const BOARD = { w: 12, h: 5.2, legs: 3 };
/** How far out to look for buildings to put boards on, from the office's middle. */
export const BOARD_RANGE = { min: 42, max: 140 };
/** How many boards: two out of each side's windows, one north and one south for the roof. */
export const BOARDS = 6;

export type Sector = 'east' | 'west' | 'north' | 'south';

export interface BillboardSpot {
  /** The middle of the face, from street level. */
  x: number;
  y: number;
  z: number;
  /** Turned (about y) to face the office. */
  yaw: number;
  /** Its building's roof. */
  top: number;
  dist: number;
  sector: Sector;
}

type P = { x: number; y: number; z: number };

/** Whether the segment a → b passes through the box of `c` (a building, or a water tower's tank taken as a box): a slab test. */
export function blocks(c: CityBox, a: P, b: P): boolean {
  let t0 = 0;
  let t1 = 1;
  const axes: [number, number, number, number][] = [
    [a.x, b.x - a.x, c.x - c.w / 2, c.x + c.w / 2],
    [a.y, b.y - a.y, c.y, c.y + c.h],
    [a.z, b.z - a.z, c.z - c.d / 2, c.z + c.d / 2],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false;
      continue;
    }
    let ta = (lo - o) / d;
    let tb = (hi - o) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/** Whether roof clutter `k` would stand in a board's way: within a metre of its face, its legs or its catwalk. */
export function inTheWay(k: CityBox, spot: Pick<BillboardSpot, 'x' | 'z' | 'yaw'>): boolean {
  const dx = k.x - spot.x;
  const dz = k.z - spot.z;
  const along = dx * Math.cos(spot.yaw) - dz * Math.sin(spot.yaw);
  const across = dx * Math.sin(spot.yaw) + dz * Math.cos(spot.yaw);
  const r = Math.max(k.w, k.d) / 2;
  return Math.abs(along) < BOARD.w / 2 + 1 + r && Math.abs(across) < 1.5 + r;
}

/** Which way from the office (x, z) lies: east and west within 50° of the side walls' windows, else north or south. */
export function sectorOf(x: number, z: number): Sector {
  const a = Math.abs(Math.atan2(z, x));
  if (a <= (50 * Math.PI) / 180) return 'east';
  if (a >= (130 * Math.PI) / 180) return 'west';
  return z < 0 ? 'north' : 'south';
}

const eye = (storey: number) => storey * FLOOR_HEIGHT + EYE_HEIGHT;

/**
 * Where a board in `sector` must be seen whole from: the side windows of the first floor and of a high one, or for
 * the north and south boards (no windows face them) the roof of the lowest building and of a tall one.
 */
export function eyesFor(sector: Sector): P[] {
  if (sector === 'east' || sector === 'west') {
    const x = sector === 'east' ? HALF_W : -HALF_W;
    return [1, 9].map((s) => ({ x, y: eye(s), z: 0 }));
  }
  return [3, 11].map((s) => ({ x: 0, y: eye(s), z: 0 }));
}

/** The order boards are handed out in: a window's view each side, then the second each side, then the roof's two. */
const ORDER: Sector[] = ['east', 'west', 'east', 'west', 'north', 'south'];

/** Up to `count` boards, each on the bare roof of the nearest building in range whose board its eyes see whole. */
export function billboardSpots(layout: CityLayout, count = BOARDS): BillboardSpot[] {
  // A building's roof is the top of its highest tier.
  const tops = new Map<string, number>();
  for (const b of layout.buildings) tops.set(`${b.x},${b.z}`, Math.max(tops.get(`${b.x},${b.z}`) ?? 0, b.y + b.h));
  const bits = [...layout.boxes, ...layout.cylinders, ...layout.cones];
  // only what's nearer than the furthest board can stand in the way
  const solids: CityBox[] = [...layout.buildings, ...bits].filter((c) => Math.hypot(c.x, c.z) - Math.hypot(c.w, c.d) / 2 < BOARD_RANGE.max);
  const candidates: BillboardSpot[] = [];
  for (const b of layout.buildings) {
    if (b.y !== 0 || Math.min(b.w, b.d) < 8) continue;
    const dist = Math.hypot(b.x, b.z);
    if (dist < BOARD_RANGE.min || dist > BOARD_RANGE.max) continue;
    const top = tops.get(`${b.x},${b.z}`)!;
    // at the roof's edge nearest the office, so it shows over the parapet from the lowest floor
    const ux = -b.x / dist;
    const uz = -b.z / dist;
    const edge = Math.min(Math.abs(ux) > 1e-6 ? b.w / 2 / Math.abs(ux) : Infinity, Math.abs(uz) > 1e-6 ? b.d / 2 / Math.abs(uz) : Infinity);
    const inset = Math.max(0, edge - 2.5);
    const x = b.x + ux * inset;
    const z = b.z + uz * inset;
    const spot: BillboardSpot = { x, y: top + BOARD.legs + BOARD.h / 2, z, yaw: Math.atan2(-x, -z), top, dist: Math.hypot(x, z), sector: sectorOf(b.x, b.z) };
    // clear of any water tower, hut or aerial up there
    if (bits.some((k) => k.y >= top - 0.5 && inTheWay(k, spot))) continue;
    // the face's middle and all four corners in sight (not quite to the face, so its own legs don't count)
    const side = { x: Math.cos(spot.yaw) * (BOARD.w / 2), z: -Math.sin(spot.yaw) * (BOARD.w / 2) };
    const ends = [spot, ...[1, -1].flatMap((s) => [1, -1].map((u) => ({ x: spot.x + s * side.x, y: spot.y + (u * BOARD.h) / 2, z: spot.z + s * side.z })))];
    const seen = eyesFor(spot.sector).every((e) =>
      ends.every((p) => {
        const to = { x: e.x + (p.x - e.x) * 0.97, y: e.y + (p.y - e.y) * 0.97, z: e.z + (p.z - e.z) * 0.97 };
        return !solids.some((c) => blocks(c, e, to));
      }),
    );
    if (seen) candidates.push(spot);
  }
  candidates.sort((a, b) => a.dist - b.dist);
  const out: BillboardSpot[] = [];
  const apart = (c: BillboardSpot) => out.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > 40);
  for (const sector of ORDER) {
    if (out.length >= count) break;
    const c = candidates.find((k) => k.sector === sector && !out.includes(k) && apart(k));
    if (c) out.push(c);
  }
  for (const c of candidates) {
    if (out.length >= count) break;
    if (!out.includes(c) && apart(c)) out.push(c);
  }
  return out;
}

// ---------- what they say ----------

/** The office's news, for the boards. */
export interface OfficeNumbers {
  company: string;
  floors: number;
  workers: number;
  working: number;
  issues: number;
  openPrs: number;
  inQa: number;
  mergedToday: number;
  /** The floor with the most workers busy (else the first), by its repo's name. */
  busiest: { name: string; working: number } | null;
  /** The latest merge in the last day. */
  lastMerge: { number: number; repo: string } | null;
}

type FloorNews = Pick<Floor, 'id' | 'fullName'> & { issues: readonly unknown[]; pulls: readonly Pick<PullInfo, 'number' | 'state' | 'mergedAt'>[] };

const DAY_MS = 86_400_000;
const repoName = (fullName: string) => fullName.split('/').pop() ?? fullName;

/** Counts the boards' numbers from the office's state; `now` is epoch ms, and "today" is the viewer's own day. */
export function officeNumbers(
  floors: readonly FloorNews[],
  workers: readonly Pick<Worker, 'role' | 'status' | 'floorId'>[],
  qa: readonly Pick<QaRecord, 'status'>[],
  company: string,
  now: number,
): OfficeNumbers {
  const team = workers.filter((w) => w.role === 'worker');
  const start = new Date(now);
  const midnight = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const merges = floors.flatMap((f) =>
    f.pulls.filter((p) => p.state === 'MERGED' && p.mergedAt && Number.isFinite(Date.parse(p.mergedAt))).map((p) => ({ number: p.number, repo: repoName(f.fullName), at: Date.parse(p.mergedAt!) })),
  );
  const latest = merges.filter((m) => now - m.at < DAY_MS && m.at <= now + 60_000).sort((a, b) => b.at - a.at)[0];
  const busy = floors.map((f) => ({ name: repoName(f.fullName), working: team.filter((w) => w.floorId === f.id && isBusy(w.status)).length }));
  const busiest = busy.reduce<(typeof busy)[number] | null>((best, f) => (!best || f.working > best.working ? f : best), null);
  return {
    company,
    floors: floors.length,
    workers: team.length,
    working: team.filter((w) => isBusy(w.status)).length,
    issues: floors.reduce((n, f) => n + f.issues.length, 0),
    openPrs: floors.reduce((n, f) => n + f.pulls.filter((p) => p.state === 'OPEN').length, 0),
    inQa: qa.filter((q) => q.status === 'queued' || q.status === 'testing').length,
    mergedToday: merges.filter((m) => m.at >= midnight && m.at <= now + 60_000).length,
    busiest,
    lastMerge: latest ? { number: latest.number, repo: latest.repo } : null,
  };
}

export interface BoardText {
  /** A small line on top, the big number or word, and a line under it. */
  top: string;
  big: string;
  under: string;
  /** Background and text colours. */
  bg: string;
  fg: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Six boards' worth: the team at work, today's merges, the backlog, the company's own ad, the floor at work, the latest merge. */
export function boardTexts(n: OfficeNumbers): BoardText[] {
  return [
    { top: 'WORKERS AT WORK RIGHT NOW', big: `${n.working} / ${n.workers}`, under: `on ${plural(n.floors, 'floor')}`, bg: '#ffd166', fg: '#2b2d42' },
    { top: 'MERGED TODAY', big: String(n.mergedToday), under: `${plural(n.openPrs, 'PR')} open · ${n.inQa} in QA`, bg: '#06d6a0', fg: '#073b4c' },
    { top: 'OPEN ISSUES', big: String(n.issues), under: n.issues ? 'the backlog awaits' : 'inbox zero!', bg: '#ef476f', fg: '#ffffff' },
    { top: (n.company.trim() || 'Marshmallow').toUpperCase(), big: 'SHIP IT', under: 'small PRs, happy reviewers', bg: '#3a86ff', fg: '#ffffff' },
    n.busiest
      ? { top: 'NOW BUILDING', big: n.busiest.name.toUpperCase(), under: n.busiest.working ? `${plural(n.busiest.working, 'worker')} on it` : 'waiting for issues', bg: '#9b5de5', fg: '#ffffff' }
      : { top: 'NOW BUILDING', big: 'YOUR REPO', under: 'connect one to start', bg: '#9b5de5', fg: '#ffffff' },
    n.lastMerge
      ? { top: 'LATEST MERGE', big: `#${n.lastMerge.number}`, under: n.lastMerge.repo, bg: '#f4a261', fg: '#2b2d42' }
      : { top: 'LATEST MERGE', big: 'SOON', under: 'the first one is on its way', bg: '#f4a261', fg: '#2b2d42' },
  ];
}
