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
| `server/backend/demo.ts` | `server/demo.ts` (1,645 lines) | Rewrite | Much smaller: an in-memory GitHub, fake sessions that write into the terminal and open a PR, random QA verdicts, a fake `BoxApi`. |

## Phase 3: scheduler and pipeline

| Marshmallow | cubefarm | Verdict | Notes |
| --- | --- | --- | --- |
| `shared/issues.ts` | `shared/issues.ts` | Copy | `blockers`, `holdUps`, `setDependsOn`, `waitsMessage`. |
| `server/pipeline/rules/` | `handOut.ts`, `qaOutcome.ts`, `qaRetry.ts`, `fixOutcome.ts`, `mergeGate.ts`, `prOwnership.ts`, `sendBack.ts`, `issueClaims.ts` | Copy | Pure, each with a test. Port in dependency order: `mergeGate` → `qaOutcome` → `fixOutcome` → `prOwnership`. `sendBack` needs `httpError`. |
| `server/pipeline/pacing.ts` | `server/pacing.ts`, `shared/usage.ts` | Copy | A usage warning means pacing; the limit means a pause. |
| `server/pipeline/scheduler.ts` | `swarm.ts` scheduling section (~l.3775): `isFree`, `available`, `readyIssues`, `startPipelineWork`, `startIssueWork`, `schedule`, `issueFailed`, `mayStart`, `pauseForLimit`, `paceForWarning` | Rewrite | Keep: finishing beats starting, floors take turns, the session limit. |
| `server/pipeline/build.ts` | `swarm.ts` (~l.2645–3165): `assign`, `beginTask`, `prepare`, `runTask`, `startAgentSession`, `launchSession`, `onFinished`, `onIssueFinished`, `noPullRequest`, `releaseIssue` | Rewrite | |
| `server/pipeline/qa.ts` | `swarm.ts`: `QA_SCHEMA` and `parseReport` (~l.404), `queueQa`, `runQa`, `onQaFinished`, `renderQaComment` (~l.3166–3505). `server/qaPrompt.ts`: Adapt. | Rewrite | Drop the mission-control and ledger calls unless checked. |
| `server/pipeline/fix.ts` | `swarm.ts`: `runFix`, `onFixFinished`, `unpushed`, `prHead` (~l.3507–3680) | Rewrite | |
| `server/pipeline/merge.ts` | `swarm.ts` auto-merge section (~l.1552): `advanceMerges`, `advanceMerge`, `closeResolvedIssues`, `sendBack` | Rewrite | Only `mm/` branches merge themselves, and only at `passedSha`. |
| `server/prompts/` | `server/prompts.ts` | Adapt | `devSystemPrompt`, `qaSystemPrompt`, `ONE_TURN`, `noPushNudge`, `ownPrLine`, `failedLogLines`, the branch names. "cubefarm" → "Marshmallow". |

## Phase 4: real GitHub and local machines

| Marshmallow | cubefarm | Verdict | Notes |
| --- | --- | --- | --- |
| `server/github/github.ts` | `server/github.ts` | Copy | All through `gh`, including `uploadEvidence` (the orphan branch). |
| `server/machines/machines.ts` | `server/machines.ts` | Copy | The `MachineProvider` interface and `machineName`. |
| `server/machines/local.ts` (+ a workspace helper) | `server/workspace.ts` (909 lines) | Adapt | **Keep:** `ensureClone`, `mainDir`, the machine functions (`machineDesk`, `prepareMachineDesk`, `machineTmp`, `releaseMachine`, `sweepMachine`, `removeMachine`, `listMachines`), the leftover patches, the git lock per clone. **Drop:** desks from before machines, preview worktrees, and unless checked: `setLocalPath` / `scanProjects` / `publishFolder` / `createProject`, `syncMain`, `trimMachineDesk`. |
| `server/machines/deps.ts` | `server/deps.ts` | Copy | `npm ci` in a desk unless nothing changed. |
| `server/machines/deskSetup.ts` | `server/deskSetup.ts` | Copy | |

## Phase 5: Claude sessions

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

| Marshmallow | cubefarm | Verdict | Notes |
| --- | --- | --- | --- |
| `server/team/workers.ts` | `swarm.ts`: agents section (~l.2122): `hireAgent`, `fireAgent`, `updateAgent`, `stopAgent`, `resetAgent`, `freeName`, `ensureAgent`; `NAMES` (~l.289); team changes section (~l.5098) | Rewrite | |
| `server/team/autoscale.ts` | `server/ceo.ts`: `scalePlan`, `floorCapacity`, `plannedSize` | Adapt | Pure team-size arithmetic; the rules version builds on it. |
| `server/team/ceo/tools.ts` | `server/ceo.ts`: `createOfficeTools` | Adapt | **Keep:** `company_status`, `agent_detail`, `set_floor_profile` (without the preview fields unless checked), `scale_team`, `configure_agent`, `file_issue`, `set_dependencies`, `close_issue`. The triage tools only if checked. |
| `server/team/ceo/prompts.ts` | `server/ceo.ts`: `ceoSystemPrompt`, `ceoJobPrompt`, `jobLabel`, `askedFor`, `NOT_ASKED`, `IssueCap` | Adapt | |
| `server/team/ceo/jobs.ts` | `swarm.ts`: the CEO section (~l.4186: `enqueueCeo`, `startCeoWork`, `runCeoJob`, `onCeoFinished`, `messageCeo`, `planFloor`) and the office tools section (~l.5326) | Rewrite | |
| `server/team/triage.ts` | `server/triage.ts` and `swarm.ts` triage section (~l.4480) | Skip | Unless "CEO triages stuck PRs" gets checked. |

## Phase 7: the Upstash Box option

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
