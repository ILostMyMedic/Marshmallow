// The front door: REST for commands, /ws for state, and the built client.
// Adapted from cubefarm server/index.ts (MIT).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer } from 'ws';
import { localModel } from '../shared/models.ts';
import { createDemoBackend } from './backend/demo.ts';
import { realBackend } from './backend/real.ts';
import { DEMO, DESK_SWEEP_INTERVAL_MS, HOME_DIR, homeProblem, HOST, PORT, SCHEDULER_INTERVAL_MS, STATE_FILE, SYNC_INTERVAL_MS, VERSION, WATCHDOG_INTERVAL_MS } from './config.ts';
import { demoRoutes } from './demoRoutes.ts';
import { Floors } from './floors.ts';
import { HttpError } from './httpError.ts';
import { createPipeline } from './pipeline/pipeline.ts';
import { handleHook, handleMcp, hooksReady, releaseClis, setOfficeUrl } from './sessions/cliRunner.ts';
import { Terminals } from './sessions/terminals.ts';
import { route } from './route.ts';
import { EFFORTS, settingsPatch } from './settings.ts';
import { Store } from './store.ts';

const problem = homeProblem(HOME_DIR, process.cwd(), DEMO);
if (problem) {
  console.error(`\n  Marshmallow won't start: ${problem}\n`);
  process.exit(1);
}

const store = new Store(STATE_FILE, { version: VERSION, demo: DEMO });
await store.load();
const demo = DEMO ? createDemoBackend({ home: HOME_DIR }) : null;
const backend = demo ?? realBackend;
const floors = new Floors(store, backend);
const terminals = new Terminals(path.join(HOME_DIR, 'terminals'));
const pipeline = createPipeline(store, backend, floors, terminals);
// Where the office left off: the cloud's saved keys, then every worker's task checked against GitHub. Finished work is
// cleared, Box workers' CLIs that kept working are back on their tasks, and interrupted sessions resume or go back in
// line. Box events wait until then (hooksReady), so a turn that finished meanwhile finishes its task now.
await pipeline.ctx.cloud.init().catch((err) => console.warn(`  the cloud account couldn't be read: ${(err as Error).message}`));
await pipeline.restart(await pipeline.ctx.cloud.reconnect().catch(() => [])).catch((err) => console.warn(`  picking up after the restart went wrong: ${(err as Error).message}`));
hooksReady();
void floors.syncAll();
setInterval(() => void floors.syncAll(), SYNC_INTERVAL_MS).unref();
pipeline.scheduler.start(SCHEDULER_INTERVAL_MS);
setTimeout(() => void pipeline.sweep(), 60_000).unref();
setInterval(() => void pipeline.sweep(), DESK_SWEEP_INTERVAL_MS).unref();
setInterval(() => pipeline.watchdog.tick(), WATCHDOG_INTERVAL_MS).unref();

