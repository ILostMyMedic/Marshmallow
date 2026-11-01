// Adapted from cubefarm client/src/world/decor/decor.test.ts (MIT): the slots' places, fits and reachability; the decor
// box, the arcade and openSlots are cut, the walk spots at the big spots, the wall art's checks and the kiosk are new.
import { describe, expect, it } from 'vitest';
import { SHOP, SHOP_SPOTS } from '../../../../shared/shop';
import type { FloorItem } from '../../../../shared/types';
import {
  APP_SCREEN,
  BOARD,
  CLOCK,
  COUCH,
  DESK_RUGS,
  ELEVATOR,
  GONG,
  HALF_D,
  HALF_W,
  OFFICE_PLANTS,
  SHOP_KIOSK,
  SIDE_DOOR,
  SIDE_OPENINGS,
  WALL_H,
  WINDOW,
  lobbyColliders,
  officeColliders,
  rect,
  type Rect,
} from '../layout';
import { findPath, spot, standable, walkways, WALK_R } from '../walkways';
import { ITEM_SIZE, PLACED_SPOTS, SPOT_AT, itemRect, itemSize, kindOf, kitTier, placedItems, placement, planRects, reservedRects, slotSpots, spotRect } from './spots';

const overlaps = (a: Rect, b: Rect, pad = 0) => a.minX < b.maxX + pad && a.maxX > b.minX - pad && a.minZ < b.maxZ + pad && a.maxZ > b.minZ - pad;
const contains = (outer: Rect, inner: Rect) => inner.minX >= outer.minX - 1e-6 && inner.maxX <= outer.maxX + 1e-6 && inner.minZ >= outer.minZ - 1e-6 && inner.maxZ <= outer.maxZ + 1e-6;
const inRoom = (r: Rect) => r.minX >= -HALF_W - 1e-6 && r.maxX <= HALF_W + 1e-6 && r.minZ >= -HALF_D - 1e-6 && r.maxZ <= HALF_D + 1e-6;
const ofKind = (k: string) => PLACED_SPOTS.filter((id) => kindOf(id) === k);
const standing = [...ofKind('big'), ...ofKind('floor')];
const EXTRAS = SHOP.filter((e) => e.type === 'extra');
const ELEVATOR_AREA: Rect = { minX: -1.6, maxX: 1.6, minZ: 9.6, maxZ: HALF_D };

/** Which wall a spot is against (within `near` of it), and its span along that wall. */
function onWall(r: Rect, near = 0.05): { wall: string; a: number; b: number }[] {
  const out: { wall: string; a: number; b: number }[] = [];
  if (r.minZ <= -HALF_D + near) out.push({ wall: 'north', a: r.minX, b: r.maxX });
  if (r.maxZ >= HALF_D - near) out.push({ wall: 'south', a: r.minX, b: r.maxX });
  if (r.minX <= -HALF_W + near) out.push({ wall: 'west', a: r.minZ, b: r.maxZ });
  if (r.maxX >= HALF_W - near) out.push({ wall: 'east', a: r.minZ, b: r.maxZ });
  return out;
}

/** What else hangs on or stands against the walls, as spans along them, up to `top` metres high. */
function wallThings(): { wall: string; a: number; b: number; top: number; what: string }[] {
  const out = [
    { wall: 'north', a: -BOARD.w / 2 - 0.2, b: BOARD.w / 2 + 0.2, top: WALL_H, what: 'whiteboard' },
    { wall: 'north', a: APP_SCREEN.x - APP_SCREEN.w / 2 - APP_SCREEN.bezel, b: APP_SCREEN.x + APP_SCREEN.w / 2 + APP_SCREEN.bezel, top: WALL_H, what: 'app monitor' },
    { wall: 'north', a: GONG.x - GONG.w / 2, b: GONG.x + GONG.w / 2, top: GONG.h, what: 'gong' },
    { wall: 'north', a: CLOCK.x - 0.4, b: CLOCK.x + 0.4, top: WALL_H, what: 'clock' },
    { wall: 'south', a: -ELEVATOR.doorHalf - 0.3, b: ELEVATOR.doorHalf + 0.3, top: WALL_H, what: 'elevator doors' },
    { wall: 'south', a: ELEVATOR.doorHalf + 0.35, b: ELEVATOR.doorHalf + 0.75, top: WALL_H, what: 'call button' },
    { wall: 'west', a: COUCH.z - 1.6, b: COUCH.z + 1.6, top: 1.05, what: 'couch' },
  ];
  for (const [x, z, s] of OFFICE_PLANTS) for (const w of onWall(rect(x, z, 0.72 * s, 0.72 * s), 1)) out.push({ ...w, top: 1.55 * s, what: `plant at ${x},${z}` });
  for (const side of ['west', 'east'] as const) {
    const { door, windows } = SIDE_OPENINGS.office[side];
    out.push({ wall: side, a: door - SIDE_DOOR.half, b: door + SIDE_DOOR.half, top: WALL_H, what: 'door' });
    for (const z of windows) out.push({ wall: side, a: z - WINDOW.w / 2, b: z + WINDOW.w / 2, top: WALL_H, what: `window at ${z}` });
  }
  return out;
}

