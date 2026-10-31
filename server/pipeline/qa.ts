// QA: a different worker tests each PR in a fresh session on its head, and the office posts the structured report on
// the PR. A pass goes to the merge gate; a fail goes back to the developer (fix.ts); a conflict is sent back before a
// tester spends a session on it.
// Adapted from cubefarm server/swarm.ts (MIT): queueQa, runQa, onQaFinished, renderQaComment.
import type { Floor } from '../../shared/types.ts';
import type { PrDetails } from '../backend/backend.ts';
import { depsPromptLine, devPort, machineName } from '../machines/machines.ts';
import { qaBranch, qaSystemPrompt } from '../prompts/prompts.ts';
import { qaInstructions } from '../prompts/qaPrompt.ts';
import type { SessionOptions } from '../sessions/session.ts';
import type { QaState } from '../store.ts';
import { afterSession, beginTask, clearTask, failTask, jobDeskFailed, minutesSince, oneLine, prepared, promptFloor, releaseDesk, sessionOptions, slugify, stillPreparing, stuck, type Ctx } from './context.ts';
import { prepareDesk } from './desk.ts';
import { evidenceFiles, parseReport, QA_SCHEMA, renderQaComment, type QaReport } from './qaReport.ts';
import { QA_STOPPED } from './rules/prOwnership.ts';
import { conflictFixInstructions, qaGate, qaOutcome } from './rules/qaOutcome.ts';
import { QA_RESUME_PROMPT, qaRetry } from './rules/qaRetry.ts';
import type { SessionEnd, Shot } from './sessions.ts';

/** QA sessions in a row without a usable report before the PR goes to the manager. */
export const MAX_QA_FAILURES = 2;

export function newQaRecord(floorId: string, prNumber: number, o: { devWorkerId: string | null; devSessionId: string | null; issueNumber: number | null }): QaState {
  return {
    floorId,
    prNumber,
    status: 'queued',
    round: 1,
    devWorkerId: o.devWorkerId,
    qaWorkerId: null,
    summary: null,
    checks: [],
    commentUrl: null,
    mergeNote: null,
    updatedAt: Date.now(),
    issueNumber: o.issueNumber,
    devSessionId: o.devSessionId,
    fixInstructions: null,
    sessionFailures: 0,
    testedSha: null,
    passedSha: null,
    fixReason: null,
    retests: 0,
    mergeFixes: 0,
    preQa: null,
    noChangeSha: null,
    qaChecks: null,
    stuckWhy: null,
    pendingSince: null,
    mergeRetryAt: null,
    alerted: false,
    rerunSha: null,
    rerunAt: null,
  };
}

export class Qa {
  // A tester's QA run can be resumed once when it ends without a report: its desk and instructions, per worker.
  private resumable = new Map<string, { cwd: string; systemAppend: string }>();

  constructor(private readonly ctx: Ctx) {}

  /** The PR waits for a tester. `devId`: who wrote it (their session is the one a fix resumes). */
  queue(floorId: string, prNumber: number, devId: string | null, issueNumber: number | null) {
    const { store } = this.ctx;
    const dev = devId && store.hasWorker(devId) ? store.worker(devId) : null;
    const rec = store.findQa(floorId, prNumber);
    if (rec?.status === 'testing') return;
    if (rec) store.patchQa(floorId, prNumber, { status: 'queued', devWorkerId: dev?.id ?? rec.devWorkerId, devSessionId: dev?.sessionId ?? rec.devSessionId });
    else store.putQa(newQaRecord(floorId, prNumber, { devWorkerId: dev?.id ?? null, devSessionId: dev && dev.task?.prNumber === prNumber ? dev.sessionId : null, issueNumber }));
    this.ctx.soon(200);
  }

