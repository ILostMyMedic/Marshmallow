import { describe, expect, it } from 'vitest';
import { EMPTY_AWARD_STATS } from '../../shared/awards';
import { EMPTY_CLOUD } from '../../shared/cloud';
import { EMPTY_PLAYBOOK } from '../../shared/playbook';
import { DEFAULT_SETTINGS, EMPTY_COINS, EMPTY_DESK, EMPTY_RECORDS, type Floor, type ServerEvent, type Snapshot, type Worker } from '../../shared/types';
import { EMPTY_WORLD } from '../../shared/worldEvents';
import { EMPTY_OFFICE, qaKey, reduce, type Office } from './store';

const worker = (over: Partial<Worker> = {}): Worker => ({
  id: 'w1',
  name: 'Ada',
  floorId: 'demo/app',
  role: 'worker',
  seed: 42,
  desk: 0,
  model: '',
  effort: '',
  host: 'local',
  status: 'idle',
  task: null,
  activity: null,
  idleSince: 100,
  startedAt: null,
  endedAt: null,
  costUsd: 0,
  turns: 0,
  lastError: null,
  sessionId: null,
  leaving: false,
  ...over,
});

const floor = (id: string, n: number): Floor => ({
  id,
  fullName: id,
  description: '',
  url: '',
  defaultBranch: 'main',
  workBranch: null,
  floor: n,
  color: '#fff',
  autoAssign: true,
  browserTesting: true,
  mission: '',
  summary: '',
  qaBrief: '',
  teamSize: null,
  held: [],
  languages: [],
  cloneStatus: 'ready',
  cloneError: null,
  issues: [],
  pulls: [],
  lastSync: null,
  syncError: null,
});

const snapshot: Snapshot = {
  cloud: EMPTY_CLOUD,
  version: '0.1.0',
  demo: true,
  settings: DEFAULT_SETTINGS,
  floors: [floor('demo/b', 2), floor('demo/a', 1)],
  workers: [worker()],
  qa: [],
  logs: { w1: [{ id: 0, t: 0, kind: 'system', text: 'hello' }] },
  messages: [],
  questions: [],
  usage: { state: 'normal', until: null, warning: null },
  records: EMPTY_RECORDS,
  look: null,
  floorPlans: {},
  coins: EMPTY_COINS,
  awards: EMPTY_AWARD_STATS,
  previews: {},
  world: EMPTY_WORLD,
  desk: EMPTY_DESK,
  playbook: EMPTY_PLAYBOOK,
};

const fold = (events: ServerEvent[], from: Office = EMPTY_OFFICE) => events.reduce(reduce, from);

describe('reduce', () => {
  it('takes the snapshot, floors in order', () => {
    const o = fold([{ type: 'snapshot', data: snapshot }]);
    expect(o.loaded).toBe(true);
    expect(o.floors.map((f) => f.id)).toEqual(['demo/a', 'demo/b']);
    expect(o.workers.w1.name).toBe('Ada');
  });

  it('folds in changes to workers and their logs, and forgets the ones who leave', () => {
    const o = fold([
      { type: 'snapshot', data: snapshot },
      { type: 'worker', worker: worker({ status: 'working', idleSince: null }) },
      { type: 'log', workerId: 'w1', lines: [{ id: 1, t: 1, kind: 'tool', text: 'Editing App.tsx' }] },
    ]);
    expect(o.workers.w1.status).toBe('working');
    expect(o.logs.w1.map((l) => l.text)).toEqual(['hello', 'Editing App.tsx']);
    const gone = reduce(o, { type: 'workerRemoved', workerId: 'w1' });
    expect(gone.workers).toEqual({});
    expect(gone.logs).toEqual({});
  });

  it('adds, replaces and removes QA records and floors', () => {
    const rec = { floorId: 'demo/a', prNumber: 4, status: 'queued' as const, round: 1, devWorkerId: 'w1', qaWorkerId: null, summary: null, checks: [], commentUrl: null, mergeNote: null, updatedAt: 0 };
    let o = fold([{ type: 'snapshot', data: snapshot }, { type: 'qa', qa: rec }, { type: 'qa', qa: { ...rec, status: 'testing' } }]);
    expect(o.qa[qaKey('demo/a', 4)].status).toBe('testing');
    o = fold([{ type: 'qaRemoved', floorId: 'demo/a', prNumber: 4 }, { type: 'floorRemoved', floorId: 'demo/b' }, { type: 'floor', floor: floor('demo/c', 0) }], o);
    expect(o.qa).toEqual({});
    expect(o.floors.map((f) => f.id)).toEqual(['demo/c', 'demo/a']);
  });

  it("takes every floor's coins from the snapshot, then each change to them", () => {
    let o = fold([{ type: 'snapshot', data: snapshot }]);
    expect(o.coins).toEqual(EMPTY_COINS);
    const coins = { floors: { 'demo/a': { coins: 15, earned: 15 } }, recent: [{ id: 1, floorId: 'demo/a', amount: 15, reason: 'merge' as const, detail: 'PR #4 merged', prNumber: 4, at: 1 }] };
    o = reduce(o, { type: 'coins', coins });
    expect(o.coins.floors['demo/a'].coins).toBe(15);
    expect(fold([{ type: 'snapshot', data: { ...snapshot, coins } }]).coins).toEqual(coins);
  });

  it('takes the playbook from the snapshot, then the whole of it after each change', () => {
    const doc = { id: 1, scope: 'office' as const, floorId: null, kind: 'rules' as const, name: 'tests-first', description: '', body: '- Run the tests', tools: '', model: '', enabled: true, updatedAt: 1 };
    let o = fold([{ type: 'snapshot', data: snapshot }]);
    expect(o.playbook).toEqual(EMPTY_PLAYBOOK);
    o = reduce(o, { type: 'playbook', playbook: { docs: [doc], proposals: [] } });
    expect(o.playbook.docs.map((d) => d.name)).toEqual(['tests-first']);
    expect(fold([{ type: 'snapshot', data: { ...snapshot, playbook: { docs: [doc], proposals: [] } } }]).playbook.docs).toHaveLength(1);
  });

  it('keeps moments for the feed without changing the state, and keeps them through a new snapshot', () => {
    const o = fold([{ type: 'snapshot', data: snapshot }, { type: 'hired', at: 5, worker: worker({ id: 'w2', name: 'Grace' }) }, { type: 'snapshot', data: snapshot }]);
    expect(o.moments.map((m) => m.type)).toEqual(['hired']);
    expect(Object.keys(o.workers)).toEqual(['w1']);
  });
});
