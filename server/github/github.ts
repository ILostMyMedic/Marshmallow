// All GitHub access goes through the gh CLI, so it acts as the manager's own `gh auth login` (GitHub's OAuth sign-in).
// Adapted from cubefarm server/github.ts (MIT).
import { setTimeout as sleep } from 'node:timers/promises';
import type { GhRepoSummary, IssueInfo, PullInfo } from '../../shared/types.ts';
import type { GitHubApi, IssueComment, PrDetails, RepoMeta } from '../backend/backend.ts';
import { CommandError, gh, ghJson } from '../exec.ts';
import { languageShares } from './languages.ts';

/**
 * A read the board syncs on, tried twice: GitHub's API blips (a 502, a GraphQL timeout on the PRs' checks) and a gh
 * that hangs on the network would otherwise put an error on the floor until the next sync.
 */
export async function readTwice<T>(read: () => Promise<T>, pauseMs = 2_000): Promise<T> {
  try {
    return await read();
  } catch {
    await sleep(pauseMs);
    return read();
  }
}

const SYNC_READ = { timeoutMs: 60_000 };

export async function currentUser(): Promise<string> {
  return gh(['api', 'user', '--jq', '.login']);
}

/** The gh login, then its organisations (none when gh may not read them): where a new repository can go. */
export async function owners(): Promise<string[]> {
  const [login, orgs] = await Promise.all([currentUser(), gh(['api', 'user/orgs', '--paginate', '--jq', '.[].login']).catch(() => '')]);
  return [login, ...orgs.split(/\r?\n/).map((o) => o.trim()).filter((o) => o && o !== login)];
}

/** Creates a repository on GitHub with a README (--add-readme), so origin has a first commit; returns its owner/name. */
export async function createRepo(owner: string, name: string, o: { description: string; private: boolean }): Promise<string> {
  const args = ['repo', 'create', `${owner}/${name}`, o.private ? '--private' : '--public', '--add-readme'];
  if (o.description.trim()) args.push('--description', o.description.trim());
  const out = await gh(args, { timeoutMs: 60_000 });
  return out.match(/github\.com\/([\w.-]+\/[\w.-]+)/)?.[1] ?? `${owner}/${name}`;
}

