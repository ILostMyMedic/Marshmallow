import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-db-'));
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

describe('the office database', () => {
  it('brings a new database up to date, once', async () => {
    const db = await openDb(null);
    expect(await migrate(db)).toEqual([]);
    expect((await db.query<{ id: number }>('select id from schema_migrations')).rows.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
    await db.close();
  });

  it("records a floor's merged PRs from a sync quietly, with the trophies they reached, dated by the merges", async () => {
    store.putFloor(floor([pull(1), pull(2), pull(3, { state: 'OPEN', mergedAt: null })]));
    office = await openOffice(null, store);
    await office.records.synced(REPO);
    const view = office.records.get();
    expect(view).toMatchObject({ total: 2, totals: { [REPO]: 2 } });
    expect(view.recent.map((w) => w.prNumber)).toEqual([2, 1]);
    expect(view.recent[0]).toMatchObject({ title: 'Feature 2', builtBy: 'Ada', testedBy: null, mergedAt: Date.parse('2026-10-02T12:00:00Z') });
    expect(view.trophies.map((t) => t.id)).toEqual(['company:1', `floor:${REPO}:1`]);
    expect(view.trophies[0].earnedAt).toBe(Date.parse('2026-10-01T12:00:00Z'));
    expect(of('records').at(-1)?.records.total).toBe(2);
    expect(of('trophy')).toEqual([]);
    expect(store.snapshot().records.total).toBe(2);
  });

  it('announces the trophies of a merge the office makes, and a later sync of it adds nothing', async () => {
    store.putFloor(floor([pull(1, { state: 'OPEN', mergedAt: null })]));
    office = await openOffice(null, store);
    store.putWorker({ id: 'q1', name: 'Grace' } as never);
    await office.records.merged(REPO, 1, null, 'q1');
    expect(office.records.get().recent[0]).toMatchObject({ prNumber: 1, builtBy: 'Ada', testedBy: 'Grace' });
    expect(of('trophy').map((m) => m.trophy.id)).toEqual(['company:1', `floor:${REPO}:1`]);
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

  it('gives every floor the default kit, once', async () => {
    store.putFloor(floor([]));
    office = await openOffice(null, store);
    expect(office.plans.get()[REPO].map((i) => i.spot).sort()).toEqual(DEFAULT_KIT.map((k) => k.spot).sort());
    expect(of('floorPlan')).toHaveLength(1);
    await office.plans.ensure(REPO);
    expect(of('floorPlan')).toHaveLength(1);
  });
});
