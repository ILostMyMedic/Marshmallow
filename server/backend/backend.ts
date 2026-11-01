// Everything the office needs from the outside world, behind one seam: GitHub, the floors' checkouts, workers'
// machines and Claude Code sessions. The demo backend (demo.ts) fakes all of it, so `--demo` and the tests run with
// no GitHub, git, npm or Claude usage.
// Adapted from cubefarm server/backend.ts (MIT).
import type { GhRepoSummary, IssueInfo, PullInfo, RepoLanguage } from '../../shared/types.ts';
import type { MachineProvider } from '../machines/machines.ts';
import type { BoxApi } from '../machines/box/box.ts';
import type { PreviewBackend } from '../previewRunner.ts';
import type { BoxSignIn, KeptBoxCli, ReconnectedCli } from '../sessions/cliRunner.ts';
import type { SessionCallbacks, SessionHandle, SessionOptions } from '../sessions/session.ts';
import type { WorkerTerminal } from '../sessions/terminal.ts';

export interface RepoMeta {
  nameWithOwner: string;
  description: string;
  url: string;
  defaultBranch: string;
  /** No commits yet, so no default branch: workers' desks, which start from origin/<default branch>, can't be set up. */
  empty: boolean;
  /** Its languages, biggest first, as shares that add up to 1 (server/github/languages.ts). */
  languages: RepoLanguage[];
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
  /** Where a new repository can go: the gh login first, then the organisations it belongs to. */
  owners(): Promise<string[]>;
  listMyRepos(owner?: string): Promise<GhRepoSummary[]>;
  repoMeta(fullName: string): Promise<RepoMeta>;
  /** Creates `owner/name` with a README, so it has a first commit and a default branch; returns its owner/name. */
  createRepo(owner: string, name: string, o: { description: string; private: boolean }): Promise<string>;
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
  /** Box workers' cloud: Upstash, the manager's gh and git, and their CLIs in the Boxes. */
  cloud: CloudBackend;
  /** Floors' previews: each floor's app run from a worktree of its own on the floor's port (server/previews.ts). */
  previews: PreviewBackend;
}

/** What Box workers need from the world: the real one, or the demo's fakes. Adapted from cubefarm server/backend.ts (MIT). */
export interface CloudBackend {
  /** The Box API behind an Upstash Box API key. */
  boxes(key: string): BoxApi;
  /** The environment cloud credentials are read from (MARSHMALLOW_CLAUDE_TOKEN): the office's own, or the demo's. */
  env(): Record<string, string | undefined>;
  /** The manager's gh login token ('' when gh isn't signed in), for Box workers' GitHub when no token is saved. */
  ghToken(): Promise<string>;
  /** Who Box workers' commits are by: the manager's git identity, else their GitHub login. */
  gitIdentity(login: string | null): Promise<{ name: string; email: string }>;
  /** The office started: Box workers' CLIs that kept working in their Boxes, back in their terminals. */
  reconnect(kept: KeptBoxCli[], terminalFor: (workerId: string) => WorkerTerminal | null): Promise<ReconnectedCli[]>;
  /** The office is stopping: stop following Box workers' CLIs, which carry on. */
  detach(): void;
  /** A Box worker's Claude Code signing in with its own login, in their terminal. */
  signIn(o: { api: BoxApi; boxId: string; term: WorkerTerminal }, exited: (code: number) => void): BoxSignIn;
  /** The demo only: every Box's sign-in expires, as a login Anthropic turned away would. */
  expireSignIns?(): void;
}
