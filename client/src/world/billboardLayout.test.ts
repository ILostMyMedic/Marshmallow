// Adapted from cubefarm client/src/world/roof/billboardLayout.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import { BOARD, BOARD_RANGE, BOARDS, billboardSpots, blocks, boardTexts, eyesFor, inTheWay, officeNumbers, sectorOf, type OfficeNumbers } from './billboardLayout';
import { theCity, type CityBuilding } from './cityLayout';

const box: CityBuilding = { x: 0, z: 0, y: 0, w: 10, h: 20, d: 10, color: 0, lit: 0, pattern: 0 };

describe('line of sight', () => {
  it('is blocked by a building in the way, not by one beside it or below', () => {
    expect(blocks(box, { x: -20, y: 5, z: 0 }, { x: 20, y: 5, z: 0 })).toBe(true);
    expect(blocks(box, { x: -20, y: 5, z: 8 }, { x: 20, y: 5, z: 8 })).toBe(false);
    expect(blocks(box, { x: -20, y: 25, z: 0 }, { x: 20, y: 25, z: 0 })).toBe(false);
    expect(blocks(box, { x: -20, y: 5, z: 0 }, { x: -8, y: 5, z: 0 })).toBe(false); // stops short of it
  });
});

describe('the billboards', () => {
  const layout = theCity();
  const spots = billboardSpots(layout);
  const solids = [...layout.buildings, ...layout.boxes, ...layout.cylinders, ...layout.cones];

  it('put two out of each side window, and one north and one south for the roof', () => {
    expect(spots).toHaveLength(BOARDS);
    const count = (s: string) => spots.filter((x) => x.sector === s).length;
    expect(count('east')).toBe(2);
    expect(count('west')).toBe(2);
    expect(count('north') + count('south')).toBe(2);
    for (const s of spots) expect(sectorOf(s.x, s.z)).toBe(s.sector);
  });

  it('stand on bare roofs in range, facing the office, seen whole from the first floor up', () => {
    for (const s of spots) {
      expect(s.dist).toBeGreaterThanOrEqual(BOARD_RANGE.min - 15);
      expect(s.dist).toBeLessThanOrEqual(BOARD_RANGE.max);
      // on its building's roof, on legs
      expect(s.y - BOARD.h / 2 - BOARD.legs).toBeCloseTo(s.top);
      const under = layout.buildings.find((b) => b.y + b.h === s.top && Math.abs(s.x - b.x) <= b.w / 2 && Math.abs(s.z - b.z) <= b.d / 2);
      expect(under, JSON.stringify(s)).toBeTruthy();
      // facing the office: the face's normal (sin yaw, cos yaw) points back towards the middle
      expect(Math.sin(s.yaw) * -s.x + Math.cos(s.yaw) * -s.z).toBeCloseTo(Math.hypot(s.x, s.z));
      for (const e of eyesFor(s.sector)) {
        const to = { x: e.x + (s.x - e.x) * 0.97, y: e.y + (s.y - e.y) * 0.97, z: e.z + (s.z - e.z) * 0.97 };
        expect(solids.some((b) => blocks(b, e, to))).toBe(false);
      }
      // nothing else up on its roof in its way (a water tower through its legs, say)
      const bits = [...layout.boxes, ...layout.cylinders, ...layout.cones].filter((k) => k.y >= s.top - 0.5 && inTheWay(k, s));
      expect(bits).toEqual([]);
    }
  });

  it('spread round, not bunched on one block', () => {
    for (const a of spots) for (const b of spots) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(40);
  });

  it('keep clear of roof clutter beside their face, not of clutter well behind it', () => {
    const spot = { x: 0, z: 0, yaw: 0 }; // facing +z, its face along x
    const hut = (x: number, z: number) => ({ x, z, y: 20, w: 2, h: 2, d: 2, color: 0 });
    expect(inTheWay(hut(3, 0.5), spot)).toBe(true);
    expect(inTheWay(hut(6.5, 0), spot)).toBe(true); // by its end
    expect(inTheWay(hut(0, -5), spot)).toBe(false); // behind it
    expect(inTheWay(hut(10, 0), spot)).toBe(false);
  });

  it('sort east and west by the windows, north and south between', () => {
    expect(sectorOf(100, 10)).toBe('east');
    expect(sectorOf(-100, -40)).toBe('west');
    expect(sectorOf(10, -100)).toBe('north');
    expect(sectorOf(-10, 100)).toBe('south');
    expect(eyesFor('east').every((e) => e.x > 0)).toBe(true);
    expect(eyesFor('west').every((e) => e.x < 0)).toBe(true);
  });
});

