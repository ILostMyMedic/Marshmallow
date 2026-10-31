// Everything the office needs from the outside world, behind one seam: GitHub, the floors' checkouts, workers'
// machines and Claude Code sessions. The demo backend (demo.ts) fakes all of it, so `--demo` and the tests run with
// no GitHub, git, npm or Claude usage.
// Adapted from cubefarm server/backend.ts (MIT).
import type { GhRepoSummary, IssueInfo, PullInfo } from '../../shared/types.ts';
import type { MachineProvider } from '../machines/machines.ts';
import type { SessionCallbacks, SessionHandle, SessionOptions } from '../sessions/session.ts';

export interface RepoMeta {
  nameWithOwner: string;
  description: string;
  url: string;
  defaultBranch: string;
}

export interface PrDetails {
  number: number;
  title: string;
  body: string;
  url: string;
  headRefName: string;
  headSha: string;
  isCrossRepository: boolean;
  closesIssues: number[];
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  mergeable: string;
  mergeState: string;
  checks: PullInfo['checks'];
  checkNames: string[]; // every check on the head commit, once each
  failedChecks: string[];
  pendingChecks: string[];
}

export interface IssueComment {
  id: string;
  body: string;
  createdAt: string;
  url: string;
}

/** GitHub: issues are the backlog, pull requests the output. */
export interface GitHubApi {
  /** Who the office acts as (the gh login). */
  user(): Promise<string>;
  listMyRepos(owner?: string): Promise<GhRepoSummary[]>;
  repoMeta(fullName: string): Promise<RepoMeta>;
  /** Open issues. */
  listIssues(fullName: string): Promise<IssueInfo[]>;
  /** Open pull requests and the latest merged ones. */
  listPulls(fullName: string): Promise<PullInfo[]>;
  createIssue(fullName: string, title: string, body: string, labels?: string[]): Promise<number>;
  /** OPEN or CLOSED; null when there is no such issue. */
  issueState(fullName: string, number: number): Promise<'OPEN' | 'CLOSED' | null>;
  editIssue(fullName: string, number: number, edit: { body?: string; addLabels?: string[]; removeLabels?: string[] }): Promise<void>;
  /** Close an issue with a comment, as completed unless `reason` says not planned. */
  closeIssue(fullName: string, number: number, comment: string, reason?: 'completed' | 'not planned'): Promise<void>;
  /** An issue's comments, oldest first. */
  issueComments(fullName: string, number: number): Promise<IssueComment[]>;
  /** Comment on an issue; returns the comment's URL. */
  commentIssue(fullName: string, number: number, body: string): Promise<string>;
  /** Merge, refusing when the head has moved on from `headSha`. */
  mergePull(fullName: string, number: number, method: 'squash' | 'merge' | 'rebase', headSha?: string): Promise<void>;
  /** Bring a PR's branch up to date with its base. */
  updateBranch(fullName: string, number: number): Promise<void>;
  /** The failed steps' log of a GitHub Actions run, for a checks fix. */
  failedRunLog(fullName: string, runId: string): Promise<string>;
  /** Re-run the failed jobs of these GitHub Actions runs. */
  rerunFailedJobs(fullName: string, runIds: number[]): Promise<void>;
  closePull(fullName: string, number: number): Promise<void>;
  /** The open PR from `branch`, if there is one. */
  prForBranch(fullName: string, branch: string): Promise<{ number: number; url: string } | null>;
  prDetails(fullName: string, number: number): Promise<PrDetails>;
  issueDetails(fullName: string, number: number): Promise<{ title: string; body: string; createdAt?: string }>;
  /** Comment on a PR; returns the comment's URL. */
  commentPull(fullName: string, number: number, body: string): Promise<string>;
  /** Put a QA screenshot on the evidence branch; returns its URL. */
  uploadEvidence(fullName: string, filePath: string, data: Buffer): Promise<string>;
}

export interface Backend {
  demo: boolean;
  github: GitHubApi;
  /** Make sure the floor's own checkout of its repository exists (workers' clones borrow its objects). */
  ensureClone(fullName: string): Promise<void>;
  /** Where the floor's own checkout is. */
  mainDir(fullName: string): string;
  machines: MachineProvider;
  /** A Claude Code session on a worker's desk. */
  startSession(opts: SessionOptions, cb: SessionCallbacks): SessionHandle;
}
