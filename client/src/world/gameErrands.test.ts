// The games' errands (gameErrands.ts, the hoops one adapted from cubefarm's toyErrands, MIT): their slice of restless
// moments, their manners, and a worker's visit to a hoop and a turn at a dartboard on a stand-in hoop and board.
import { afterEach, describe, expect, it } from 'vitest';
import { fanciesBeer } from './beerBreak';
import { fanciesCoffee } from './coffeeBreak';
import { wallFoot, slotSpotIds } from './decor/spots';
import { errandNamed, type ErrandState, type Me } from './errands';
import { clearOfPlayer, dartsScript, fanciesGame, gamePlays, GAME_SHARE, hoopsScript } from './gameErrands';
import { dartboardY } from './decor/spots';
import { scoreAt } from './games/darts';
import { boardAt, closeBoard, closeCourt, courtAt, dartLanded, openBoard, openCourt, PLAYER, takeBall, toyHand } from './games/gameState';
import { fanciesSnack } from './snackBreak';
import { fanciesVending } from './vendingBreak';
import { useView } from './view';
import { spot, walkways } from './walkways';

const office = walkways('office');
const ADA = 'ada';

afterEach(() => {
  useView.setState({ held: null });
  closeCourt('big-2');
  closeBoard('wall-3');
});

/** A restless moment's length whose number (fanciesCoffee's) is `f`. */
const restlessFor = (f: number) => (Math.ceil(25 * 97.31) + f) / 97.31;

const state = (restless: number): ErrandState => ({ floor: 'office', statusFor: 100, seatedFor: 100, restless, roll: 0.9 });

/** What a script sees of Ada each frame. */
const me = (x: number, z: number, arrived = true): Me => ({ id: ADA, x, z, heading: 0, arrived, dt: 0.1, player: { x: 0, z: 9 } });

describe('who fancies a game', () => {
  it("takes a slice of restless moments no coffee, snack or vending machine has, and the beer's only by day", () => {
    let hoops = 0;
    let darts = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const r = 25 + (i / N) * 45;
      const h = fanciesGame('hoops', r);
      const d = fanciesGame('darts', r);
      expect(h && d).toBe(false);
      if (h || d) {
        expect(fanciesCoffee(r) || fanciesSnack(r) || fanciesVending(r), `${r}`).toBe(false);
        expect(fanciesGame(h ? 'hoops' : 'darts', r, true) && fanciesBeer(r)).toBe(false); // the beer's, after hours
      }
      if (h) hoops++;
      if (d) darts++;
    }
    expect(hoops / N).toBeCloseTo(GAME_SHARE.hoops[1] - GAME_SHARE.hoops[0], 1);
    expect(darts / N).toBeGreaterThan(0.08);
  });

  it('waits while the player stands in the way of a throw', () => {
    expect(clearOfPlayer({ x: 0, z: 0 }, { x: 0, z: -4 }, { x: 0.3, z: -2 })).toBe(false);
    expect(clearOfPlayer({ x: 0, z: 0 }, { x: 0, z: -4 }, { x: 2, z: -2 })).toBe(true);
    expect(clearOfPlayer({ x: 0, z: 0 }, { x: 0, z: -4 }, { x: 0, z: 1.5 })).toBe(true); // behind the shooter
  });

  it('goes only to a hoop on screen that nobody is using', () => {
    const hoops = errandNamed('hoops')!;
    const w = { id: ADA, status: 'idle' as const, role: 'worker' };
    const r = restlessFor((GAME_SHARE.hoops[0] + GAME_SHARE.hoops[1]) / 2);
    expect(hoops.when(w, state(r))).toBe(false); // no hoop here
    openCourt('big-2', wallFoot('big-2')!);
    expect(hoops.when(w, state(r))).toBe(true);
    expect(hoops.where!(ADA)).toEqual(['big-2-front']);
    expect(hoops.when({ ...w, status: 'working' }, state(r))).toBe(false);
    expect(hoops.when(w, state(restlessFor(0.1)))).toBe(false); // a coffee's moment
    takeBall('big-2'); // the player has the ball
    expect(hoops.when(w, state(r))).toBe(false);
  });
});

