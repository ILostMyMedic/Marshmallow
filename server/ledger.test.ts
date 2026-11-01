// Adapted from cubefarm server/ledger.test.ts (MIT).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Floor, Moment, PullInfo, ServerEvent, Worker } from '../shared/types.ts';
import { createDemoBackend, type DemoBackend } from './backend/demo.ts';
import { openOffice, type OfficeDb } from './db/office.ts';
import { Floors } from './floors.ts';
import { afterVerdict, COINS, LISTED_GRACE_MS, payout, reconcile, type CoinTrack } from './ledger.ts';
import { createPipeline, type Pipeline } from './pipeline/pipeline.ts';
import { Store } from './store.ts';

const REPO = 'acme/app';
const pull = (n: number, state: PullInfo['state'] = 'OPEN'): PullInfo => ({
  number: n,
  title: `Feature ${n}`,
  url: `https://github.com/${REPO}/pull/${n}`,
  headRefName: `mm/issue-${n}-ada`,
  state,
  isDraft: false,
  mergeable: 'MERGEABLE',
  reviewDecision: null,
  closesIssues: [],
  createdAt: '2026-10-01T00:00:00Z',
  mergedAt: state === 'MERGED' ? '2026-10-02T12:00:00Z' : null,
  additions: 1,
  deletions: 0,
  checks: 'passing',
  headSha: 'abc',
  mergeState: 'CLEAN',
  failedChecks: [],
  pendingChecks: [],
});
const floor = (pulls: PullInfo[]) => ({ id: REPO, fullName: REPO, url: `https://github.com/${REPO}`, floor: 1, pulls, issues: [], held: [], languages: [] }) as unknown as Floor;
const track = (n: number, over: Partial<CoinTrack> = {}): CoinTrack => ({ floorId: REPO, prNumber: n, first: null, failed: false, seenAt: 0, ...over });

describe('the coin rules', () => {
  it('pay a merge only for a PR the office watched open, or merged itself (the base)', () => {
    expect(payout(REPO, 4, null, false)).toEqual([]);
    expect(payout(REPO, 4, null, true)).toEqual([{ key: `merge:${REPO}#4`, amount: COINS.merge, reason: 'merge', detail: 'PR #4 merged' }]);
    expect(payout(REPO, 4, { first: null, failed: false }, false).map((p) => p.key)).toEqual([`merge:${REPO}#4`]);
  });

  it('add the clean bonus for a pass in round 1, the smaller fix bonus once QA failed it, never both', () => {
    const total = (t: Pick<CoinTrack, 'first' | 'failed'>) => payout(REPO, 4, t, true).reduce((s, p) => s + p.amount, 0);
    expect(payout(REPO, 4, { first: 'pass', failed: false }, false).map((p) => [p.key, p.reason])).toEqual([
      [`merge:${REPO}#4`, 'merge'],
      [`clean-qa:${REPO}#4`, 'clean-qa'],
    ]);
    expect(payout(REPO, 4, { first: 'fail', failed: true }, false).map((p) => [p.key, p.reason])).toEqual([
      [`merge:${REPO}#4`, 'merge'],
      [`fixed:${REPO}#4`, 'fixed'],
    ]);
    expect(total({ first: 'pass', failed: false })).toBe(15);
    expect(total({ first: 'late', failed: false })).toBe(10);
    expect(total({ first: 'fail', failed: true })).toBe(13);
    expect(total({ first: 'pass', failed: true })).toBe(13); // passed, then failed a later round: failing never earns more
  });

  it('note the first verdict seen (late after round 1) and any fail', () => {
    expect(afterVerdict(null, true, 1)).toEqual({ first: 'pass', failed: false });
    expect(afterVerdict(null, false, 1)).toEqual({ first: 'fail', failed: true });
    expect(afterVerdict(null, true, 2)).toEqual({ first: 'late', failed: false });
    expect(afterVerdict({ first: 'fail', failed: true }, true, 2)).toEqual({ first: 'fail', failed: true });
    expect(afterVerdict({ first: 'pass', failed: false }, false, 2)).toEqual({ first: 'pass', failed: true });
    expect(afterVerdict({ first: null, failed: false }, true, 1)).toEqual({ first: 'pass', failed: false });
  });

  it("read a sync: open PRs to watch, tracked merges to pay, closed and long-gone tracks to drop", () => {
    const now = 100 * LISTED_GRACE_MS;
    const tracks = [track(1), track(2), track(3), track(4, { seenAt: now - LISTED_GRACE_MS }), track(5, { seenAt: now - 1000 })];
    const r = reconcile(tracks, [pull(1), pull(2, 'MERGED'), pull(3, 'CLOSED'), pull(6), pull(7, 'MERGED')], now);
    expect(r.open).toEqual([6]);
    expect(r.merged.map((t) => t.prNumber)).toEqual([2]);
    expect(r.dropped).toEqual([3, 4]); // 5 is too new to be missed: the sync may have started before it opened
  });
});

