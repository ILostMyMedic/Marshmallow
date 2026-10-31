// The contract between the server and the browser: a snapshot when a tab connects, then typed events folded into it.
// The game reads the same stream later, so workers carry what it needs from day one: status, activity, idleSince, seed.
// Adapted from cubefarm shared/types.ts (MIT).

/** Where a worker stands, as far as the pipeline is concerned. */
export type WorkerStatus =
  | 'idle' // nothing assigned
  | 'preparing' // setting up their desk: worktree, dependencies
  | 'working' // a session is running
  | 'done' // finished their task: a PR opened, or a QA report posted
  | 'error' // their session failed
  | 'stopped'; // the manager stopped them

/** Statuses in which a worker is busy at their desk. */
export const BUSY_STATUSES: readonly WorkerStatus[] = ['preparing', 'working'];
export const isBusy = (status: WorkerStatus) => BUSY_STATUSES.includes(status);

/** The kinds of work the sign over a busy worker shows. */
export type ActivityKind = 'read' | 'edit' | 'test' | 'build' | 'browse' | 'git' | 'ci' | 'qa' | 'fix' | 'talk' | 'run';

/** What a worker is doing right now: a kind and a short detail that is safe to show anyone ("store.ts", "npm test"). */
export interface Activity {
  kind: ActivityKind;
  detail: string;
}

export type LogKind = 'text' | 'tool' | 'result' | 'system' | 'error' | 'manager' | 'done' | 'thinking';

export interface LogLine {
  id: number; // rising across the whole office
  t: number; // epoch ms
  kind: LogKind;
  text: string;
  tool?: string; // the tool's name, for kind 'tool'
}

/** A log line before the office numbers and timestamps it. */
export type LogEntry = Omit<LogLine, 'id' | 't'>;

/** A worker's current tool while the office installs their desk's dependencies (status 'preparing'). */
export const INSTALL_STEP = 'Installing dependencies';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Where a worker's machine is: a folder on this computer, or an Upstash Box. */
export type MachineHost = 'local' | 'box';

/** An Upstash Box's size. */
export type BoxSize = 'small' | 'medium' | 'large';

/** The cloud settings: where new workers work, and the Upstash Box size and limit. */
export interface CloudSettings {
  machineKind: MachineHost; // where new workers work ('local' unless the manager turns the cloud on)
  boxSize: BoxSize;
  boxLimit: number; // the Upstash plan's most Boxes (the free plan's 10), counted before a Box worker is hired
}

/** How a Box worker's machine is doing. */
export type CloudMachineState = 'none' | 'creating' | 'setting-up' | 'ready' | 'paused' | 'disconnected' | 'error';

/** Where a cloud credential comes from (never its value). 'login': each Box worker signs in in their own terminal. */
export type CloudCredentialSource = 'token' | 'gh' | 'subscription' | 'apiKey' | 'login' | null;

/** One credential Box workers use: whether it's there and where it comes from. */
export interface CloudCredentialView {
  ready: boolean;
  source: CloudCredentialSource;
  hint: string; // the last 4 characters of a saved key or token, '' otherwise
}

/** The cloud account as the manager sees it. Keys and tokens never leave the server. */
export interface CloudView {
  keySet: boolean; // an Upstash Box API key is saved
  keyHint: string;
  keyError: string | null; // Upstash turned the key away, or couldn't be reached, at the last check
  github: CloudCredentialView;
  claude: CloudCredentialView;
  boxes: { total: number; running: number; paused: number; orphans: number } | null; // null until counted
}

/** Building an issue, testing a pull request, or fixing one after QA or failing checks. */
export type TaskKind = 'issue' | 'qa' | 'fix';

/** A worker's work. It stays after the work ends (status done, error or stopped) until they take the next. */
export interface Task {
  kind: TaskKind;
  issueNumber: number | null; // the issue being built, or the one the PR closes
  title: string; // the issue's title, or the PR's while testing or fixing it
  branch: string | null;
  prNumber: number | null; // the PR they opened, are testing or are fixing
  prUrl: string | null;
}