  /** The worker tests the PR. They turn 'preparing' at once; the rest runs in the background. */
  run(workerId: string, floorId: string, prNumber: number) {
    const { store } = this.ctx;
    const w = store.worker(workerId);
    const rec = store.qaRecord(floorId, prNumber);
    const pull = store.floor(floorId).pulls.find((p) => p.number === prNumber);
    const branch = qaBranch(prNumber, slugify(w.name));
    store.patchQa(floorId, prNumber, { status: 'testing', qaWorkerId: workerId });
    beginTask(
      this.ctx,
      workerId,
      { kind: 'qa', issueNumber: rec.issueNumber, title: pull?.title ?? `PR #${prNumber}`, branch, prNumber, prUrl: pull?.url ?? null },
      `▶ Testing PR #${prNumber}${pull ? `: ${pull.title}` : ''} (round ${rec.round})`,
    );
    void this.test(workerId, floorId, prNumber, branch)
      .catch((err) => {
        if (stillPreparing(this.ctx, workerId)) failTask(this.ctx, workerId, oneLine(err));
        this.requeue(floorId, prNumber, workerId);
      })
      .finally(() => prepared(this.ctx, workerId));
  }

  private async test(workerId: string, floorId: string, n: number, branch: string) {
    const { store } = this.ctx;
    const gh = this.ctx.backend.github;
    const floor = store.floor(floorId);
    const rec = store.qaRecord(floorId, n);
    const lastTestedSha = rec.testedSha;
    let pr: PrDetails;
    try {
      pr = await gh.prDetails(floor.fullName, n);
    } catch (err) {
      if (stillPreparing(this.ctx, workerId)) failTask(this.ctx, workerId, `Couldn't read PR #${n}: ${oneLine(err)}`);
      this.requeue(floorId, n, workerId);
      return;
    }
    const issueNumber = rec.issueNumber ?? pr.closesIssues[0] ?? null;
    const issue = issueNumber ? await gh.issueDetails(floor.fullName, issueNumber).catch(() => null) : null;
    if (!stillPreparing(this.ctx, workerId)) return this.requeue(floorId, n, workerId);
    if (pr.state !== 'OPEN') {
      clearTask(this.ctx, workerId);
      store.removeQa(floorId, n);
      this.ctx.closures.pullClosed(floorId, pr);
      return;
    }
    // A conflicting PR goes back to its developer first; one that's only behind is brought up to date.
    const gate = qaGate(pr, rec);
    if (gate.do === 'send-back') {
      clearTask(this.ctx, workerId);
      if (gate.needsHuman) this.ctx.merge.sendBack(rec, 'conflict', rec.fixInstructions ?? '', true);
      else store.patchQa(floorId, n, { status: 'failed', qaWorkerId: null, fixReason: 'conflict', preQa: { sha: pr.headSha, fixReason: rec.fixReason }, mergeFixes: rec.mergeFixes + 1, mergeNote: null });
      this.ctx.soon(200);
      return;
    }
    if (gate.do === 'update-branch') {
      try {
        await gh.updateBranch(floor.fullName, n);
        pr = await gh.prDetails(floor.fullName, n);
      } catch (err) {
        store.appendLog(workerId, [{ kind: 'system', text: `Couldn't bring PR #${n} up to date (${oneLine(err)}); testing it as it is.` }]);
      }
      if (!stillPreparing(this.ctx, workerId)) return this.requeue(floorId, n, workerId);
    }
    store.patchQa(floorId, n, { testedSha: pr.headSha }, false);
    let desk;
    try {
      desk = await prepareDesk(this.ctx, workerId, floor, { pr: n }, branch);
    } catch (err) {
      jobDeskFailed(this.ctx, workerId, store.qaRecord(floorId, n), 'qa', oneLine(err), MAX_QA_FAILURES, null);
      return;
    }
    if (!desk) return this.requeue(floorId, n, workerId);

    // A conflict fix for a PR QA failed on its last round also fixed QA's findings: it's a QA re-test.
    const failedConflict = rec.fixReason === 'conflict' && !rec.passedSha;
    const info = qaInstructions({
      ...pr,
      round: rec.round,
      fixReason: failedConflict ? 'qa' : rec.fixReason,
      lastTestedSha: failedConflict ? null : lastTestedSha,
      summary: rec.summary,
      fixInstructions: rec.fixInstructions,
      defaultBranch: floor.defaultBranch,
    });
    const w = store.worker(workerId);
    const author = rec.devWorkerId === workerId ? 'you, in an earlier session' : rec.devWorkerId && store.hasWorker(rec.devWorkerId) ? store.worker(rec.devWorkerId).name : 'a teammate';
    const prompt = [
      `Please QA pull request #${n}: ${pr.title}`,
      `URL: ${pr.url}`,
      `Author: ${author} · QA round ${rec.round}`,
      info.checks,
      info.retest,
      'PR description:',
      pr.body.trim() || '(empty)',
      issue ? `\nLinked issue: ${issue.title}\n${issue.body.trim() || '(no description)'}` : '',
    ]
      .filter((l) => l !== '')
      .join('\n');
    const systemAppend = qaSystemPrompt({
      worker: w,
      repo: promptFloor(floor),
      port: devPort(workerId),
      cwd: desk.cwd,
      branch,
      pr: { number: n, title: pr.title, headRefName: pr.headRefName, url: pr.url },
      testStep: info.testStep,
      depsLine: depsPromptLine(desk.deps),
    });
    this.resumable.set(workerId, { cwd: desk.cwd, systemAppend });
    this.start(
      workerId,
      floorId,
      n,
      sessionOptions(this.ctx, w, floor, {
        cwd: desk.cwd,
        box: desk.box,
        prompt,
        systemAppend,
        task: 'qa',
        outputSchema: QA_SCHEMA,
        subject: { issueNumber, prNumber: n, title: pr.title, round: rec.round },
        keepAlive: false,
        label: `${w.name} · QA #${n} ${pr.title}`,
      }),
    );
  }

