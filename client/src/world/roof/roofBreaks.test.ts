// Adapted from cubefarm client/src/world/roof/roofBreaks.test.ts (MIT): seats instead of deck chairs, and the chatter.
import { afterEach, describe, expect, it } from 'vitest';
import { chatPick, endVisit, freeSeat, planVisit, ROOF_BREAK, ROOF_EMOJI, roofEmoji, roofVisit, roofVisits, roomFor, startVisit, updateVisit, visitOn, visitStage, type RoofVisit } from './roofBreaks';
import { ROOF_SEATS, type SeatKind } from './roofLayout';

const S = 1000;
const visit = (id: string, kind: RoofVisit['kind'], seat: string, arrive = 0, leave = 60 * S): RoofVisit => ({ id, kind, seat, arrive, leave });
const seats: { id: string; kind: SeatKind }[] = [
  { id: 'chair-0', kind: 'chair' },
  { id: 'chair-1', kind: 'chair' },
  { id: 'fire-0', kind: 'fire' },
  { id: 'lookout-north', kind: 'lookout' },
];
const o = { seats, playerSeat: null };

afterEach(() => {
  for (const v of roofVisits(0)) endVisit(v.id);
});

describe('roof visits', () => {
  it('ride up, stay up there, then ride back down', () => {
    const v = visit('a', 'break', 'chair-0', 4 * S, 64 * S);
    expect(visitStage(v, 0)).toBe('riding');
    expect(visitStage(v, 5 * S)).toBe('up');
    expect(visitStage(v, 64 * S)).toBe('down');
    expect(visitOn(v, 64 * S + (ROOF_BREAK.ride - 1) * S)).toBe(true);
    expect(visitOn(v, 64 * S + ROOF_BREAK.ride * S)).toBe(false);
  });

  it('give each break a seat nobody else (nor you) is in', () => {
    const taken = [visit('a', 'break', 'chair-0'), visit('b', 'break', 'fire-0')];
    for (const r of [0, 0.3, 0.6, 0.99]) expect(['chair-1', 'lookout-north']).toContain(freeSeat(taken, seats, null, r)?.id);
    expect(freeSeat(taken, seats, 'lookout-north', 0.5)?.id).toBe('chair-1');
    expect(freeSeat([...taken, visit('c', 'break', 'chair-1')], seats, 'lookout-north', 0.5)).toBeNull();
    // the CEO's call takes no seat
    expect(freeSeat([visit('ceo', 'call', '')], seats, null, 0)?.id).toBe('chair-0');
  });

  it('keep a few on breaks at most, one call, and nobody up twice', () => {
    const full = Array.from({ length: ROOF_BREAK.max }, (_, i) => visit(`p${i}`, 'break', ROOF_SEATS[i].id));
    expect(roomFor(full.slice(1), 'c', 'break', 0)).toBe(true);
    expect(roomFor(full, 'c', 'break', 0)).toBe(false);
    expect(roomFor(full, 'ceo', 'call', 0)).toBe(true);
    expect(roomFor([visit('ceo', 'call', '')], 'boss', 'call', 0)).toBe(false);
    expect(roomFor(full.slice(0, 1), 'p0', 'break', 0)).toBe(false);
    // a visit that's over doesn't count
    expect(roomFor(full, 'c', 'break', 2 * 60 * S)).toBe(true);
  });

  it('plan a visit after the ride, for a while: a sit longer than a look through the binoculars', () => {
    const v = planVisit([], 'a', 'break', 1000, 0, o)!;
    expect(v.arrive).toBe(1000 + ROOF_BREAK.ride * S);
    expect(v.seat).toBe('chair-0');
    expect((v.leave - v.arrive) / S).toBeCloseTo(ROOF_BREAK.stay[0]);
    const look = planVisit([], 'a', 'break', 0, 0.99, o)!;
    expect(look.seat).toBe('lookout-north');
    const [lo, hi] = ROOF_BREAK.look;
    expect((look.leave - look.arrive) / S).toBeGreaterThanOrEqual(lo);
    expect((look.leave - look.arrive) / S).toBeLessThanOrEqual(hi);
    const call = planVisit([], 'ceo', 'call', 0, 0, { ...o, ride: 2, stay: 30 })!;
    expect(call).toMatchObject({ kind: 'call', seat: '', arrive: 2 * S, leave: 32 * S });
    const full = Array.from({ length: ROOF_BREAK.max }, (_, i) => visit(`p${i}`, 'break', ROOF_SEATS[i].id));
    expect(planVisit(full, 'c', 'break', 0, 0.5, o)).toBeNull();
    expect(planVisit([], 'c', 'break', 0, 0.5, { seats: seats.slice(3), playerSeat: 'lookout-north' })).toBeNull();
  });

  it('are shared by every floor until they end, or their time is up', () => {
    startVisit(visit('a', 'break', 'chair-1', 0, 10 * S));
    expect(roofVisit('a', 5 * S)?.seat).toBe('chair-1');
    updateVisit('a', { leave: 6 * S });
    expect(roofVisit('a', 6 * S + ROOF_BREAK.ride * S)).toBeNull();
    expect(roofVisits(6 * S + ROOF_BREAK.ride * S)).toEqual([]);
    startVisit(visit('b', 'break', 'fire-0'));
    endVisit('b');
    expect(roofVisit('b', 0)).toBeNull();
    // read into an array that's reused
    const out = [visit('stale', 'break', '')];
    startVisit(visit('c', 'break', 'fire-0'));
    expect(roofVisits(0, out)).toBe(out);
    expect(out.map((v) => v.id)).toEqual(['c']);
  });
});

describe('chatter up top', () => {
  it('comes from someone with company near enough to talk to', () => {
    const fire = [
      { id: 'a', x: 0, z: 0 },
      { id: 'b', x: 2, z: 0 },
      { id: 'loner', x: 20, z: 0 },
    ];
    for (const r of [0, 0.5, 0.99]) expect(['a', 'b']).toContain(chatPick(fire, r));
    expect(chatPick([fire[2]], 0.5)).toBeNull();
    expect(chatPick([], 0.5)).toBeNull();
  });

  it('is an emoji that fits where they are', () => {
    for (const kind of ['chair', 'fire', 'lookout', 'call'] as const) {
      for (const r of [0, 0.5, 0.999]) expect(ROOF_EMOJI[kind]).toContain(roofEmoji(kind, r));
    }
  });
});