export interface Worker {
  id: string;
  name: string;
  floorId: string; // their floor's repo id; '' for the CEO, who works in the lobby
  role: 'worker' | 'ceo';
  seed: number; // picks their look in the game, the same in every tab
  desk: number; // their desk on the floor, from 0
  model: string; // '' = the office default; `ollama/<name>` runs on Ollama (shared/models.ts)
  effort: EffortLevel | ''; // '' = the office default
  host: MachineHost;
  status: WorkerStatus;
  task: Task | null;
  activity: Activity | null; // null when there's nothing to show, e.g. idle
  idleSince: number | null; // when they last stopped being busy; null while busy. The game's errands and naps go by it.
  startedAt: number | null; // their current or last task's start
  endedAt: number | null;
  costUsd: number; // their current or last task's
  turns: number;
  lastError: string | null;
  sessionId: string | null; // their latest session, resumed for a follow-up (a nudge, a fix of their own PR)
  leaving: boolean; // asked to leave while busy: gets no new work, and goes when their task ends
  cloud?: CloudMachineState; // their Box's state (absent for local workers)
  needsSignIn?: boolean; // a Box worker whose Claude Code waits for the manager to sign it in, in their terminal
}

export interface IssueInfo {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  createdAt: string;
}

export interface PullInfo {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  mergeable: string; // MERGEABLE | CONFLICTING | UNKNOWN
  reviewDecision: string | null;
  closesIssues: number[];
  createdAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  checks: 'pending' | 'passing' | 'failing' | 'none';
  headSha: string;
  mergeState: string; // GitHub's mergeStateStatus: CLEAN | BEHIND | BLOCKED | DIRTY | UNSTABLE | DRAFT | UNKNOWN …
  failedChecks: { name: string; url: string | null }[];
  pendingChecks: string[];
}

/** A repository the manager could connect, as GitHub lists it. */
export interface GhRepoSummary {
  nameWithOwner: string;
  description: string;
  visibility: string;
  updatedAt: string;
}

/** One connected repository, one floor of the building. */
export interface Floor {
  id: string; // "owner/name"
  fullName: string;
  description: string;
  url: string;
  defaultBranch: string;
  floor: number; // its number in the building, from 1
  color: string; // the floor's accent colour
  autoAssign: boolean; // free workers take the next ready issue on their own
  browserTesting: boolean; // QA tests in a real browser (the Playwright MCP)
  mission: string; // the manager's brief: what this floor is building
  summary: string; // the CEO's one-line read of the project, e.g. "3D browser game · Three.js + Vite"
  qaBrief: string; // how QA should test this kind of project (written by the CEO, editable)
  teamSize: number | null; // the size the CEO or the manager set, which the rules leave alone; null = the rules size it
  // GitHub's side: refreshed by every sync, never saved
  cloneStatus: 'pending' | 'cloning' | 'ready' | 'error';
  cloneError: string | null;
  issues: IssueInfo[]; // open issues
  pulls: PullInfo[]; // open and recently merged PRs
  lastSync: number | null;
  syncError: string | null;
}

export type QaStatus =
  | 'queued' // waiting for a free worker to test it
  | 'testing' // a worker is testing it
  | 'passed' // ready to merge
  | 'failed' // waiting for its author (or any free worker) to fix it
  | 'fixing' // a worker is fixing what QA found
  | 'needs-human'; // failed too many rounds, or nobody can fix it automatically

export interface QaCheck {
  name: string;
  result: 'pass' | 'fail' | 'skip';
  details: string;
}

/** A pull request's trip through QA. */
export interface QaRecord {
  floorId: string;
  prNumber: number;
  status: QaStatus;
  round: number; // from 1
  devWorkerId: string | null; // who wrote it, or took over its fixes
  qaWorkerId: string | null; // who is testing it, or last did
  summary: string | null; // the latest QA summary
  checks: QaCheck[];
  commentUrl: string | null; // the PR comment with the latest QA report
  mergeNote: string | null; // where auto-merge stands once QA passed, e.g. "waiting for checks"
  updatedAt: number;
}

export interface Settings {
  managerName: string; // what the office calls you
  companyName: string;
  setupDone: boolean; // the first-run setup wizard was finished or skipped
  sessionLimit: number; // most sessions running at once; 0 = no limit
  pacingSessions: number; // after Claude's usage warning, new issues start only while fewer sessions than this run
  maxWorkers: number; // most workers on a floor
  autoscale: boolean; // the rules grow and shrink floors to fit the work (floors held at a size excepted)
  cloud: CloudSettings;
  defaultModel: string; // a Claude model, or `ollama/<name>`
  defaultEffort: EffortLevel;
}

export const DEFAULT_SETTINGS: Settings = {
  managerName: '',
  companyName: '',
  setupDone: false,
  sessionLimit: 0,
  pacingSessions: 3,
  maxWorkers: 10,
  autoscale: true,
  cloud: { machineKind: 'local', boxSize: 'small', boxLimit: 10 },
  defaultModel: 'claude-opus-5-5',
  defaultEffort: 'medium',
};

