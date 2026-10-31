// Box workers: where new hires work, their Boxes brought up and paused, moving a worker between this computer and a
// Box, the Box a session runs in, signing a Box's Claude Code in, and picking their CLIs up after a restart. The
// account itself is cloud.ts; the machines are machines/box/boxMachines.ts.
// Adapted from cubefarm server/swarm.ts (MIT): the cloud sections (hostFor, boxRoom, bringUpBox, moveAgent, boxTarget,
// holdForSignIn, startSignIn, signInEnded, boxCliRecord).
import path from 'node:path';
import { effectiveModel, localModel } from '../../shared/models.ts';
import { isBusy, type Floor, type MachineHost, type Worker } from '../../shared/types.ts';
import { Cloud } from '../cloud.ts';
import { HOME_DIR } from '../config.ts';
import { HttpError } from '../httpError.ts';
import { BoxMachines } from '../machines/box/boxMachines.ts';
import { machineName, type MachineProvider } from '../machines/machines.ts';
import type { Ctx } from '../pipeline/context.ts';
import { isFree } from '../pipeline/scheduler.ts';
import type { BoxCliRecord, BoxTarget } from '../sessions/boxCli.ts';
import { boxVersions } from '../sessions/clis.ts';
import type { BoxSignIn, ReconnectedCli } from '../sessions/cliRunner.ts';

/** An idle Box worker's Box pauses after this long without a task (a paused Box costs only its disk). */
export const BOX_PAUSE_MS = 5 * 60_000;

/** Thrown when a Box's Claude Code has to be signed in before the worker can take work. */
export class SignInNeeded extends Error {}

export class CloudOffice {
  readonly account: Cloud;
  readonly boxes: BoxMachines;
  private signIns = new Map<string, BoxSignIn>(); // workerId → the sign-in running in their terminal

  constructor(
    private readonly ctx: Ctx,
    o: { secretsFile?: string; pauseMs?: number } = {},
  ) {
    const { store, backend } = ctx;
    const cloud = backend.cloud;
    this.pauseMs = o.pauseMs ?? BOX_PAUSE_MS;
    this.account = new Cloud({
      secretsFile: o.secretsFile ?? path.join(HOME_DIR, backend.demo ? 'demo-secrets.json' : 'secrets.json'),
      env: cloud.env(),
      boxes: (key) => cloud.boxes(key),
      ghToken: () => cloud.ghToken(),
      office: () => this.office(),
      machines: () => new Set(store.workerList().filter((w) => w.host === 'box').map((w) => machineName(w.id))),
      changed: (view) => store.setCloud(view),
      log: (line) => console.warn(`  ${line}`),
    });
    this.boxes = new BoxMachines({
      api: () => this.account.boxApi(),
      office: () => this.office(),
      size: () => store.getSettings().cloud.boxSize,
      versions: boxVersions(),
      git: async () => cloud.gitIdentity(await backend.github.user().catch(() => null)),
      githubEnv: () => this.account.githubEnv(),
      state: (machine, s) => {
        const w = store.workerList().find((x) => machineName(x.id) === machine);
        if (w && w.cloud !== s) store.patchWorker(w.id, { cloud: s });
      },
      secrets: () => this.account.secretValues(),
      log: (line) => console.warn(`  ${line}`),
    });
  }

  private readonly pauseMs: number;

  private office() {
    return this.ctx.store.officeId(() => Math.random().toString(36).slice(2, 8).padEnd(6, '0'));
  }

  /** Reads the saved keys and counts the account's Boxes. */
  async init() {
    await this.account.init();
    this.ctx.store.setCloud(this.account.view());
    await this.account.count().catch(() => undefined);
  }

  /** The machines a worker works on: folders on this computer, or their Box. */
  machinesFor(w: Pick<Worker, 'host'>): MachineProvider {
    return w.host === 'box' ? this.boxes : this.ctx.backend.machines;
  }

  /** Box workers and the account's other Boxes stay within the plan's limit. */
  private room(): boolean {
    const { store } = this.ctx;
    const limit = store.getSettings().cloud.boxLimit;
    const workers = store.workerList().filter((w) => w.host === 'box').length;
    return Math.max(this.account.view().boxes?.total ?? 0, workers) < limit;
  }

