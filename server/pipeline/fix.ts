// Fixing a PR that failed QA, failed its checks or conflicts: its author when they can (resuming their session), anyone
// free otherwise. A fix that pushed nothing is asked once more before it counts, and may say nothing needs to change.
// Adapted from cubefarm server/swarm.ts (MIT): runFix, onFixFinished.
import type { Floor } from '../../shared/types.ts';
import type { PrDetails } from '../backend/backend.ts';
import { depsPromptLine, devPort, machineName } from '../machines/machines.ts';
import { devSystemPrompt, failedLogLines, noPushNudge, ownPrLine } from '../prompts/prompts.ts';
import type { SessionOptions } from '../sessions/session.ts';
import type { QaState } from '../store.ts';
import { afterSession, beginTask, clearTask, failTask, jobDeskFailed, minutesSince, oneLine, prepared, promptFloor, releaseDesk, sessionOptions, stillPreparing, stuck, type Ctx } from './context.ts';
import { prepareDesk, resumeBox } from './desk.ts';
import { fixOutcome, MAX_FIX_FAILURES } from './rules/fixOutcome.ts';
import { failedRunId, logTail, noChangeReason, unpushedFix } from './rules/prOwnership.ts';
import type { SessionEnd } from './sessions.ts';

const REASONS = { qa: 'QA failed it', checks: 'its checks fail', conflict: 'it conflicts' } as const;

export class Fix {
  private nudged = new Set<string>(); // PRs whose fix session was asked once to push

  constructor(private readonly ctx: Ctx) {}

  /** The worker fixes the PR. They turn 'preparing' at once; the rest runs in the background. */
  run(workerId: string, floorId: string, prNumber: number) {
    const { store } = this.ctx;
    const rec = store.qaRecord(floorId, prNumber);
    const pull = store.floor(floorId).pulls.find((p) => p.number === prNumber);
    const author = rec.devWorkerId;
    const headRef = pull?.headRefName ?? store.worker(workerId).task?.branch ?? `pr-${prNumber}`;
    this.nudged.delete(`${floorId}#${prNumber}`);
    store.patchQa(floorId, prNumber, { status: 'fixing', devWorkerId: workerId });
    beginTask(
      this.ctx,
      workerId,
      { kind: 'fix', issueNumber: rec.issueNumber, title: pull?.title ?? `PR #${prNumber}`, branch: headRef, prNumber, prUrl: pull?.url ?? null },
      `▶ Fixing PR #${prNumber}: ${REASONS[rec.fixReason ?? 'qa']}`,
    );
    void this.fix(workerId, floorId, prNumber, headRef, author === workerId, author)
      .catch((err) => {
        if (stillPreparing(this.ctx, workerId)) failTask(this.ctx, workerId, oneLine(err));
        this.giveBack(floorId, prNumber, author, workerId);
      })
      .finally(() => prepared(this.ctx, workerId));
  }

  private async fix(workerId: string, floorId: string, n: number, headRef: string, original: boolean, author: string | null) {
    const { store } = this.ctx;
    const floor = store.floor(floorId);
    let pr: PrDetails;
    try {
      pr = await this.ctx.backend.github.prDetails(floor.fullName, n);
    } catch (err) {
      if (stillPreparing(this.ctx, workerId)) failTask(this.ctx, workerId, `Couldn't read PR #${n}: ${oneLine(err)}`);
      return this.giveBack(floorId, n, author, workerId);
    }
    if (!stillPreparing(this.ctx, workerId)) return this.giveBack(floorId, n, author, workerId);
    if (pr.state !== 'OPEN') {
      clearTask(this.ctx, workerId);
      store.removeQa(floorId, n);
      this.ctx.closures.pullClosed(floorId, pr);
      return;
    }
    let desk;
    try {
      desk = await prepareDesk(this.ctx, workerId, floor, { pr: n }, headRef);
    } catch (err) {
      jobDeskFailed(this.ctx, workerId, store.qaRecord(floorId, n), 'fix', oneLine(err), MAX_FIX_FAILURES, author);
      return;
    }
    if (!desk) return this.giveBack(floorId, n, author, workerId);
    const rec = store.qaRecord(floorId, n);
    const w = store.worker(workerId);
    const prompt = await this.prompt(floor, rec, pr, headRef, original);
    if (!stillPreparing(this.ctx, workerId)) return this.giveBack(floorId, n, author, workerId);
    const systemAppend = devSystemPrompt({ worker: w, repo: promptFloor(floor), port: devPort(workerId), cwd: desk.cwd, branch: headRef, fixing: { pr: n, headRef }, depsLine: depsPromptLine(desk.deps) });
    this.start(
      workerId,
      floorId,
      n,
      sessionOptions(this.ctx, w, floor, {
        cwd: desk.cwd,
        box: desk.box,
        prompt,
        systemAppend,
        task: 'fix',
        // The author picks up where their session left off; anyone else starts afresh.
        resumeSessionId: original && rec.devSessionId ? rec.devSessionId : undefined,
        subject: { issueNumber: rec.issueNumber, prNumber: n, title: pr.title, round: rec.round },
        keepAlive: true,
        label: `${w.name} · fixing #${n} ${pr.title}`,
      }),
    );
  }

