// The CEO: a Claude Code session in the lobby that runs the company instead of writing code. Its jobs (onboard a new
// floor, plan the manager's brief, answer the manager) queue up and run one at a time, chat first; everything it
// changes goes through the office tools, and its final message goes to the manager.
// Adapted from cubefarm server/swarm.ts (MIT): the CEO section (enqueueCeo, startCeoWork, runCeoJob, onCeoFinished,
// messageCeo, planFloor).
import fs from 'node:fs';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { effectiveModel } from '../../../shared/models.ts';
import { isBusy, type CeoJobKind, type Worker } from '../../../shared/types.ts';
import { HOME_DIR } from '../../config.ts';
import { HttpError } from '../../httpError.ts';
import type { Ctx } from '../../pipeline/context.ts';
import type { SessionEnd } from '../../pipeline/sessions.ts';
import { IssueCap } from './issueRules.ts';
import { officeHandlers } from './office.ts';
import { ceoJobPrompt, ceoSystemPrompt, jobLabel, type CeoJob } from './prompts.ts';
import { createOfficeTools } from './tools.ts';

/** The CEO's name until the setup wizard (BUILD-PLAN's game phases) lets the manager pick one. */
export const CEO_NAME = 'Mallow';
/** Issues the CEO may file in one job. */
const ISSUES_PER_JOB = 12;

export class Ceo {
  private queue: CeoJob[] = [];
  private running: CeoJob | null = null;

  constructor(private readonly ctx: Ctx) {}

  /** The CEO's worker record; null while the office has no CEO. */
  get worker(): Worker | null {
    return this.ctx.store.workerList().find((w) => w.role === 'ceo') ?? null;
  }

  /** Jobs waiting, oldest first (the one running isn't among them). */
  waiting(): readonly CeoJob[] {
    return this.queue;
  }

