// The front door: REST for commands, /ws for state, and the built client.
// Adapted from cubefarm server/index.ts (MIT).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer } from 'ws';
import { createDemoBackend } from './backend/demo.ts';
import { DEMO, HOME_DIR, HOST, PORT, SCHEDULER_INTERVAL_MS, STATE_FILE, SYNC_INTERVAL_MS, VERSION } from './config.ts';
import { demoRoutes } from './demoRoutes.ts';
import { Floors } from './floors.ts';
import { HttpError } from './httpError.ts';
import { createPipeline } from './pipeline/pipeline.ts';
import { route } from './route.ts';
import { Store } from './store.ts';

const store = new Store(STATE_FILE, { version: VERSION, demo: DEMO });
await store.load();
// Only the demo has a backend so far: the real one (gh, git, Claude Code) comes in BUILD-PLAN phases 4 and 5.
const demo = DEMO ? createDemoBackend({ home: HOME_DIR }) : null;
const floors = demo ? new Floors(store, demo) : null;
const pipeline = demo && floors ? createPipeline(store, demo, floors) : null;
const need = <T>(part: T | null): T => {
  if (!part) throw new HttpError(501, 'Only the demo can do this so far (real GitHub comes in BUILD-PLAN phase 4): start with --demo');
  return part;
};
if (floors && pipeline) {
  void floors.syncAll();
  setInterval(() => void floors.syncAll(), SYNC_INTERVAL_MS).unref();
  pipeline.scheduler.start(SCHEDULER_INTERVAL_MS);
}

const app = express();
app.use(express.json({ limit: '1mb' }));
const str = (v: unknown) => (typeof v === 'string' ? v : '');

app.get('/api/state', route(() => store.snapshot()));
app.get('/api/github/repos', route(() => need(demo).github.listMyRepos()));
app.post('/api/floors', route((req) => need(floors).connect(str(req.body?.fullName), { autoAssign: req.body?.autoAssign === true })));
app.post('/api/floors/:floor/sync', route((req) => need(floors).sync(String(req.params.floor))));
app.patch(
  '/api/floors/:floor',
  route((req) => {
    const patch: { autoAssign?: boolean; browserTesting?: boolean } = {};
    for (const key of ['autoAssign', 'browserTesting'] as const) {
      if (req.body?.[key] === undefined) continue;
      if (typeof req.body[key] !== 'boolean') throw new HttpError(400, `${key} must be true or false`);
      patch[key] = req.body[key];
    }
    const floor = store.patchFloor(String(req.params.floor), patch);
    pipeline?.ctx.soon(200);
    return floor;
  }),
);
app.post('/api/workers/:id/stop', route((req) => need(pipeline).stopWorker(String(req.params.id))));
app.post('/api/workers/:id/reset', route((req) => need(pipeline).resetWorker(String(req.params.id))));
if (demo && floors && pipeline) app.use('/api/demo', demoRoutes(store, demo, pipeline));
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
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws) => store.addClient(ws));
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '', 'http://localhost');
  if (pathname !== '/ws') return void socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

server.listen(PORT, HOST, () => {
  const port = (server.address() as AddressInfo).port;
  console.log(`\n  Marshmallow ${VERSION} on http://localhost:${port}${DEMO ? '  (DEMO MODE: fake GitHub + fake workers)' : ''}`);
  console.log(`     state: ${STATE_FILE}\n`);
});

let closing = false;
const shutdown = (signal: string) => {
  if (closing) return;
  closing = true;
  console.log(`\n  ${signal}: saving and closing…`);
  setTimeout(() => process.exit(0), 5_000).unref();
  for (const ws of wss.clients) ws.terminate();
  server.close();
  void Promise.all([store.flush(), demo?.github.flush()])
    .catch((err) => console.error('  could not save the state:', err))
    .finally(() => process.exit(0));
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGHUP', () => shutdown('SIGHUP')); // its terminal window closed
