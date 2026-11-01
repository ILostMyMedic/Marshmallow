import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Floor, ServerEvent } from '../../shared/types.ts';
import { Store } from '../store.ts';
import { busiestDay, hatTricks, nightMerges } from './awards.ts';
import { openOffice, type OfficeDb } from './office.ts';

const MIN = 60_000;
const REPO = 'acme/app';
const OTHER = 'acme/api';
const floor = (id: string, n = 1) => ({ id, fullName: id, url: `https://github.com/${id}`, floor: n, pulls: [], issues: [], held: [], languages: [] }) as unknown as Floor;

let dir: string;
let store: Store;
let office: OfficeDb | null;
let events: ServerEvent[];
const newStore = () => {
  const s = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  s.addClient({ OPEN: 1, readyState: 1, send: (t: string) => events.push(JSON.parse(t)), on: () => undefined } as unknown as WebSocket);
  return s;
};
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-awards-'));
  events = [];
  store = newStore();
  office = null;
});
afterEach(async () => {
  await office?.close();
  await store.flush();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});
const of = <T extends ServerEvent['type']>(type: T) => events.filter((e): e is Extract<ServerEvent, { type: T }> => e.type === type);
const trophies = () => office!.records.get().trophies.map((t) => t.id);
/** Lets the moments' writes (the records', the ledger's) and the awards' looks they set off run out. */
async function settle() {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 20));
    await office!.ledger.serial(async () => undefined);
    await office!.awards.poke();
  }
}
/** A PR the office opens, tests (passing or failing first) and merges. */
function shipPr(n: number, firstPass = true) {
  const at = Date.now();
  store.moment({ type: 'prOpened', at, floorId: REPO, prNumber: n, workerId: 'w1', issueNumber: null });
  store.moment({ type: firstPass ? 'qaPassed' : 'qaFailed', at, floorId: REPO, prNumber: n, qaWorkerId: null, round: 1 });
  if (!firstPass) store.moment({ type: 'qaPassed', at, floorId: REPO, prNumber: n, qaWorkerId: null, round: 2 });
  store.moment({ type: 'merged', at, floorId: REPO, prNumber: n, devWorkerId: 'w1' });
}

describe('counting for the awards', () => {
  it('counts hat tricks without sharing a merge between two', () => {
    expect(hatTricks([0, 10 * MIN, 20 * MIN])).toBe(1);
    expect(hatTricks([0, 30 * MIN, 70 * MIN])).toBe(0);
    expect(hatTricks([0, 10, 20, 30, 40, 50].map((m) => m * MIN))).toBe(2);
    expect(hatTricks([50 * MIN, 0, 20 * MIN])).toBe(1);
  });

  it("finds the busiest day and the night's merges by the office's clock", () => {
    const at = (d: number, h: number) => new Date(2026, 9, d, h, 0).getTime();
    expect(busiestDay([at(1, 9), at(1, 12), at(1, 18), at(2, 9), at(2, 10)])).toBe(3);
    expect(busiestDay([])).toBe(0);
    expect(nightMerges([at(1, 23), at(2, 4), at(2, 12), at(2, 22)])).toBe(3);
  });
});

describe('the awards', () => {
  it("pays a clean pass the office merges: the PR's coins, its first-ship and first-merge trophies and the clean-pass award", async () => {
    store.putFloor(floor(REPO));
    office = await openOffice(null, store);
    shipPr(1);
    await settle();
    expect(trophies()).toEqual(expect.arrayContaining(['company:1', `floor:${REPO}:1`, `floor:${REPO}:clean:1`]));
    // 10 + 5 for the PR, 25 + 15 + 10 for the awards
    expect(office.ledger.balance(REPO)).toEqual({ coins: 65, earned: 65 });
    expect(of('trophy').map((m) => m.trophy.reward)).toEqual([25, 15, 10]);
    expect(of('earned').filter((m) => m.award).map((m) => m.amount)).toEqual([25, 15, 10]);
    expect(store.snapshot().awards.floors[REPO]).toMatchObject({ merges: 1, cleanQa: 1 });
  });

  it('counts a PR fixed after failing QA as a comeback, not a clean pass', async () => {
    store.putFloor(floor(REPO));
    office = await openOffice(null, store);
    shipPr(1, false);
    await settle();
    expect(trophies()).toContain(`floor:${REPO}:fixed:1`);
    expect(trophies()).not.toContain(`floor:${REPO}:clean:1`);
  });

  it("pays the company's awards to every floor", async () => {
    store.putFloor(floor(REPO, 1));
    store.putFloor(floor(OTHER, 2));
    office = await openOffice(null, store);
    await settle();
    expect(trophies()).toEqual(['company:floors:2']);
    expect(office.ledger.balance(REPO).coins).toBe(30);
    expect(office.ledger.balance(OTHER).coins).toBe(30);
  });

  it('wins the first purchase and a team of three', async () => {
    store.putFloor(floor(REPO));
    office = await openOffice(null, store);
    await office.ledger.grant(REPO, 100);
    await office.shop.buy(REPO, 'plant');
    for (const id of ['w1', 'w2', 'w3']) store.putWorker({ id, name: id, floorId: REPO, role: 'worker' } as never);
    store.moment({ type: 'hired', at: Date.now(), worker: store.worker('w3') });
    await settle();
    expect(trophies()).toEqual(expect.arrayContaining([`floor:${REPO}:purchases:1`, `floor:${REPO}:team:3`]));
    expect(office.ledger.balance(REPO).coins).toBe(100 - 20 + 10 + 20);
  });

  it("keeps a floor's old merges' trophies unpaid, and counts only the office's merges for a hat trick", async () => {
    const pulls = [1, 2, 3].map((n) => ({ number: n, title: `PR ${n}`, url: '', headRefName: 'x', state: 'MERGED', mergedAt: new Date(Date.now() - 3 * 60 * MIN + n * MIN).toISOString() }));
    store.putFloor({ ...floor(REPO), pulls } as unknown as Floor);
    office = await openOffice(null, store);
    await office.records.synced(REPO);
    await settle();
    expect(trophies()).toEqual(['company:1', `floor:${REPO}:1`]);
    expect(office.ledger.balance(REPO).coins).toBe(0);
    expect(store.snapshot().awards.floors[REPO]?.hatTrick).toBeUndefined();
    for (const n of [4, 5, 6]) shipPr(n);
    await settle();
    expect(trophies()).toContain(`floor:${REPO}:hat-trick:1`);
    expect(of('trophy').map((m) => m.trophy.id)).toContain(`floor:${REPO}:hat-trick:1`);
  });

  it('pays each award once, across a restart', async () => {
    store.putFloor(floor(REPO));
    office = await openOffice(path.join(dir, 'db'), store);
    shipPr(1);
    await settle();
    const coins = office.ledger.balance(REPO).coins;
    await office.close();
    office = await openOffice(path.join(dir, 'db'), store);
    await settle();
    expect(office.ledger.balance(REPO).coins).toBe(coins);
    expect(of('trophy')).toHaveLength(3);
  });

  it("starts the demo's awards over on a reset", async () => {
    store.putFloor(floor(REPO));
    office = await openOffice(null, store);
    shipPr(1);
    await settle();
    await office.demoReset();
    expect(office.records.get()).toMatchObject({ total: 0, trophies: [] });
    expect(office.ledger.balance(REPO).coins).toBe(0);
  });
});
