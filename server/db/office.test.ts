import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Floor, PullInfo, ServerEvent } from '../../shared/types.ts';
import { Store } from '../store.ts';
import { migrate, openDb } from './db.ts';
import { DEFAULT_KIT } from './floorPlans.ts';
import { MIGRATIONS } from './migrations.ts';
import { openOffice, type OfficeDb } from './office.ts';

const REPO = 'acme/app';
const pull = (n: number, over: Partial<PullInfo> = {}): PullInfo => ({
  number: n,
  title: `Feature ${n}`,
  url: `https://github.com/${REPO}/pull/${n}`,
  headRefName: `mm/issue-${n}-ada`,
  baseRefName: 'main',
  state: 'MERGED',
  isDraft: false,
  mergeable: 'UNKNOWN',
  reviewDecision: null,
  closesIssues: [],
  createdAt: '2026-10-01T00:00:00Z',
  mergedAt: `2026-10-0${n}T12:00:00Z`,
  additions: 1,
  deletions: 0,
  checks: 'passing',
  headSha: 'abc',
  mergeState: 'CLEAN',
  failedChecks: [],
  pendingChecks: [],
  ...over,
});
const floor = (pulls: PullInfo[]) => ({ id: REPO, fullName: REPO, url: `https://github.com/${REPO}`, floor: 1, pulls, issues: [], held: [] }) as unknown as Floor;

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
  // Midday on the office's clock: a merge after 22:00 would win the night-owl award too.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 1, 12, 0), shouldAdvanceTime: true });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-db-'));
  events = [];
  store = newStore();
  office = null;
});
afterEach(async () => {
  await office?.close();
  await store.flush();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  vi.useRealTimers();
});
const of = <T extends ServerEvent['type']>(type: T) => events.filter((e): e is Extract<ServerEvent, { type: T }> => e.type === type);

