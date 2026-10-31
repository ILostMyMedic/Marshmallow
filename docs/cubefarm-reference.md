# cubefarm: how the reference works

A guide to `D:\Projects\cubefarm-main` (cubefarm 0.3.20, MIT, © 2026 Leon van Zyl), written for building Marshmallow. Paths are relative to that folder. Line numbers (`~l.123`) drift, so search by the names given. For what to port into which Marshmallow module, see [porting-map.md](porting-map.md).

## What it is

cubefarm is a cartoon first-person 3D office (React Three Fiber) over a Node orchestrator:

- each connected GitHub repository is a **floor**
- each **agent** is a real coding-agent CLI (Claude Code by default; Codex or OpenCode) running in a pseudo-terminal of its own
- a **CEO** agent sizes teams and turns your briefs into issues

GitHub issues are the work queue and pull requests are the output; there is no database, only `state.json`. The code is about 30,000 lines of server and 78,000 of client, of which the 3D world is 51,000.

```
Browser (React + three.js)  ◄── /ws: a snapshot, then small patches ──  server/index.ts (Express 5 + ws)
                                                                              │
   GitHub (the gh CLI)  ◄── issues, PRs, checks, merges ──  Swarm (server/swarm.ts)
                                                  scheduler · QA loop · merge gate · CEO job queue
                                                                              │ backend.startSession(opts, callbacks)
                                         ┌────────────────────────────────────┴──────────────┐
                              server/cliRunner.ts (default)                        server/agentRunner.ts
                     the real CLI in a pseudo-terminal;                       the Agent SDK's query()
                     its hooks POST to /api/hooks/:token
                                         │
                            MachineProvider (server/machines.ts)
          local: its own clone, worktree and temp folder per agent  │  box: one Upstash Box per agent
```

## The core loop: issue → merged PR