export async function listMyRepos(owner?: string): Promise<GhRepoSummary[]> {
  const args = ['repo', 'list'];
  if (owner) args.push(owner);
  args.push('--limit', '200', '--json', 'nameWithOwner,description,visibility,updatedAt');
  const repos = await ghJson<GhRepoSummary[]>(args);
  return repos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function repoMeta(fullName: string): Promise<RepoMeta> {
  const raw = await ghJson<{ nameWithOwner: string; description: string | null; url: string; defaultBranchRef: { name: string } | null; languages: { size: number; node: { name: string } | null }[] | null }>([
    'repo',
    'view',
    fullName,
    '--json',
    'nameWithOwner,description,url,defaultBranchRef,languages',
  ]);
  const languages = languageShares((raw.languages ?? []).map((l) => ({ name: l.node?.name ?? '', size: l.size })));
  // An empty repository has no default branch yet: 'main' is what its first push will likely make.
  return { nameWithOwner: raw.nameWithOwner, description: raw.description ?? '', url: raw.url, defaultBranch: raw.defaultBranchRef?.name || 'main', empty: !raw.defaultBranchRef, languages };
}

/** The repository's branches, by name (a floor's work branch is picked from them). */
export async function listBranches(fullName: string): Promise<string[]> {
  const out = await gh(['api', `repos/${fullName}/branches`, '--paginate', '--jq', '.[].name']);
  return out.split(/\r?\n/).map((b) => b.trim()).filter(Boolean);
}

/** Creates branch `name` at the head of `from` (a floor's work branch, made from its default branch). */
export async function createBranch(fullName: string, name: string, from: string): Promise<void> {
  const sha = await gh(['api', `repos/${fullName}/git/ref/heads/${from}`, '--jq', '.object.sha']);
  await gh(['api', '-X', 'POST', `repos/${fullName}/git/refs`, '-f', `ref=refs/heads/${name}`, '-f', `sha=${sha.trim()}`]);
}

export async function listIssues(fullName: string): Promise<IssueInfo[]> {
  const raw = await readTwice(() =>
    ghJson<{ number: number; title: string; body: string; url: string; labels: { name: string }[]; createdAt: string }[]>(
      ['issue', 'list', '-R', fullName, '--state', 'open', '--limit', '100', '--json', 'number,title,body,url,labels,createdAt'],
      SYNC_READ,
    ),
  );
  return raw.map((i) => ({ number: i.number, title: i.title, body: i.body ?? '', url: i.url, labels: i.labels.map((l) => l.name), createdAt: i.createdAt })).sort((a, b) => a.number - b.number);
}

interface RawPull {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  mergeable: string;
  reviewDecision: string | null;
  closingIssuesReferences: { number: number }[] | null;
  createdAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  headRefOid: string;
  mergeStateStatus: string;
  // check runs (GitHub Actions…) carry name/status/conclusion/detailsUrl; commit statuses (Vercel…) carry context/state/targetUrl
  statusCheckRollup: { name?: string; context?: string; status?: string; conclusion?: string; state?: string; detailsUrl?: string; targetUrl?: string }[] | null;
}

const PR_FIELDS = 'number,title,url,headRefName,baseRefName,headRefOid,state,isDraft,mergeable,mergeStateStatus,reviewDecision,closingIssuesReferences,createdAt,mergedAt,additions,deletions,statusCheckRollup';

type Check = NonNullable<RawPull['statusCheckRollup']>[number];
const BAD = ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'];
const failed = (c: Check) => BAD.includes(c.conclusion ?? '') || BAD.includes(c.state ?? '');
const pending = (c: Check) => (!!c.status && c.status !== 'COMPLETED') || c.state === 'PENDING' || c.state === 'EXPECTED';
const checkName = (c: Check) => c.name || c.context || 'check';

/** One word for a PR's checks: none, failing (any failed), pending (any running), else passing. */
export function checksOf(rollup: RawPull['statusCheckRollup']): PullInfo['checks'] {
  if (!rollup || rollup.length === 0) return 'none';
  if (rollup.some(failed)) return 'failing';
  if (rollup.some(pending)) return 'pending';
  return 'passing';
}

function toPull(p: RawPull): PullInfo {
  return {
    number: p.number,
    title: p.title,
    url: p.url,
    headRefName: p.headRefName,
    baseRefName: p.baseRefName,
    state: p.state,
    isDraft: p.isDraft,
    mergeable: p.mergeable,
    reviewDecision: p.reviewDecision || null,
    closesIssues: (p.closingIssuesReferences ?? []).map((r) => r.number),
    createdAt: p.createdAt,
    mergedAt: p.mergedAt,
    additions: p.additions,
    deletions: p.deletions,
    checks: checksOf(p.statusCheckRollup),
    headSha: p.headRefOid,
    mergeState: p.mergeStateStatus || 'UNKNOWN',
    failedChecks: (p.statusCheckRollup ?? []).filter(failed).map((c) => ({ name: checkName(c), url: c.detailsUrl || c.targetUrl || null })),
    pendingChecks: (p.statusCheckRollup ?? []).filter(pending).map(checkName),
  };
}

export async function listPulls(fullName: string): Promise<PullInfo[]> {
  const [open, merged] = await Promise.all([
    readTwice(() => ghJson<RawPull[]>(['pr', 'list', '-R', fullName, '--state', 'open', '--limit', '50', '--json', PR_FIELDS], SYNC_READ)),
    readTwice(() => ghJson<RawPull[]>(['pr', 'list', '-R', fullName, '--state', 'merged', '--limit', '8', '--json', PR_FIELDS], SYNC_READ)),
  ]);
  return [...open, ...merged].map(toPull);
}

// gh refuses labels a repository doesn't have, so the ones the office adds are made on first use. A label that
// already exists keeps its colour and description.
const labelsMade = new Set<string>();

async function ensureLabel(fullName: string, name: string) {
  const key = `${fullName}#${name}`;
  if (labelsMade.has(key)) return;
  try {
    await gh(['label', 'create', name, '-R', fullName, '--color', 'f2a7b8', '--description', 'Added by Marshmallow']);
  } catch (err) {
    if (!(err instanceof CommandError && /already exists/i.test(err.stderr))) throw err;
  }
  labelsMade.add(key);
}

export async function createIssue(fullName: string, title: string, body: string, labels: string[] = []): Promise<number> {
  for (const l of labels) await ensureLabel(fullName, l);
  const args = ['issue', 'create', '-R', fullName, '--title', title, '--body-file', '-'];
  for (const l of labels) args.push('--label', l);
  const out = await gh(args, { input: body || ' ' });
  const match = out.match(/\/issues\/(\d+)/);
  if (!match) throw new Error(`Could not read the new issue number from gh output: ${out}`);
  return Number(match[1]);
}

/** OPEN or CLOSED; null when the repo has no such issue. */
export async function issueState(fullName: string, number: number): Promise<'OPEN' | 'CLOSED' | null> {
  try {
    const raw = await ghJson<{ state: string }>(['issue', 'view', String(number), '-R', fullName, '--json', 'state']);
    return raw.state === 'OPEN' ? 'OPEN' : 'CLOSED';
  } catch {
    return null;
  }
}

/** Closes an issue as completed (or not planned), with a comment saying why. */
export async function closeIssue(fullName: string, number: number, comment: string, reason: 'completed' | 'not planned' = 'completed'): Promise<void> {
  await gh(['issue', 'close', String(number), '-R', fullName, '--reason', reason, '--comment', comment]);
}

/** Replaces an issue's body and/or adds and removes labels. */
export async function editIssue(fullName: string, number: number, edit: { body?: string; addLabels?: string[]; removeLabels?: string[] }): Promise<void> {
  const args = ['issue', 'edit', String(number), '-R', fullName];
  if (edit.body !== undefined) args.push('--body-file', '-');
  for (const l of edit.addLabels ?? []) {
    await ensureLabel(fullName, l);
    args.push('--add-label', l);
  }
  for (const l of edit.removeLabels ?? []) args.push('--remove-label', l);
  if (args.length === 5) return;
  await gh(args, edit.body !== undefined ? { input: edit.body || ' ' } : undefined);
}

/** An issue's comments, oldest first. */
export async function issueComments(fullName: string, number: number): Promise<IssueComment[]> {
  const raw = await ghJson<{ comments: { id: string; body: string; createdAt: string; url: string }[] }>(['issue', 'view', String(number), '-R', fullName, '--json', 'comments']);
  return (raw.comments ?? []).map((c) => ({ id: c.id, body: c.body ?? '', createdAt: c.createdAt, url: c.url }));
}

/** Comments on an issue; returns the comment's URL. */
export async function commentIssue(fullName: string, number: number, body: string): Promise<string> {
  const out = await gh(['issue', 'comment', String(number), '-R', fullName, '--body-file', '-'], { input: body });
  return out.match(/https:\/\/github\.com\/\S+/)?.[0] ?? '';
}

/** Merges a PR. With headSha, GitHub refuses if anything was pushed after that commit (e.g. after QA signed it off). */
export async function mergePull(fullName: string, number: number, method: 'squash' | 'merge' | 'rebase', headSha?: string): Promise<void> {
  const pr = await ghJson<{ headRefName: string; isCrossRepository: boolean }>(['pr', 'view', String(number), '-R', fullName, '--json', 'headRefName,isCrossRepository']);
  await gh(['pr', 'merge', String(number), '-R', fullName, `--${method}`, ...(headSha ? ['--match-head-commit', headSha] : [])], { timeoutMs: 60_000 });
  // Tidy up the office's branch on the remote; the worker's own clone is swept later.
  if (!pr.isCrossRepository && pr.headRefName.startsWith('mm/issue-')) {
    await gh(['api', '-X', 'DELETE', `repos/${fullName}/git/refs/heads/${pr.headRefName}`]).catch(() => undefined);
  }
}

/** Merges the base branch into a PR's branch on GitHub, for repos that only merge up-to-date branches. */
export async function updateBranch(fullName: string, number: number): Promise<void> {
  await gh(['pr', 'update-branch', String(number), '-R', fullName], { timeoutMs: 60_000 });
}

/** Points a PR at another base branch: the floor's work branch, when it was opened against another. */
export async function setPullBase(fullName: string, number: number, base: string): Promise<void> {
  await gh(['pr', 'edit', String(number), '-R', fullName, '--base', base], { timeoutMs: 60_000 });
}

/** The failed steps' log of a GitHub Actions run (gh run view --log-failed), for a checks fix. */
export async function failedRunLog(fullName: string, runId: string): Promise<string> {
  return gh(['run', 'view', runId, '-R', fullName, '--log-failed'], { timeoutMs: 60_000 });
}

/** Re-runs the failed jobs of these GitHub Actions runs (a flaky check or an outage). */
export async function rerunFailedJobs(fullName: string, runIds: number[]): Promise<void> {
  for (const id of runIds) await gh(['run', 'rerun', String(id), '--failed', '-R', fullName], { timeoutMs: 60_000 });
}

export async function closePull(fullName: string, number: number): Promise<void> {
  await gh(['pr', 'close', String(number), '-R', fullName]);
}

/** The open PR from `branch`, if there is one. */
export async function prForBranch(fullName: string, branch: string): Promise<{ number: number; url: string } | null> {
  const list = await ghJson<{ number: number; url: string }[]>(['pr', 'list', '-R', fullName, '--head', branch, '--state', 'open', '--json', 'number,url', '--limit', '1']);
  return list[0] ?? null;
}

// ---------- QA support ----------

const uniqueNames = (checks: Check[]) => [...new Set(checks.map(checkName))];

export async function prDetails(fullName: string, number: number): Promise<PrDetails> {
  const raw = await ghJson<{
    number: number;
    title: string;
    body: string;
    url: string;
    headRefName: string;
    baseRefName: string;
    headRefOid: string;
    isCrossRepository: boolean;
    closingIssuesReferences: { number: number }[] | null;
    state: PrDetails['state'];
    mergeable: string;
    mergeStateStatus: string;
    statusCheckRollup: RawPull['statusCheckRollup'];
  }>(['pr', 'view', String(number), '-R', fullName, '--json', 'number,title,body,url,headRefName,baseRefName,headRefOid,isCrossRepository,closingIssuesReferences,state,mergeable,mergeStateStatus,statusCheckRollup']);
  const rollup = raw.statusCheckRollup ?? [];
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    url: raw.url,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    headSha: raw.headRefOid,
    isCrossRepository: raw.isCrossRepository,
    closesIssues: (raw.closingIssuesReferences ?? []).map((r) => r.number),
    state: raw.state,
    mergeable: raw.mergeable,
    mergeState: raw.mergeStateStatus || 'UNKNOWN',
    checks: checksOf(rollup),
    checkNames: uniqueNames(rollup),
    failedChecks: uniqueNames(rollup.filter(failed)),
    pendingChecks: uniqueNames(rollup.filter(pending)),
  };
}