  /** What the fixer is told: merge the base for a conflict, the failed run's log for checks, QA's findings otherwise. */
  private async prompt(floor: Floor, rec: QaState, pr: PrDetails, headRef: string, original: boolean): Promise<string> {
    const { store } = this.ctx;
    const base = floor.defaultBranch;
    const push = `git push origin HEAD:${headRef}`;
    const close = 'Then reply with a short summary of what you changed. Do not open a new pull request.';
    if (rec.fixReason === 'conflict' && (rec.preQa || rec.passedSha)) {
      return [
        `Pull request #${rec.prNumber} (${pr.url}) conflicts with ${base}. Bring it up to date: git fetch origin && git merge origin/${base}, resolve the conflicts so both this change and the newly merged work keep working, run the relevant checks, and push: ${push}`,
        ownPrLine(base),
        close,
      ].join('\n');
    }
    if (rec.fixReason === 'checks') {
      const runId = failedRunId(rec.fixInstructions);
      const tail = runId ? logTail(await this.ctx.backend.github.failedRunLog(floor.fullName, runId).catch(() => '')) : '';
      return [
        `QA passed pull request #${rec.prNumber} (${pr.url}), but GitHub's checks fail on it:`,
        rec.fixInstructions ?? '',
        ...(runId ? failedLogLines(runId, tail) : []),
        `Fix what fails and push: ${push}. If a check failed for reasons outside the change, re-run it instead${runId ? ` (gh run rerun ${runId} --failed)` : ''}.`,
        ownPrLine(base),
        close,
      ]
        .filter(Boolean)
        .join('\n');
    }
    const tester = rec.qaWorkerId && store.hasWorker(rec.qaWorkerId) ? store.worker(rec.qaWorkerId).name : 'QA';
    const failed = rec.checks.filter((c) => c.result === 'fail').map((c) => `- ${c.name}: ${c.details}`);
    return [
      original
        ? `${tester} tested your pull request #${rec.prNumber} and it FAILED (round ${rec.round}).`
        : `You are taking over pull request #${rec.prNumber} (${pr.url}), written by a teammate, because QA failed it (round ${rec.round}). Read the PR and the linked issue first.`,
      rec.summary ? `QA summary: ${rec.summary}` : '',
      failed.length ? `Failed checks:\n${failed.join('\n')}` : '',
      rec.fixInstructions ? `What needs fixing:\n${rec.fixInstructions}` : '',
      rec.commentUrl ? `Full report with screenshots: ${rec.commentUrl}` : '',
      `Fix these problems, re-run the relevant checks, and push to the same branch: ${push}`,
      ownPrLine(base),
      `${close} QA will re-test automatically.`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** The office restarted while the worker fixed this PR in their Box: back on that session, whose push follows. */
  reattach(workerId: string): boolean {
    const { store } = this.ctx;
    const w = store.worker(workerId);
    const n = w.task?.kind === 'fix' ? w.task.prNumber : null;
    if (n == null || !store.hasFloor(w.floorId) || !store.findQa(w.floorId, n)) return false;
    const floor = store.floor(w.floorId);
    const cwd = this.ctx.cloud.machinesFor(w).deskDir(machineName(workerId), floor.fullName);
    const opts = sessionOptions(this.ctx, w, floor, { cwd, prompt: '', systemAppend: '', task: 'fix', subject: { issueNumber: w.task!.issueNumber, prNumber: n, title: w.task!.title }, keepAlive: true, label: `${w.name} · fixing #${n} ${w.task!.title}` });
    this.start(workerId, floor.id, n, { ...opts, reattach: true });
    return true;
  }

  /** A restart cut the worker's fix off: their session resumes, told what they were doing. False when it can't. */
  async resume(workerId: string, note: string): Promise<boolean> {
    const { store } = this.ctx;
    const w = store.worker(workerId);
    const task = w.task;
    const n = task?.kind === 'fix' ? task.prNumber : null;
    if (!task || n == null || !task.branch || !w.sessionId || !store.hasFloor(w.floorId) || store.findQa(w.floorId, n)?.status !== 'fixing') return false;
    const floor = store.floor(w.floorId);
    const box = await resumeBox(this.ctx, w, floor);
    if (box === null) return false;
    const cwd = this.ctx.cloud.machinesFor(w).deskDir(machineName(workerId), floor.fullName);
    const systemAppend = devSystemPrompt({ worker: w, repo: promptFloor(floor), port: devPort(workerId), cwd, branch: task.branch, fixing: { pr: n, headRef: task.branch } });
    const opts = sessionOptions(this.ctx, w, floor, { cwd, box, prompt: note, systemAppend, task: 'fix', subject: { issueNumber: task.issueNumber, prNumber: n, title: task.title }, resumeSessionId: w.sessionId, keepAlive: true, label: `${w.name} · fixing #${n} ${task.title}` });
    try {
      this.start(workerId, floor.id, n, opts);
    } catch {
      return false;
    }
    store.patchWorker(workerId, { lastError: null });
    store.appendLog(workerId, [{ kind: 'manager', text: `▶ Office: ${note}` }]);
    return true;
  }

  private start(workerId: string, floorId: string, n: number, opts: SessionOptions) {
    this.ctx.sessions.start(workerId, opts, (end) => {
      releaseDesk(this.ctx, workerId, floorId);
      void this.finished(workerId, floorId, n, end, opts)
        .catch((err) => console.warn(`  the end of a fix went wrong: ${oneLine(err)}`))
        .finally(() => afterSession(this.ctx, floorId, workerId));
    });
  }

  private async finished(workerId: string, floorId: string, n: number, end: SessionEnd, opts: SessionOptions) {
    const { store } = this.ctx;
    if (!store.hasWorker(workerId) || !store.hasFloor(floorId)) return;
    const w = store.worker(workerId);
    const rec = store.findQa(floorId, n);
    if (!rec) {
      if (w.status !== 'stopped') store.patchWorker(workerId, { status: 'done' }); // its PR closed meanwhile
      return;
    }
    const key = `${floorId}#${n}`;
    const limited = this.ctx.usage.paused();
    if (w.status === 'stopped') {
      if (rec.status === 'fixing') store.patchQa(floorId, n, { status: 'failed' });
      return;
    }
    if (!end.result.ok) {
      failTask(this.ctx, workerId, end.result.errors.join('; ') || 'The fix session failed');
      const failures = rec.sessionFailures + (limited ? 0 : 1);
      if (failures >= MAX_FIX_FAILURES) stuck(this.ctx, rec, { sessionFailures: failures }, `${failures} fix sessions failed in a row`);
      else store.patchQa(floorId, n, { status: 'failed', sessionFailures: failures });
      return;
    }
    // Did it push? A checks fix may rightly push nothing (it re-ran a flaky check), so it isn't asked.
    const current = rec.fixReason !== 'checks' ? await this.ctx.backend.github.prDetails(store.floor(floorId).fullName, n).catch(() => null) : null;
    const head = current?.headSha ?? null;
    const step = fixOutcome(rec, head, minutesSince(w.startedAt), !limited, current?.checks ?? null);
    const now = store.findQa(floorId, n);
    if (!now || !store.hasWorker(workerId)) return;
    if (!step.pushed && head) {
      const next = unpushedFix(now, head, { nudged: this.nudged.has(key), noChange: noChangeReason(end.result.text), counts: !limited });
      if (next.do === 'retest') {
        store.patchQa(floorId, n, next.set);
        store.patchWorker(workerId, { status: 'done' });
        store.appendLog(workerId, [{ kind: 'done', text: `✔ No change needed for PR #${n}: back to QA.` }]);
        return;
      }
      if (next.do === 'nudge' && end.sessionId) {
        this.nudged.add(key);
        const text = noPushNudge(n, store.floor(floorId).defaultBranch);
        store.appendLog(workerId, [{ kind: 'manager', text: `▶ Office: ${text}` }]);
        try {
          const cwd = this.ctx.cloud.machinesFor(store.worker(workerId)).deskDir(machineName(workerId), store.floor(floorId).fullName);
          this.start(workerId, floorId, n, { ...opts, cwd, prompt: text, resumeSessionId: end.sessionId });
          return;
        } catch {
          // can't resume it: it counts as a fix that pushed nothing
        }
      }
    }
    if (step.set.status === 'needs-human') stuck(this.ctx, now, step.set, step.set.mergeNote ?? 'its fixes kept failing');
    else store.patchQa(floorId, n, { ...step.set, devSessionId: end.sessionId ?? now.devSessionId });
    if (step.pushed) store.patchWorker(workerId, { status: 'done' });
    else failTask(this.ctx, workerId, step.log.text.replace(/^✗ /, ''));
    if (step.pushed) store.appendLog(workerId, [{ kind: step.log.kind, text: step.log.text }]);
  }

  /** A fix that never got going: the PR waits for its author (or anyone) again. */
  /** The worker's fix ended before it began: the PR waits for a fixer again, unless someone else has it by now. */
  private giveBack(floorId: string, n: number, author: string | null, workerId: string) {
    const rec = this.ctx.store.findQa(floorId, n);
    if (rec?.status === 'fixing' && rec.devWorkerId === workerId) this.ctx.store.patchQa(floorId, n, { status: 'failed', devWorkerId: author });
  }
}
