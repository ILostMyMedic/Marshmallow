// Building an issue: the worker's desk on a new branch, a session with the issue as its prompt, then the PR it opened
// goes to QA. A build that ends without a PR is asked once to finish; after that the issue goes back on the board.
// Adapted from cubefarm server/swarm.ts (MIT): assign, runTask, onIssueFinished, noPullRequest, releaseIssue, issueFailed.
import type { Floor, IssueInfo } from '../../shared/types.ts';
import { depsPromptLine, devPort, machineName } from '../machines/machines.ts';
import { devBranch, devSystemPrompt } from '../prompts/prompts.ts';
import type { SessionOptions } from '../sessions/session.ts';
import { afterSession, beginTask, clearTask, failTask, minutesSince, oneLine, promptFloor, releaseDesk, sessionOptions, slugify, stillPreparing, type Ctx } from './context.ts';
import { prepareDesk } from './desk.ts';
import { managerQuestion } from './questions.ts';
import type { SessionEnd } from './sessions.ts';

/** Failed builds of one issue before it waits for the manager (until a restart). */
export const MAX_ISSUE_FAILURES = 2;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class Build {
  private failures = new Map<string, number>(); // `${floorId}#${n}` → failed builds in a row
  private nudged = new Set<string>(); // issues whose build was asked once to open its PR
  private deskAlerts = new Set<string>(); // `${workerId} ${why}`: desk failures the manager has heard about

  constructor(private readonly ctx: Ctx) {}

  /** The issue failed too often to be handed out again. */
  failedTooOften(floorId: string, n: number): boolean {
    return (this.failures.get(`${floorId}#${n}`) ?? 0) >= MAX_ISSUE_FAILURES;
  }

  /** The worker builds the issue. They turn 'preparing' at once; the rest runs in the background. */
  assign(workerId: string, floorId: string, issue: IssueInfo): void {
    const w = this.ctx.store.worker(workerId);
    const branch = devBranch(issue.number, slugify(w.name));
    beginTask(this.ctx, workerId, { kind: 'issue', issueNumber: issue.number, title: issue.title, branch, prNumber: null, prUrl: null }, `▶ Issue #${issue.number}: ${issue.title}`);
    void this.run(workerId, floorId, issue, branch).catch((err) => {
      if (stillPreparing(this.ctx, workerId)) failTask(this.ctx, workerId, oneLine(err));
      this.ctx.soon();
    });
  }

  private async run(workerId: string, floorId: string, issue: IssueInfo, branch: string) {
    const { store, backend } = this.ctx;
    const floor = store.floor(floorId);
    const live = await backend.github.issueState(floor.fullName, issue.number).catch(() => null);
    if (!stillPreparing(this.ctx, workerId)) return;
    if (live === 'CLOSED') {
      store.appendLog(workerId, [{ kind: 'system', text: `Issue #${issue.number} is closed; nothing to do.` }]);
      clearTask(this.ctx, workerId);
      afterSession(this.ctx, floorId);
      return;
    }
    let desk;
    try {
      desk = await prepareDesk(this.ctx, workerId, floor, {}, branch);
    } catch (err) {
      this.deskFailed(workerId, floor, oneLine(err));
      return;
    }
    if (!desk) return;
    const w = store.worker(workerId);
    const answers = this.ctx.questions.promptFor(floorId, issue.number);
    const prompt = [
      `Please resolve GitHub issue #${issue.number}: ${issue.title}`,
      `URL: ${issue.url}`,
      ...(issue.labels.length ? [`Labels: ${issue.labels.join(', ')}`] : []),
      '',
      issue.body.trim() || '(The issue has no description.)',
      ...(answers ? ['', answers] : []),
    ].join('\n');
    const systemAppend = devSystemPrompt({ worker: w, repo: promptFloor(floor), port: devPort(workerId), cwd: desk.cwd, branch, depsLine: depsPromptLine(desk.deps) });
    this.start(
      workerId,
      floorId,
      sessionOptions(this.ctx, w, floor, {
        cwd: desk.cwd,
        prompt,
        systemAppend,
        task: 'issue',
        subject: { issueNumber: issue.number, prNumber: null, title: issue.title },
        keepAlive: true,
        label: `${w.name} · #${issue.number} ${issue.title}`,
      }),
    );
  }

  private start(workerId: string, floorId: string, opts: SessionOptions) {
    this.ctx.sessions.start(workerId, opts, (end) => {
      releaseDesk(this.ctx, workerId, floorId);
      void this.finished(workerId, floorId, end)
        .catch((err) => console.warn(`  the end of a build went wrong: ${oneLine(err)}`))
        .finally(() => afterSession(this.ctx, floorId));
    });
  }

  private async finished(workerId: string, floorId: string, end: SessionEnd) {
    const { store, backend } = this.ctx;
    if (!store.hasWorker(workerId) || !store.hasFloor(floorId)) return;
    const floor = store.floor(floorId);
    const task = store.worker(workerId).task;
    if (task?.kind !== 'issue' || task.issueNumber == null) return;
    const n = task.issueNumber;
    // The PR: the link in the final message, else the open PR from the branch.
    const linked = end.result.text.match(new RegExp(`https://github\\.com/${escapeRe(floor.fullName)}/pull/(\\d+)`, 'i'));
    let pr = linked ? { number: Number(linked[1]), url: linked[0] } : null;
    if (!pr && task.branch) pr = await backend.github.prForBranch(floor.fullName, task.branch).catch(() => null);
    if (!store.hasWorker(workerId)) return;
    if (pr) store.patchWorker(workerId, { task: { ...task, prNumber: pr.number, prUrl: pr.url } });
    const w = store.worker(workerId);
    if (w.status === 'stopped') return;
    if (!end.result.ok) {
      this.failed(floor, n);
      failTask(this.ctx, workerId, end.result.errors.join('; ') || 'The session failed');
      return;
    }
    this.failures.delete(`${floorId}#${n}`);
    // Too unclear to build: the worker asked the manager instead of guessing.
    const question = pr ? null : managerQuestion(end.result.text);
    if (question && (await this.asked(workerId, floor, n, question))) return;
    store.patchWorker(workerId, { status: 'done' });
    store.appendLog(workerId, [{ kind: 'done', text: `✔ Finished in ${minutesSince(w.startedAt)}m · ${w.turns} turns · ${pr ? `PR #${pr.number}` : 'no PR found'}` }]);
    if (!pr) return this.noPullRequest(workerId, floor, n);
    store.moment({ type: 'prOpened', at: Date.now(), floorId, prNumber: pr.number, workerId, issueNumber: n });
    const rec = store.findQa(floorId, pr.number);
    // QA can fail a PR the worker opened mid-session before the session ends: its fix waited for them.
    if (rec?.status === 'failed') store.patchQa(floorId, pr.number, { devWorkerId: workerId, devSessionId: w.sessionId ?? rec.devSessionId });
    else this.ctx.qa.queue(floorId, pr.number, workerId, n);
  }

  /** The worker's question goes to the manager and the issue waits for the answer; false when it couldn't be asked. */
  private async asked(workerId: string, floor: Floor, n: number, question: string): Promise<boolean> {
    const { store } = this.ctx;
    try {
      await this.ctx.questions.ask(floor.id, n, question, store.worker(workerId).name);
    } catch (err) {
      store.appendLog(workerId, [{ kind: 'error', text: `✗ Couldn't ask the manager about #${n}: ${oneLine(err)}` }]);
      return false;
    }
    if (!store.hasWorker(workerId)) return true;
    store.appendLog(workerId, [{ kind: 'done', text: `❓ Asked the manager about #${n}; it waits for the answer.` }]);
    clearTask(this.ctx, workerId);
    return true;
  }

  /** A build that ended without a PR: asked once to finish it, else the issue goes back on the board. */
  private noPullRequest(workerId: string, floor: Floor, n: number) {
    const { store } = this.ctx;
    const key = `${floor.id}#${n}`;
    const w = store.worker(workerId);
    if (!this.nudged.has(key) && w.sessionId && w.task?.branch) {
      this.nudged.add(key);
      const text = `You finished without opening a pull request for #${n}. Finish the remaining steps now: commit, push your branch and open the PR with "Closes #${n}". If the issue can't be done, open a draft PR that explains why.`;
      store.appendLog(workerId, [{ kind: 'manager', text: `▶ Office: ${text}` }]);
      store.patchWorker(workerId, { startedAt: Date.now(), lastError: null });
      const cwd = this.ctx.backend.machines.deskDir(machineName(workerId), floor.fullName);
      const systemAppend = devSystemPrompt({ worker: w, repo: promptFloor(floor), port: devPort(workerId), cwd, branch: w.task.branch });
      try {
        this.start(
          workerId,
          floor.id,
          sessionOptions(this.ctx, w, floor, { cwd, prompt: text, systemAppend, task: 'issue', subject: { issueNumber: n, prNumber: null, title: w.task.title }, resumeSessionId: w.sessionId, keepAlive: true }),
        );
        return;
      } catch {
        // can't resume it: the issue goes back on the board
      }
    }
    this.nudged.delete(key);
    this.failed(floor, n);
    clearTask(this.ctx, workerId);
    store.say(`🙅 ${w.name} couldn't open a PR for #${n} on ${floor.fullName}, so it's back on the board.`, floor.id);
  }

  /** A build of the issue failed. Not while Claude's limit is hit, which is nobody's fault. */
  private failed(floor: Floor, n: number) {
    if (this.ctx.usage.paused()) return;
    const key = `${floor.id}#${n}`;
    const count = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, count);
    if (count === MAX_ISSUE_FAILURES) this.ctx.store.say(`🧱 Issue #${n} on ${floor.fullName} failed ${count} times; nobody picks it up again until you look at it.`, floor.id);
  }

  private deskFailed(workerId: string, floor: Floor, why: string) {
    failTask(this.ctx, workerId, `Couldn't set up the desk: ${why}`);
    const key = `${workerId} ${why}`;
    if (this.deskAlerts.has(key)) return;
    this.deskAlerts.add(key);
    this.ctx.store.say(`🛠️ ${this.ctx.store.worker(workerId).name}'s desk for ${floor.fullName} couldn't be set up: ${why}`, floor.id);
  }
}
