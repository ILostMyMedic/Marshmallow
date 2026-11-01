// Floor previews: each floor's app, running, so the manager can check what the team shipped. One per floor, run from a
// worktree of its own on the floor's default branch (refreshed on every start), on the manager's port or the one kept
// for the floor, 127.0.0.1 only. Started by hand only; restarted after a merge on its floor; stopped on demand, when its
// floor goes and when the office closes. The manager's settings are kept in the office database, the running state
// isn't: after a restart every preview reads stopped. The backend runs the app (server/previewRunner.ts, or the demo's
// fake in server/backend/demoPreviews.ts).
// Adapted from cubefarm server/previews.ts (MIT). Cut: the PR theatre (PR previews, slot worktrees, viewers, sync
// proxies), the floor's environment variables and the "unconfigured" state.
import type { PreviewConfig, PreviewState, PreviewView } from '../shared/types.ts';
import type { Backend } from './backend/backend.ts';
import { CLIENT_PORT, PORT, PREVIEW_PORT } from './config.ts';
import type { PreviewSettings } from './db/previewSettings.ts';
import { HttpError } from './httpError.ts';
import { fillPort, LOOPBACK, portOpen, urlFromOutput, type PreviewHandle } from './previewRunner.ts';
import type { Store } from './store.ts';

/** Lines of output kept per preview, the last of them sent in its view, each clipped to LINE_MAX. */
export const LOG_KEEP = 200;
export const LOG_VIEW = 40;
const LINE_MAX = 500;
const ACTIVE: readonly PreviewState[] = ['preparing', 'installing', 'starting', 'running'];
/** The app is up or on its way: its port is taken, and a merge restarts it. */
export const isActive = (state: PreviewState) => ACTIVE.includes(state);

/** Ports kept clear besides the office's own: the dev office's (4600/5600), the spare pair 4700/5700, and cubefarm's. */
const RESERVED = [4600, 5600, 4700, 5700, 4317, 5317];
/** Where workers run their dev servers (devPort in server/machines/machines.ts). */
const WORKER_PORTS = { from: 5200, to: 5899 };

/** Why no preview may have `port`, or null when one may: it's the office's own, or where workers run their dev servers. */
export function reservedPort(port: number, officePorts: readonly number[]): string | null {
  if (officePorts.includes(port) || RESERVED.includes(port)) return `Port ${port} is the office's own.`;
  if (port >= WORKER_PORTS.from && port <= WORKER_PORTS.to) return `Ports ${WORKER_PORTS.from}-${WORKER_PORTS.to} are where workers run their dev servers.`;
  return null;
}

/** The port kept for floor number `floor`: base + floor, moved up by 100 while it's reserved or another floor has it. */
export function keptPort(floor: number, taken: ReadonlySet<number>, reserved: (port: number) => boolean, base = PREVIEW_PORT): number {
  let port = base + floor;
  while ((reserved(port) || taken.has(port)) && port + 100 <= 65535) port += 100;
  return port;
}

/** A PATCH body checked: a trimmed one-line command or null, a port from 1024 to 65535 or null. Throws 400; what's left out stays out. */
export function parsePreviewPatch(body: unknown): Partial<PreviewConfig> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Send { command?, port? }');
  const { command, port } = body as Record<string, unknown>;
  const out: Partial<PreviewConfig> = {};
  if (command === null) out.command = null;
  else if (command !== undefined) {
    if (typeof command !== 'string') throw new HttpError(400, 'command must be text, or null to let the office find it');
    const c = command.trim();
    if (!c) throw new HttpError(400, 'The command is empty: send null to let the office find it');
    if (/[\r\n]/.test(c)) throw new HttpError(400, 'The command must be one line');
    if (c.length > 1000) throw new HttpError(400, 'The command is too long: 1000 characters at most');
    out.command = c;
  }
  if (port === null) out.port = null;
  else if (port !== undefined) {
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535) throw new HttpError(400, 'port must be a whole number from 1024 to 65535, or null for the port kept for the floor');
    out.port = port;
  }
  return out;
}

