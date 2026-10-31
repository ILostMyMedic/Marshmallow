// The demo's GitHub: repositories with issues, pull requests and checks, kept in memory and saved to
// demo-github.json in the office's home, so a restart picks up where it left off. Checks run for a while after every
// push and now and then fail, and a merge now and then leaves another open PR conflicting, so the pipeline's fix
// paths show.
// Adapted from cubefarm server/demo.ts (MIT).
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { GhRepoSummary, IssueInfo, PullInfo } from '../../shared/types.ts';
import { writeJsonAtomic } from '../files.ts';
import type { GitHubApi, IssueComment, PrDetails, RepoMeta } from './backend.ts';

interface FakeRepo {
  fullName: string;
  description: string;
  issues: IssueInfo[]; // the open ones
  pulls: PullInfo[]; // newest first
  nextNumber: number; // issues and PRs share one sequence, as on GitHub
  closed: number[]; // closed issues
  comments?: Record<number, IssueComment[]>; // by issue number (absent in files saved before comments)
}

export interface FakeGitHubOptions {
  /** Where it's saved; null keeps it in memory only (tests). */
  file: string | null;
  rand: () => number;
  /** How long checks run after a push. */
  checksMs: () => number;
  /** GitHub closes the issues a merge resolves a little after the merge, not at once. */
  closeAfterMergeMs: number;
}

const SEED: { fullName: string; description: string; issues: [string, string][] }[] = [
  {
    fullName: 'demo-co/pixel-todo',
    description: 'A cheerful todo app',
    issues: [
      ['Add dark mode toggle', 'Users want a dark theme. Persist the choice in localStorage.'],
      ['Todos should support due dates', 'Add an optional due date and highlight overdue items.'],
      ['Drag and drop to reorder', 'Let users reorder todos by dragging.'],
      ['Empty state illustration', 'Show a friendly illustration when the list is empty.'],
      ['Keyboard shortcuts', 'N for new todo, / to search, ? for help.'],
      ['Fix: completed count off by one', 'The footer shows one more completed item than there is.'],
      ['Make it pop', 'The app feels a bit flat. Make it more fun.'], // too vague to build: its worker asks first
    ],
  },
  {
    fullName: 'demo-co/weather-api',
    description: 'Tiny weather REST API',
    issues: [
      ['Add /forecast endpoint', 'Return a 5-day forecast for a city.'],
      ['Rate limit anonymous callers', '60 requests per minute per IP.'],
      ['OpenAPI spec', 'Publish an OpenAPI 3.1 document at /openapi.json.'],
    ],
  },
  {
    fullName: 'demo-co/recipe-box',
    description: 'Recipes with a shopping list',
    issues: [
      ['Scale a recipe by servings', 'A servings field that scales every ingredient.'],
      ['Shopping list from a week of recipes', 'Merge the ingredients of the recipes picked for the week.'],
      ['Print view', 'A clean printable page for one recipe.'],
      ['Search by ingredient', 'Find recipes that use what is in the fridge.'],
    ],
  },
];

const CHECKS = ['CI / build', 'Vercel'];
const fakeSha = () => crypto.randomBytes(20).toString('hex');
const iso = () => new Date().toISOString();
// What GitHub hands out is the caller's to keep: copies, so nothing changes under the office's feet.
const copy = <T>(value: T): T => structuredClone(value);

export class FakeGitHub implements GitHubApi {
  private repos = new Map<string, FakeRepo>();
  private timers = new Set<NodeJS.Timeout>();
  private saving: Promise<void> = Promise.resolve();
  private runSeq = Math.floor(Date.now() / 1000); // fake Actions run ids, so a failed one can be re-run

  constructor(private readonly opts: FakeGitHubOptions) {
    this.load();
  }

  /** Back to the seed, as a first start finds it (the debug page's reset). */
  reset() {
    this.close();
    this.repos.clear();
    this.seed();
    this.save();
  }