  /** Where a new worker works: a Box when the cloud is on, a key is saved, there's room, and their model isn't local. */
  hostForHire(model: string): MachineHost {
    const s = this.ctx.store.getSettings();
    if (s.cloud.machineKind !== 'box' || !this.account.boxApi() || localModel(effectiveModel(model, s.defaultModel))) return 'local';
    return this.room() ? 'box' : 'local';
  }

  /** A new or moved Box worker's Box is created and set up in the background, then counted, and its sign-in checked. */
  bringUp(workerId: string) {
    const { store } = this.ctx;
    void this.boxes
      .ensure(machineName(workerId))
      .then(() => {
        void this.account.count().catch(() => undefined);
        return this.checkSignIn(workerId);
      })
      .catch((err) => store.hasWorker(workerId) && store.appendLog(workerId, [{ kind: 'error', text: `⚠ ${(err as Error).message}` }]));
  }

  /** The manager moves a worker between this computer and a Box, while they aren't working (or stopped mid-task). */
  async move(workerId: string, host: MachineHost): Promise<Worker> {
    const { store } = this.ctx;
    const w = store.worker(workerId);
    if (w.role !== 'worker') throw new HttpError(400, 'Only workers move');
    if (w.host === host) return w;
    if (isBusy(w.status) || w.status === 'stopped') throw new HttpError(409, `${w.name} is on a task: move them once it's done`);
    if (host === 'box') {
      if (!this.account.boxApi()) throw new HttpError(400, 'Save your Upstash Box API key first, in the cloud settings.');
      if (localModel(effectiveModel(w.model, store.getSettings().defaultModel))) throw new HttpError(400, `${w.name} runs a model on this computer, which a cloud machine can't reach. Give them a Claude model first.`);
      if (!this.room()) throw new HttpError(409, "Your plan's Box limit is reached.");
    }
    const old = this.machinesFor(w);
    this.stopSignIn(workerId);
    await old.remove(machineName(workerId)).catch(() => undefined);
    if (w.host === 'box') void this.account.count().catch(() => undefined);
    store.patchWorker(workerId, { host, sessionId: null, needsSignIn: false, cloud: host === 'box' ? 'none' : undefined });
    store.appendLog(workerId, [{ kind: 'system', text: host === 'box' ? '☁ Moved to a cloud machine (an Upstash Box).' : '🖥 Moved to this computer.' }]);
    if (host === 'box') this.bringUp(workerId);
    this.ctx.soon(200);
    return store.worker(workerId);
  }

  /**
   * The Box a Box worker's session runs in: awake and set up, with the credentials its Claude Code runs with. Throws
   * SignInNeeded (and the worker waits for the manager) when it has to use its own login and isn't signed in.
   */
  async target(w: Worker, floor: Floor): Promise<BoxTarget> {
    const machine = machineName(w.id);
    const api = this.account.boxApi();
    if (!api) throw new Error('Box workers need your Upstash Box API key, in the cloud settings.');
    const boxId = await this.boxes.ensure(machine);
    const creds = await this.account.credentials();
    if (creds.missing.length) throw new Error(`A cloud machine needs ${creds.missing[0]}.`);
    if (creds.ownLogin && !(await this.boxes.signedIn(machine))) {
      this.needSignIn(w.id);
      throw new SignInNeeded(`${w.name}'s cloud machine needs you to sign Claude Code in.`);
    }
    return {
      api,
      boxId,
      env: creds.env,
      apiKeyHelper: creds.apiKeyHelper,
      browser: floor.browserTesting ? await api.browser(boxId) : false,
      record: (rec) => this.record(w.id, rec),
      connection: (up) => this.boxes.connection(machine, up),
    };
  }

  /** A Box worker's live CLI record changed (null: it's gone), saved so a restarted office can pick the CLI up. */
  private record(workerId: string, rec: BoxCliRecord | null) {
    if (this.ctx.store.hasWorker(workerId)) this.ctx.store.setBoxCli(workerId, rec);
  }

  // ---------- signing in ----------

  /** Is the Box's Claude Code signed in, if it has to be? Marks the worker when it isn't. */
  async checkSignIn(workerId: string) {
    const { store } = this.ctx;
    if (!store.hasWorker(workerId) || store.worker(workerId).host !== 'box') return;
    if (!(await this.account.credentials()).ownLogin) return;
    if (await this.boxes.signedIn(machineName(workerId))) {
      if (store.worker(workerId).needsSignIn) store.patchWorker(workerId, { needsSignIn: false });
    } else this.needSignIn(workerId);
  }