/** A preview's log with `lines` added: each clipped to LINE_MAX, the last `keep` kept. */
export function trimLog(log: readonly string[], lines: readonly string[], keep = LOG_KEEP): string[] {
  const next = [...log, ...lines.map((l) => (l.length > LINE_MAX ? `${l.slice(0, LINE_MAX)}…` : l))];
  return next.length > keep ? next.slice(-keep) : next;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Run {
  state: PreviewState;
  port: number | null; // the current or last run's
  command: string | null; // what the current or last run runs, as a person would say it: as typed, or the script found
  sha: string | null;
  startedAt: number | null;
  error: string | null;
  log: string[];
  handle: PreviewHandle | null;
  halting: Promise<void>; // the last stop of its app, which the next run waits out
  gen: number; // bumped by every start and stop: callbacks from an older run are ignored
}

export interface PreviewsOptions {
  /** Floor n's kept port is base + n (PREVIEW_PORT); the tests move it clear of a running office's. */
  base?: number;
  /** The office's own ports, which no preview takes (the server's and Vite's). */
  officePorts?: number[];
  /** How long log lines gather before tabs hear of them. */
  logEmitMs?: number;
}

export class Previews {
  private runs = new Map<string, Run>();
  private emitTimers = new Map<string, NodeJS.Timeout>();
  private readonly base: number;
  private readonly officePorts: number[];
  private readonly logEmitMs: number;

  constructor(
    private readonly store: Store,
    private readonly backend: Backend,
    private readonly settings: PreviewSettings,
    o: PreviewsOptions = {},
  ) {
    this.base = o.base ?? PREVIEW_PORT;
    this.officePorts = (o.officePorts ?? [PORT, CLIENT_PORT]).filter((p) => p > 0);
    this.logEmitMs = o.logEmitMs ?? 1000;
    store.attachPreviews(() => this.views());
    // A merge on a floor whose app is up: it comes up again on the commit that just shipped
    store.onMoment((m) => {
      if (m.type !== 'merged' || !isActive(this.runs.get(m.floorId)?.state ?? 'stopped')) return;
      void this.relaunch(m.floorId, `↻ PR #${m.prNumber} was merged: restarting on the latest commit.`).catch((err) => console.warn(`  ${m.floorId}'s preview couldn't restart after the merge: ${(err as Error).message}`));
    });
    store.onFloorGone((floorId) => this.floorGone(floorId));
  }

  /** Every floor's preview, by floor id (the snapshot's). */
  views(): Record<string, PreviewView> {
    const out: Record<string, PreviewView> = {};
    for (const f of this.store.floorList()) out[f.id] = this.view(f.id);
    return out;
  }

  view(floorId: string): PreviewView {
    const r = this.runs.get(floorId);
    const config = this.settings.get(floorId);
    const state = r?.state ?? 'stopped';
    const active = isActive(state);
    const port = active && r?.port ? r.port : this.portFor(floorId);
    // An app served under a path (Vite's base) says so in its output
    const said = state === 'running' && r ? urlFromOutput(r.log, port) : null;
    return {
      floorId,
      state,
      url: state === 'running' ? `http://${LOOPBACK}:${port}${said?.port === port ? said.path : '/'}` : null,
      port,
      command: active ? (r?.command ?? null) : (config.command ?? r?.command ?? null),
      config,
      sha: r?.sha ?? null,
      startedAt: r?.startedAt ?? null,
      error: r?.error ?? null,
      log: (r?.log ?? []).slice(-LOG_VIEW),
    };
  }

  /** The floor's port: the manager's, else the one kept for it. */
  portFor(floorId: string): number {
    return this.settings.get(floorId).port ?? this.keptFor(floorId);
  }

  /** Starts the floor's preview from its default branch's latest commit; one that's on already is left as it is. */
  async start(floorId: string): Promise<PreviewView> {
    this.store.floor(floorId);
    if (isActive(this.runs.get(floorId)?.state ?? 'stopped')) return this.view(floorId);
    return this.relaunch(floorId);
  }

  /** Runs the floor's preview again from the latest commit, whatever it's doing now. */
  async restart(floorId: string): Promise<PreviewView> {
    this.store.floor(floorId);
    return this.relaunch(floorId);
  }

  /** Stops the floor's preview: its app's whole process tree, and its port free again. */
  async stop(floorId: string): Promise<PreviewView> {
    this.store.floor(floorId);
    const r = this.run(floorId);
    const gen = ++r.gen;
    await this.halt(r);
    if (gen !== r.gen) return this.view(floorId); // started again meanwhile
    Object.assign(r, { state: 'stopped', error: null, startedAt: null });
    this.emit(floorId);
    return this.view(floorId);
  }

  /** The manager's command and port for the floor's preview (null hands one back to the office); a running app takes them at its next start. */
  async configure(floorId: string, body: unknown): Promise<PreviewView> {
    this.store.floor(floorId);
    const patch = parsePreviewPatch(body);
    if (typeof patch.port === 'number') {
      const why = reservedPort(patch.port, this.officePorts);
      if (why) throw new HttpError(400, `${why} Pick another port for the preview.`);
      const other = this.store.floorList().find((f) => f.id !== floorId && this.portFor(f.id) === patch.port);
      if (other) throw new HttpError(409, `Port ${patch.port} is ${other.fullName}'s preview port. Pick another one.`);
    }
    await this.settings.set(floorId, { ...this.settings.get(floorId), ...patch });
    this.emit(floorId);
    return this.view(floorId);
  }

  /** The office started: whatever a hard stop left running in the floors' preview worktrees goes (nothing of ours runs yet). */
  async clearOrphans(): Promise<void> {
    await this.backend.previews.clearOrphans(this.store.floorList().map((f) => f.fullName)).catch((err) => console.warn(`  couldn't clear what the last office left running in its previews: ${(err as Error).message}`));
  }

  /** The office is closing: every preview's app stops, its whole process tree killed. */
  async stopAll(): Promise<void> {
    for (const t of this.emitTimers.values()) clearTimeout(t);
    this.emitTimers.clear();
    await Promise.all(
      [...this.runs.values()].map(async (r) => {
        r.gen++;
        const handle = r.handle;
        r.handle = null;
        await handle?.stop().catch(() => undefined);
      }),
    );
  }

  // ---------- inside ----------

  private run(floorId: string): Run {
    let r = this.runs.get(floorId);
    if (!r) {
      r = { state: 'stopped', port: null, command: null, sha: null, startedAt: null, error: null, log: [], handle: null, halting: Promise.resolve(), gen: 0 };
      this.runs.set(floorId, r);
    }
    return r;
  }

  /** The port kept for a floor: other floors' ports (the manager's, or the one their app runs on) are taken. */
  private keptFor(floorId: string): number {
    const taken = new Set<number>();
    for (const f of this.store.floorList()) {
      if (f.id === floorId) continue;
      const own = this.settings.get(f.id).port;
      if (own !== null) taken.add(own);
      const r = this.runs.get(f.id);
      if (r?.port && isActive(r.state)) taken.add(r.port);
    }
    const floor = this.store.hasFloor(floorId) ? this.store.floor(floorId).floor : 0;
    return keptPort(floor, taken, (p) => reservedPort(p, this.officePorts) !== null, this.base);
  }

  /** Stops what the floor's preview runs now, then starts it afresh: the latest commit, the current settings. */
  private async relaunch(floorId: string, note?: string): Promise<PreviewView> {
    const r = this.run(floorId);
    const gen = ++r.gen;
    await this.halt(r);
    if (gen !== r.gen) return this.view(floorId); // another start or a stop came in meanwhile
    const floor = this.store.floor(floorId);
    const config = this.settings.get(floorId);
    const port = this.portFor(floorId);
    // The view says the command as it was typed (or the script found); the run gets its {port} filled in
    Object.assign(r, { state: 'preparing', port, command: config.command, sha: null, startedAt: Date.now(), error: null, log: note ? [note] : [] });
    this.emit(floorId);
    if (await portOpen(port)) {
      if (gen !== r.gen) return this.view(floorId);
      Object.assign(r, { state: 'error', error: `Port ${port} is already in use by another program. The office won't stop it: free the port, or set another port for this floor's preview.` });
      this.emit(floorId);
      throw new HttpError(409, r.error!);
    }
    if (gen !== r.gen) return this.view(floorId);
    const live = () => gen === r.gen;
    r.handle = this.backend.previews.start(
      { fullName: floor.fullName, defaultBranch: floor.defaultBranch, port, command: config.command ? fillPort(config.command, port) : null },
      {
        status: (state) => {
          if (!live()) return;
          r.state = state;
          this.emit(floorId);
        },
        sha: (sha) => {
          if (!live()) return;
          r.sha = sha || null;
          this.emitSoon(floorId);
        },
        command: (cmd) => {
          if (!live()) return;
          r.command = cmd;
          this.emitSoon(floorId);
        },
        log: (lines) => {
          if (!live()) return;
          r.log = trimLog(r.log, lines);
          this.emitSoon(floorId);
        },
        failed: (message) => {
          if (!live()) return;
          r.handle = null;
          Object.assign(r, { state: 'error', error: message });
          this.emit(floorId);
        },
      },
    );
    return this.view(floorId);
  }

  /** Stops a run's app and waits a little for its port to be free; a stop already under way finishes first. */
  private halt(r: Run): Promise<void> {
    const handle = r.handle;
    const port = r.port;
    const before = r.halting;
    r.handle = null;
    r.halting = (async () => {
      await before;
      if (!handle) return;
      await handle.stop().catch(() => undefined);
      // Windows can take a moment to let go of a killed process's socket
      for (let i = 0; port && i < 20 && (await portOpen(port)); i++) await sleep(250);
    })();
    return r.halting;
  }

  /** Its floor left: the app stops, and tabs hear nothing more of it. */
  private floorGone(floorId: string) {
    clearTimeout(this.emitTimers.get(floorId));
    this.emitTimers.delete(floorId);
    const r = this.runs.get(floorId);
    if (!r) return;
    this.runs.delete(floorId);
    r.gen++;
    void this.halt(r);
  }

  private emit(floorId: string) {
    clearTimeout(this.emitTimers.get(floorId));
    this.emitTimers.delete(floorId);
    if (this.store.hasFloor(floorId)) this.store.publish({ type: 'preview', preview: this.view(floorId) });
  }

  /** Output comes in bursts (an install): tabs hear of it at most once every logEmitMs. */
  private emitSoon(floorId: string) {
    if (this.emitTimers.has(floorId)) return;
    const t = setTimeout(() => this.emit(floorId), this.logEmitMs);
    t.unref();
    this.emitTimers.set(floorId, t);
  }
}