describe('the office database', () => {
  it('brings a new database up to date, once', async () => {
    const db = await openDb(null);
    expect(await migrate(db)).toEqual([]);
    expect((await db.query<{ id: number }>('select id from schema_migrations')).rows.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
    await db.close();
  });

  it("records a floor's merged PRs from a sync quietly, with the trophies they reached, dated by the merges and unpaid", async () => {
    store.putFloor(floor([pull(1), pull(2), pull(3, { state: 'OPEN', mergedAt: null })]));
    office = await openOffice(null, store);
    await office.records.synced(REPO);
    await office.awards.poke();
    const view = office.records.get();
    expect(view).toMatchObject({ total: 2, totals: { [REPO]: 2 } });
    expect(view.recent.map((w) => w.prNumber)).toEqual([2, 1]);
    expect(view.recent[0]).toMatchObject({ title: 'Feature 2', builtBy: 'Ada', testedBy: null, mergedAt: Date.parse('2026-10-02T12:00:00Z') });
    expect(view.trophies.map((t) => t.id)).toEqual(['company:1', `floor:${REPO}:1`]);
    expect(view.trophies[0].earnedAt).toBe(Date.parse('2026-10-01T12:00:00Z'));
    expect(view.trophies.map((t) => t.reward)).toEqual([0, 0]);
    expect(of('records').at(-1)?.records.total).toBe(2);
    expect(of('trophy')).toEqual([]);
    expect(office.ledger.balance(REPO).coins).toBe(0);
    expect(store.snapshot().records.total).toBe(2);
  });

  it('announces and pays the trophies of a merge the office makes, and a later sync of it adds nothing', async () => {
    store.putFloor(floor([pull(1, { state: 'OPEN', mergedAt: null })]));
    office = await openOffice(null, store);
    store.putWorker({ id: 'q1', name: 'Grace' } as never);
    await office.records.merged(REPO, 1, null, 'q1');
    await office.awards.poke();
    expect(office.records.get().recent[0]).toMatchObject({ prNumber: 1, builtBy: 'Ada', testedBy: 'Grace' });
    expect(of('trophy').map((m) => [m.trophy.id, m.trophy.reward])).toEqual([
      ['company:1', 25],
      [`floor:${REPO}:1`, 15],
    ]);
    expect(office.ledger.balance(REPO).coins).toBe(40);
    const published = of('records').length;
    store.patchFloor(REPO, { pulls: [pull(1)] });
    await office.records.synced(REPO);
    expect(of('records').length).toBe(published);
    expect(office.records.get().total).toBe(1);
  });

  it("keeps the manager's look across a restart, and refuses what isn't one", async () => {
    office = await openOffice(path.join(dir, 'db'), store);
    await office.player.setLook({ hair: 'bun', skin: '#f1c27d' });
    expect(of('look').at(-1)?.look).toEqual({ hair: 'bun', skin: '#f1c27d' });
    await expect(office.player.setLook(['not', 'a', 'look'])).rejects.toMatchObject({ status: 400 });
    await office.close();
    office = await openOffice(path.join(dir, 'db'), newStore());
    expect(office.player.get()).toEqual({ hair: 'bun', skin: '#f1c27d' });
    expect(store.snapshot().look).toEqual({ hair: 'bun', skin: '#f1c27d' });
  });

  it("puts the desk in the snapshot, with the phone's old chat with the CEO copied into it", async () => {
    store.say('Hello Mallow', null, 'manager');
    store.say('Hello! All quiet.', null, 'ceo');
    office = await openOffice(null, store);
    expect(store.snapshot().desk.chats).toMatchObject([{ title: 'Earlier messages', messages: [{ from: 'manager', text: 'Hello Mallow' }, { from: 'ceo', text: 'Hello! All quiet.' }] }]);
    await office.desk.createChat('Recipes');
    expect(store.snapshot().desk.chats.map((c) => c.title)).toEqual(['Recipes', 'Earlier messages']);
  });

  it('moves beanbags bought for a small spot to a free big one as it opens, and pays back the ones with no room', async () => {
    store.putFloor(floor([]));
    const home = path.join(dir, 'db');
    office = await openOffice(home, store);
    await office.ledger.grant(REPO, 500);
    // what an older catalogue sold: two lots of beanbags in small spots (35 and 45 coins), the big spots taken but one
    const db = office.db;
    const buy = async (spot: string, item: string, price: number, detail: string, at: string) => {
      await db.query('insert into floor_items (floor_id, spot, item, since) values ($1, $2, $3, $4)', [REPO, spot, item, at]);
      await db.query("insert into coin_entries (floor_id, amount, reason, detail, at) values ($1, $2, 'purchase', $3, $4)", [REPO, -price, detail, at]);
    };
    await buy('big-1', 'vending-machine', 120, 'Vending machine', '2026-10-01T10:00:00Z');
    await buy('floor-3', 'beanbags', 35, 'Beanbags', '2026-10-02T10:00:00Z');
    await buy('big-3', 'sofa', 90, 'Sofa', '2026-10-03T10:00:00Z');
    await buy('floor-1', 'beanbags', 45, 'Beanbags', '2026-10-04T10:00:00Z');
    await office.close();
    office = null;

    events = [];
    const again = newStore();
    again.putFloor(floor([]));
    office = await openOffice(home, again);
    const plan = office.plans.of(REPO);
    // the older lot moved into the free big spot; the newer one, with no room left, paid back what it cost
    expect(plan.filter((i) => i.item === 'beanbags').map((i) => i.spot)).toEqual(['big-2']);
    expect(plan.map((i) => i.spot)).not.toContain('floor-1');
    expect(plan.map((i) => i.spot)).not.toContain('floor-3');
    await office.awards.idle(); // a purchases award may pay too: count from the lines
    const sum = async (where: string) => (await office!.db.query<{ n: number }>(`select coalesce(sum(amount), 0)::int as n from coin_entries where floor_id = $1 and ${where}`, [REPO])).rows[0].n;
    expect(await sum("reason = 'refund'")).toBe(45);
    expect(office.ledger.balance(REPO)).toEqual({ coins: await sum('true'), earned: await sum("amount > 0 and reason not in ('grant', 'refund')") });
    expect(office.ledger.get().recent.find((e) => e.reason === 'refund')).toMatchObject({ amount: 45, detail: 'Beanbags paid back: no room for them now' });
    expect(of('floorPlan').some((e) => e.floorId === REPO && e.items.some((i) => i.spot === 'big-2' && i.item === 'beanbags'))).toBe(true);
    // done once: opening again changes nothing
    await office.close();
    office = await openOffice(home, newStore());
    expect(await office.plans.resettle(office.ledger)).toEqual([]);
    expect(await sum("reason = 'refund'")).toBe(45);
  });

  it('gives every floor the default kit, once', async () => {
    store.putFloor(floor([]));
    office = await openOffice(null, store);
    expect(office.plans.get()[REPO].map((i) => i.spot).sort()).toEqual(DEFAULT_KIT.map((k) => k.spot).sort());
    expect(of('floorPlan')).toHaveLength(1);
    await office.plans.ensure(REPO);
    expect(of('floorPlan')).toHaveLength(1);
  });
});
