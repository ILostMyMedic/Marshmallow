// The office's team: hiring, letting go, and each floor's size. The rules grow and shrink the floors nobody holds at a
// size; the CEO's scale_team and the manager hold a floor at the size they set. A busy worker asked to leave gets no
// new work and goes once their task ends.
// Adapted from cubefarm server/swarm.ts (MIT): hireAgent, fireAgent, freeName, scaleTeam, applyTeamChanges.
import { randomInt, randomUUID } from 'node:crypto';
import { isBusy, type EffortLevel, type Floor, type Worker } from '../../shared/types.ts';
import { DEMO } from '../config.ts';
import { HttpError } from '../httpError.ts';
import { machineName } from '../machines/machines.ts';
import type { Ctx } from '../pipeline/context.ts';
import { isFree, readyIssues } from '../pipeline/scheduler.ts';
import { rulesSize, scalePlan, type FloorLoad, type ScalePlan } from './autoscale.ts';

const NAMES = ['Ada', 'Grace', 'Linus', 'Ken', 'Barbara', 'Dennis', 'Margaret', 'Alan', 'Radia', 'Guido', 'Hedy', 'Edsger', 'Frances', 'Donald', 'Katherine', 'Niklaus'];

export interface TeamTiming {
  idleMs: number; // idle this long, a worker may be let go by the rules
  cooldownMs: number; // the rules change a floor's size at most this often
}

/** The demo's sessions take seconds, so its floors grow and shrink within a couple of minutes. */
export const TEAM_TIMING: TeamTiming = DEMO ? { idleMs: 60_000, cooldownMs: 10_000 } : { idleMs: 10 * 60_000, cooldownMs: 60_000 };

/** Who changed a floor's size: the rules, or someone who then holds the floor at that size. */
export type SizedBy = 'rules' | 'ceo' | 'manager';

export interface HireOptions {
  model?: string;
  effort?: EffortLevel | '';
}

const BY: Record<SizedBy, string> = { rules: 'the rules', ceo: 'the CEO', manager: 'you' };

export class Team {
  private resizedAt = new Map<string, number>();

  constructor(
    private readonly ctx: Ctx,
    /** Stops a worker's session, as the manager's Stop does. */
    private readonly stopWorker: (workerId: string) => void,
    private readonly timing: TeamTiming = TEAM_TIMING,
  ) {}

  /** A new worker on the floor, at its first free desk, idle and ready for work. */
  hire(floorId: string, o: HireOptions = {}): Worker {
    const { store } = this.ctx;
    const floor = store.floor(floorId);
    const everyone = store.workerList();
    const team = this.team(floor.id);
    if (team.length >= store.getSettings().maxWorkers) throw new HttpError(409, `${floor.fullName} is full (${team.length} workers)`);
    const name = NAMES.find((x) => !everyone.some((w) => w.name === x)) ?? `Worker ${everyone.length + 1}`;
    let desk = 0;
    while (team.some((w) => w.desk === desk)) desk++;
    const now = Date.now();
    const worker: Worker = {
      id: randomUUID(),
      name,
      floorId: floor.id,
      role: 'worker',
      seed: randomInt(2 ** 31),
      desk,
      model: o.model ?? '',
      effort: o.effort ?? '',
      host: 'local',
      status: 'idle',
      task: null,
      activity: null,
      idleSince: now,
      startedAt: null,
      endedAt: null,
      costUsd: 0,
      turns: 0,
      lastError: null,
      sessionId: null,
      leaving: false,
    };
    store.putWorker(worker);
    store.appendLog(worker.id, [{ kind: 'system', text: `Joined ${floor.fullName}` }], now);
    store.moment({ type: 'hired', at: now, worker });
    this.ctx.soon(200);
    return worker;
  }

  /** The worker leaves now, even mid-task (the manager's Let go). A floor keeps its last worker. */
  letGo(workerId: string) {
    const w = this.ctx.store.worker(workerId);
    if (!this.team(w.floorId).some((x) => x.id !== w.id && !x.leaving)) throw new HttpError(409, `${w.name} is the last worker on the floor`);
    this.depart(w);
  }