let dir: string;
let store: Store;
let office: OfficeDb | null;
let events: ServerEvent[];
const newStore = () => {
  const s = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  s.addClient({ OPEN: 1, readyState: 1, send: (t: string) => events.push(JSON.parse(t)), on: () => undefined } as unknown as WebSocket);
  return s;
};
const of = <T extends ServerEvent['type']>(type: T) => events.filter((e): e is Extract<ServerEvent, { type: T }> => e.type === type);
const open = async (s = store, dbDir: string | null = null) => {
  office = await openOffice(dbDir, s);
  return office;
};
/** Waits for the ledger's writes so far (moments are fed in without waiting). */
const settle = () => office!.ledger.serial(async () => undefined);
const say = async (m: Moment) => {
  store.moment(m);
  await settle();
};
const opened = (n: number): Moment => ({ type: 'prOpened', at: 0, floorId: REPO, prNumber: n, workerId: 'ada', issueNumber: null });
const verdict = (n: number, pass: boolean, round = 1): Moment => ({ type: pass ? 'qaPassed' : 'qaFailed', at: 0, floorId: REPO, prNumber: n, qaWorkerId: 'grace', round });
const merged = (n: number, devWorkerId: string | null = 'ada'): Moment => ({ type: 'merged', at: 0, floorId: REPO, prNumber: n, devWorkerId });
/** The office merged PR n: GitHub's list says so, then the pipeline's moment. */
const officeMerges = async (n: number, devWorkerId: string | null = 'ada') => {
  store.patchFloor(REPO, { pulls: store.floor(REPO).pulls.map((p) => (p.number === n ? { ...p, state: 'MERGED' as const } : p)) });
  await say(merged(n, devWorkerId));
};
/** A floor's purse without the awards' coins (server/db/awards.test.ts has those). */
const purse = async (floorId = REPO) =>
  (
    await office!.db.query<{ coins: number; earned: number }>(
      "select coalesce(sum(amount), 0)::int as coins, coalesce(sum(amount) filter (where amount > 0 and reason <> 'grant'), 0)::int as earned from coin_entries where floor_id = $1 and reason <> 'award'",
      [floorId],
    )
  ).rows[0];