  /** The office gets a CEO, who onboards every floor it doesn't know yet. */
  hire(): Worker {
    const { store } = this.ctx;
    if (this.worker) throw new HttpError(409, 'The office has a CEO already');
    const now = Date.now();
    const ceo: Worker = {
      id: randomUUID(),
      name: CEO_NAME,
      floorId: '',
      role: 'ceo',
      seed: randomInt(2 ** 31),
      desk: 0,
      model: '',
      effort: '',
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
    store.putWorker(ceo);
    store.appendLog(ceo.id, [{ kind: 'system', text: 'Joined as CEO' }], now);
    store.moment({ type: 'hired', at: now, worker: ceo });
    this.onboardUnknown();
    return ceo;
  }

  /** Floors the CEO has no profile of get onboarded: at hiring, and at start (the queue isn't saved). */
  onboardUnknown() {
    if (this.worker) for (const f of this.ctx.store.floorList()) if (!f.summary) this.enqueue('onboard', f.id);
  }

  /** The CEO leaves: their session stops, and their jobs go with them. */
  letGo() {
    const { store, sessions } = this.ctx;
    const ceo = this.worker;
    if (!ceo) throw new HttpError(404, 'The office has no CEO');
    this.queue = [];
    sessions.stop(ceo.id);
    store.removeWorker(ceo.id);
    sessions.forget(ceo.id);
    store.moment({ type: 'left', at: Date.now(), worker: ceo });
  }

  /** A floor connected: the CEO studies it, and plans its brief if it came with one. Nothing without a CEO. */
  joined(floorId: string) {
    if (!this.worker) return;
    this.enqueue('onboard', floorId);
    if (this.ctx.store.floor(floorId).mission) this.enqueue('plan', floorId);
  }

  /** The manager's brief for a floor, planned into issues. */
  plan(floorId: string, mission?: string) {
    const { store } = this.ctx;
    if (!this.worker) throw new HttpError(409, 'Hire a CEO first');
    if (mission !== undefined) store.patchFloor(floorId, { mission: mission.trim() });
    if (!store.floor(floorId).mission) throw new HttpError(400, 'The floor has no brief to plan');
    this.enqueue('plan', floorId);
  }

  /** The manager writes to the CEO. */
  message(text: string) {
    if (!this.worker) throw new HttpError(409, 'Hire a CEO first');
    if (!text.trim()) throw new HttpError(400, 'The message is empty');
    this.ctx.store.say(text.trim(), null, 'manager');
    this.enqueue('chat', null, text.trim());
  }

  /** One job per kind and floor; the manager's messages merge into one chat. */
  private enqueue(kind: CeoJobKind, floorId: string | null, text = '') {
    const same = this.queue.find((j) => j.kind === kind && j.floorId === floorId);
    if (same) same.text = [same.text, text].filter(Boolean).join('\n');
    else this.queue.push({ kind, floorId, text, at: Date.now() });
    this.ctx.soon(200);
  }

  /**
   * Starts the next job if the CEO is free: chat first, then the oldest. A floor's job waits for its clone and first
   * sync, and is dropped if the floor went or its clone failed. Called by the scheduler; true when one started.
   */
  tick(): boolean {
    const { store } = this.ctx;
    const ceo = this.worker;
    if (!ceo || this.running || isBusy(ceo.status) || ceo.status === 'stopped' || this.ctx.sessions.isRunning(ceo.id)) return false;
    for (const job of [...this.queue].sort((a, b) => Number(a.kind !== 'chat') - Number(b.kind !== 'chat') || a.at - b.at)) {
      if (job.floorId !== null) {
        const floor = store.hasFloor(job.floorId) ? store.floor(job.floorId) : null;
        if (!floor || floor.cloneStatus === 'error') {
          this.queue = this.queue.filter((j) => j !== job);
          if (floor) store.say(`⚠ ${CEO_NAME} skipped "${jobLabel(job, floor)}": the repository couldn't be cloned.`, floor.id);
          continue;
        }
        if (floor.cloneStatus !== 'ready' || floor.lastSync === null) continue;
      }
      this.queue = this.queue.filter((j) => j !== job);
      this.start(ceo, job);
      return true;
    }
    return false;
  }

  private start(ceo: Worker, job: CeoJob) {
    const { store, backend, sessions } = this.ctx;
    const settings = store.getSettings();
    const floor = job.floorId ? store.floor(job.floorId) : null;
    const label = jobLabel(job, floor);
    const cap = new IssueCap(ISSUES_PER_JOB);
    const cwd = path.join(HOME_DIR, 'ceo');
    if (!backend.demo) fs.mkdirSync(cwd, { recursive: true });
    this.running = job;
    store.appendLog(ceo.id, [{ kind: 'system', text: `▶ ${label}` }]);
    sessions.start(
      ceo.id,
      {
        cwd,
        prompt: ceoJobPrompt(job, floor && { floor: floor.floor, fullName: floor.fullName, clone: backend.mainDir(floor.fullName), mission: floor.mission, backlog: floor.issues.length }),
        systemAppend: ceoSystemPrompt({ name: ceo.name, company: settings.companyName, manager: settings.managerName, sessionLimit: settings.sessionLimit, maxWorkers: settings.maxWorkers }),
        model: effectiveModel(ceo.model, settings.defaultModel),
        effort: ceo.effort || settings.defaultEffort,
        browserTesting: false,
        role: 'ceo',
        task: null,
        subject: { issueNumber: null, prNumber: null, title: label },
        // A chat carries on the CEO's last conversation; other jobs start afresh.
        resumeSessionId: job.kind === 'chat' ? (ceo.sessionId ?? undefined) : undefined,
        label: `${ceo.name} · ${label}`,
        office: createOfficeTools(officeHandlers(this.ctx, job, cap, ceo.name)),
        addDirs: store.floorList().flatMap((f) => (f.cloneStatus === 'ready' ? [backend.mainDir(f.fullName)] : [])),
        ceoJob: { kind: job.kind, floorId: job.floorId, text: job.text },
      },
      (end) => this.finished(job, label, cap, end),
    );
  }

  private finished(job: CeoJob, label: string, cap: IssueCap, end: SessionEnd) {
    const { store, floors } = this.ctx;
    this.running = null;
    for (const floorId of cap.floors) if (store.hasFloor(floorId)) void floors.sync(floorId).catch(() => undefined);
    const ceo = this.worker;
    if (ceo && ceo.status !== 'stopped') {
      const { ok, text, errors } = end.result;
      if (ok) {
        store.patchWorker(ceo.id, { status: 'idle', lastError: null });
        if (text.trim()) store.say(text.trim(), job.floorId, 'ceo');
      } else {
        const why = errors[0] ?? 'the session failed';
        store.patchWorker(ceo.id, { status: 'error', lastError: why });
        store.say(`⚠ ${ceo.name} couldn't finish "${label}": ${why}`, job.floorId);
      }
    }
    this.ctx.soon(200);
  }
}