const app = express();
// Workers' CLIs calling back: hooks and the status line (a tool result can be a large screenshot, hence the limit). The
// token in the path is the session's; unknown tokens get an empty answer.
app.post('/api/hooks/:token', express.json({ limit: '64mb' }), (req, res) => void res.json(handleHook(String(req.params.token), req.body)));
// The CEO's office tools over MCP, stateless: POST only, the session's token in the path.
app.post('/api/mcp/:token', express.json({ limit: '4mb' }), (req, res) => void handleMcp(String(req.params.token), req, res).catch(() => res.headersSent || res.status(500).end()));
app.all('/api/mcp/:token', (_req, res) => void res.status(405).set('Allow', 'POST').end());
app.use(express.json({ limit: '1mb' }));
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Not a number: ${v}`);
  return n;
};

app.get('/api/state', route(() => store.snapshot()));
// The repositories you could connect: yours, or an organisation's (?owner=)
app.get('/api/github/repos', route((req) => backend.github.listMyRepos(str(req.query.owner) || undefined)));
// A new floor: the CEO, if there is one, studies it, and plans the brief when one came with it
app.post(
  '/api/floors',
  route(async (req) => {
    const floor = await floors.connect(str(req.body?.fullName), { autoAssign: req.body?.autoAssign === true });
    const mission = str(req.body?.mission).trim();
    if (mission) store.patchFloor(floor.id, { mission });
    pipeline.ctx.ceo.joined(floor.id);
    return store.floor(floor.id);
  }),
);
app.post('/api/floors/:floor/plan', route((req) => pipeline.ctx.ceo.plan(String(req.params.floor), req.body?.mission === undefined ? undefined : str(req.body.mission))));
// The CEO: hired and let go, and the manager's messages to it
app.post('/api/ceo', route((req) => pipeline.ctx.ceo.hire(str(req.body?.model).trim())));
app.delete('/api/ceo', route(() => pipeline.ctx.ceo.letGo()));
app.post('/api/ceo/message', route((req) => pipeline.ctx.ceo.message(str(req.body?.text))));
app.post('/api/floors/:floor/sync', route((req) => floors.sync(String(req.params.floor))));
app.post('/api/floors/:floor/issues', route((req) => floors.fileIssue(String(req.params.floor), str(req.body?.title), str(req.body?.body))));
// Questions to the manager: asked on an issue (the CEO's ask_manager later; a test meanwhile), and answered here or on GitHub
app.post(
  '/api/floors/:floor/issues/:n/questions',
  route((req) => {
    const text = str(req.body?.text).trim();
    if (!text) throw new HttpError(400, 'The question is empty');
    return pipeline.ctx.questions.ask(String(req.params.floor), num(req.params.n), text, str(req.body?.from).trim() || 'The office');
  }),
);
// An issue held after its PR was closed goes back in line
app.delete('/api/floors/:floor/held/:n', route((req) => pipeline.ctx.closures.release(String(req.params.floor), num(req.params.n))));
app.post('/api/questions/:id/answer', route((req) => pipeline.ctx.questions.answer(num(req.params.id), str(req.body?.text))));
app.patch(
  '/api/floors/:floor',
  route((req) => {
    const floorId = String(req.params.floor);
    const patch: { autoAssign?: boolean; browserTesting?: boolean; teamSize?: null } = {};
    for (const key of ['autoAssign', 'browserTesting'] as const) {
      if (req.body?.[key] === undefined) continue;
      if (typeof req.body[key] !== 'boolean') throw new HttpError(400, `${key} must be true or false`);
      patch[key] = req.body[key];
    }
    // teamSize: a number holds the floor at that size; null hands it back to the rules
    const size = req.body?.teamSize;
    if (size === null) patch.teamSize = null;
    else if (size !== undefined) {
      if (!Number.isInteger(size)) throw new HttpError(400, 'teamSize must be a whole number, or null for the rules');
      pipeline.ctx.team.resize(floorId, size, 'Set by hand.', 'manager');
    }
    const floor = store.patchFloor(floorId, patch);
    pipeline.ctx.soon(200);
    return floor;
  }),
);
// Hiring and letting go by hand hold the floor at its new size (PATCH teamSize: null hands it back to the rules)
app.post(
  '/api/floors/:floor/workers',
  route((req) => {
    const w = pipeline.ctx.team.hire(String(req.params.floor));
    pipeline.ctx.team.hold(w.floorId);
    return w;
  }),
);
app.delete(
  '/api/workers/:id',
  route((req) => {
    const w = store.worker(String(req.params.id));
    if (w.role === 'ceo') return pipeline.ctx.ceo.letGo();
    pipeline.ctx.team.letGo(w.id);
    pipeline.ctx.team.hold(w.floorId);
  }),
);
// A worker's model (a Claude model, or ollama/<name>) and effort; '' falls back to the office default
app.patch(
  '/api/workers/:id',
  route((req) => {
    const w = store.worker(String(req.params.id));
    const patch: { model?: string; effort?: (typeof EFFORTS)[number] | '' } = {};
    if (req.body?.model !== undefined) patch.model = str(req.body.model).trim();
    if (w.host === 'box' && patch.model !== undefined && localModel(patch.model || store.getSettings().defaultModel)) throw new HttpError(400, `${w.name} works in a cloud machine, which can't reach a model on this computer. Move them to this computer first.`);
    if (req.body?.effort !== undefined) {
      const effort = str(req.body.effort);
      if (effort !== '' && !EFFORTS.includes(effort as (typeof EFFORTS)[number])) throw new HttpError(400, `effort must be one of ${EFFORTS.join(', ')}, or empty`);
      patch.effort = effort as (typeof EFFORTS)[number] | '';
    }
    return store.patchWorker(w.id, patch);
  }),
);
app.patch('/api/settings', route((req) => store.updateSettings(settingsPatch(req.body, store.getSettings()))));
app.post('/api/workers/:id/stop', route((req) => pipeline.stopWorker(String(req.params.id))));
app.post('/api/workers/:id/reset', route((req) => pipeline.resetWorker(String(req.params.id))));
// The manager's note, dropped into the worker's running session (409 without one); the CEO's goes to the CEO
app.post('/api/workers/:id/message', route((req) => pipeline.messageWorker(String(req.params.id), str(req.body?.text))));
// Box workers: the Upstash key and tokens (kept in secrets.json, never sent back), moving a worker, signing one in
app.put('/api/cloud/key', route((req) => pipeline.ctx.cloud.account.setKey(str(req.body?.key))));
app.put(
  '/api/cloud/token',
  route((req) => {
    const kind = str(req.body?.kind);
    if (kind !== 'github' && kind !== 'anthropic') throw new HttpError(400, 'kind must be github or anthropic');
    return pipeline.ctx.cloud.account.setToken(kind, str(req.body?.value));
  }),
);
app.post('/api/cloud/test', route(() => pipeline.ctx.cloud.account.test()));
app.post('/api/cloud/orphans', route(() => pipeline.ctx.cloud.account.deleteOrphans()));
app.post(
  '/api/workers/:id/move',
  route((req) => {
    const host = str(req.body?.host);
    if (host !== 'local' && host !== 'box') throw new HttpError(400, 'host must be local or box');
    return pipeline.ctx.cloud.move(String(req.params.id), host);
  }),
);
app.post('/api/workers/:id/sign-in', route((req) => pipeline.ctx.cloud.startSignIn(String(req.params.id))));
if (demo) app.post('/api/demo/expire-sign-ins', route(() => pipeline.ctx.cloud.expireSignIns()));
if (demo) app.use('/api/demo', demoRoutes(store, demo, pipeline));
app.use(
  '/api',
  route((req) => {
    throw new HttpError(404, `No such route: ${req.method} ${req.originalUrl}`);
  }),
);