/** The PRs' earned moments, not the awards'. */
const prEarned = () => of('earned').filter((e) => !e.award);
const entries = async () => (await office!.db.query<{ key: string | null; amount: number; reason: string; detail: string }>('select key, amount, reason, detail from coin_entries order by id')).rows;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-ledger-'));
  events = [];
  store = newStore();
  office = null;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await office?.close();
  await store.flush();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('the ledger', () => {
  it('pays a merge once, with its clean QA bonus, though the moment and the sync both see it', async () => {
    store.putFloor(floor([pull(1)]));
    await open();
    await office!.ledger.synced(REPO);
    expect(office!.ledger.track(REPO, 1)).toMatchObject({ first: null, failed: false });
    await say(verdict(1, true));
    await officeMerges(1);
    await office!.ledger.synced(REPO);
    await say(merged(1));
    expect((await purse())).toEqual({ coins: 15, earned: 15 });
    expect((await entries()).map((e) => e.key)).toEqual([`merge:${REPO}#1`, `clean-qa:${REPO}#1`]);
    expect(prEarned()).toEqual([{ type: 'earned', at: expect.any(Number), floorId: REPO, amount: 15, reasons: ['PR #1 merged', 'clean QA pass'], prNumber: 1, workerId: 'ada' }]);
    expect(office!.ledger.track(REPO, 1)).toBeNull();
    expect(of('coins').at(-1)?.coins.floors[REPO]).toEqual({ coins: 15, earned: 15 });
    expect(store.snapshot().coins.recent.map((e) => e.reason)).toEqual(['clean-qa', 'merge']);
  });

  it('pays a merge the sync sees first, to the builder the QA record names, and not again for the moment', async () => {
    store.putFloor(floor([pull(2)]));
    await open();
    await say(opened(2));
    await say(verdict(2, false));
    await say(verdict(2, true, 2));
    store.putQa({ floorId: REPO, prNumber: 2, devWorkerId: 'linus' } as never);
    store.patchFloor(REPO, { pulls: [pull(2, 'MERGED')] });
    await office!.ledger.synced(REPO);
    await say(merged(2, 'linus'));
    expect((await purse())).toEqual({ coins: COINS.merge + COINS.fixed, earned: 13 });
    expect(prEarned()).toMatchObject([{ amount: 13, reasons: ['PR #2 merged', 'fixed after failing QA'], workerId: 'linus' }]);
  });

  it('gives no clean bonus to a PR first tested after round 1', async () => {
    store.putFloor(floor([pull(3)]));
    await open();
    await say(opened(3));
    await say(verdict(3, true, 2));
    expect(office!.ledger.track(REPO, 3)?.first).toBe('late');
    await officeMerges(3);
    expect((await purse()).coins).toBe(10);
  });

  it("pays nothing for merges a sync finds that it never saw open (a floor's history)", async () => {
    store.putFloor(floor([pull(1, 'MERGED'), pull(2, 'MERGED'), pull(3)]));
    await open();
    await office!.ledger.synced(REPO);
    expect((await purse())).toEqual({ coins: 0, earned: 0 });
    expect(prEarned()).toEqual([]);
    expect(office!.ledger.track(REPO, 3)).not.toBeNull();
    expect(office!.ledger.track(REPO, 1)).toBeNull();
  });

  it('pays the base for a merge the office made without a track (QA from before the database), to its builder', async () => {
    store.putFloor(floor([pull(4)]));
    await open();
    await officeMerges(4, null);
    expect((await purse())).toEqual({ coins: 10, earned: 10 });
    expect(prEarned()).toMatchObject([{ amount: 10, reasons: ['PR #4 merged'], workerId: null, prNumber: 4 }]);
  });

  it('drops the track of a PR closed without merging, and of one gone from the lists past the grace period', async () => {
    store.putFloor(floor([pull(5), pull(6)]));
    await open();
    await office!.ledger.synced(REPO);
    store.patchFloor(REPO, { pulls: [{ ...pull(5), state: 'CLOSED' }] });
    await office!.ledger.synced(REPO);
    expect(office!.ledger.track(REPO, 5)).toBeNull();
    expect(office!.ledger.track(REPO, 6)).not.toBeNull(); // missing, but just seen
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + LISTED_GRACE_MS + 1);
    await office!.ledger.synced(REPO);
    vi.mocked(Date.now).mockRestore();
    expect(office!.ledger.track(REPO, 6)).toBeNull();
    expect((await office!.db.query('select * from coin_tracks')).rows).toEqual([]);
  });

  it('earns once per key, announced (awards will be paid so)', async () => {
    store.putFloor(floor([]));
    await open();
    expect(await office!.ledger.earn(REPO, 'award:first-merge', 25, 'award', 'First merge')).toBe(true);
    expect(await office!.ledger.earn(REPO, 'award:first-merge', 25, 'award', 'First merge')).toBe(false);
    expect(office!.ledger.balance(REPO)).toEqual({ coins: 25, earned: 25 });
    expect(of('earned')).toMatchObject([{ amount: 25, reasons: ['First merge'], prNumber: null, workerId: null, award: true }]);
    expect(() => office!.ledger.earn(REPO, 'award:x', 0, 'award', 'Nothing')).toThrow();
  });

  it("grants coins to spend without counting them as earned", async () => {
    store.putFloor(floor([pull(7)]));
    await open();
    expect(await office!.ledger.grant(REPO, 50)).toEqual({ coins: 50, earned: 0 });
    await say(opened(7));
    await officeMerges(7);
    expect((await purse())).toEqual({ coins: 60, earned: 10 });
    expect(prEarned()).toHaveLength(1); // the merge's, not the gift's
  });

  it('puts every connected floor in the view, and keeps the purse of one that left', async () => {
    store.putFloor(floor([]));
    await open();
    expect(office!.ledger.get().floors).toEqual({ [REPO]: { coins: 0, earned: 0 } });
    await office!.ledger.grant(REPO, 30);
    store.removeFloor(REPO);
    expect(office!.ledger.get().floors).toEqual({ [REPO]: { coins: 30, earned: 0 } });
  });
});

