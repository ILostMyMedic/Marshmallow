import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Floor } from '../shared/types.ts';
import { openOffice, type OfficeDb } from './db/office.ts';
import { HttpError } from './httpError.ts';
import { shopRoutes } from './shopRoutes.ts';
import { Store } from './store.ts';

const REPO = 'acme/app';
const AT = `/api/floors/${encodeURIComponent(REPO)}`;

let dir: string;
let store: Store;
let office: OfficeDb;
let server: http.Server;
let base: string;

/** The shop's routes behind the same JSON body parser and error handler as server/index.ts. */
async function serve(demo: boolean) {
  const app = express();
  app.use(express.json());
  app.use('/api', shopRoutes(store, office.shop, office.ledger, demo));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err instanceof HttpError ? err.status : 500).json({ error: err instanceof Error ? err.message : String(err) });
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = async (url: string, body: unknown) => {
  const res = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-shop-'));
  store = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  store.putFloor({ id: REPO, fullName: REPO, url: `https://github.com/${REPO}`, floor: 1, pulls: [], issues: [], held: [], languages: [] } as unknown as Floor);
  office = await openOffice(null, store);
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  await office.close();
  await store.flush();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('the shop routes', () => {
  it('grant coins in the demo, buy with them and move what was bought', async () => {
    await serve(true);
    expect(await post(`${AT}/coins/grant`, { amount: 100 })).toEqual({ status: 200, body: { coins: { coins: 100, earned: 0 } } });
    const bought = await post(`${AT}/shop/buy`, { item: 'plant', spot: 'floor-3' });
    expect(bought.status).toBe(200);
    expect(bought.body.coins).toEqual({ coins: 80, earned: 0 });
    expect(bought.body.items).toContainEqual({ spot: 'floor-3', item: 'plant', tier: 1, since: expect.any(Number) });
    const moved = await post(`${AT}/shop/move`, { from: 'floor-3', to: 'floor-1' });
    expect(moved.status).toBe(200);
    expect(Object.keys(moved.body)).toEqual(['items']);
    expect((moved.body.items as { spot: string; item: string }[]).filter((i) => i.item === 'plant').map((i) => i.spot)).toEqual(['floor-1']);
  });

  it("answers 409 with the shop's reason for a refusal", async () => {
    await serve(true);
    expect(await post(`${AT}/shop/buy`, { item: 'vending-machine' })).toEqual({ status: 409, body: { error: 'Vending machine: 120 coins, and this floor has 0' } });
    expect(await post(`${AT}/shop/move`, { from: 'kitchen', to: 'big-1' })).toEqual({ status: 409, body: { error: 'The kit stays where it is' } });
    expect((await post(`${AT}/shop/buy`, { item: 'jacuzzi' })).status).toBe(409);
  });

  it('answers 404 for an unknown floor and 400 for a bad body', async () => {
    await serve(true);
    expect(await post(`/api/floors/${encodeURIComponent('nobody/nothing')}/shop/buy`, { item: 'plant' })).toEqual({ status: 404, body: { error: 'No floor nobody/nothing' } });
    expect((await post(`/api/floors/${encodeURIComponent('nobody/nothing')}/coins/grant`, { amount: 5 })).status).toBe(404);
    expect((await post(`${AT}/shop/buy`, {})).status).toBe(400);
    expect((await post(`${AT}/shop/buy`, { item: 'plant', spot: 3 })).status).toBe(400);
    expect((await post(`${AT}/shop/move`, { from: 'floor-1' })).status).toBe(400);
    for (const amount of [0, -5, 1.5, '50', 10_001, null]) expect((await post(`${AT}/coins/grant`, { amount })).status, String(amount)).toBe(400);
    expect((await post(`${AT}/coins/grant`, { amount: 10_000 })).status).toBe(200);
  });

  it('grants nothing outside the demo', async () => {
    await serve(false);
    expect(await post(`${AT}/coins/grant`, { amount: 100 })).toEqual({ status: 403, body: { error: 'Coins are only granted in the demo' } });
    expect(office.ledger.balance(REPO)).toEqual({ coins: 0, earned: 0 });
  });
});