describe('the shop spots', () => {
  it('has a place in the room for every spot the shop knows but the kit’s, and nothing else', () => {
    expect(Object.keys(SPOT_AT).sort()).toEqual(SHOP_SPOTS.filter((s) => s.kind !== 'kit').map((s) => s.id).sort());
    expect(PLACED_SPOTS).toEqual(SHOP_SPOTS.filter((s) => s.kind !== 'kit').map((s) => s.id));
    for (const e of EXTRAS) expect(ITEM_SIZE[e.id] ?? (e.id === 'rug' ? {} : undefined), e.id).toBeDefined();
  });

  it('fits every extra in every spot of its kind, what it blocks inside the room the spot keeps', () => {
    for (const e of EXTRAS) {
      if (e.type !== 'extra') continue;
      for (const id of ofKind(e.kind)) {
        const s = SPOT_AT[id];
        const size = itemSize(e.id, id);
        expect(size.w, `${e.id} in ${id}`).toBeLessThanOrEqual(s.w);
        if (e.kind !== 'wall') expect(size.d, `${e.id} in ${id}`).toBeLessThanOrEqual(s.d);
        const r = itemRect(id, e.id);
        if (e.kind === 'floor' || e.kind === 'big') {
          expect(r).not.toBeNull();
          expect(contains(spotRect(id)!, r!), `${e.id} in ${id}`).toBe(true);
        } else expect(r).toBeNull();
      }
    }
  });

  it('keeps the floor and big spots off the furniture, the named spots, the desks, the elevator and each other', () => {
    const solids = officeColliders();
    const w = walkways('office');
    for (const id of standing) {
      const r = spotRect(id)!;
      expect(inRoom(r), id).toBe(true);
      for (const c of solids) expect(overlaps(r, c), `${id} and ${JSON.stringify(c)}`).toBe(false);
      for (const s of [...w.spots, ...w.homes]) expect(overlaps(r, { minX: s.x, maxX: s.x, minZ: s.z, maxZ: s.z }, WALK_R + 0.2), `${id} and ${s.id}`).toBe(false);
      expect(overlaps(r, ELEVATOR_AREA), id).toBe(false);
      for (const other of standing.filter((o) => o !== id)) expect(overlaps(r, spotRect(other)!), `${id} and ${other}`).toBe(false);
    }
  });

  it('keeps what stands against a side wall clear of its windows and its door', () => {
    for (const id of standing) {
      for (const on of onWall(spotRect(id)!).filter((x) => x.wall === 'west' || x.wall === 'east')) {
        const { door, windows } = SIDE_OPENINGS.office[on.wall as 'west' | 'east'];
        for (const z of windows) expect(on.b <= z - WINDOW.w / 2 || on.a >= z + WINDOW.w / 2, `${id} and the window at ${z}`).toBe(true);
        expect(on.b <= door - SIDE_DOOR.half - 0.5 || on.a >= door + SIDE_DOOR.half + 0.5, `${id} and the door`).toBe(true);
      }
    }
  });

  it('lays the rugs inside the room, off the desks’ rugs, the elevator and anything standing in a spot', () => {
    for (const id of ofKind('rug')) {
      const r = spotRect(id)!;
      expect(inRoom(r), id).toBe(true);
      for (const d of DESK_RUGS) expect(overlaps(r, d), `${id} and a desk rug`).toBe(false);
      expect(overlaps(r, ELEVATOR_AREA), id).toBe(false);
      for (const other of [...standing, ...ofKind('rug').filter((o) => o !== id)]) expect(overlaps(r, spotRect(other)!), `${id} and ${other}`).toBe(false);
    }
    // under what they're for
    expect(overlaps(spotRect('rug-1')!, rect(COUCH.x, COUCH.z, 1, 1))).toBe(true);
    expect(contains(spotRect('rug-2')!, officeColliders().find((c) => c.minX < -6 && c.maxX > -7 && c.minZ > 7 && c.maxZ < 9.5)!)).toBe(true);
  });

  it('hangs wall art on a wall, facing the room, where nothing covers it', () => {
    const things = wallThings();
    const tallest = Math.max(...EXTRAS.filter((e) => e.type === 'extra' && e.kind === 'wall').map((e) => ITEM_SIZE[e.id].h));
    for (const id of ofKind('wall')) {
      const s = SPOT_AT[id];
      const r = spotRect(id)!;
      const on = onWall(r);
      expect(on, id).toHaveLength(1);
      const { wall, a, b } = on[0];
      // a step in from the corners, and its front out into the room
      expect(Math.min(a, b) > (wall === 'north' || wall === 'south' ? -HALF_W : -HALF_D) + 0.4 && Math.max(a, b) < (wall === 'north' || wall === 'south' ? HALF_W : HALF_D) - 0.4, id).toBe(true);
      const p = placement(id, 'poster')!;
      expect(Math.abs(p.x) < HALF_W && Math.abs(p.z) < HALF_D, `${id} hangs inside the room`).toBe(true);
      const bottom = s.y! - tallest / 2;
      expect(bottom, id).toBeGreaterThan(1.5);
      expect(s.y! + tallest / 2, id).toBeLessThan(WALL_H - 0.3);
      for (const t of things.filter((x) => x.wall === wall)) expect(b <= t.a || a >= t.b || t.top < bottom, `${id} and the ${t.what}`).toBe(true);
      // nothing bought stands in front of it
      for (const other of standing) for (const o of onWall(spotRect(other)!, 1.5).filter((x) => x.wall === wall)) expect(b <= o.a || a >= o.b, `${id} behind ${other}`).toBe(true);
      for (const other of ofKind('wall').filter((o) => o !== id)) expect(overlaps(r, spotRect(other)!), `${id} and ${other}`).toBe(false);
    }
  });

  it('leaves every named spot on an office floor reachable from the elevator, and every desk, with every spot filled', () => {
    const w = walkways('office');
    for (const r of reservedRects()) expect(w.nav.rects).toContainEqual(r);
    const lift = spot(w, 'elevator')!;
    for (const s of [...w.spots, ...w.homes]) expect(findPath(w, lift, s), s.id).not.toBeNull();
    for (const h of w.homes) expect(findPath(w, h, spot(w, 'big-1-front')!), h.id).not.toBeNull();
  });

  it('gives every big spot a place at its front, one to wait at and two to stand and drink at, all clear', () => {
    const w = walkways('office');
    const spots = slotSpots();
    for (const id of ofKind('big')) {
      for (const k of ['front', 'line', 'sip-0', 'sip-1']) {
        const s = spot(w, `${id}-${k}`);
        expect(s, `${id}-${k}`).toBeDefined();
        expect(standable(w, s!.x, s!.z), `${id}-${k}`).toBe(true);
      }
      // the front faces the machine, close enough to reach it
      const f = spots.find((s) => s.id === `${id}-front`)!;
      const r = spotRect(id)!;
      const ahead = { x: f.x + Math.cos(f.facing) * 0.7, z: f.z + Math.sin(f.facing) * 0.7 };
      expect(overlaps(r, { minX: ahead.x, maxX: ahead.x, minZ: ahead.z, maxZ: ahead.z }), id).toBe(true);
      // the two to drink at face each other
      const [a, b] = [spots.find((s) => s.id === `${id}-sip-0`)!, spots.find((s) => s.id === `${id}-sip-1`)!];
      expect(Math.cos(a.facing) * (b.x - a.x) + Math.sin(a.facing) * (b.z - a.z), id).toBeGreaterThan(0.5);
      expect(Math.cos(b.facing) * (a.x - b.x) + Math.sin(b.facing) * (a.z - b.z), id).toBeGreaterThan(0.5);
    }
  });
});