describe('what the billboards say', () => {
  const n: OfficeNumbers = { company: 'Acme Robots', floors: 2, workers: 7, working: 3, issues: 12, openPrs: 4, inQa: 2, mergedToday: 5, busiest: { name: 'pixel-todo', working: 3 }, lastMerge: { number: 41, repo: 'pixel-todo' } };

  it("puts the office's news up in big letters", () => {
    const boards = boardTexts(n);
    expect(boards).toHaveLength(BOARDS);
    expect(boards[0]).toMatchObject({ big: '3 / 7', under: 'on 2 floors' });
    expect(boards[1]).toMatchObject({ big: '5', under: '4 PRs open · 2 in QA' });
    expect(boards[2]).toMatchObject({ big: '12' });
    expect(boards[3]).toMatchObject({ top: 'ACME ROBOTS', big: 'SHIP IT' });
    expect(boards[4]).toMatchObject({ big: 'PIXEL-TODO', under: '3 workers on it' });
    expect(boards[5]).toMatchObject({ big: '#41', under: 'pixel-todo' });
    for (const b of boards) expect(b.bg).not.toBe(b.fg);
  });

  it('cheers an empty backlog and copes with an empty office', () => {
    const boards = boardTexts({ ...n, company: '', issues: 0, floors: 1, busiest: null, lastMerge: null });
    expect(boards[2].under).toBe('inbox zero!');
    expect(boards[0].under).toBe('on 1 floor');
    expect(boards[3].top).toBe('MARSHMALLOW');
    expect(boards[4].big).toBe('YOUR REPO');
    expect(boards[5].big).toBe('SOON');
  });

  it("counts the office's state: who's busy, today's merges, the latest one, what's in QA", () => {
    const now = new Date(2026, 9, 4, 15, 0).getTime();
    const at = (d: number, h: number) => new Date(2026, 9, d, h).toISOString();
    const floors = [
      { id: 'a/one', fullName: 'a/one', issues: [1, 2], pulls: [{ number: 3, state: 'MERGED' as const, mergedAt: at(4, 9) }, { number: 4, state: 'OPEN' as const, mergedAt: null }] },
      { id: 'a/two', fullName: 'a/two', issues: [1], pulls: [{ number: 8, state: 'MERGED' as const, mergedAt: at(4, 14) }, { number: 7, state: 'MERGED' as const, mergedAt: at(3, 20) }] },
    ];
    const workers = [
      { role: 'worker' as const, status: 'working' as const, floorId: 'a/two' },
      { role: 'worker' as const, status: 'preparing' as const, floorId: 'a/two' },
      { role: 'worker' as const, status: 'idle' as const, floorId: 'a/one' },
      { role: 'ceo' as const, status: 'working' as const, floorId: '' },
    ];
    const qa = [{ status: 'testing' as const }, { status: 'queued' as const }, { status: 'passed' as const }];
    expect(officeNumbers(floors, workers, qa, 'Acme', now)).toEqual({
      company: 'Acme',
      floors: 2,
      workers: 3,
      working: 2,
      issues: 3,
      openPrs: 1,
      inQa: 2,
      mergedToday: 2,
      busiest: { name: 'two', working: 2 },
      lastMerge: { number: 8, repo: 'two' },
    });
    expect(officeNumbers([], [], [], '', now)).toMatchObject({ floors: 0, busiest: null, lastMerge: null });
  });
});