// Serve the built client after `npm run build`; in development Vite serves it and proxies /api and /ws here.
const dist = path.resolve(import.meta.dirname, '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // express.json() flags malformed bodies with a 4xx status of its own.
  const parserStatus = (err as { status?: unknown })?.status;
  const status = err instanceof HttpError ? err.status : typeof parserStatus === 'number' && parserStatus >= 400 && parserStatus < 500 ? parserStatus : 500;
  const message = err instanceof Error ? err.message : String(err);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

const server = http.createServer(app);
// Two sockets: /ws carries the office's state to every tab, /ws/term?worker=<id> one worker's terminal to whoever opened it.
const wss = new WebSocketServer({ noServer: true });
const terms = new WebSocketServer({ noServer: true });
wss.on('connection', (ws) => store.addClient(ws));
terms.on('connection', (ws, req) => {
  const id = new URL(req.url ?? '', 'http://localhost').searchParams.get('worker') ?? '';
  if (!store.hasWorker(id)) return ws.close(4404, 'No such worker');
  terminals.attach(id, ws);
});
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '', 'http://localhost');
  const target = pathname === '/ws' ? wss : pathname === '/ws/term' ? terms : null;
  if (!target) return void socket.destroy();
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});

server.listen(PORT, HOST, () => {
  const port = (server.address() as AddressInfo).port;
  setOfficeUrl(`http://127.0.0.1:${port}`);
  console.log(`\n  Marshmallow ${VERSION} on http://localhost:${port}${DEMO ? '  (DEMO MODE: fake GitHub + fake workers)' : ''}`);
  console.log(`     state: ${STATE_FILE}\n`);
  if (!DEMO) {
    backend.github.user().then(
      (login) => console.log(`     GitHub: acting as ${login} (your gh login)\n`),
      () => console.log("     GitHub: gh isn't signed in. Run gh auth login, then restart.\n"),
    );
  }
});

let closing = false;
const shutdown = (signal: string) => {
  if (closing) return;
  closing = true;
  console.log(`\n  ${signal}: saving and closing…`);
  setTimeout(() => process.exit(0), 5_000).unref();
  // Sessions ending with the office change nothing, so the restart finds who was on what; Box workers' CLIs carry on
  // in their Boxes: the office lets go of them before its last save.
  pipeline.close();
  releaseClis();
  backend.cloud.detach();
  for (const ws of [...wss.clients, ...terms.clients]) ws.terminate();
  server.close();
  void Promise.all([store.flush(), demo?.github.flush(), terminals.saveAll()])
    .catch((err) => console.error('  could not save the state:', err))
    .finally(() => process.exit(0));
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGHUP', () => shutdown('SIGHUP')); // its terminal window closed