describe('placing what’s bought', () => {
  it('backs big items onto their wall, centres the rest in their spot and hangs wall art on the wall', () => {
    const vend = placement('big-1', 'vending-machine')!;
    expect(vend.z - ITEM_SIZE['vending-machine'].d / 2).toBeCloseTo(-HALF_D);
    expect(vend.x).toBeCloseTo(SPOT_AT['big-1'].x);
    const sofa = placement('big-2', 'sofa')!;
    expect(sofa.z + ITEM_SIZE.sofa.d / 2).toBeCloseTo(HALF_D);
    const fig = placement('floor-3', 'fig')!;
    expect([fig.x, fig.z]).toEqual([SPOT_AT['floor-3'].x, SPOT_AT['floor-3'].z]);
    const poster = placement('wall-5', 'poster')!;
    expect(poster.x).toBeCloseTo(-HALF_W + ITEM_SIZE.poster.d / 2);
    expect(poster.y).toBe(SPOT_AT['wall-5'].y);
    expect(placement('kitchen', 'coffee-machine')).toBeNull();
    expect(placement('nowhere', 'plant')).toBeNull();
  });

  it('blocks the player with what stands on the floor, and walks them over rugs and past wall art', () => {
    const plan: FloorItem[] = [
      { spot: 'kitchen', item: 'coffee-machine', tier: 2, since: 0 },
      { spot: 'floor-1', item: 'plant', tier: 1, since: 0 },
      { spot: 'wall-1', item: 'neon', tier: 1, since: 0 },
      { spot: 'rug-1', item: 'rug', tier: 1, since: 0 },
      { spot: 'big-1', item: 'vending-machine', tier: 1, since: 0 },
    ];
    const rects = planRects(plan);
    expect(rects).toHaveLength(2);
    expect(rects[0].maxX - rects[0].minX).toBeCloseTo(0.5); // the pot, not the leaves
    expect(rects[1].maxX - rects[1].minX).toBeCloseTo(ITEM_SIZE['vending-machine'].w);
    expect(placedItems(plan).map((i) => i.spot)).toEqual(['floor-1', 'wall-1', 'rug-1', 'big-1']);
    expect(kitTier(plan, 'coffee-machine')).toBe(2);
    expect(kitTier(plan, 'pingpong-table')).toBe(1);
    expect(kitTier(undefined, 'pingpong-table')).toBe(1);
  });
});