describe('a worker at the hoop', () => {
  const at = (id: string) => spot(office, id)!;

  it('takes a ball, shoots from the free-throw spot, cheers a make, fetches another and goes back after the last', () => {
    const court = openCourt('big-2', wallFoot('big-2')!);
    const script = hoopsScript(ADA, 'big-2', 2);
    expect(gamePlays()['big-2']).toBe(ADA);
    const rack = at(slotSpotIds('big-2').front);
    const line = at(slotSpotIds('big-2').shoot);
    // at the rack: a stoop, and the ball's theirs
    let act = script.tick(me(rack.x, rack.z));
    expect(act.gesture).toBe('stoop');
    for (let i = 0; i < 6; i++) act = script.tick(me(rack.x, rack.z));
    expect(court.holder).toBe(ADA);
    // out to the free-throw spot with it
    act = script.tick(me(rack.x, rack.z, false));
    expect(act).toMatchObject({ do: 'walk', x: line.x, z: line.z, gesture: 'hold' });
    // there: the ball up, and away
    for (let i = 0; i < 14 && !court.throws.length; i++) act = script.tick(me(line.x, line.z));
    expect(court.throws).toHaveLength(1);
    expect(court.throws[0].who).toBe(ADA);
    expect(court.throws[0].v.y).toBeGreaterThan(2); // up, towards the rim
    expect(court.holder).toBeNull();
    court.throws.length = 0;
    // it went in: a cheer
    court.last = { who: ADA, made: true, swish: false, at: performance.now() + 1 };
    act = script.tick(me(line.x, line.z));
    act = script.tick(me(line.x, line.z));
    expect(act.gesture).toBe('cheer');
    // back to the rack for the next ball
    for (let i = 0; i < 14 && act.do !== 'walk'; i++) act = script.tick(me(line.x, line.z));
    expect(act).toMatchObject({ do: 'walk', x: rack.x, z: rack.z });
    // the second ball, and a miss: a shrug, and back to work
    for (let i = 0; i < 8; i++) script.tick(me(rack.x, rack.z));
    for (let i = 0; i < 16 && !court.throws.length; i++) script.tick(me(line.x, line.z));
    expect(court.throws).toHaveLength(1);
    for (let i = 0; i < 35 && act.do !== 'done'; i++) act = script.tick(me(line.x, line.z));
    expect(act.do).toBe('done');
    script.end();
    expect(gamePlays()['big-2']).toBeUndefined();
  });

  it('shrugs and goes back to work when the player takes the ball', () => {
    const court = openCourt('big-2', wallFoot('big-2')!);
    const script = hoopsScript(ADA, 'big-2', 3);
    const rack = at(slotSpotIds('big-2').front);
    for (let i = 0; i < 7; i++) script.tick(me(rack.x, rack.z));
    expect(court.holder).toBe(ADA);
    takeBall('big-2');
    expect(court.holder).toBe(PLAYER);
    let act = script.tick(me(rack.x, rack.z));
    expect(act.gesture).toBe('shrug');
    expect(toyHand(ADA)).toBeNull();
    for (let i = 0; i < 20 && act.do !== 'done'; i++) act = script.tick(me(rack.x, rack.z));
    expect(act.do).toBe('done');
    script.end();
    expect(courtAt('big-2')!.holder).toBe(PLAYER); // still yours
  });
});

describe('a worker at the dartboard', () => {
  it('throws three darts from the oche, says what they came to, and leaves the board free', () => {
    const board = openBoard('wall-3', { ...wallFoot('wall-3')!, y: dartboardY('wall-3') });
    const oche = spot(office, 'wall-3-oche')!;
    const script = dartsScript(ADA, 'wall-3');
    let act = script.tick(me(oche.x, oche.z));
    expect(board.holder).toBe(ADA);
    for (let i = 0; i < 60 && board.throws.length + (board.turn?.darts.length ?? 0) < 3; i++) {
      act = script.tick(me(oche.x, oche.z));
      // the board takes each dart as it's thrown; here they land at once
      for (const t of board.throws.splice(0)) dartLanded(board, t.who, scoreAt(0, 0.05));
    }
    expect(board.turn?.darts.map((d) => d.points)).toEqual([20, 20, 20]);
    expect(board.last).toMatchObject({ who: ADA, points: 60 });
    for (let i = 0; i < 40 && act.do !== 'done'; i++) act = script.tick(me(oche.x, oche.z));
    expect(act.do).toBe('done');
    script.end();
    expect(boardAt('wall-3')!.holder).toBeNull();
    expect(gamePlays()['wall-3']).toBeUndefined();
  });
});
