// The contract between the server and the browser: a snapshot when a tab connects, then typed events folded into it.
// The game reads the same stream later, so workers carry what it needs from day one: status, activity, idleSince, seed.
// Adapted from cubefarm shared/types.ts (MIT).
import type { AwardStats } from './awards.ts';
import type { PlaybookView } from './playbook.ts';
import type { SeasonSetting } from './seasons.ts';
import type { WorldView } from './worldEvents.ts';

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
  baseRefName: string; // the branch it merges into
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

/** An open issue held back after its PR `pr` was closed without merging. */
export interface HeldIssue {
  issue: number;
  pr: number;
}

/** One connected repository, one floor of the building. */
export interface Floor {
  id: string; // "owner/name"
  fullName: string;
  description: string;
  url: string;
  defaultBranch: string;
  workBranch: string | null; // where the floor's work starts from and merges into (shared/branches.ts); null = the default branch
  floor: number; // its number in the building, from 1
  color: string; // the floor's accent colour
  autoAssign: boolean; // free workers take the next ready issue on their own
  browserTesting: boolean; // QA tests in a real browser (the Playwright MCP)
  mission: string; // the manager's brief: what this floor is building
  summary: string; // the CEO's one-line read of the project, e.g. "3D browser game · Three.js + Vite"
  qaBrief: string; // how QA should test this kind of project (written by the CEO, editable)
  teamSize: number | null; // the size the CEO or the manager set, which the rules leave alone; null = the rules size it
  held: HeldIssue[]; // open issues whose PR was closed without merging: they wait for the manager instead of auto-assign
  languages: RepoLanguage[]; // the repository's languages, biggest first (its posters are made from them); refreshed with its metadata
  // GitHub's side: refreshed by every sync, never saved
  cloneStatus: 'pending' | 'cloning' | 'ready' | 'error';
  cloneError: string | null;
  issues: IssueInfo[]; // open issues
  pulls: PullInfo[]; // open and recently merged PRs
  lastSync: number | null;
  syncError: string | null;
}

/** One of a repository's languages and its share of the code, from 0 to 1. */
export interface RepoLanguage {
  name: string;
  share: number;
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
  dayMode: DayMode; // the office clock, which the game's sky, light and rituals follow in every tab
  bodyStyle: BodyStyle; // how everyone in the office is drawn, in every tab
  season: SeasonSetting; // the season outside (shared/seasons.ts): the office's date, or one shown now, in every tab
  inkOutlines: boolean; // ink outlines round the furniture and the people, in every tab; off saves their draw calls
  workersUseMySetup: boolean; // sessions load the manager's own Claude Code setup (user settings, CLAUDE.md, skills, memory); off: the repo's and the playbook's only
}

export const DAY_MODES = ['cycle', 'clock', 'day'] as const;
/** 'cycle': a whole day every 30 minutes; 'clock': each viewer's own local time; 'day': always mid-afternoon. */
export type DayMode = (typeof DAY_MODES)[number];

export const BODY_STYLES = ['chibi', 'human'] as const;
/** 'chibi': a big head on a small round body; 'human': a stylized human, slim and tall. */
export type BodyStyle = (typeof BODY_STYLES)[number];

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
  dayMode: 'cycle',
  bodyStyle: 'human',
  season: 'auto',
  inkOutlines: true,
  workersUseMySetup: false,
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
/** The CEO's jobs: study a new floor, plan the manager's brief into issues, answer the manager in a chat or a discussion. */
export type CeoJobKind = 'onboard' | 'plan' | 'chat' | 'discussion';

export interface OfficeMessage {
  id: number;
  at: number;
  text: string;
  floorId: string | null;
  from: 'office' | 'ceo' | 'manager'; // the office's own notices, the CEO's replies, or what the manager told the CEO
}

// ---------- what the office database keeps (server/db/) ----------

/** A merged PR: the shipped wall and the trophies come from these. */
export interface ShippedWork {
  floorId: string;
  prNumber: number;
  title: string;
  url: string;
  builtBy: string | null; // the worker's name; null for a PR from outside the office
  testedBy: string | null; // the QA worker's name, when the office tested it
  mergedAt: number;
}

/** An award the office or a floor won (shared/awards.ts has the list): its trophy. */
export interface Trophy {
  id: string;
  floorId: string | null; // null: the company's
  icon: string;
  title: string;
  detail: string;
  earnedAt: number;
  reward: number; // coins it paid (the company's to every floor); 0 when it was found in a floor's old history
}

