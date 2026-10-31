// Auto-merge: after every floor sync, each PR QA passed takes its next step toward merging (rules/mergeGate.ts):
// wait for checks, re-run a failed one once, send it back for failing checks or a conflict, bring it up to date, or
// merge exactly the commit QA passed. Only the office's own mm/issue- branches merge themselves.
// Adapted from cubefarm server/swarm.ts (MIT): advanceMerges, advanceMerge, sendBack, closeResolvedIssues.
import type { Floor, PullInfo } from '../../shared/types.ts';
import type { QaState } from '../store.ts';
import { clearTask, oneLine, stuck, type Ctx } from './context.ts';
import { issuesResolvedBy } from './rules/issueClaims.ts';
import { MAX_MERGE_FIXES, MERGE_RETRY_MS, mergeStep, type MergePull } from './rules/mergeGate.ts';

export class Merge {
  private merging = new Set<string>(); // floors whose merges are being advanced right now

  constructor(private readonly ctx: Ctx) {}

  /** Advances every QA-passed PR on the floor. Runs after each sync, so it decides on what GitHub just said. */
  async advance(floorId: string) {
    const { store } = this.ctx;
    if (this.merging.has(floorId) || !store.hasFloor(floorId)) return;
    this.merging.add(floorId);
    let merged = false;
    try {
      for (const rec of store.qaList(floorId).filter((q) => q.status === 'passed')) {
        if (!store.hasFloor(floorId)) break;
        const floor = store.floor(floorId);
        const pr = floor.pulls.find((p) => p.number === rec.prNumber && p.state === 'OPEN');
        if (!pr?.headRefName.startsWith('mm/issue-')) continue;
        // Decide only on a sync that began after the record last changed (a QA pass, a fix, a re-run).
        if ((floor.lastSync ?? 0) < rec.updatedAt) continue;
        try {
          if (await this.step(floor, rec, pr)) merged = true;
        } catch (err) {
          this.note(rec, `auto-merge hit a problem: ${oneLine(err)}`);
        }
      }
    } finally {
      this.merging.delete(floorId);
    }
    if (merged) {
      void this.ctx.floors.sync(floorId).catch(() => undefined);
      this.ctx.soon(200);
    }
  }

  /** Sends a QA-passed PR back to a developer for failing checks or a conflict; to the manager once the fixes run out. */
  sendBack(rec: QaState, reason: 'checks' | 'conflict', instructions: string, needsHuman: boolean) {
    const { store } = this.ctx;
    if (needsHuman) {
      const base = store.hasFloor(rec.floorId) ? store.floor(rec.floorId).defaultBranch : 'the default branch';
      stuck(this.ctx, rec, { mergeNote: null }, `it still ${reason === 'conflict' ? `conflicts with ${base}` : 'fails its checks'} after ${MAX_MERGE_FIXES} fixes`);
      return;
    }
    if (!store.findQa(rec.floorId, rec.prNumber)) return;
    store.patchQa(rec.floorId, rec.prNumber, { status: 'failed', fixReason: reason, fixInstructions: instructions, mergeFixes: rec.mergeFixes + 1, mergeNote: null, pendingSince: null });
    this.ctx.soon(200);
  }

  /** One step for one PR; true when it merged. */
  private async step(floor: Floor, rec: QaState, pull: PullInfo): Promise<boolean> {
    const { store } = this.ctx;
    const gh = this.ctx.backend.github;
    const now = Date.now();
    const base = floor.defaultBranch;
    let pr: MergePull = pull;
    let step = mergeStep(pr, rec, now, { base });
    if (step.do === 'details') {
      // GitHub's list hadn't worked out mergeability yet: ask about the PR itself.
      const d = await gh.prDetails(floor.fullName, rec.prNumber);
      pr = { ...pull, headSha: d.headSha, mergeable: d.mergeable, mergeState: d.mergeState };
      step = mergeStep(pr, rec, now, { base, detailed: true });
    }
    if (Object.keys(step.set).length) store.patchQa(rec.floorId, rec.prNumber, step.set, false);
    const fresh = () => store.qaRecord(rec.floorId, rec.prNumber);
    switch (step.do) {
      case 'details':
        return false;
      case 'wait':
        if (step.alert) store.say(`⏳ PR #${rec.prNumber} on ${floor.fullName} has waited over half an hour for its checks.`, floor.id);
        if (step.note) this.note(rec, step.note);
        return false;
      case 'requeue':
        // Commits arrived after QA's sign-off: QA tests them too.
        store.patchQa(rec.floorId, rec.prNumber, { status: 'queued', round: rec.round + 1, retests: rec.retests + 1, mergeNote: null, pendingSince: null });
        this.ctx.soon(200);
        return false;
      case 'send-back':
        this.sendBack(fresh(), step.reason, step.instructions, step.needsHuman);
        return false;
      case 'rerun':
        try {
          await gh.rerunFailedJobs(floor.fullName, step.runIds);
          store.patchQa(rec.floorId, rec.prNumber, { rerunSha: pr.headSha, rerunAt: now, pendingSince: null, alerted: false, mergeNote: 're-running a failed check' });
        } catch {
          this.sendBack(fresh(), step.reason, step.instructions, step.needsHuman);
        }
        return false;
      case 'update-branch': {
        // GitHub merges the base in; QA's sign-off carries over to the new head, and the checks run on it.
        this.note(rec, `bringing it up to date with ${base}`);
        await gh.updateBranch(floor.fullName, rec.prNumber);
        const d = await gh.prDetails(floor.fullName, rec.prNumber);
        store.patchQa(rec.floorId, rec.prNumber, { passedSha: d.headSha });
        return false;
      }
      case 'merge':
        return this.merge(floor, fresh(), pull);
    }
  }