  /**
   * Brings the floor to `size` workers, between 1 and the max: leavers asked to stay first, then new hires; or free
   * workers let go first (those `mayGo` allows), then busy ones, who leave once their task ends. Anyone but the rules
   * holds the floor at the new size, and the rules leave it alone.
   */
  resize(floorId: string, size: number, reason: string, by: SizedBy, o: HireOptions = {}, mayGo = (w: Worker) => this.mayGo(w, Date.now())): ScalePlan {
    const { store } = this.ctx;
    const floor = store.floor(floorId);
    const team = this.team(floorId);
    const before = team.filter((w) => !w.leaving).length;
    const plan = scalePlan({ workers: team.map((w) => ({ id: w.id, desk: w.desk, free: mayGo(w), leaving: w.leaving })) }, size, store.getSettings().maxWorkers);
    for (const id of plan.stay) store.patchWorker(id, { leaving: false });
    for (let i = 0; i < plan.hire; i++) this.hire(floorId, o);
    for (const id of plan.letGo) {
      const w = store.worker(id);
      if (!isBusy(w.status)) this.depart(w);
      else {
        store.patchWorker(id, { leaving: true });
        store.appendLog(id, [{ kind: 'system', text: '🧳 Leaving the floor once this task is done.' }]);
      }
    }
    if (by !== 'rules') store.patchFloor(floorId, { teamSize: plan.size });
    if (plan.size !== before) store.say(`${plan.size > before ? '📈' : '📉'} Floor ${floor.floor}: ${before} → ${plan.size} worker${plan.size === 1 ? '' : 's'} (${BY[by]}). ${reason}`, floorId);
    this.ctx.soon(200);
    return plan;
  }

  /** The manager hired or let go by hand: the floor stays at its new size, and the rules leave it alone. */
  hold(floorId: string) {
    this.ctx.store.patchFloor(floorId, { teamSize: this.team(floorId).filter((w) => !w.leaving).length });
  }

  /** Workers asked to leave whose task has ended go now. Runs before work is handed out, so they get none. */
  applyLeaving() {
    for (const w of this.ctx.store.workerList()) if (w.leaving && !isBusy(w.status)) this.depart(w);
  }

  /** The rules' pass: each synced floor nobody holds at a size gets the size its work wants, at most once per cooldown. */
  autoscale(now = Date.now()) {
    const { store } = this.ctx;
    if (!store.getSettings().autoscale) return;
    for (const floor of store.floorList()) {
      if (floor.teamSize !== null || floor.lastSync === null || floor.cloneStatus === 'error') continue;
      if (now - (this.resizedAt.get(floor.id) ?? -Infinity) < this.timing.cooldownMs) continue;
      const idleLong = (w: Worker) => this.mayGo(w, now) && w.idleSince !== null && now - w.idleSince >= this.timing.idleMs;
      const call = rulesSize(this.load(floor, now, idleLong));
      if (!call) continue;
      this.resizedAt.set(floor.id, now);
      this.resize(floor.id, call.size, call.reason, 'rules', {}, idleLong);
    }
  }

  /** The floor's work as the rules see it. */
  private load(floor: Floor, now: number, idleLong: (w: Worker) => boolean): FloorLoad {
    const { store, build } = this.ctx;
    const staying = this.team(floor.id).filter((w) => !w.leaving);
    // A PR the sync hasn't listed yet counts as open, as in the scheduler.
    const open = (n: number) => (floor.pulls.find((p) => p.number === n)?.state ?? 'OPEN') === 'OPEN';
    return {
      size: staying.length,
      max: store.getSettings().maxWorkers,
      busy: staying.filter((w) => isBusy(w.status)).length,
      ready: floor.autoAssign ? readyIssues(floor, store.workerList(), (n) => build.failedTooOften(floor.id, n), now).length : 0,
      waiting: store.qaList(floor.id).filter((q) => (q.status === 'queued' || q.status === 'failed') && open(q.prNumber)).length,
      idleLong: staying.filter(idleLong).length,
    };
  }

  private team(floorId: string): Worker[] {
    return this.ctx.store.workerList().filter((w) => w.floorId === floorId && w.role === 'worker');
  }

  /** Free, and no failed PR of theirs waits for their fix (letting them go would hand it to someone without the context). */
  private mayGo(w: Worker, now: number): boolean {
    return isFree(w, now) && !this.ctx.store.qaList(w.floorId).some((q) => q.status === 'failed' && q.devWorkerId === w.id);
  }

  /** The worker goes: their session stops, and their machine goes (work on no remote branch is saved first). */
  private depart(w: Worker) {
    const { store, backend, sessions } = this.ctx;
    if (isBusy(w.status) || sessions.isRunning(w.id)) this.stopWorker(w.id);
    store.removeWorker(w.id);
    sessions.forget(w.id);
    store.moment({ type: 'left', at: Date.now(), worker: w });
    void backend.machines.remove(machineName(w.id)).then(
      (r) => r.patches.length && store.say(`🧳 ${w.name} left work that was on no GitHub branch: saved as ${r.patches.join(', ')}.`),
      () => undefined,
    );
  }
}