/** What the office has shipped and won: the latest merges, each floor's total and the company's, and every trophy. */
export interface RecordsView {
  recent: ShippedWork[]; // newest first
  totals: Record<string, number>; // by floor id
  total: number;
  trophies: Trophy[]; // oldest first
}

export const EMPTY_RECORDS: RecordsView = { recent: [], totals: {}, total: 0, trophies: [] };

/** Something standing in one of a floor's spots: the default kit, and later what the shop sells. */
export interface FloorItem {
  spot: string;
  item: string;
  tier: number; // 1, or higher for an upgrade
  since: number;
}

/**
 * Why coins came or went: a merge, its clean first QA pass, a PR fixed after failing QA, an award, the shop, the demo's
 * gift, or a purchase paid back (the catalogue moved it to a kind of spot the floor had no room in).
 */
export type CoinReason = 'merge' | 'clean-qa' | 'fixed' | 'award' | 'purchase' | 'grant' | 'refund';

/** A line in a floor's ledger (server/ledger.ts): coins earned (amount > 0) or spent. */
export interface CoinEntry {
  id: number;
  floorId: string;
  amount: number;
  reason: CoinReason;
  detail: string; // e.g. "PR #12 merged", "Espresso machine"
  prNumber: number | null;
  at: number;
}

/** A floor's purse: what it has to spend, and what it has earned in all. */
export interface FloorCoins {
  coins: number;
  earned: number;
}

/** Every floor's purse (floors no longer connected keep theirs, for when they come back) and the latest lines. */
export interface CoinsView {
  floors: Record<string, FloorCoins>; // by floor id
  recent: CoinEntry[]; // newest first
}

export const EMPTY_COINS: CoinsView = { floors: {}, recent: [] };

/** The manager's look in the game, as the client keeps it (client/src/world/appearance.ts); stored as it comes. */
export type PlayerLook = Record<string, unknown>;

// ---------- floor previews (server/previews.ts) ----------

/** Where a floor's preview is: off, its worktree being refreshed, dependencies installing, the app coming up, up, or failed. */
export type PreviewState = 'stopped' | 'preparing' | 'installing' | 'starting' | 'running' | 'error';

/** What the manager set for a floor's preview; null leaves it to the office (the package.json's script, the floor's port). */
export interface PreviewConfig {
  command: string | null;
  port: number | null;
}

/** A floor's app, run for the manager to check what the team shipped. */
export interface PreviewView {
  floorId: string;
  state: PreviewState;
  url: string | null; // where it answers (http://127.0.0.1:<port>), once it's up
  port: number; // the port it runs on: the manager's, or the one kept for the floor
  command: string | null; // what runs it: the manager's, or what the office found ("npm run dev"); null until found
  config: PreviewConfig;
  sha: string | null; // the commit it runs
  startedAt: number | null;
  error: string | null;
  log: string[]; // the last lines of its output, oldest first
}

// ---------- the desktop: chats with the CEO and discussions (server/desk/, kept in the office database) ----------

/** One message in a chat or a discussion. */
export interface DeskMessage {
  id: number;
  at: number;
  from: 'manager' | 'ceo' | 'office'; // the office's own lines: a project started, a step that failed
  text: string;
  proposalId: number | null; // the project card the CEO put with this message
}

/** A task the CEO plans for a new project: filed in order, so it may wait on tasks filed before it. */
export interface ProposalTask {
  title: string;
  body: string;
  dependsOn: number[]; // indices into the proposal's tasks, each lower than this one's
}

/** Where a proposed project lives: a new repository, or one that exists. */
export type ProposalRepo = { kind: 'new'; owner: string; name: string; description: string; private: boolean } | { kind: 'existing'; fullName: string };

/**
 * A project the CEO proposes in a chat. Nothing touches GitHub until the manager approves it; then the office creates
 * (or links) the repository, connects it as a floor with the brief, sets the team and files the tasks.
 */
export interface ProjectProposal {
  id: number;
  chatId: number;
  at: number;
  status: 'pending' | 'starting' | 'started' | 'declined' | 'failed' | 'replaced'; // replaced: the CEO proposed again
  repo: ProposalRepo;
  brief: string; // becomes the floor's brief
  teamSize: number;
  tasks: ProposalTask[];
  step: string | null; // what it's doing while starting ("Creating the repository…")
  floorId: string | null; // the floor it started
  issueNumbers: number[]; // the tasks as filed
  error: string | null;
  decidedAt: number | null;
}

