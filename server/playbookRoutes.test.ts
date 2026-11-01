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
import { playbookRoutes } from './playbookRoutes.ts';
import { Store } from './store.ts';
import type { Ceo } from './team/ceo/jobs.ts';

const REPO = 'acme/app';

let dir: string;
let store: Store;
let office: OfficeDb;
let server: http.Server;
let base: string;

/** The playbook's routes behind the same JSON body parser and error handler as server/index.ts; no CEO. */
async function serve() {
  const app = express();
  app.use(express.json());
  app.use('/api', playbookRoutes({ desk: office.desk, ceo: { worker: null } as unknown as Ceo }, office.playbook));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err instanceof HttpError ? err.status : 500).json({ error: err instanceof Error ? err.message : String(err) });
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const send = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-playbook-routes-'));
  store = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
  store.putFloor({ id: REPO, fullName: REPO, defaultBranch: 'main', workBranch: null, url: `https://github.com/${REPO}`, floor: 1, pulls: [], issues: [], held: [], languages: [] } as unknown as Floor);
  office = await openOffice(null, store);
  await serve();
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  await office.close();
  await store.flush();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const rules = { scope: 'office', kind: 'rules', name: 'tests-first', body: '- Run the tests' };

describe('the playbook routes', () => {
  it('make, change, switch off and delete a doc', async () => {
    const made = await send('POST', '/api/playbook/docs', rules);
    expect(made).toMatchObject({ status: 200, body: { id: 1, name: 'tests-first', enabled: true } });
    expect((await send('PATCH', '/api/playbook/docs/1', { body: '- Run every test' })).body).toMatchObject({ body: '- Run every test' });
    expect((await send('POST', '/api/playbook/docs/1/enable', { enabled: false })).body).toMatchObject({ enabled: false });
    expect(await send('DELETE', '/api/playbook/docs/1')).toEqual({ status: 200, body: { ok: true } });
    expect(office.playbook.get().docs).toEqual([]);
  });

  it('refuse what is out of shape with a 400', async () => {
    for (const body of [
      { ...rules, kind: 'memo' },
      { ...rules, scope: 'everywhere' },
      { ...rules, scope: 'floor' }, // no floorId
      { ...rules, name: 'Tests First' },
      { ...rules, body: 42 },
      { ...rules, enabled: 'yes' },
    ]) {
      expect((await send('POST', '/api/playbook/docs', body)).status, JSON.stringify(body)).toBe(400);
    }
    await send('POST', '/api/playbook/docs', rules);
    expect((await send('PATCH', '/api/playbook/docs/1', { kind: 'skill' })).status).toBe(400);
    expect((await send('POST', '/api/playbook/docs/1/enable', {})).status).toBe(400);
    expect((await send('POST', '/api/playbook/templates/tests-first/apply', { scope: 'nowhere' })).status).toBe(400);
  });

  it('answer 404 for what is not there, and 409 for a name taken in its scope', async () => {
    expect((await send('POST', '/api/playbook/docs', { ...rules, scope: 'floor', floorId: 'nobody/here' })).status).toBe(404);
    expect((await send('PATCH', '/api/playbook/docs/7', { body: 'x' })).status).toBe(404);
    expect((await send('DELETE', '/api/playbook/docs/abc')).status).toBe(404);
    expect((await send('POST', '/api/playbook/templates/nope/apply', { scope: 'office' })).status).toBe(404);
    expect((await send('POST', '/api/playbook/proposals/5/approve', {})).status).toBe(404);
    await send('POST', '/api/playbook/docs', rules);
    const again = await send('POST', '/api/playbook/docs', rules);
    expect(again).toEqual({ status: 409, body: { error: 'the office already has rules named "tests-first"' } });
  });

  it("take an office doc's floorId as null, as the console sends it", async () => {
    expect((await send('POST', '/api/playbook/docs', { ...rules, floorId: null })).body).toMatchObject({ scope: 'office', floorId: null });
    expect((await send('POST', '/api/playbook/templates/commits-and-prs/apply', { scope: 'office', floorId: null })).body).toMatchObject({ scope: 'office', name: 'commits-and-prs' });
  });

  it('add a template to a floor', async () => {
    const out = await send('POST', '/api/playbook/templates/work-branch-flow/apply', { scope: 'floor', floorId: REPO });
    expect(out.body).toMatchObject({ scope: 'floor', floorId: REPO, kind: 'rules', name: 'work-branch-flow' });
    expect((await send('POST', '/api/playbook/templates/work-branch-flow/apply', { scope: 'floor', floorId: REPO })).status).toBe(409);
  });

  it("approve the CEO's change as edited, or decline it, saying so in its chat", async () => {
    const chat = await office.desk.createChat('Rules');
    const p = await office.playbook.propose({ kind: 'chat', id: chat.id }, { scope: 'floor', floorId: REPO, kind: 'skill', name: 'write-tests', description: 'Tests', body: 'Write them', tools: '', model: '' }, 'Untested PRs');
    const ok = await send('POST', `/api/playbook/proposals/${p.id}/approve`, { body: 'Write them first' });
    expect(ok.body).toMatchObject({ proposal: { status: 'approved' }, doc: { name: 'write-tests', body: 'Write them first' } });
    expect((await office.desk.chat(chat.id)).messages.at(-1)).toMatchObject({ from: 'office', text: `📘 Playbook: added ${REPO}'s skill "write-tests", as you edited it. Sessions starting from now get it.` });
    expect((await send('POST', `/api/playbook/proposals/${p.id}/decline`, {})).status).toBe(409);

    const q = await office.playbook.propose({ kind: 'chat', id: chat.id }, { scope: 'office', floorId: null, kind: 'rules', name: 'small-prs', description: '', body: '- Small', tools: '', model: '' }, 'x');
    expect((await send('POST', `/api/playbook/proposals/${q.id}/decline`, { note: 'Not yet' })).body).toMatchObject({ status: 'declined' });
    expect((await office.desk.chat(chat.id)).messages.at(-1)).toMatchObject({ from: 'manager', text: 'Declined the playbook change to the office\'s rules "small-prs": Not yet' });
  });
});