1. **Schedule.** `Swarm.schedule()` runs on a timer (`SCHEDULER_INTERVAL_MS`, 8 s) and shortly after every session ends. In order, it:
   - ticks usage pacing and the office's self-update drain
   - applies team changes
   - stops if Claude's usage limit is hit
   - starts the CEO's next job
   - for each floor, starting from a rotating one: `startPipelineWork` (queued QA, then failed PRs' fixes), and only then `startIssueWork` (auto-assign)

   It stops handing out work once `slotsFull()` says the session limit is reached.
2. **Pick an issue.** `readyIssues()` drops issues that are:
   - labelled `swarm:skip`, `wontfix` or `question`
   - already taken, or held after their PR closed
   - blocked by an open `Depends on #N` (`blockers()` in `shared/issues.ts`)
   - failed `MAX_ISSUE_FAILURES` times

   It sorts the rest by `holdUps()` (how long a chain of issues each one blocks), then by waiting time.
3. **Build.** `assign()` → `runTask()`:
   - `beginTask()` sets the agent to `preparing`.
   - It asks GitHub whether the issue is still open.
   - `prepare()` checks out the desk (`machines.prepareDesk`), then `installDeps()`.
   - The prompt is the issue text; the system prompt is `devSystemPrompt()`.
   - `startAgentSession()` → `launchSession()` → `backend.startSession()`.
4. **Session ends.** `finished` → `onFinished()` adds up cost and turns, releases the desk (stops leftover dev servers) and dispatches on the task:
   - `onIssueFinished()` finds the PR URL in the final message, or by branch (`prForBranch`).
   - No PR: `noPullRequest()` asks the agent once to finish, then puts the issue back on the board.
5. **QA.** `queueQa()` creates a `QaRecord`. `startPipelineWork` → `pickTester()` (`handOut.ts`) chooses who tests: not the author, unless nobody else can, or nobody else has come free for 15 minutes. `runQa()` then:
   - runs `qaGate()`: a conflicting PR goes back to its author first; one that's behind gets its branch updated
   - checks the PR head out on a desk
   - builds the prompt from `qaInstructions()` (`qaPrompt.ts`) and `qaSystemPrompt()`
   - starts a fresh session with `QA_SCHEMA` (~l.406)

   `onQaFinished()` parses the report (`parseReport`), resumes the session once if it has none (`qaRetry.ts`), posts the report and screenshots on the PR (`renderQaComment` + `commentPull`), and lets `qaOutcome()` choose the next status.
6. **Fix.** `runFix()` gives the fix to the author when possible (`fixGoesTo`), resuming their session. `onFixFinished()` + `fixOutcome()`:
   - pushed something → back to QA
   - pushed nothing → asked once (`noPushNudge`), then it counts as a failure
7. **Merge.** `advanceMerges()` / `advanceMerge()` follow `mergeStep()` (`mergeGate.ts`):
   - only `swarm/` branches merge themselves, and only at the commit QA passed (`passedSha`)
   - it waits for GitHub's checks
   - failing checks or a conflict go back for a fix (`sendBack()`, at most `MAX_MERGE_FIXES` times)
   - it squash-merges, falling back to a merge commit
   - `closeResolvedIssues()` closes the issues the PR resolved
8. **Stuck.** `stuck()` queues a CEO triage job (`triageJob`). Only if that fails does `escalate()` mark the PR needs-human and message the manager's phone.

## server/swarm.ts, section by section

One `Swarm` class holds all state and behaviour. Its sections (`// ---------- x ----------`):

| ~Line | Section | What's there |
| --- | --- | --- |
| 107 | persisted shape | `PersistedRepo`, `PersistedAgent`, `QaRecord`, `Persisted`, `AgentRuntime`, `RepoRuntime`, `QaReport` |
| 282 | flavour | floor colours, shirts, the `NAMES` pool, `FEMININE_NAMES` |
| 404 | QA report | `QA_SCHEMA`, `parseReport` |
| 679 | lifecycle | `init()`, restart reconciliation (`reconcileRestart`, `recover`) |
| 1021 | views | `repoView`, `agentView`, `qaView`, `snapshot()` |
| 1168 | clients | `addClient`, `broadcast`, `emitAgent`, `emitRepo`, `appendLog` |
| 1279 | persistence | `save`, `writeState`, `writeStateFile` |
| 1396 | GitHub / repos | `connectRepo`, `syncRepo`, `createIssue`, `mergePull`, `closePull` |
| 1552 | auto-merge | `advanceMerges`, `advanceMerge`, `sendBack`, `syncFolder`, `sweepFloor` |
| 1755 | previews | floor previews and the PR theatre |
| 1956 | closed issues and PRs | `cleanUpClosed`, `applyClosure`, `stopForClosure` |
| 2122 | agents | `hireAgent`, `fireAgent`, `updateAgent`, `stopAgent`, `assign` |
| 2198 / 2325 | cloud agents / signing in | `hostFor`, `bringUpBox`, `boxTarget`, `holdForSignIn`, `checkSignIn` |
| 2697 | terminals | `terminalFor`, `attachTerminal`, `beginTask`, `prepare`, `runTask`, `launchSession`, `onFinished` |
| 3166 | QA | `queueQa`, `runQa`, `onQaFinished`, `runFix`, `onFixFinished`, `message`, `updateSettings` |
| 3775 | scheduling | `isFree`, `readyIssues`, `startPipelineWork`, `startIssueWork`, pacing, `schedule` |
| 3962 | mission control | `opsView`, `emitOps` |
| 4054 | office update | the self-update drain and handover |
| 4186 | the CEO | `enqueueCeo`, `startCeoWork`, `runCeoJob`, `onCeoFinished`, `messageCeo`, `planFloor` |
| 4480 | triage | `stuck`, `escalate`, `triagePr` and the triage actions |
| 4622 | idle desks | `trimIdleDesks` |
| 4689 | watchdog | `watchdogTick`, `remedy`, the office doctor |
| 4930 | progress | coins, decorations, achievements (the ledger) |
| 5020 / 5041 / 5075 | phone, notifications, ping-pong | |
| 5098 | team changes | hire requests, `applyTeamChanges` |
| 5326 | office tools | the CEO's tool handlers |

## The Backend seam: server/backend.ts and server/demo.ts

`Backend` is the single interface for everything outside the process:

- GitHub calls
- clones and desks
- `machines: MachineProvider`
- `startSession`
- CLI detection and terminal reconnects
- previews, voice, weather, notifications
- `cloud: CloudBackend` (the Upstash Box API, credentials, sign-in)

`realBackend` wires it to `github.ts`, `workspace.ts` and the runners; `createDemoBackend()` in `demo.ts` fakes every part of it. The fakes include sessions that draw into the agent's terminal and open PRs, and a fake Upstash account. This seam is why `--demo` costs nothing and why the pipeline can be tested offline: **the most important pattern to copy.**

## Sessions

**The contract** (top of `agentRunner.ts`):

- `SessionOptions`: cwd, prompt, `systemAppend`, model, effort, `browserTesting`, `additionalDirectories`, `outputSchema`, `resumeSessionId`, terminal, cli, `keepAlive`, box…
- `SessionCallbacks`: `log`, `tool`, `sessionId`, `browserUrl`, `screenshot`, `turn`, `limited`, `usageWarning`, `finished`
- `SessionHandle`: `send`, `stop`

Both runtimes implement it, so the orchestrator never knows which one runs.

### server/cliRunner.ts: the real CLI in a pseudo-terminal (the default)

- **Per session**, a token (a UUID) routes the CLI's calls back to its session (`routes`, `handleHook`). A folder `<home>/sessions/<token>/` holds:
  - `settings.json`:
    - each of `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `StopFailure` and `Notification` is an HTTP hook (`{ type: 'http', url: <office>/api/hooks/<token> }`)
    - a `statusLine` command (`statusline.cjs`) posts the session's status to the same URL
    - ~l.841
  - `mcp.json`: the Playwright MCP server; for the CEO, the office tools as an HTTP MCP server at `/api/mcp/<token>`.
  - `instructions.md`: the system prompt the office appends.
- **Claude's command line** (`launchArgs` in `clis.ts`):
  - session: `--session-id <uuid>` or `--resume <id>`
  - `--model`, `--effort`, `--permission-mode acceptEdits`
  - `--settings <file>`, `--mcp-config <file>`, `--append-system-prompt-file <file>`
  - `--name <label>`, `--add-dir <linked clone>`…
  - `--disallowedTools AskUserQuestion EnterPlanMode ExitPlanMode Monitor ScheduleWakeup CronCreate CronDelete CronList RemoteTrigger`, plus `Bash PowerShell NotebookEdit` for the CEO
  - `-- <prompt>`
- **The binary** is the Claude Code bundled with `@anthropic-ai/claude-agent-sdk` (`commandFor`), so the hook and settings formats match the code. `DISABLE_AUTOUPDATER=1`.
- **Environment:** the office's own, minus `/^(ANTHROPIC_|CLAUDE)/` (except `CLAUDE_CONFIG_DIR`), so the CLI uses the subscription login rather than an API key. On top: `TERM`/`COLORTERM`, and the machine's `TMP`/`TEMP`/`TMPDIR` (~l.889).
- **Hooks** (`hook()`, ~l.642):

  | Event | What the office does |
  | --- | --- |
  | `PreToolUse` | logs the step, sets the current tool, answers `permissionDecision: 'allow'` (nobody may be watching to approve) |
  | `PostToolUse` | Playwright screenshots (images in `tool_response`), the browser URL, a summary line |
  | `UserPromptSubmit` | tells the office's prompts apart from ones the manager typed |
  | `Stop` | `last_assistant_message`, then `turnEnded()`; with no new prompt within `FINISH_GRACE_MS` (3 s), `finish()` |
  | `StopFailure` | `rate_limit` pauses the office |
  | `StatusLine` | `cost.total_cost_usd`, and `rate_limits.*.used_percentage`: at 90 % and above, a usage warning (pacing) |
- **A structured QA report** in this runtime: the schema is appended to the prompt ("end your final message with a ```json block matching this schema", ~l.829) and `parseReport` reads it from the final message.
- **Prompts over 8,000 characters** go into `task.md` (Windows caps a command line at 32K).
- **`keepAlive`:** after building or fixing, the CLI waits at its prompt for 30 minutes (5 in a Box), and follow-ups reuse it. After QA, and for the CEO, it closes.
- **Folder trust:** the office answers the CLI's folder-trust question by watching the screen (`trustKey`). Esc typed in the terminal ends the session as `interrupted`.

### The rest of the session layer

- `server/terminal.ts`: `AgentTerminal`, a headless xterm (120×32) mirroring each agent's screen.
  - It serializes the screen for late viewers and saves to `<home>/terminals/<id>.ansi`.
  - Browser viewers connect over `/ws/term`, and keystrokes go back to the CLI.
- `server/ptyHost.ts` / `ptyClient.ts` / `ptyProtocol.ts`: the **terminal keeper**, a detached process holding the pseudo-terminals.
  - It talks over a named pipe or socket guarded by a secret.
  - Hooks route through it, so CLIs survive an office restart; `reconnectClis()` picks them up again.
- `server/agentRunner.ts` `startSession()`: the older runtime, the SDK's `query()`. An `InputQueue` feeds it messages mid-session, `canUseTool` allows everything, and the callbacks are the same.

## Machines (local): server/machines.ts and server/workspace.ts

- **Layout:** `<home>/machines/<machine>/` holds:
  - `repos/<owner>__<repo>/`: the agent's own clone, borrowing objects from the floor's checkout
  - `work/<owner>__<repo>/`: its worktree, where task branches are checked out
  - `tmp/`: its temp folder
- **Name:** `machineName` is the first 8 alphanumeric characters of the agent's id, so a rename moves nothing.
- **Dev-server port:** `5200 + parseInt(id.slice(0, 4), 16) % 700`.
- **`release`** kills whatever the agent left running on its port or in its worktree.
- **`sweep`** deletes finished `swarm/` and `qa/` branches.
- **`remove`** saves unpushed work as a patch in `<home>/leftovers/` before deleting.
- **Git:** a lock per clone; `fs.rm` with retries for Windows file locks.

## GitHub: server/github.ts

Everything goes through the `gh` CLI, via `exec.ts`: `execFile` without a shell, prompts disabled, `CommandError` carrying stderr. QA screenshots are uploaded to an orphan branch, `swarm-qa-evidence`, so evidence never lands in the code.

## The CEO: server/ceo.ts

- **What it is:** a Claude Code session in `<home>/ceo/` with no shell. It reads the floors' clones and changes things only through MCP office tools (zod-validated; errors come back as `Refused: …`).
- **Tools:** `company_status`, `agent_detail`, `set_floor_profile`, `scale_team`, `configure_agent`, `file_issue`, `set_dependencies`, `close_issue`, and the triage tools `retry_qa`, `send_back`, `rerun_checks`, `close_pull`, `escalate`.
- **Jobs**, in a queue (`chat` and `triage` first, then `onboard` and `plan`, then `review`).
- **Rules:**
  - `file_issue` is refused unless the manager asked for work in that job (`askedFor`), with at most 12 issues per job (`IssueCap`).
  - Its final message goes to the manager's phone.
  - It keeps notes in `NOTES.md`.
- **Prompts:** `ceoSystemPrompt()` and `ceoJobPrompt()`; `scalePlan()` does the team-size arithmetic.

## Cloud agents (Upstash Box): docs/cloud.md

| File | Role |
| --- | --- |
| `server/box.ts` | the only importer of `@upstash/box`; `BoxApi`: list, create, get, resume, pause, remove, run, read, write, files, session, browser |
| `server/boxMachines.ts` | the Box `MachineProvider`: create, set up, prepare a desk, pause, remove |
| `server/boxScripts.ts` | the shell scripts run in a Box, as pure tested functions |
| `server/boxHelpers.ts` | the programs written into a Box (launcher, hook, status line, release) |
| `server/boxCli.ts` | `BoxPty`: the CLI under tmux, its events file read from a byte offset |
| `server/cloud.ts` | the account: credentials, `secrets.json` |

- **Box setup:**
  - Boxes are named `cubefarm-<office>-<machine>` and labelled `cubefarm`, `cf:<office>`, `m:<machine>`.
  - They're created with `runtime: 'node'` and `browser: true`.
  - Home is `/workspace/home`.
  - `setupScript` installs pinned CLIs into `~/.cubefarm/cli` plus tmux, and sets a git credential helper that reads `$GH_TOKEN` from the command's environment. A marker file skips setup next time.
- **Reporting back:** a Box can't reach the office. The CLI runs under its own tmux server; its hooks append to `<session>/events.jsonl`, and the office reads that from the byte offset it last handled (`EventLines`). That also replays what happened while the office was closed.
- **The browser:** Playwright attaches to the Box's own Chromium at `127.0.0.1:9222`.
- **Credentials** travel only as one command's environment, never in the Box's files.
- **Sign-in:** the CLI's own login runs in the agent's terminal (`claude auth login`), checked with `claude auth status`. Or a key or `CUBEFARM_CLAUDE_TOKEN` is used for every Box.
- **Idle Boxes:** the CLI closes 5 minutes after finishing, and idle Boxes pause.

## The client's data path

- **Connect:** `client/src/net.ts` opens `/ws` and gets a `snapshot`, then typed `ServerEvent`s (`shared/types.ts` ~l.638). `client/src/store.ts` (zustand) folds them in with `apply(ev)`.
- **Batching:** `server/outbox.ts` sends agents' and floors' changes as patches every 250 ms, and terminal lines only to the tabs that show them.
- **Commands** go through REST in `client/src/api.ts`; errors become toasts.

## The game layer

All of it is built in code, with no asset files beyond the app icons and two Google Fonts:

| What | How | Where |
| --- | --- | --- |
| Furniture and props | primitives with a 3-step toon ramp and ink outlines | `client/src/world/Toon.tsx`, `materials.ts`, `decor/parts.ts` |
| Characters' looks | an FNV-1a hash of the id seeds mulberry32, which picks the look | `appearance.ts`, `characterParts.ts` |
| Faces | morph targets | `face.ts` |
| Monitors, whiteboard, signs | 2D canvases, painted in a worker | `draw.ts`, `paint/` |
| Sounds | WebAudio synthesis | `client/src/ui/sfx.ts`, `babble.ts`, `music.ts` |
| Speech bubbles | a phrasebook with no Claude calls | `chatterLines.ts` |

The world's logic is mostly pure, tested modules (rules, layouts, schedules) with thin React components drawing them: `errands.ts`, `walkways.ts`, `socials.ts`, `ritualSchedule.ts`. Idle errands include coffee, the fridge, stretching, hoops, toss, catch and ping-pong.

## Patterns worth keeping

- **The Backend seam with a full demo fake:** offline development, CI without secrets, a free demo.
- **Hooks as telemetry and approval at once:** one HTTP endpoint gives live steps, cost and usage, and unattended runs.
- **GitHub as the source of truth,** with a small state file and no database.
- **QA in a fresh session** with a structured report; the office, not the agent, posts to GitHub.
- **Decisions in small pure modules** with tests (`handOut`, `qaOutcome`, `mergeGate`…), and `swarm.ts` only wiring them.
- **"Your session ends when your turn ends"** (`ONE_TURN`) in every prompt, and cross-turn tools disallowed, so agents never wait for a wake-up that won't come.
- **Seeded identities:** looks and names derived from ids need no storage and look the same in every browser.

## What to do differently

- **Split `swarm.ts` by concern** from the start: scheduler, build, QA, fix, merge, team, CEO, cloud.
- **Leave the extras out of the core loop.** Ledger, metrics and journal calls are woven through it; an event bus the extras subscribe to keeps them out.
- **Put work sources behind an interface.** GitHub is hard-wired through `gh`; an interface keeps GitLab or Linear possible.
- **No auth:** cubefarm relies on binding to 127.0.0.1. Keep that default.

## Gotchas

- **Windows:**
  - Use the prebuilt `@lydell/node-pty`.
  - npm goes through `cmd.exe`.
  - `.cmd` shims need unwrapping to spawn a CLI directly (`unwrapCmdShim` in `clis.ts`).
  - A session started in a missing folder dies at once with exit 267, so check the desk exists first (`sessionStart`).
- **Hook timeouts:** 30 s, or 120 s through the keeper, which holds hooks while the office restarts.
- **Session ids:** a session can be resumed only by the CLI, and from the folder, that created it (`sessionCli`, `resumableSession`).
- **Playwright MCP** is pinned exactly and run from `node_modules` (`browser.ts`), so sessions never run npx.
- **Never copy login files** between machines: refresh tokens rotate and the copies log each other out. Anthropic's terms also forbid apps collecting claude.ai credentials.