describe('the shop', () => {
  it('buys an extra into the first free spot, taking its price, in one go', async () => {
    store.putFloor(floor([]));
    await open();
    await office!.ledger.grant(REPO, 200);
    const out = await office!.shop.buy(REPO, 'vending-machine');
    expect(out.coins).toEqual({ coins: 80, earned: 0 });
    expect(out.items.find((i) => i.spot === 'big-1')).toMatchObject({ item: 'vending-machine', tier: 1 });
    expect((await entries()).at(-1)).toEqual({ key: null, amount: -120, reason: 'purchase', detail: 'Vending machine' });
    expect(of('floorPlan').at(-1)).toEqual({ type: 'floorPlan', floorId: REPO, items: out.items });
    expect(of('coins').at(-1)?.coins.floors[REPO]).toEqual({ coins: 80, earned: 0 });
    expect(of('coins').at(-1)?.coins.recent[0]).toMatchObject({ amount: -120, reason: 'purchase', detail: 'Vending machine', floorId: REPO });
    expect(store.snapshot().floorPlans[REPO]).toEqual(out.items);
  });

  it('upgrades a kit item in its spot, and moves an extra to another spot of its kind', async () => {
    store.putFloor(floor([]));
    await open();
    await office!.ledger.grant(REPO, 200);
    const kit = office!.plans.of(REPO).find((i) => i.spot === 'kitchen')!;
    const { items } = await office!.shop.buy(REPO, 'espresso-machine');
    expect(items.find((i) => i.spot === 'kitchen')).toMatchObject({ item: 'coffee-machine', tier: 2 });
    expect(items.find((i) => i.spot === 'kitchen')!.since).toBeGreaterThanOrEqual(kit.since);
    await office!.shop.buy(REPO, 'poster', 'wall-3');
    const moved = await office!.shop.move(REPO, 'wall-3', 'wall-5');
    expect(moved.items.filter((i) => i.item === 'poster').map((i) => i.spot)).toEqual(['wall-5']);
    await expect(office!.shop.move(REPO, 'wall-5', 'floor-1')).rejects.toMatchObject({ status: 409, message: "That doesn't go in west of the elevator" });
    expect((await purse()).coins).toBe(70);
  });

  it('changes nothing when it refuses a purchase, or when writing the item fails', async () => {
    store.putFloor(floor([]));
    await open();
    await office!.ledger.grant(REPO, 100);
    const before = office!.plans.of(REPO);
    await expect(office!.shop.buy(REPO, 'vending-machine')).rejects.toMatchObject({ status: 409, message: 'A vending machine costs 120 coins; this floor has 100' });
    await expect(office!.shop.buy(REPO, 'plant', 'wall-1')).rejects.toMatchObject({ status: 409 });
    await expect(office!.shop.buy(REPO, 'nope')).rejects.toMatchObject({ status: 409 });
    vi.spyOn(office!.plans, 'put').mockRejectedValueOnce(new Error('disk full'));
    await expect(office!.shop.buy(REPO, 'plant')).rejects.toThrow('disk full');
    expect((await purse())).toEqual({ coins: 100, earned: 0 });
    expect((await entries()).map((e) => e.reason)).toEqual(['grant']);
    expect(office!.plans.of(REPO)).toEqual(before);
    await expect(office!.shop.buy('nobody/nothing', 'plant')).rejects.toMatchObject({ status: 404 });
  });

  it("can't overspend with two purchases at once", async () => {
    store.putFloor(floor([]));
    await open();
    await office!.ledger.grant(REPO, 130);
    const [a, b] = await Promise.allSettled([office!.shop.buy(REPO, 'vending-machine'), office!.shop.buy(REPO, 'vending-machine')]);
    expect(a.status).toBe('fulfilled');
    expect(b).toMatchObject({ status: 'rejected', reason: { status: 409, message: 'A vending machine costs 150 coins; this floor has 10' } });
    expect((await purse()).coins).toBe(10);
    expect(office!.plans.of(REPO).filter((i) => i.item === 'vending-machine')).toHaveLength(1);
  });

  it("leaves out an older catalogue's rows, and a purchase replaces one in its spot", async () => {
    store.putFloor(floor([]));
    await open();
    await office!.db.query("insert into floor_items (floor_id, spot, item) values ($1, 'floor-1', 'lava-lamp'), ($1, 'patio', 'plant')", [REPO]);
    await office!.plans.load();
    expect(office!.plans.get()[REPO].some((i) => i.item === 'lava-lamp' || i.spot === 'patio')).toBe(false);
    await office!.ledger.grant(REPO, 20);
    const { items } = await office!.shop.buy(REPO, 'plant');
    expect(items.find((i) => i.spot === 'floor-1')).toMatchObject({ item: 'plant' });
  });
});