describe('the shop kiosk in the lobby', () => {
  it('stands against the south wall east of the elevator, clear of everything, with every lobby spot still reachable', () => {
    const mine = rect(SHOP_KIOSK.x, SHOP_KIOSK.z, SHOP_KIOSK.w, SHOP_KIOSK.d);
    const all = lobbyColliders();
    expect(all).toContainEqual(mine);
    const others = all.filter((r) => r !== all.find((x) => Math.abs(x.minX - mine.minX) < 1e-9 && Math.abs(x.minZ - mine.minZ) < 1e-9));
    expect(others.filter((r) => overlaps(mine, r))).toEqual([]);
    expect(mine.minX).toBeGreaterThan(ELEVATOR.doorHalf + 0.8); // past the call button
    expect(mine.maxZ).toBeLessThanOrEqual(HALF_D);
    const lobby = walkways('lobby');
    const lift = spot(lobby, 'elevator')!;
    for (const s of lobby.spots) expect(findPath(lobby, lift, s), s.id).not.toBeNull();
    // the guide's walk to the elevator on the tour (TourGuide.tsx), and standing in front of the kiosk to use it
    expect(standable(lobby, 0.9, HALF_D - 1.2)).toBe(true);
    expect(standable(lobby, SHOP_KIOSK.x, SHOP_KIOSK.z - SHOP_KIOSK.d / 2 - 0.6)).toBe(true);
  });
});