  /** The office restarted while the worker tested this PR in their Box: back on that session, whose report follows. */
  reattach(workerId: string): boolean {
    const { store } = this.ctx;
    const w = store.worker(workerId);
    const n = w.task?.kind === 'qa' ? w.task.prNumber : null;
    if (n == null || !store.hasFloor(w.floorId) || !store.findQa(w.floorId, n)) return false;
    const floor = store.floor(w.floorId);
    const cwd = this.ctx.cloud.machinesFor(w).deskDir(machineName(workerId), floor.fullName);
    const opts = sessionOptions(this.ctx, w, floor, { cwd, prompt: '', systemAppend: '', task: 'qa', outputSchema: QA_SCHEMA, subject: { issueNumber: w.task!.issueNumber, prNumber: n, title: w.task!.title }, keepAlive: false, label: `${w.name} · QA #${n} ${w.task!.title}` });
    this.start(workerId, floor.id, n, { ...opts, reattach: true });
    return true;
  }

  private start(workerId: string, floorId: string, n: number, opts: SessionOptions) {
    this.ctx.sessions.start(workerId, opts, (end) => {
      releaseDesk(this.ctx, workerId, floorId);
      void this.finished(workerId, floorId, n, end, opts)
        .catch((err) => console.warn(`  the end of a QA run went wrong: ${oneLine(err)}`))
        .finally(() => afterSession(this.ctx, floorId, workerId));
    });
  }