describe('across a restart', () => {
  it('keeps the balances, the tracks and the plans', async () => {
    const dbDir = path.join(dir, 'db');
    store.putFloor(floor([pull(8)]));
    await open(store, dbDir);
    await say(opened(8));
    await say(verdict(8, true));
    await office!.ledger.grant(REPO, 100);
    await office!.shop.buy(REPO, 'plant', 'floor-2');
    await office!.close();

    events = [];
    store = newStore();
    store.putFloor(floor([pull(8)]));
    await open(store, dbDir);
    expect((await purse())).toEqual({ coins: 80, earned: 0 });
    expect(office!.ledger.track(REPO, 8)).toMatchObject({ first: 'pass', failed: false });
    expect(office!.plans.of(REPO).find((i) => i.spot === 'floor-2')).toMatchObject({ item: 'plant' });
    expect(store.snapshot().coins.floors[REPO]).toEqual(office!.ledger.balance(REPO));
    await officeMerges(8);
    expect((await purse())).toEqual({ coins: 95, earned: 15 });
  });

  it("starts the demo's reset with no coins, tracks or plans", async () => {
    store.putFloor(floor([pull(9)]));
    await open();
    await say(opened(9));
    await office!.ledger.grant(REPO, 100);
    await office!.shop.buy(REPO, 'plant');
    await office!.demoReset();
    expect((await purse())).toEqual({ coins: 0, earned: 0 });
    expect(office!.ledger.track(REPO, 9)).toBeNull();
    expect(office!.plans.of(REPO)).toEqual([]);
    expect((await office!.db.query('select * from coin_entries')).rows).toEqual([]);
  });
});

// Phase 19's "a floor earns coins as its PRs merge", on the demo's pipeline at full speed.
describe('on the demo', () => {
  const INSTANT = { stepMs: () => 1, prepareMs: 1, installMs: 1, cloneMs: 1, checksMs: () => 5, closeAfterMergeMs: 5 };
  let backend: DemoBackend;
  let pipeline: Pipeline;
  let syncing: NodeJS.Timeout;

  afterEach(() => {
    clearInterval(syncing);
    pipeline.scheduler.stop();
    pipeline.stopAll();
    backend.github.close();
  });

  async function run(rand: number, repo: string, workers: string[]) {
    backend = createDemoBackend({ home: null, timing: INSTANT, rand: () => rand });
    const floors = new Floors(store, backend);
    await open();
    pipeline = createPipeline(store, backend, floors, null, {});
    const pipelineSynced = floors.onSynced;
    floors.onSynced = (id) => {
      pipelineSynced?.(id);
      office!.synced(id);
    };
    syncing = setInterval(() => void floors.syncAll(), 25);
    await floors.connect(repo, { autoAssign: true });
    workers.forEach((name, desk) => store.putWorker({ id: `${name}-0000`, name, floorId: repo, role: 'worker', seed: desk, desk, model: '', effort: '', host: 'local', status: 'idle', task: null, activity: null, idleSince: Date.now(), startedAt: null, endedAt: null, costUsd: 0, turns: 0, lastError: null, sessionId: null, leaving: false } satisfies Worker));
    pipeline.scheduler.start(20);
  }

  async function until(done: () => boolean | Promise<boolean>, ms = 15_000) {
    const end = Date.now() + ms;
    while (!(await done())) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  it('pays each merge with its clean QA bonus when QA passes first time', async () => {
    const repo = 'demo-co/weather-api';
    await run(0.9, repo, ['Ada']);
    await until(() => prEarned().length === 3);
    await settle();
    expect((await purse(repo))).toEqual({ coins: 45, earned: 45 });
    expect(prEarned().map((e) => [e.amount, e.workerId])).toEqual([[15, 'Ada-0000'], [15, 'Ada-0000'], [15, 'Ada-0000']]);
  });

  it('pays the fix bonus instead when every PR fails QA once', async () => {
    const repo = 'demo-co/pixel-todo';
    await run(0.3, repo, ['Ada', 'Grace', 'Linus']);
    for (const n of [6, 7]) await backend.github.closeIssue(repo, n, 'Not now');
    await until(() => prEarned().length === 5);
    await settle();
    expect((await purse(repo))).toEqual({ coins: 65, earned: 65 });
    expect(new Set(prEarned().map((e) => e.reasons[1]))).toEqual(new Set(['fixed after failing QA']));
  });
});