  /** Stops the pending checks and issue closings (tests, shutdown). */
  close() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /** Waits for the saves in progress. */
  flush(): Promise<void> {
    return this.saving;
  }

  // ---------- GitHubApi ----------

  async user() {
    return 'demo-manager';
  }

  async listMyRepos(): Promise<GhRepoSummary[]> {
    return [...this.repos.values()].map((r) => ({ nameWithOwner: r.fullName, description: r.description, visibility: 'PUBLIC', updatedAt: iso() }));
  }

  async repoMeta(fullName: string): Promise<RepoMeta> {
    const r = this.repo(fullName);
    return { nameWithOwner: r.fullName, description: r.description, url: `https://github.com/${r.fullName}`, defaultBranch: 'main' };
  }

  async listIssues(fullName: string) {
    return copy(this.repo(fullName).issues);
  }

  // Like GitHub's list as the office asks for it: the open PRs and the 8 latest merges, never closed ones.
  async listPulls(fullName: string) {
    const pulls = this.repo(fullName).pulls;
    return copy([...pulls.filter((p) => p.state === 'OPEN'), ...pulls.filter((p) => p.state === 'MERGED').slice(0, 8)]);
  }

  async createIssue(fullName: string, title: string, body: string, labels: string[] = []) {
    const r = this.repo(fullName);
    const issue = this.issue(r, title, body, labels);
    r.issues.push(issue);
    this.save();
    return issue.number;
  }

  async issueState(fullName: string, number: number) {
    const r = this.repo(fullName);
    if (r.issues.some((i) => i.number === number)) return 'OPEN';
    return r.closed.includes(number) ? 'CLOSED' : null;
  }

  async editIssue(fullName: string, number: number, edit: { body?: string; addLabels?: string[]; removeLabels?: string[] }) {
    const i = this.repo(fullName).issues.find((x) => x.number === number);
    if (!i) throw new Error(`Issue #${number} is not open`);
    if (edit.body !== undefined) i.body = edit.body;
    i.labels = [...i.labels.filter((l) => !edit.removeLabels?.includes(l)), ...(edit.addLabels ?? []).filter((l) => !i.labels.includes(l))];
    this.save();
  }

  async closeIssue(fullName: string, number: number, _comment?: string) {
    const r = this.repo(fullName);
    if (!r.issues.some((i) => i.number === number)) throw new Error(`Issue #${number} is not open`);
    this.closeIssues(r, [number]);
    this.save();
  }

  async issueComments(fullName: string, number: number) {
    return copy(this.repo(fullName).comments?.[number] ?? []);
  }

  async commentIssue(fullName: string, number: number, body: string) {
    const r = this.repo(fullName);
    if (!r.issues.some((i) => i.number === number) && !r.closed.includes(number)) throw new Error(`Could not resolve to an issue with the number of ${number}.`);
    const list = ((r.comments ??= {})[number] ??= []);
    const id = `IC_demo${number}_${list.length + 1}`;
    const url = `https://github.com/${fullName}/issues/${number}#issuecomment-${Date.now()}${list.length}`;
    list.push({ id, body, createdAt: new Date().toISOString(), url });
    this.save();
    return url;
  }

  async mergePull(fullName: string, number: number, _method: 'squash' | 'merge' | 'rebase', headSha?: string) {
    const r = this.repo(fullName);
    const pr = this.pull(r, number);
    if (pr.state !== 'OPEN') throw new Error(`Pull request #${number} is not open`);
    if (headSha && pr.headSha !== headSha) throw new Error('Head branch was modified. Review and try the merge again.');
    if (pr.mergeable === 'CONFLICTING') throw new Error('Pull request is not mergeable: the merge commit cannot be cleanly created.');
    Object.assign(pr, { state: 'MERGED', mergedAt: iso() });
    // Now and then a merge leaves another open PR conflicting, so conflict fixes can be seen.
    for (const other of r.pulls) if (other.state === 'OPEN' && this.opts.rand() < 0.25) Object.assign(other, { mergeable: 'CONFLICTING', mergeState: 'DIRTY' });
    this.later(this.opts.closeAfterMergeMs, () => {
      this.closeIssues(r, pr.closesIssues);
      this.save();
    });
    this.save();
  }

