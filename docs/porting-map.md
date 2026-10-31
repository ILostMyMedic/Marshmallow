# Porting map: cubefarm → Marshmallow

For each Marshmallow module in [BUILD-PLAN.md](../BUILD-PLAN.md): the cubefarm code it comes from (paths relative to `D:\Projects\cubefarm-main`), and what to do with it. Scope follows [FEATURES.md](../FEATURES.md): when a feature there is unchecked, cut its code while porting. How the pieces fit together is in [cubefarm-reference.md](cubefarm-reference.md).

**Verdicts**

| Verdict | Meaning |
| --- | --- |
| **Copy** | Bring the file over nearly as is (renames, dead imports dropped) and port its test too. |
| **Adapt** | Bring it over, then cut the branches for features Marshmallow doesn't have. |
| **Rewrite** | Write it fresh, reading cubefarm's as the reference. Usually because it's tangled into `swarm.ts`. |
| **Skip** | Not in Marshmallow's scope (yet). |

Every ported file gets the header `Adapted from cubefarm <path> (MIT).`; the first port adds `NOTICE`.

## Phase 0: skeleton

| Marshmallow | cubefarm | Verdict | Notes |
| --- | --- | --- | --- |
| `server/config.ts` | `server/config.ts` | Adapt | Keep `HOME_DIR`, `PORT`, `HOST`, `DEMO`, `STATE_FILE`, `SYNC_INTERVAL_MS` (45 s), `SCHEDULER_INTERVAL_MS` (8 s), `DESK_SWEEP_INTERVAL_MS`, `LOG_BUFFER`. Drop preview ports and the demo scale. `SWARM_*` → `MARSHMALLOW_*`; default port 4600. |
| `server/exec.ts` | `server/exec.ts` | Copy | `run` / `git` / `gh` through `execFile`, prompts disabled, `CommandError`. |
| `server/httpError.ts` | `server/httpError.ts` | Copy | |
| `server/index.ts` | `server/index.ts` | Rewrite | Keep the shape: routes, the error handler returning `{ error }`, the `/ws` and `/ws/term` upgrades, static `dist/`, shutdown. Drop the voice, notify, journal, pong, decor, preview, doctor and office-update routes. |
| `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` | same | Adapt | vitest points the home folder at a temp dir and the port at 0. |
| `.github/workflows/ci.yml` | same | Adapt | Drop the package smoke test until there's a package. |

## Phase 1: contract, state, debug page

| Marshmallow | cubefarm | Verdict | Notes |
| --- | --- | --- | --- |
| `shared/types.ts` | `shared/types.ts` | Rewrite | Start from `WorldSnapshot`, `ServerEvent`, `AgentView`, `RepoView`, `QaView`, `SwarmSettings`, `LogLine`, `IssueInfo`, `PullInfo`. Drop voice, weather, themes, notify, presence, progress, pong, journal and previews. Add the game fields from BUILD-PLAN phase 1. |
| `server/store.ts` | `swarm.ts`: `Persisted` (~l.212) and the persistence section (~l.1279) | Rewrite | A debounced save; temp file + rename. |
| broadcasting | `swarm.ts`: the clients section (~l.1168); `server/outbox.ts` | Rewrite | A plain broadcast first. Port `outbox.ts` (patches every 250 ms, per-tab terminal lines) only if "batched state patches" gets checked. |
| `shared/models.ts` | `shared/models.ts` | Adapt | Keep `<server>/<model>` naming (`localModel`) and the server list, with only Ollama for now. Claude Code takes Ollama's base URL without `/v1`. Drop `effectiveModel`'s per-CLI logic: there's one CLI. `CUBEFARM_*_URL` → `MARSHMALLOW_*_URL`. |
| `client/src/store.ts` | `client/src/store.ts` | Adapt | Keep the zustand store and `apply(event)`; drop the replay mode. |
| `client/src/net.ts` | `client/src/net.ts` | Adapt | Reconnect with backoff. The tab's "watch" message only comes with the outbox. |
| `client/src/debug/` | `client/src/ui/FloorList.tsx` | Rewrite | A plain list of floors and workers. |

