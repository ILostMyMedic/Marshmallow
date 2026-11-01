import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerEvent } from '../../shared/types.ts';
import { EVENTS, FIRST, GAP } from '../../shared/worldEvents.ts';
import { Store } from '../store.ts';
import { openDb, type Db } from './db.ts';
import { World } from './world.ts';

let dir: string;
let db: Db;
let now: number;
let events: ServerEvent[];
const clock = () => now;
const newStore = () => {
  const s = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  s.addClient({ OPEN: 1, readyState: 1, send: (t: string) => events.push(JSON.parse(t)), on: () => undefined } as unknown as WebSocket);
  return s;
};
const open = async () => {
  const w = new World(db, newStore(), clock);
  await w.load();
  return w;
};
const worlds = () => events.filter((e): e is Extract<ServerEvent, { type: 'world' }> => e.type === 'world').map((e) => e.world);

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-world-'));
  db = await openDb(null);
  now = Date.parse('2026-11-01T12:00:00Z');
  events = [];
});
afterEach(async () => {
  await db.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('the world events', () => {
  it('picks the first event a minute or two after opening, tells the tabs, logs it, and ends it on time', async () => {
    const world = await open();
    const { nextAt } = world.get();
    expect(nextAt - now).toBeGreaterThanOrEqual(FIRST[0] * 1000);
    expect(nextAt - now).toBeLessThanOrEqual(FIRST[1] * 1000);
    now = nextAt - 1000;
    await world.tick();
    expect(world.get().running).toEqual([]);
    expect(worlds()).toEqual([]);
    now = nextAt + 10;
    await world.tick();
    const [run] = world.get().running;
    expect(run).toMatchObject({ startedAt: now, seconds: EVENTS[run.id].seconds, forced: false });
    expect(worlds().at(-1)?.running).toEqual([run]);
    expect(world.get().nextAt - now).toBeGreaterThanOrEqual(GAP[0] * 1000 - 1);
    expect(await world.log()).toEqual([expect.objectContaining({ key: run.key, id: run.id, side: run.side, seed: run.seed, startedAt: now, endsAt: now + run.seconds * 1000 })]);
    now += run.seconds * 1000;
    await world.tick();
    expect(world.get().running).toEqual([]);
    expect(worlds().at(-1)?.running).toEqual([]);
  });

  it('starts one on demand for every tab, a big one cutting any other big one short', async () => {
    const world = await open();
    const duck = await world.trigger('duck', 'west');
    const plane = await world.trigger('plane');
    now += 5000;
    const blimp = await world.trigger('blimp', 'east');
    expect(world.get().running.map((r) => r.id)).toEqual(['plane', 'blimp']);
    expect(worlds().at(-1)?.running.map((r) => r.key)).toEqual([plane.key, blimp.key]);
    expect(blimp).toMatchObject({ side: 'east', forced: true });
    const log = await world.log();
    expect(log.find((e) => e.key === duck.key)?.endsAt).toBe(now);
    await world.end('plane');
    expect(world.get().running.map((r) => r.id)).toEqual(['blimp']);
    await world.end();
    expect(world.get().running).toEqual([]);
  });

  it('keeps one event on the street at a time: a new one cuts the one there short', async () => {
    const world = await open();
    const truck = await world.trigger('icecream', 'west');
    const plane = await world.trigger('plane');
    now += 3000;
    await world.trigger('firetruck', 'east');
    expect(world.get().running.map((r) => r.id)).toEqual(['plane', 'firetruck']);
    expect((await world.log()).find((e) => e.key === truck.key)?.endsAt).toBe(now);
    // the rock bus is big and on the street: it ends the fire engine, and a blimp after it ends the bus
    await world.trigger('rockbus', 'west');
    await world.trigger('blimp');
    expect(world.get().running.map((r) => r.id)).toEqual(['plane', 'blimp']);
    expect(world.get().running[0].key).toBe(plane.key);
  });

  it('carries on after a restart: what was running, and the schedule', async () => {
    let world = await open();
    const blimp = await world.trigger('blimp', 'west');
    await world.soon(30);
    const { nextAt } = world.get();
    now += 20_000;
    world = await open();
    expect(world.get()).toEqual({ running: [blimp], nextAt });
    // closed past the next event's time: the first comes a minute or two after opening again
    now = nextAt + 3_600_000;
    world = await open();
    expect(world.get().running).toEqual([]);
    expect(world.get().nextAt - now).toBeGreaterThanOrEqual(FIRST[0] * 1000);
    expect(world.get().nextAt - now).toBeLessThanOrEqual(FIRST[1] * 1000);
  });

  it('keeps to the same schedule across a restart as without one', async () => {
    const run = async (restartAt: number | null) => {
      await db.exec('delete from world_events; delete from world_schedule');
      await db.query('insert into world_schedule (key, state, next_at) values ($1, $2, $3)', ['office', 12345, new Date(now + 60_000)]);
      const start = now;
      let world = await open();
      const picked: string[] = [];
      for (let t = 0; t < 3600; t += 5) {
        now = start + t * 1000;
        if (t === restartAt) world = await open();
        await world.tick();
        const last = world.get().running.at(-1);
        if (last && last.startedAt === now) picked.push(last.id);
      }
      now = start;
      return picked;
    };
    const straight = await run(null);
    expect(straight.length).toBeGreaterThan(5);
    expect(await run(1800)).toEqual(straight);
  });
});