  async updateBranch(fullName: string, number: number) {
    const pr = this.pull(this.repo(fullName), number);
    if (pr.mergeable === 'CONFLICTING') throw new Error('merge conflict between base and head');
    Object.assign(pr, { headSha: fakeSha(), mergeState: 'CLEAN' });
    this.runChecks(pr, false);
    this.save();
  }

  async failedRunLog(_fullName: string, runId: string) {
    return [
      `build\tRun npm test\t2026-01-01T00:00:00Z > vitest run (run ${runId})`,
      'build\tRun npm test\t2026-01-01T00:00:01Z  FAIL  src/__tests__/toolbar.test.ts > wraps below 480px',
      'build\tRun npm test\t2026-01-01T00:00:01Z AssertionError: expected "nowrap" to be "wrap"',
      'build\tRun npm test\t2026-01-01T00:00:02Z Test Files  1 failed | 7 passed (8)',
      'build\tRun npm test\t2026-01-01T00:00:02Z ##[error]Process completed with exit code 1.',
    ].join('\n');
  }

  // A re-run passes: a flake, as the office hoped.
  async rerunFailedJobs(fullName: string, runIds: number[]) {
    for (const pr of this.repo(fullName).pulls) {
      if (pr.failedChecks.some((c) => runIds.some((id) => c.url?.includes(`/actions/runs/${id}/`)))) this.runChecks(pr, false);
    }
    this.save();
  }

  async closePull(fullName: string, number: number) {
    this.pull(this.repo(fullName), number).state = 'CLOSED';
    this.save();
  }

  async prForBranch(fullName: string, branch: string) {
    const pr = this.repo(fullName).pulls.find((p) => p.state === 'OPEN' && p.headRefName === branch);
    return pr ? { number: pr.number, url: pr.url } : null;
  }

  async prDetails(fullName: string, number: number): Promise<PrDetails> {
    const pr = this.pull(this.repo(fullName), number);
    return {
      number,
      title: pr.title,
      body: `Implements the change.\n\nCloses #${pr.closesIssues[0] ?? '?'}`,
      url: pr.url,
      headRefName: pr.headRefName,
      headSha: pr.headSha,
      isCrossRepository: false,
      closesIssues: [...pr.closesIssues],
      state: pr.state,
      mergeable: pr.mergeable,
      mergeState: pr.mergeState,
      checks: pr.checks,
      checkNames: pr.checks === 'none' ? [] : [...CHECKS],
      failedChecks: pr.failedChecks.map((c) => c.name),
      pendingChecks: [...pr.pendingChecks],
    };
  }

  async issueDetails(fullName: string, number: number) {
    const i = this.repo(fullName).issues.find((x) => x.number === number);
    return { title: i?.title ?? `Issue #${number}`, body: i?.body ?? '', createdAt: i?.createdAt };
  }

  async commentPull(fullName: string, number: number) {
    return `https://github.com/${fullName}/pull/${number}#issuecomment-${Date.now()}`;
  }

  async uploadEvidence(fullName: string, filePath: string) {
    return `https://github.com/${fullName}/raw/mm-qa-evidence/${filePath}`;
  }

  // ---------- what the fake sessions do ----------