## Phase 2: the Backend seam and the demo

| Marshmallow | cubefarm | Verdict | Notes |
| --- | --- | --- | --- |
| `server/backend/backend.ts` | `server/backend.ts` | Adapt | **Keep:** the GitHub calls, `ensureClone`, `mainDir`, `machines`, `installDeps`, `startSession`, `terminals`, `cloud`. **Drop:** `voice`, `weather`, `notify`, `previews`, `office`, `seedOps`, `demoTeam`, `demoDoctor`; the pre-machine desk calls (`deskDir`, `prepareDesk`, `removeDesk`, `sweepDesks`, `trimDesk`, `releaseDesk`); the folder calls unless "connect a local folder" is checked. |
| `server/backend/demo.ts`, `demoGithub.ts`, `demoSessions.ts` | `server/demo.ts` (1,645 lines) | Rewrite | Done. A fake GitHub saved to `<home>/demo-github.json`, so the demo survives restarts; fake machines; scripted issue, QA and fix sessions; random checks and QA verdicts. Timing and randomness are injectable for tests. Still to come with their phases: writing into the terminal (5), the fake `BoxApi` (7), the CEO's session (6), usage warnings (3). |
| `server/sessions/session.ts`, `server/machines/machines.ts` | `agentRunner.ts` (the types), `machines.ts` | Adapt | Done early: the backend needs them. `subject` on `SessionOptions` tells the demo what the task is about, so the demo doesn't parse prompts. The `terminal`, `box` and `office` fields come in phases 5 to 7. |
| `server/floors.ts` | `swarm.ts`: `connectRepo`, `syncRepo` | Rewrite | Done early, so the demo has floors to run on. Includes the `issuesFiled` moment and one sync per floor at a time. |
| `server/pipeline/sessions.ts` | `swarm.ts`: `launchSession` and its callbacks, `activityOf` | Rewrite | Done early: log lines, current tool and the activity sign go to the store; `onEnd` gets the result, the session id and the screenshots. Phase 3's build, QA and fix start sessions through it. |
| `shared/activity.ts` | `shared/activity.ts` | Copy | Done. `agentActivity` became `workerActivity`; the Codex and triage tool cases were cut; the office tools are named `worker_detail` and `configure_worker` (phase 6 must match). |

## Phase 3: scheduler and pipeline