  /** The worker takes no work until the manager signs their Box's Claude Code in, in their terminal. */
  needSignIn(workerId: string) {
    const { store } = this.ctx;
    if (!store.hasWorker(workerId) || store.worker(workerId).needsSignIn) return;
    const w = store.patchWorker(workerId, { needsSignIn: true });
    store.appendLog(workerId, [{ kind: 'error', text: '🔑 Claude Code in my cloud machine needs signing in: press Sign in, then finish it in my terminal.' }]);
    store.say(`🔑 ${w.name}'s cloud machine needs you to sign Claude Code in (Sign in, on the debug page).`, w.floorId);
  }

  /** The manager starts the sign-in: Claude Code's own login runs in the worker's terminal. */
  async startSignIn(workerId: string): Promise<void> {
    const { store, backend, sessions } = this.ctx;
    const w = store.worker(workerId);
    if (w.host !== 'box') throw new HttpError(400, `${w.name} works on this computer`);
    if (isBusy(w.status)) throw new HttpError(409, `${w.name} is busy`);
    const term = sessions.terminal(workerId);
    const api = this.account.boxApi();
    if (!term || !api) throw new HttpError(400, 'Save your Upstash Box API key first, in the cloud settings.');
    this.stopSignIn(workerId);
    const boxId = await this.boxes.ensure(machineName(workerId));
    this.signIns.set(workerId, backend.cloud.signIn({ api, boxId, term }, () => void this.signInEnded(workerId)));
  }

  private async signInEnded(workerId: string) {
    const { store } = this.ctx;
    this.signIns.delete(workerId);
    if (!store.hasWorker(workerId)) return;
    const signedIn = await this.boxes.signedIn(machineName(workerId)).catch(() => false);
    if (!signedIn) return void store.appendLog(workerId, [{ kind: 'error', text: "🔑 Claude Code still isn't signed in: press Sign in to try again." }]);
    store.patchWorker(workerId, { needsSignIn: false });
    store.appendLog(workerId, [{ kind: 'system', text: '✓ Claude Code is signed in in my cloud machine.' }]);
    this.ctx.soon(500);
  }

  private stopSignIn(workerId: string) {
    this.signIns.get(workerId)?.stop();
    this.signIns.delete(workerId);
  }

  /** The demo's "expire sign-ins": every Box worker has to sign in again. */
  expireSignIns() {
    const { store, backend } = this.ctx;
    if (!backend.cloud.expireSignIns) throw new HttpError(404, 'Only the demo can expire sign-ins');
    backend.cloud.expireSignIns();
    for (const w of store.workerList()) if (w.host === 'box') void this.checkSignIn(w.id).catch(() => undefined);
  }

  // ---------- idle Boxes, leaving, restarts ----------

  /** Box workers idle a while, with no CLI left in their Box, get it paused. Runs with the scheduler. */
  pauseIdle(now = Date.now()) {
    const { store } = this.ctx;
    for (const w of store.workerList()) {
      if (w.host !== 'box' || !isFree(w, now) || w.idleSince === null || now - w.idleSince < this.pauseMs) continue;
      const machine = machineName(w.id);
      if (store.boxCli(w.id) || this.signIns.has(w.id) || ['paused', 'none', 'creating', 'setting-up'].includes(this.boxes.stateOf(machine))) continue;
      void this.boxes.pause(machine).catch(() => undefined);
    }
  }

  /** A worker left: a sign-in in their terminal stops. Their machine goes with Team's departure. */
  left(workerId: string) {
    this.stopSignIn(workerId);
  }

  /** The office started: Box workers' CLIs that kept working are back in their terminals. */
  async reconnect(): Promise<ReconnectedCli[]> {
    const { store, backend, sessions } = this.ctx;
    const api = this.account.boxApi();
    const kept = store.boxCliList().filter(([id]) => store.hasWorker(id) && store.worker(id).host === 'box');
    if (!api || !kept.length) return [];
    return backend.cloud.reconnect(
      kept.map(([workerId, rec]) => ({ workerId, rec, api, record: (r) => this.record(workerId, r), connection: (up) => this.boxes.connection(machineName(workerId), up) })),
      (id) => sessions.terminal(id),
    );
  }
}
