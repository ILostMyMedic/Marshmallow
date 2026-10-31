// The pipeline's shared context: the office's parts each module works through, the modules themselves (a QA result
// can send a PR back for a fix, a merge can requeue QA), and the small steps they all take.
// Adapted from cubefarm server/swarm.ts (MIT): beginTask, clearTask, fail, stuck, jobDeskFailed.
import { effectiveModel } from '../../shared/models.ts';
import type { Floor, Task, Worker } from '../../shared/types.ts';
import type { Backend } from '../backend/backend.ts';
import type { Floors } from '../floors.ts';
import { devPort, machineName } from '../machines/machines.ts';
import type { PromptFloor } from '../prompts/prompts.ts';
import type { SessionOptions } from '../sessions/session.ts';
import type { QaState, Store } from '../store.ts';
import type { Build } from './build.ts';
import type { Fix } from './fix.ts';
import type { Merge } from './merge.ts';
import type { Qa } from './qa.ts';
import type { Questions } from './questions.ts';
import type { Ceo } from '../team/ceo/jobs.ts';
import type { CloudOffice } from '../team/cloud.ts';
import type { Team } from '../team/workers.ts';
import { prepFailure, type PrepStrikes } from './rules/handOut.ts';
import type { Sessions } from './sessions.ts';
import type { Usage } from './usage.ts';

export interface Ctx {
  store: Store;
  backend: Backend;
  sessions: Sessions;
  floors: Floors;
  usage: Usage;
  build: Build;
  qa: Qa;
  fix: Fix;
  merge: Merge;
  questions: Questions;
  team: Team;
  ceo: Ceo;
  cloud: CloudOffice;
  /** Failed desk preparations per PR and task (`${floorId}#${pr}:${task}`), in memory. */
  prepStrikes: Map<string, PrepStrikes>;
  /** Asks the scheduler for a pass shortly. */
  soon(ms?: number): void;
}

export const oneLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split('\n')[0];

/** Whole minutes since `t`, at least one, for the log. */
export const minutesSince = (t: number | null) => Math.max(1, Math.round((Date.now() - (t ?? Date.now())) / 60_000));

/** A name as a branch part: "Ada Lovelace" → "ada-lovelace". */
export const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'worker';

export const promptFloor = (f: Floor): PromptFloor => ({ fullName: f.fullName, defaultBranch: f.defaultBranch, browserTesting: f.browserTesting, summary: f.summary, mission: f.mission, qaBrief: f.qaBrief });

/** The options every worker session shares; `task` and the rest come from the caller. */
export function sessionOptions(ctx: Ctx, w: Worker, floor: Floor, o: Pick<SessionOptions, 'cwd' | 'prompt' | 'systemAppend'> & Partial<SessionOptions>): SessionOptions {
  const s = ctx.store.getSettings();
  return {
    model: effectiveModel(w.model, s.defaultModel),
    effort: w.effort || s.defaultEffort,
    browserTesting: floor.browserTesting,
    role: 'worker',
    env: ctx.cloud.machinesFor(w).env(machineName(w.id)),
    ...o,
  };
}

/** The worker starts a task: preparing their desk, the task's cost from zero. Synchronous, so the scheduler sees them busy at once. */
export function beginTask(ctx: Ctx, workerId: string, task: Task, line: string) {
  ctx.store.patchWorker(workerId, { status: 'preparing', task, activity: { kind: 'build', detail: 'setting up desk' }, startedAt: Date.now(), endedAt: null, costUsd: 0, turns: 0, lastError: null });
  ctx.store.appendLog(workerId, [{ kind: 'system', text: line }]);
}

/** The worker is still on the job they were preparing for: a stop or a reset since means it was given up. */
export const stillPreparing = (ctx: Ctx, workerId: string) => ctx.store.hasWorker(workerId) && ctx.store.worker(workerId).status === 'preparing';

/** The task is over: back to idle, holding nothing. */
export function clearTask(ctx: Ctx, workerId: string) {
  if (ctx.store.hasWorker(workerId)) ctx.store.patchWorker(workerId, { status: 'idle', task: null, activity: null, lastError: null });
}

/** The task failed: the worker shows why and sits out a cooldown (the scheduler's ERROR_COOLDOWN_MS). */
export function failTask(ctx: Ctx, workerId: string, why: string) {
  if (!ctx.store.hasWorker(workerId)) return;
  ctx.store.patchWorker(workerId, { status: 'error', activity: null, endedAt: Date.now(), lastError: why });
  ctx.store.appendLog(workerId, [{ kind: 'error', text: `✗ ${why}` }]);
}

/** A PR needs the manager: the record says why, and the office tells them once, as it gets there. */
export function stuck(ctx: Ctx, rec: QaState, patch: Partial<QaState>, why: string) {
  const current = ctx.store.findQa(rec.floorId, rec.prNumber);
  if (!current) return;
  ctx.store.patchQa(rec.floorId, rec.prNumber, { ...patch, status: 'needs-human', stuckWhy: why });
  if (current.status !== 'needs-human') ctx.store.say(`⚠️ PR #${rec.prNumber} on ${rec.floorId} needs you: ${why}.`, rec.floorId);
}

/**
 * A desk couldn't be set up for a PR's QA run or fix. It ran nothing, so the worker is free again at once; the PR is
 * what keeps failing, so it sits out after a second failure, and its budget pays (rules/handOut.ts prepFailure).
 */
export function jobDeskFailed(ctx: Ctx, workerId: string, rec: QaState, task: 'qa' | 'fix', why: string, budget: number, author: string | null) {
  const key = `${rec.floorId}#${rec.prNumber}:${task}`;
  const step = prepFailure(ctx.prepStrikes.get(key), rec.sessionFailures, budget, Date.now());
  ctx.prepStrikes.set(key, step.strikes);
  if (ctx.store.hasWorker(workerId)) ctx.store.appendLog(workerId, [{ kind: 'error', text: `✗ Couldn't set up the desk for PR #${rec.prNumber}: ${why}` }]);
  clearTask(ctx, workerId);
  const back = task === 'qa' ? { status: 'queued' as const, qaWorkerId: null } : { status: 'failed' as const, devWorkerId: author };
  if (step.next === 'needs-human') stuck(ctx, rec, { ...back, sessionFailures: step.sessionFailures }, `its desk couldn't be set up: ${why}`);
  else if (ctx.store.findQa(rec.floorId, rec.prNumber)) ctx.store.patchQa(rec.floorId, rec.prNumber, { ...back, sessionFailures: step.sessionFailures });
  ctx.soon(200);
}

/** A session ended: what the worker left running stops (their dev server). */
export function releaseDesk(ctx: Ctx, workerId: string, floorId: string) {
  if (!ctx.store.hasFloor(floorId) || !ctx.store.hasWorker(workerId)) return;
  void ctx.cloud.machinesFor(ctx.store.worker(workerId)).release(machineName(workerId), ctx.store.floor(floorId).fullName, devPort(workerId)).catch(() => undefined);
}

/** A session's outcome is handled: the floor syncs (it lists the new PR, and auto-merge looks again), then the next work. */
export function afterSession(ctx: Ctx, floorId: string) {
  if (ctx.store.hasFloor(floorId)) void ctx.floors.sync(floorId).catch(() => undefined);
  ctx.soon(500);
}