export async function issueDetails(fullName: string, number: number): Promise<{ title: string; body: string; createdAt: string }> {
  const raw = await ghJson<{ title: string; body: string; createdAt: string }>(['issue', 'view', String(number), '-R', fullName, '--json', 'title,body,createdAt']);
  return { title: raw.title, body: raw.body ?? '', createdAt: raw.createdAt };
}

export async function commentPull(fullName: string, number: number, body: string): Promise<string> {
  const out = await gh(['pr', 'comment', String(number), '-R', fullName, '--body-file', '-'], { input: body });
  return out.match(/https:\/\/github\.com\/\S+/)?.[0] ?? '';
}

// QA screenshots live on an orphan branch, so evidence never lands in the default branch when a PR merges.
export const EVIDENCE_BRANCH = 'mm-qa-evidence';
const evidenceReady = new Set<string>();

const ghApiJson = <T>(method: string, endpoint: string, body: unknown) =>
  gh(['api', '-X', method, endpoint, '-H', 'Content-Type: application/json', '--input', '-'], { input: JSON.stringify(body), timeoutMs: 120_000 }).then((out) => (out ? JSON.parse(out) : null) as T);

async function ensureEvidenceBranch(fullName: string) {
  if (evidenceReady.has(fullName)) return;
  try {
    await gh(['api', `repos/${fullName}/git/ref/heads/${EVIDENCE_BRANCH}`]);
  } catch {
    const readme = '# QA evidence\n\nScreenshots attached to pull request QA reports by Marshmallow workers.\nThis branch has no shared history with the code and is never merged.\n';
    const tree = await ghApiJson<{ sha: string }>('POST', `repos/${fullName}/git/trees`, { tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: readme }] });
    const commit = await ghApiJson<{ sha: string }>('POST', `repos/${fullName}/git/commits`, { message: 'QA evidence branch (Marshmallow)', tree: tree.sha, parents: [] });
    await ghApiJson('POST', `repos/${fullName}/git/refs`, { ref: `refs/heads/${EVIDENCE_BRANCH}`, sha: commit.sha });
  }
  evidenceReady.add(fullName);
}

/** Uploads one evidence file and returns a URL that renders inside PR comments (private repos too). */
export async function uploadEvidence(fullName: string, filePath: string, data: Buffer): Promise<string> {
  await ensureEvidenceBranch(fullName);
  await ghApiJson('PUT', `repos/${fullName}/contents/${filePath}`, { message: `QA evidence: ${filePath}`, content: data.toString('base64'), branch: EVIDENCE_BRANCH });
  return `https://github.com/${fullName}/raw/${EVIDENCE_BRANCH}/${filePath}`;
}

/** GitHub as the office uses it, through gh. */
export const realGithub: GitHubApi = {
  user: currentUser,
  owners,
  listMyRepos,
  repoMeta,
  listBranches,
  createBranch,
  createRepo,
  listIssues,
  listPulls,
  createIssue,
  issueState,
  editIssue,
  closeIssue,
  issueComments,
  commentIssue,
  mergePull,
  updateBranch,
  setPullBase,
  failedRunLog,
  rerunFailedJobs,
  closePull,
  prForBranch,
  prDetails,
  issueDetails,
  commentPull,
  uploadEvidence,
};