  private async merge(floor: Floor, rec: QaState, pull: PullInfo): Promise<boolean> {
    const { store } = this.ctx;
    const n = rec.prNumber;
    let error = '';
    // A squash merge, else the methods the repository allows; always exactly the commit QA passed.
    for (const method of ['squash', 'merge', 'rebase'] as const) {
      try {
        await this.ctx.backend.github.mergePull(floor.fullName, n, method, rec.passedSha ?? pull.headSha);
        error = '';
        break;
      } catch (err) {
        error = oneLine(err).replace(/^gh .*? failed: /, '');
        if (!/not allowed/i.test(error)) break;
      }
    }
    if (error) {
      if (/head (branch|commit)/i.test(error)) {
        this.note(rec, 'new commits arrived; QA checks them first');
        return false;
      }
      store.patchQa(floor.id, n, { mergeRetryAt: Date.now() + MERGE_RETRY_MS, alerted: true }, false);
      if (!rec.alerted) store.say(`⚠️ GitHub won't merge PR #${n} on ${floor.fullName}: ${error}. Trying again in 10 minutes.`, floor.id);
      this.note(rec, `merge blocked: ${error}`);
      return false;
    }
    await this.merged(floor, rec, pull);
    return true;
  }

  /** After a merge: its issues close, its QA record goes, and whoever still held the PR is free for the next issue. */
  private async merged(floor: Floor, rec: QaState, pull: PullInfo) {
    const { store } = this.ctx;
    const n = rec.prNumber;
    const resolved = issuesResolvedBy(pull);
    const now = store.floor(floor.id);
    store.patchFloor(floor.id, {
      issues: now.issues.filter((i) => !resolved.includes(i.number)),
      pulls: now.pulls.map((p) => (p.number === n ? { ...p, state: 'MERGED' as const, mergedAt: new Date().toISOString() } : p)),
    });
    store.removeQa(floor.id, n);
    for (const w of store.workerList()) {
      if (w.floorId !== floor.id || w.task?.prNumber !== n || w.status === 'preparing' || w.status === 'working') continue;
      store.appendLog(w.id, [{ kind: 'done', text: `🎉 PR #${n} was merged. Ready for the next issue.` }]);
      clearTask(this.ctx, w.id);
    }
    store.moment({ type: 'merged', at: Date.now(), floorId: floor.id, prNumber: n, devWorkerId: rec.devWorkerId, qaWorkerId: rec.qaWorkerId });
    // GitHub closes what "Closes #N" links; the office closes the rest (and anything GitHub missed).
    for (const issue of resolved) {
      const state = await this.ctx.backend.github.issueState(floor.fullName, issue).catch(() => null);
      if (state === 'OPEN') await this.ctx.backend.github.closeIssue(floor.fullName, issue, `Shipped in #${n}`).catch(() => undefined);
    }
  }

  /** Where auto-merge stands, on the PR's QA card. Bookkeeping: it doesn't count as a change to the record. */
  private note(rec: QaState, text: string) {
    const current = this.ctx.store.findQa(rec.floorId, rec.prNumber);
    if (current && current.mergeNote !== text) this.ctx.store.patchQa(rec.floorId, rec.prNumber, { mergeNote: text }, false);
  }
}