/** A conversation with the CEO about an idea; each keeps its own CEO session, so ideas don't mix. */
export interface ChatView {
  id: number;
  title: string;
  createdAt: number;
  updatedAt: number; // its latest message
  replying: boolean; // the CEO has a job for it waiting or running
  messages: DeskMessage[]; // oldest first
}

/**
 * A thread the CEO opened to settle something with the manager before it plans or acts. (Workers' questions on issues
 * are threads too, drawn from the snapshot's questions.)
 */
export interface DiscussionView {
  id: number;
  title: string;
  floorId: string | null; // the floor it's about, if one
  openedAt: number;
  updatedAt: number;
  status: 'open' | 'resolved';
  outcome: string | null; // how it was settled, once resolved
  replying: boolean; // the CEO has a job for it waiting or running
  messages: DeskMessage[]; // oldest first; the first is the CEO's
}

/** Everything the desktop shows besides the office's notices and the workers' questions. */
export interface DeskView {
  chats: ChatView[]; // the most recently active first
  proposals: ProjectProposal[];
  discussions: DiscussionView[]; // open ones first, then the most recently active
  owners: string[]; // where a new repository can go: the gh login first, then its organisations
}

export const EMPTY_DESK: DeskView = { chats: [], proposals: [], discussions: [], owners: [] };

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
  // from the office database
  records: RecordsView;
  look: PlayerLook | null;
  floorPlans: Record<string, FloorItem[]>; // by floor id
  coins: CoinsView;
  awards: AwardStats; // the counts behind the awards, for how far along each one is
  world: WorldView; // the world events on now (shared/worldEvents.ts)
  previews: Record<string, PreviewView>; // by floor id
  desk: DeskView;
  playbook: PlaybookView; // the office's and each floor's agent docs, and the CEO's proposed changes (shared/playbook.ts)
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
  | { type: 'cloud'; cloud: CloudView }
  | { type: 'records'; records: RecordsView }
  | { type: 'look'; look: PlayerLook | null }
  | { type: 'floorPlan'; floorId: string; items: FloorItem[] }
  | { type: 'coins'; coins: CoinsView }
  | { type: 'awards'; awards: AwardStats }
  | { type: 'world'; world: WorldView } // a world event started or ended, or the next one moved
  | { type: 'preview'; preview: PreviewView }
  | { type: 'desk'; desk: DeskView } // the whole desk, after any change to it
  | { type: 'playbook'; playbook: PlaybookView }; // the whole playbook, after any change to it

/**
 * Things that happened, for the game's moments (arrivals, celebrations) and the debug page's feed. They change no
 * state: each comes alongside the state events that do, so a tab that misses one only misses the moment.
 */
export type Moment =
  | { type: 'hired'; at: number; worker: Worker }
  | { type: 'left'; at: number; worker: Worker }
  | { type: 'issuesFiled'; at: number; floorId: string; numbers: number[] }
  | { type: 'prOpened'; at: number; floorId: string; prNumber: number; workerId: string; issueNumber: number | null }
  | { type: 'qaPassed'; at: number; floorId: string; prNumber: number; qaWorkerId: string | null; round: number }
  | { type: 'qaFailed'; at: number; floorId: string; prNumber: number; qaWorkerId: string | null; round: number }
  | { type: 'merged'; at: number; floorId: string; prNumber: number; devWorkerId: string | null; qaWorkerId?: string | null } // the QA record is gone by then
  | { type: 'trophy'; at: number; trophy: Trophy }
  // coins a floor just earned, all at once (a merge with its clean QA pass, say): the game bursts them over the builder's desk
  | { type: 'earned'; at: number; floorId: string; amount: number; reasons: string[]; prNumber: number | null; workerId: string | null; award?: boolean }; // award: an award's coins (its trophy moment says so)

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

const MOMENT_TYPES = new Set<string>(['hired', 'left', 'issuesFiled', 'prOpened', 'qaPassed', 'qaFailed', 'merged', 'trophy', 'earned'] satisfies Moment['type'][]);
export const isMoment = (ev: ServerEvent): ev is Moment => MOMENT_TYPES.has(ev.type);
