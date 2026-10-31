// The front door: REST for commands, /ws for state, and the built client.
// Adapted from cubefarm server/index.ts (MIT).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ServerEvent, Snapshot } from '../shared/types.ts';
import { DEMO, HOST, PORT, STATE_FILE, VERSION } from './config.ts';
import { HttpError } from './httpError.ts';

// Phase 1 replaces this with the store's.
const snapshot = (): Snapshot => ({ version: VERSION, demo: DEMO });

const app = express();
app.use(express.json({ limit: '1mb' }));

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
const route = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (err) {
    next(err);
  }
};

app.get('/api/state', route(() => snapshot()));
app.use(
  '/api',
  route((req) => {
    throw new HttpError(404, `No such route: ${req.method} /api${req.path}`);
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
const send = (ws: WebSocket, ev: ServerEvent) => ws.send(JSON.stringify(ev));
wss.on('connection', (ws) => send(ws, { type: 'snapshot', data: snapshot() }));
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
  console.log(`\n  ${signal}: closing…`);
  for (const ws of wss.clients) ws.terminate();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGHUP', () => shutdown('SIGHUP')); // its terminal window closed
