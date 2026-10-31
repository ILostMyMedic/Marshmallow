// The ping-pong errands (pongErrands.ts, adapted from cubefarm's, MIT) against a small stand-in for the match's seats.
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkerStatus } from '../../../shared/types';
import { errandNamed, wanted, errands, type ErrandPeer, type ErrandState, type ErrandWorker, type Me } from './errands';
import { PONG_SHARE, WAITING, setPongSeats, type PongMove, type PongSeats } from './pongErrands';
import { otherEnd, type End } from './pongPhysics';
import { spot, walkways } from './walkways';

const office = walkways('office');

/** The seats as cubefarm's pongState keeps them: who's at which end, and what the runner tells each to do. */
function table() {
  const at: Record<End, { id: string; ready: boolean } | null> = { west: null, east: null };
  const moves = new Map<string, PongMove>();
  let open = false;
  const seatOf = (id: string): End | null => (at.west?.id === id ? 'west' : at.east?.id === id ? 'east' : null);
  const t: PongSeats & { at: typeof at; moves: typeof moves; playerAt(end: End): void } = {
    at,
    moves,
    playerAt(end) {
      open = true;
      at[end] = { id: 'player', ready: true };
    },
    seatOf,
    wantsOpponent: () => (!open ? null : at.west && !at.east ? 'east' : at.east && !at.west ? 'west' : null),
    tableFree: () => !open,
    claimSeat(id) {
      const end = t.wantsOpponent();
      if (!end) return null;
      at[end] = { id, ready: false };
      return end;
    },
    startNpcMatch(id, end) {
      if (open) return null;
      open = true;
      at[end] = { id, ready: false };
      return end;
    },
    readySeat(id) {
      const end = seatOf(id);
      if (end) at[end]!.ready = true;
    },
    leaveSeat(id) {
      const end = seatOf(id);
      moves.delete(id);
      if (!end) return;
      at[end] = null;
      if (!at.west && !at.east) open = false;
    },
    npcPong: (id) => moves.get(id) ?? null,
  };
  return t;
}

const worker = (id: string, status: WorkerStatus = 'idle'): ErrandWorker => ({ id, status, role: 'worker' });
const peer = (id: string, status: WorkerStatus = 'idle', role = 'worker'): ErrandPeer => ({ id, status, role, home: spot(office, 'desk-1')! });
const state = (over: Partial<ErrandState> = {}): ErrandState => ({ floor: 'office', statusFor: 100, seatedFor: 60, restless: 30, roll: 0.55, others: [peer('b')], ...over });
const me = (dt: number): Me => ({ id: 'a', x: 0, z: 0, heading: 0, arrived: true, dt, player: { x: 0, z: 0 } });
const pong = () => errandNamed('pong')!;
const start = () => errandNamed('pong-start')!;

afterEach(() => setPongSeats(null));

describe('answering a game', () => {
  it('nobody plays without a table on screen', () => {
    expect(pong().when(worker('a'), state())).toBe(false);
    expect(start().when(worker('a'), state())).toBe(false);
    expect(pong().where!('a')).toEqual([]);
    expect(pong().claim!('a')).toBe(false);
  });

  it('a free worker goes to the end that is waiting for someone, and takes it', () => {
    const t = table();
    setPongSeats(t);
    expect(pong().when(worker('a'), state())).toBe(false); // nobody waiting
    t.playerAt('west');
    expect(pong().when(worker('a'), state())).toBe(true);
    expect(pong().when(worker('a', 'working'), state())).toBe(false);
    expect(pong().when(worker('a'), state({ floor: 'lobby' }))).toBe(false);
    expect(pong().when(worker('a'), state({ seatedFor: 1 }))).toBe(false); // just got back
    expect(pong().where!('a')).toEqual(['pong-east']);
    expect(pong().claim!('a')).toBe(true);
    expect(t.seatOf('a')).toBe('east');
    expect(pong().claim!('b')).toBe(false); // taken
    expect(pong().script!(worker('a'), 'office')).not.toBeNull();
    expect(pong().script!(worker('b'), 'office')).toBeNull();
  });
});

describe('starting a game', () => {
  it(`someone restless whose roll is in ${PONG_SHARE.join('-')} starts one at the free table, if someone else could come`, () => {
    const t = table();
    setPongSeats(t);
    expect(start().when(worker('a'), state())).toBe(true);
    expect(start().when(worker('a'), state({ roll: 0.2 }))).toBe(false);
    expect(start().when(worker('a'), state({ seatedFor: 10 }))).toBe(false);
    expect(start().when(worker('a'), state({ others: [peer('b', 'working')] }))).toBe(false);
    expect(start().when(worker('a'), state({ others: [peer('ceo', 'idle', 'ceo')] }))).toBe(false);
    expect(wanted(errands(), worker('a'), state()).map((e) => e.name)).toContain('pong-start');
    const [where] = start().where!('a');
    expect(['pong-west', 'pong-east']).toContain(where);
    expect(start().claim!('a')).toBe(true);
    expect(`pong-${t.seatOf('a')}`).toBe(where);
    // the table's taken now; the next free worker comes to play them instead
    expect(start().when(worker('b'), state())).toBe(false);
    expect(pong().when(worker('b'), state())).toBe(true);
    expect(pong().where!('b')).toEqual([`pong-${otherEnd(t.seatOf('a')!)}`]);
  });
});

describe('at the table', () => {
  it('stands ready, plays where the runner says, and goes back with a shrug once the seat is gone', () => {
    const t = table();
    setPongSeats(t);
    t.playerAt('west');
    pong().claim!('a');
    const script = pong().script!(worker('a'), 'office')!;
    let act = script.tick(me(0.1));
    expect(act).toMatchObject({ do: 'stand', gesture: 'paddle', heading: Math.PI / 2 });
    expect(t.at.east?.ready).toBe(true);
    t.moves.set('a', { x: 1, z: 2, heading: 0.5, speed: 3, gesture: 'paddle' });
    act = script.tick(me(0.1));
    expect(act).toMatchObject({ do: 'step', x: 1, z: 2, heading: 0.5, speed: 3 });
    t.leaveSeat('a'); // the player put the paddle down, say
    act = script.tick(me(0.1));
    expect(act).toMatchObject({ do: 'stand', gesture: 'shrug' });
    for (let i = 0; i < 20 && act.do !== 'done'; i++) act = script.tick(me(0.1));
    expect(act.do).toBe('done');
  });

  it('a starter nobody comes to play gives up after a while', () => {
    const t = table();
    setPongSeats(t);
    start().where!('a');
    start().claim!('a');
    const script = start().script!(worker('a'), 'office')!;
    for (let s = 0; s < WAITING - 1; s += 0.5) script.tick(me(0.5));
    expect(t.seatOf('a')).not.toBeNull();
    script.tick(me(2));
    expect(t.seatOf('a')).toBeNull();
    expect(t.tableFree()).toBe(true);
  });

  it('leaves the table when the errand ends, however it ends', () => {
    const t = table();
    setPongSeats(t);
    t.playerAt('east');
    pong().claim!('a');
    const script = pong().script!(worker('a'), 'office')!;
    script.tick(me(0.1));
    script.end();
    expect(t.seatOf('a')).toBeNull();
  });
});