  private async finished(workerId: string, floorId: string, n: number, end: SessionEnd, opts: SessionOptions) {
    const { store } = this.ctx;
    if (!store.hasWorker(workerId) || !store.hasFloor(floorId)) return;
    const w = store.worker(workerId);
    const rec = store.findQa(floorId, n);
    const stopped = w.status === 'stopped';
    if (!rec) {
      if (!stopped) store.patchWorker(workerId, { status: 'done' }); // its PR closed meanwhile
      return;
    }
    if (stopped && this.ctx.dropping.has(workerId)) {
      this.resumable.delete(workerId); // given up (the watchdog, a reset): whoever gave it up saw to the record
      return;
    }
    const report = end.result.ok ? parseReport(end.result) : null;
    const limited = this.ctx.usage.paused();
    const resume = this.resumable.get(workerId);
    const next = qaRetry({ stopped, limited, ok: end.result.ok, report: !!report, canResume: !!resume && !!end.sessionId });
    this.resumable.delete(workerId);
    if (next === 'resume' && resume && end.sessionId) {
      store.appendLog(workerId, [{ kind: 'manager', text: `▶ Office: ${QA_RESUME_PROMPT}` }]);
      try {
        this.start(workerId, floorId, n, { ...opts, cwd: resume.cwd, systemAppend: resume.systemAppend, prompt: QA_RESUME_PROMPT, resumeSessionId: end.sessionId });
        return;
      } catch {
        // can't resume it: it counts as a run without a report
      }
    }
    if (!report) {
      if (!stopped) failTask(this.ctx, workerId, 'QA finished without a usable report');
      const failures = rec.sessionFailures + (limited ? 0 : 1);
      if (stopped) store.patchQa(floorId, n, { status: 'needs-human', summary: QA_STOPPED, stuckWhy: QA_STOPPED });
      else if (failures >= MAX_QA_FAILURES) stuck(this.ctx, rec, { sessionFailures: failures }, `QA ended without a report ${failures} times`);
      else store.patchQa(floorId, n, { status: 'queued', qaWorkerId: null, sessionFailures: failures });
      return;
    }

    const pass = report.verdict === 'pass';
    store.patchWorker(workerId, { status: 'done' });
    store.appendLog(workerId, [{ kind: 'done', text: `✔ QA ${pass ? 'passed' : 'failed'} PR #${n} (round ${rec.round}) in ${minutesSince(w.startedAt)}m` }]);
    const floor = store.floor(floorId);
    const pull = pass ? null : await this.ctx.backend.github.prDetails(floor.fullName, n).catch(() => null);
    const outcome = qaOutcome(pass, rec, pull);
    const commentUrl = await this.postReport(floor, rec, report, end.shots, w.name);
    const current = store.findQa(floorId, n);
    if (!current) return; // its PR closed while the report went up
    const fixInstructions = report.fixInstructions ?? (report.checks.filter((c) => c.result === 'fail').map((c) => `${c.name}: ${c.details}`).join('\n') || null);
    const patch: Partial<QaState> = {
      summary: report.summary,
      checks: report.checks,
      commentUrl: commentUrl ?? current.commentUrl,
      fixInstructions,
      sessionFailures: 0,
      fixReason: pass ? null : 'qa',
      preQa: null,
      passedSha: pass ? current.testedSha : null,
      qaChecks: pull?.checks ?? null,
      mergeNote: null,
      pendingSince: null,
      mergeRetryAt: null,
      alerted: false,
    };
    store.moment({ type: pass ? 'qaPassed' : 'qaFailed', at: Date.now(), floorId, prNumber: n, qaWorkerId: workerId });
    // stuck() moves it to needs-human itself, so the manager hears about it as it gets there.
    if (outcome === 'needs-human') return stuck(this.ctx, current, patch, `it failed QA ${rec.round - rec.retests} times`);
    const updated = store.patchQa(floorId, n, { ...patch, status: outcome === 'conflict' ? 'failed' : outcome });
    if (outcome === 'conflict') this.ctx.merge.sendBack(updated, 'conflict', conflictFixInstructions(fixInstructions ?? '', floor.defaultBranch), false);
  }

  /** Posts the report on the PR, with the newest screenshots on the evidence branch; the comment's URL, or null. */
  private async postReport(floor: Floor, rec: QaState, report: QaReport, shots: Shot[], tester: string): Promise<string | null> {
    const gh = this.ctx.backend.github;
    const posted: { url: string; caption: string }[] = [];
    for (const f of evidenceFiles(shots, report, rec.prNumber, rec.round, Date.now())) {
      try {
        posted.push({ url: await gh.uploadEvidence(floor.fullName, f.path, shots[f.index].data), caption: f.caption });
      } catch (err) {
        console.warn(`  a QA screenshot for PR #${rec.prNumber} didn't upload: ${oneLine(err)}`);
      }
    }
    try {
      return await gh.commentPull(floor.fullName, rec.prNumber, renderQaComment(report, { round: rec.round, tester, shots: posted }));
    } catch (err) {
      console.warn(`  the QA report for PR #${rec.prNumber} wasn't posted: ${oneLine(err)}`);
      return null;
    }
  }

  /** A QA run that never got going: the PR waits for a tester again. */
  /** The worker's QA run of the PR ended before it began: the PR waits for a tester again, unless someone else has it by now. */
  private requeue(floorId: string, n: number, workerId: string) {
    const rec = this.ctx.store.findQa(floorId, n);
    if (rec?.status === 'testing' && rec.qaWorkerId === workerId) this.ctx.store.patchQa(floorId, n, { status: 'queued', qaWorkerId: null });
  }
}