**Done.** Things that differ from cubefarm:
- **Rules:** live in `server/pipeline/rules/`, with their tests. `catchUp`, "resume full speed" and the `autoMerge` checks were cut, since auto-merge is always on.
- **Branch checks:** match `mm/issue-`, because QA's local branches (`mm/qa-`) also start with `mm/`.
- **Wiring:** split into `build.ts`, `qa.ts`, `fix.ts`, `merge.ts`, `scheduler.ts`, `desk.ts` and `usage.ts`, sharing one `Ctx` (`context.ts`), and assembled in `pipeline.ts`.
- **QA records:** the server-only fields live on `QaState` in `store.ts`, saved but not sent to tabs.
- **Office messages:** `store.say` replaces cubefarm's phone messages. A PR that needs you posts one message as it gets there; there's no triage.
- **Syncs:** `Floors.sync` runs once more when it's asked for while a sync is running. Otherwise a merge could wait for the next 45-second timer.
- **Not wired yet:** `sendBack.ts` (the manager's "send back", once the console exists), closed issues and PRs stopping work and held issues (`closeCleanup`, phase 8), and restart reconciliation (phase 8).

| Marshmallow | cubefarm | Verdict | Notes |
| --- | --- | --- | --- |
| `shared/issues.ts` | `shared/issues.ts` | Copy | `blockers`, `holdUps`, `setDependsOn`, `waitsMessage`. |
| `server/pipeline/rules/` | `handOut.ts`, `qaOutcome.ts`, `qaRetry.ts`, `fixOutcome.ts`, `mergeGate.ts`, `prOwnership.ts`, `sendBack.ts`, `issueClaims.ts` | Copy | Pure, each with a test. Port in dependency order: `mergeGate` → `qaOutcome` → `fixOutcome` → `prOwnership`. `sendBack` needs `httpError`. |
| `server/pipeline/pacing.ts` | `server/pacing.ts`, `shared/usage.ts` | Copy | A usage warning means pacing; the limit means a pause. |
| `server/pipeline/scheduler.ts` | `swarm.ts` scheduling section (~l.3775): `isFree`, `available`, `readyIssues`, `startPipelineWork`, `startIssueWork`, `schedule`, `issueFailed`, `mayStart`, `pauseForLimit`, `paceForWarning` | Rewrite | Keep: finishing beats starting, floors take turns, the session limit. |
| `server/pipeline/build.ts` | `swarm.ts` (~l.2645–3165): `assign`, `beginTask`, `prepare`, `runTask`, `startAgentSession`, `onFinished`, `onIssueFinished`, `noPullRequest`, `releaseIssue` | Rewrite | Sessions start through `pipeline/sessions.ts`. Replaces the demo's "run" route in `server/demoRoutes.ts`. |
| `server/pipeline/qa.ts` | `swarm.ts`: `QA_SCHEMA` and `parseReport` (~l.404), `queueQa`, `runQa`, `onQaFinished`, `renderQaComment` (~l.3166–3505). `server/qaPrompt.ts`: Adapt. | Rewrite | Drop the mission-control and ledger calls unless checked. |
| `server/pipeline/fix.ts` | `swarm.ts`: `runFix`, `onFixFinished`, `unpushed`, `prHead` (~l.3507–3680) | Rewrite | |
| `server/pipeline/merge.ts` | `swarm.ts` auto-merge section (~l.1552): `advanceMerges`, `advanceMerge`, `closeResolvedIssues`, `sendBack` | Rewrite | Only `mm/` branches merge themselves, and only at `passedSha`. |
| `server/prompts/` | `server/prompts.ts` | Adapt | `devSystemPrompt`, `qaSystemPrompt`, `ONE_TURN`, `noPushNudge`, `ownPrLine`, `failedLogLines`, the branch names. "cubefarm" → "Marshmallow". |

## Phase 4: real GitHub and local machines

**Done.** Things that differ from cubefarm:
- **GitHub:** `server/github/github.ts` dropped mission control's check timing, added `issueComments` and `commentIssue` for questions, and only lists open PRs for `prForBranch`. The evidence branch is `mm-qa-evidence`, and only `mm/issue-` remote branches are deleted after a merge.
- **Workspace:** `server/machines/workspace.ts` keeps the floor's clone, the machine functions, worktree reuse with stale-lock recovery, leftover processes and leftover patches. Project folders, `syncMain`, pre-machine desks, `sweepDesks` and trimming are out.
- **Dependencies:** `deps.ts` was copied; `deskSetup.ts` waits for phase 5, since it closes an idle terminal.
- **Backend:** `server/backend/real.ts` wires it all up. Its sessions end at once, saying phase 5 is next.
- **Hiring:** a manual hire and let-go moved to `server/team/workers.ts`, for both modes. Phase 6 adds autospawning.
- **Questions to the manager** (new, not in cubefarm): `server/pipeline/questions.ts`, with the fake GitHub's comments and a vague seeded issue in the demo.

| Marshmallow | cubefarm | Verdict | Notes |
| --- | --- | --- | --- |
| `server/github/github.ts` | `server/github.ts` | Copy | All through `gh`, including `uploadEvidence` (the orphan branch). |
| `server/machines/machines.ts` | `server/machines.ts` | Copy | The `MachineProvider` interface and `machineName`. |
| `server/machines/local.ts` (+ a workspace helper) | `server/workspace.ts` (909 lines) | Adapt | **Keep:** `ensureClone`, `mainDir`, the machine functions (`machineDesk`, `prepareMachineDesk`, `machineTmp`, `releaseMachine`, `sweepMachine`, `removeMachine`, `listMachines`), the leftover patches, the git lock per clone. **Drop:** desks from before machines, preview worktrees, and unless checked: `setLocalPath` / `scanProjects` / `publishFolder` / `createProject`, `syncMain`, `trimMachineDesk`. |
| `server/machines/deps.ts` | `server/deps.ts` | Copy | `npm ci` in a desk unless nothing changed. |
| `server/machines/deskSetup.ts` | `server/deskSetup.ts` | Copy | |

## Phase 5: Claude sessions

**Done.** Things that differ from cubefarm:
- **Claude Code only:** `clis.ts` and `cliRunner.ts` lost the Codex and OpenCode branches, the Box branches (phase 7 brings them back) and the keepers. `claudeCommand()` runs the Claude Code the Agent SDK bundles, so the hooks match the version the office was written against.
- **Local models** (new): `modelEnv` gives a worker on `ollama/<name>` the server's `ANTHROPIC_BASE_URL`, a dummy `ANTHROPIC_AUTH_TOKEN`, an empty `ANTHROPIC_API_KEY`, and the local name for every model Claude Code reaches for (main, the haiku/sonnet/opus defaults and subagents). `launchArgs` asks for the local name and leaves out `--effort`. The status line's cost and limits are ignored for local models: Claude Code prices a model it doesn't know as if it were Claude's.
- **No inherited MCP servers:** cubefarm layers the office's servers on top of the manager's own; Marshmallow adds `--strict-mcp-config`, so a worker that approves its own tool calls never reaches the manager's servers or claude.ai connectors. The manager's settings, skills and plugins still load.
- **Format helpers** live in `server/sessions/format.ts`, not in a runner file.
- **Terminals:** `server/sessions/terminals.ts` keeps one `WorkerTerminal` per worker, saves the dirty ones every 10 s to `<home>/terminals/<id>.ansi`, and serves `/ws/term?worker=<id>`. The demo writes its scripted sessions into the same terminal.
- **Settings:** `server/settings.ts` validates `PATCH /api/settings`; a worker's model and effort go through `PATCH /api/workers/:id`. The debug page has a default-model field, a model field per worker and a terminal per worker.
- **Desk setup:** `server/machines/deskSetup.ts` was copied with its test. Preparing a desk closes the worker's CLI waiting at its prompt first, since Windows can't clear a folder that a process has as its working directory.
- **Verified** on the sandbox: issue #3 went build → QA → merge on `ollama/gpt-oss:20b` (PR #5), and issue #1 on Opus 5.5 (PR #6), with the Phase 4 answer in its prompt.

| Marshmallow | cubefarm | Verdict | Notes |
| --- | --- | --- | --- |
| `server/sessions/session.ts` | `server/agentRunner.ts`: the types at the top (`SessionOptions`, `LogEntry`, `SessionResult`, `SessionCallbacks`, `SessionHandle`) and its helpers (`describeTool`, `summariseResult`, `tidyPaths`, `todoLines`, `resultText`, `screenshotFile`, `newScreenshots`, `clip`) | Adapt | Leave the `box` and `office` fields until phases 6 and 7 need them. |
| `server/sessions/cliRunner.ts` | `server/cliRunner.ts` (983 lines) | Adapt | Claude only. **Keep:** the hook route (`handleHook`); the session files (settings with HTTP hooks and the status line, `mcp.json`, `instructions.md`); env stripping; `hook()`; the 3 s finish grace; `keepAlive` / `waitAtPrompt`; resume; folder-trust answering; Esc as interrupt. **Cut:** the Codex and OpenCode branches. Keep the Box branches for phase 7, and the keeper branches only if checked. |
| `server/sessions/clis.ts` | `server/clis.ts` | Adapt | `commandFor('claude')` (the SDK's bundled Claude Code), the `claude` case of `launchArgs`, `CROSS_TURN_TOOLS`, `trustKey`, `interruptions`, `signedOutScreen`, `STATUSLINE_SOURCE`. Cut Codex and OpenCode, with their local-model wiring (`localServerUrl` and the `--oss` paths). Claude Code on Ollama is new: a few environment variables the runner sets (BUILD-PLAN phase 5). |
| `server/sessions/terminal.ts` | `server/terminal.ts` | Copy | |
| `server/sessions/browser.ts` | `server/browser.ts` | Copy | The pinned `@playwright/mcp`, run from `node_modules`. |
| `server/sessions/agentRunner.ts` | `server/agentRunner.ts` `startSession` | Skip | Unless "Agent SDK runtime" gets checked. |
| `client/src/ui/LiveTerminal.tsx` | same | Adapt | xterm.js on `/ws/term`. |

## Phase 6: workers and autospawning

**Done.** Things that differ from cubefarm:
- **Rules first:** `server/team/autoscale.ts` keeps `scalePlan` and `floorCapacity`, and adds `rulesSize`: one worker per 3 things to do (tasks under way, ready issues, waiting PRs), growing at once and shrinking only by workers idle 10 minutes (1 in the demo) while nothing waits. cubefarm has no rules sizer, only its CEO.
- **No approval:** without request records, a busy worker asked to leave carries `leaving`, gets no new work, and goes when their task ends (`Team.applyLeaving`, at each scheduler tick). A floor keeps its last worker.
- **Held sizes:** `Floor.teamSize` is the size the CEO's `scale_team` or the manager set; the rules leave such a floor alone until `PATCH /api/floors/:floor {teamSize: null}`. Hiring or letting go by hand holds the floor too.
- **The CEO** (`server/team/ceo/`): `prompts.ts` is about half of cubefarm's (no triage, notes, previews, approval or heartbeat); `issueRules.ts` keeps `IssueCap`, `planDependencies` and `checkCloseIssue`; `tools.ts` serves nine tools, `ask_manager` new; `office.ts` implements them; `jobs.ts` queues onboard, plan and chat, one at a time, chat first. The queue isn't saved: at start the CEO onboards the floors it has no profile of. A message during a job waits for the next chat instead of being injected.
- **Transport:** `POST /api/mcp/:token`, stateless Streamable HTTP with a fresh server per request (`handleMcp` in `cliRunner.ts`). With `--strict-mcp-config`, the CEO's CLI sees only the office's server.
- **The CEO can't edit:** Edit and Write join Bash, PowerShell and NotebookEdit in its disallowed tools; it reads the floors' clones through `--add-dir`.
- **Demo:** the scripted CEO in `demoSessions.ts` calls the real handlers, picking its script from `SessionOptions.ceoJob`, not from the prompt's wording.

| Marshmallow | cubefarm | Verdict | Notes |
| --- | --- | --- | --- |
| `server/team/workers.ts` | `swarm.ts`: agents section (~l.2122): `hireAgent`, `fireAgent`, `updateAgent`, `stopAgent`, `resetAgent`, `freeName`, `ensureAgent`; `NAMES` (~l.289); team changes section (~l.5098) | Rewrite | |
| `server/team/autoscale.ts` | `server/ceo.ts`: `scalePlan`, `floorCapacity`, `plannedSize` | Adapt | Pure team-size arithmetic; the rules version builds on it. |
| `server/team/ceo/tools.ts` | `server/ceo.ts`: `createOfficeTools` | Adapt | **Keep:** `company_status`, `agent_detail`, `set_floor_profile` (without the preview fields unless checked), `scale_team`, `configure_agent`, `file_issue`, `set_dependencies`, `close_issue`. The triage tools only if checked. |
| `server/team/ceo/prompts.ts` | `server/ceo.ts`: `ceoSystemPrompt`, `ceoJobPrompt`, `jobLabel`, `askedFor`, `NOT_ASKED`, `IssueCap` | Adapt | |
| `server/team/ceo/jobs.ts` | `swarm.ts`: the CEO section (~l.4186: `enqueueCeo`, `startCeoWork`, `runCeoJob`, `onCeoFinished`, `messageCeo`, `planFloor`) and the office tools section (~l.5326) | Rewrite | |
| `server/team/triage.ts` | `server/triage.ts` and `swarm.ts` triage section (~l.4480) | Skip | Unless "CEO triages stuck PRs" gets checked. |

## Phase 7: the Upstash Box option

**Done** (on a fake Upstash account; the real run waits for a key). Things that differ from cubefarm:
- **Claude Code only:** Codex, OpenCode, linked repos, `trimDesk` and the notify and Codex hook programs are cut. Box names are `marshmallow-<office>-<machine>`, labels `marshmallow`, `mm:<office>`, `m:<machine>`; tmux sockets `mm-…`; markers `MARSHMALLOW_*`; the launcher's exit event `MarshmallowExit`.
- **The seam:** `Backend.cloud: CloudBackend` (real: Upstash, `gh auth token`, git identity, the runner's reconnect, detach and sign-in; demo: `server/backend/demoCloud.ts`, a fake account whose Boxes note each desk's branch so the demo's fake sessions open PRs, and a fake sign-in drawn in the worker's terminal).
- **`server/team/cloud.ts`** replaces swarm.ts's cloud sections: where hires work (a Box only with a key, room under the plan's limit, and a model that isn't local), bring-up, moving, the Box a session runs in, signing in, pausing idle Boxes (any free Box worker idle 5 minutes with no CLI left), and the restart pick-up. A sign-in that's needed gives the work back instead of failing it.
- **Restarts:** a Box worker's live CLI record is saved server-only (`SavedState.boxClis`). At start the office reconnects (`reconnectBoxClis`), `Pipeline.reattach` puts each busy one back on its task's session (`Build`, `Qa` and `Fix` each have a `reattach`), and only then does `hooksReady()` let the events in. Full restart reconciliation for local workers stays in phase 8.
- **Shutdown** detaches Box CLIs instead of killing them, before the last save.
- **Tested:** the ported script, helper, CLI-events, machines and cloud tests; the demo scenarios (`server/team/cloud.test.ts`); and the done-when on the real runner with a fake Box (`server/team/cloudRestart.test.ts`: still running, finished and exited, gone mid-turn).

| Marshmallow | cubefarm | Verdict | Notes |
| --- | --- | --- | --- |
| `server/machines/box/box.ts` | `server/box.ts` | Copy | The only importer of `@upstash/box`. |
| `server/machines/box/boxMachines.ts` | `server/boxMachines.ts` | Adapt | Box names and labels: `cubefarm-<office>-<machine>` → `marshmallow-…`. |
| `server/machines/box/boxScripts.ts` | `server/boxScripts.ts` | Adapt | Pure and tested. Paths `~/.cubefarm` → `~/.marshmallow`; drop Codex from `setupScript` unless checked. |
| `server/machines/box/boxHelpers.ts` | `server/boxHelpers.ts` | Adapt | Drop the Codex notify and hook programs. |
| `server/sessions/boxCli.ts` | `server/boxCli.ts` | Copy | `BoxPty`, `EventLines`, the events-file offsets. |
| `server/cloud.ts`, `server/secrets.ts` | same | Adapt | Credential resolution and `secrets.json`; drop the ElevenLabs and webhook secrets. |
| cloud wiring | `swarm.ts` cloud sections (~l.2198–2500): `hostFor`, `bringUpBox`, `moveAgent`, `boxTarget`, and the sign-in flow (`holdForSignIn`, `startSignIn`, `pollSignIn`, `checkSignIn`, `signedOutMidTask`) | Rewrite | |
| Settings → Cloud | `client/src/ui/CloudSettings.tsx` | Adapt | |

## Phase 8: hardening

| Marshmallow | cubefarm | Verdict | Notes |
| --- | --- | --- | --- |
| `server/recovery/` | `reconcile.ts`, `restartRecovery.ts`, `qaOrphans.ts` | Copy | Pure and tested. Their wiring (`swarm.ts` `init`, `reconcileRestart`, `finishRestart`, `recover`, ~l.681–1008): Rewrite. |
| `server/pipeline/closeCleanup.ts` | `server/closeCleanup.ts`; `swarm.ts` closed issues section (~l.1956) | Copy + Rewrite | The rules copy over; the wiring is new. |
| `server/watchdog.ts` | `server/watchdog.ts`; `swarm.ts` watchdog section (~l.4689) | Copy + Rewrite | The office doctor's UI only if checked. |
| `server/sessions/pty*.ts` | `ptyHost.ts`, `ptyClient.ts`, `ptyProtocol.ts` | Copy | Only if "terminal keeper" gets checked. |

**Done.** Things that differ from cubefarm:
- **Where things went:** the pure rules in `server/recovery/` (`reconcile.ts`, `restartRecovery.ts`, `qaOrphans.ts`, `watchdog.ts`) and `server/pipeline/rules/closeCleanup.ts`, with their tests; the wiring in `server/pipeline/restart.ts`, `closures.ts` and `watch.ts`. `reconcile.ts` drops `sessionStart` (nothing restores a missing desk before a session).
- **Giving work up:** `context.ts` `giveUp` replaces `stopForClosure`, `dropTask` and `abandoned`: a worker in a session or setting up a desk (`ctx.preparing`, from `beginTask` until `prepared`) is stopped, and cleared only once that has ended (`settle`, from `afterSession` and `prepared`), so a late desk set-up can't run on into their next task. The manager's reset, the watchdog's requeue and closures all use it; `handBack` puts a QA run or fix back in its PR's queue first. A desk set-up that gives up only gives its PR back if the PR is still theirs.
- **Restarts:** `Pipeline.restart` runs once at start, before the scheduler and before Box events come in (`hooksReady`), and does all of cubefarm's `reconcileRestart` and `finishRestart` in one go, without waiting for a sync (it needs only GitHub's answers about each task). Shutdown calls `Pipeline.close` first, so sessions ending with the office change nothing and the saved state still shows who was on what. Resumes count against the session limit; any over it start over from the queue. A Box worker whose CLI is gone resumes in their Box (`desk.ts` `resumeBox`).
- **Closing:** a closed PR's issues are held in `Floor.held` (saved with the floor) until the manager's "Build again" (`DELETE /api/floors/:floor/held/:n`) or the issue closes. The CEO's `close_issue` and a task that finds its issue or PR closed tell `Closures` at once; a sync's asks catch the rest. PR previews and the ledger are cut.
- **The watchdog:** automatic remedies only, every minute (`WATCHDOG_INTERVAL_MS`). The office doctor (findings, buttons, the "unclosed issue" check) is unchecked and cut; an item remedied within the hour is left alone. A quiet worker with no session to nudge goes straight back in line. A nudge is typed in as "▶ Office:".

## Not ported for now (unchecked in FEATURES.md)

| cubefarm | Feature |
| --- | --- |
| `server/journal.ts`, `journalSample.ts`, `client/src/replay.ts` | time-lapse |
| `server/ledger.ts` | coins, decorations, achievements, careers |
| `server/voice.ts`, `elevenlabs.ts` | voice |
| `server/notifier.ts`, `notify.ts`, `webPush.ts`, `pwa.ts` | notifications, the installable app |
| `server/presence.ts`, `demoVisitors.ts` | shared presence |
| `server/weather.ts` | weather |
| `server/ticker.ts` | the activity ticker |
| `server/previews.ts`, `previewRunner.ts`, `previewGateway.ts`, `prTheatre.ts`, `syncProxy.ts`, `qaShots.ts` | floor previews and the PR theatre |
| `server/metrics.ts`, `issueAges.ts` | mission control |
| `server/officeUpdate.ts`, `scripts/office.mjs`, `scripts/officeSteps.mjs` | the self-updating launcher |
| `server/deskTrim.ts` | freeing disk on idle desks |
| `client/src/pocket/` | mobile |
| `client/src/world/events/` | world events |

When a box in FEATURES.md gets checked, move its row into the phase that needs it.

## The game (after phase 8)

Each game item in FEATURES.md sections 7 to 11 names its cubefarm source. The world's code is mostly pure modules (rules, layouts, state machines, each with a test) drawn by thin React components: port the pure module first, then its component. The game reads the client-side world model from BUILD-PLAN's "Then: game states", never the server directly.