  /** A worker's build opened a PR from `branch`; its checks start. */
  openPull(fullName: string, pr: { title: string; branch: string; closes: number | null }): PullInfo {
    const r = this.repo(fullName);
    const number = r.nextNumber++;
    const pull: PullInfo = {
      number,
      title: pr.title,
      url: `https://github.com/${fullName}/pull/${number}`,
      headRefName: pr.branch,
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      reviewDecision: null,
      closesIssues: pr.closes ? [pr.closes] : [],
      createdAt: iso(),
      mergedAt: null,
      additions: 40 + ((number * 13) % 200),
      deletions: (number * 7) % 40,
      checks: 'pending',
      headSha: fakeSha(),
      mergeState: 'CLEAN',
      failedChecks: [],
      pendingChecks: [],
    };
    r.pulls.unshift(pull);
    this.runChecks(pull);
    this.save();
    return copy(pull);
  }

  /** A fix was pushed to the PR: a new head that merges cleanly, and checks that pass. */
  push(fullName: string, number: number) {
    const pr = this.pull(this.repo(fullName), number);
    Object.assign(pr, { headSha: fakeSha(), mergeable: 'MERGEABLE', mergeState: 'CLEAN' });
    this.runChecks(pr, false);
    this.save();
  }

  // ---------- inside ----------

  private load() {
    try {
      if (this.opts.file) {
        const saved = JSON.parse(fs.readFileSync(this.opts.file, 'utf8')) as { repos: FakeRepo[] };
        for (const r of saved.repos) this.repos.set(r.fullName, r);
        // Checks that were running when the office stopped have finished by now.
        for (const r of this.repos.values()) for (const p of r.pulls) if (p.checks === 'pending') this.settleChecks(p, false);
      }
    } catch {
      // A first start, or a file it can't read: the seed it is (it's pretend data).
    }
    if (!this.repos.size) this.seed();
  }

  private seed() {
    for (const s of SEED) {
      const r: FakeRepo = { fullName: s.fullName, description: s.description, issues: [], pulls: [], nextNumber: 1, closed: [] };
      for (const [title, body] of s.issues) r.issues.push(this.issue(r, title, body));
      this.repos.set(r.fullName, r);
    }
  }

  private save() {
    const file = this.opts.file;
    if (!file) return;
    this.saving = this.saving.then(() => writeJsonAtomic(file, { repos: [...this.repos.values()] })).catch((err) => console.warn('  could not save the demo GitHub:', err));
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    t.unref();
    this.timers.add(t);
  }

  private repo(fullName: string): FakeRepo {
    const r = this.repos.get(fullName);
    if (!r) throw new Error(`Could not resolve to a Repository with the name '${fullName}'.`);
    return r;
  }

  private pull(r: FakeRepo, number: number): PullInfo {
    const pr = r.pulls.find((p) => p.number === number);
    if (!pr) throw new Error(`no pull requests found for #${number} in ${r.fullName}`);
    return pr;
  }

  private issue(r: FakeRepo, title: string, body: string, labels: string[] = []): IssueInfo {
    const number = r.nextNumber++;
    return { number, title, body, url: `https://github.com/${r.fullName}/issues/${number}`, labels, createdAt: iso() };
  }

  private closeIssues(r: FakeRepo, numbers: number[]) {
    r.issues = r.issues.filter((i) => !numbers.includes(i.number));
    r.closed.push(...numbers.filter((n) => !r.closed.includes(n)));
  }

  /** Checks run on the PR's head; now and then one fails, so the fix paths show. */
  private runChecks(pr: PullInfo, fail = this.opts.rand() < 0.2) {
    Object.assign(pr, { checks: 'pending', pendingChecks: [...CHECKS], failedChecks: [] });
    const sha = pr.headSha;
    this.later(this.opts.checksMs(), () => {
      if (pr.headSha !== sha) return; // pushed again since: those checks are running instead
      this.settleChecks(pr, fail);
      this.save();
    });
  }

  private settleChecks(pr: PullInfo, fail: boolean) {
    const failed = fail ? [{ name: 'CI / build', url: `${pr.url.replace(/\/pull\/\d+$/, '')}/actions/runs/${++this.runSeq}/job/1` }] : [];
    Object.assign(pr, { checks: fail ? 'failing' : 'passing', pendingChecks: [], failedChecks: failed });
  }
}