/** The last usage warning Claude gave: which limit ("weekly limit"), how full it was (0-100), when it resets, and when it came. */
export interface UsageWarningView {
  limit: string | null;
  pct: number | null;
  resetsAt: number | null;
  at: number;
}

/** Claude's subscription usage: normal, pacing new work after a usage warning, or paused at the limit until `until`. */
export interface UsageView {
  state: 'normal' | 'pacing' | 'paused';
  until: number | null;
  warning: UsageWarningView | null; // the latest since the server started, for the usage meter
}

/**
 * A question a worker (or the CEO) asked the manager about an issue, on GitHub: a comment there and the issue's
 * mm:needs-answer label. Answered once the manager replies; kept while the issue is open, for its next prompt.
 */
export interface Question {
  id: number;
  floorId: string;
  issueNumber: number;
  from: string; // who asked: a worker's name, or "the CEO"
  text: string;
  askedAt: number;
  url: string | null; // the question's comment on GitHub
  answer: string | null;
  answeredAt: number | null;
}

/** A note from the office to the manager, for the phone: a PR that needs them, merges GitHub refuses, pacing. */
/** The CEO's jobs: study a new floor, plan the manager's brief into issues, answer the manager. */
export type CeoJobKind = 'onboard' | 'plan' | 'chat';

export interface OfficeMessage {
  id: number;
  at: number;
  text: string;
  floorId: string | null;
  from: 'office' | 'ceo' | 'manager'; // the office's own notices, the CEO's replies, or what the manager told the CEO
}

/** What a tab needs to draw everything, sent when it connects. */
export interface Snapshot {
  version: string;
  demo: boolean; // running on the fakes: no GitHub, git, npm or Claude usage
  settings: Settings;
  floors: Floor[];
  workers: Worker[];
  qa: QaRecord[];
  logs: Record<string, LogLine[]>; // each worker's latest lines, by worker id
  messages: OfficeMessage[]; // the latest, oldest first
  questions: Question[];
  usage: UsageView;
  cloud: CloudView;
}

/** Changes to the state: the snapshot with these folded in is what the server has. */
export type StateEvent =
  | { type: 'snapshot'; data: Snapshot }
  | { type: 'settings'; settings: Settings }
  | { type: 'floor'; floor: Floor }
  | { type: 'floorRemoved'; floorId: string }
  | { type: 'worker'; worker: Worker }
  | { type: 'workerRemoved'; workerId: string }
  | { type: 'log'; workerId: string; lines: LogLine[] }
  | { type: 'qa'; qa: QaRecord }
  | { type: 'qaRemoved'; floorId: string; prNumber: number }
  | { type: 'message'; message: OfficeMessage }
  | { type: 'question'; question: Question }
  | { type: 'questionRemoved'; id: number }
  | { type: 'usage'; usage: UsageView }
  | { type: 'cloud'; cloud: CloudView };

/**
 * Things that happened, for the game's moments (arrivals, celebrations) and the debug page's feed. They change no
 * state: each comes alongside the state events that do, so a tab that misses one only misses the moment.
 */
export type Moment =
  | { type: 'hired'; at: number; worker: Worker }
  | { type: 'left'; at: number; worker: Worker }
  | { type: 'issuesFiled'; at: number; floorId: string; numbers: number[] }
  | { type: 'prOpened'; at: number; floorId: string; prNumber: number; workerId: string; issueNumber: number | null }
  | { type: 'qaPassed'; at: number; floorId: string; prNumber: number; qaWorkerId: string | null }
  | { type: 'qaFailed'; at: number; floorId: string; prNumber: number; qaWorkerId: string | null }
  | { type: 'merged'; at: number; floorId: string; prNumber: number; devWorkerId: string | null };

/** Server to browser on /ws/term: a worker's terminal. */
export type TermServerMessage =
  | { t: 'snapshot'; data: string; cols: number; rows: number; live: boolean } // the screen and scrollback so far
  | { t: 'data'; data: string }
  | { t: 'size'; cols: number; rows: number } // another viewer resized the terminal
  | { t: 'live'; live: boolean }; // a CLI is (or is no longer) running in it

/** Browser to server on /ws/term: keystrokes go to the running CLI; the size is the viewer's fitted terminal. */
export type TermClientMessage = { t: 'input'; data: string } | { t: 'resize'; cols: number; rows: number };

/** Everything the server sends over /ws. */
export type ServerEvent = StateEvent | Moment;

const MOMENT_TYPES = new Set<string>(['hired', 'left', 'issuesFiled', 'prOpened', 'qaPassed', 'qaFailed', 'merged'] satisfies Moment['type'][]);
export const isMoment = (ev: ServerEvent): ev is Moment => MOMENT_TYPES.has(ev.type);
