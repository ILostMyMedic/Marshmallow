# Marshmallow: where to start

The goal before any game work: a service that turns a GitHub issue into a merged pull request. It runs in demo mode first and on real repos after, with a plain debug page to watch it. The game sits on top of the service's event stream later, so the foundation's job is to report every worker's status, activity and comings and goings accurately.

Every phase ends in something you can run. Scope follows [FEATURES.md](FEATURES.md); the cubefarm files named here are in `D:\Projects\cubefarm-main`.

**Repos:**
- **The code:** Marshmallow's own code lives in [Mallowy-tv/TheMarshmallow](https://github.com/Mallowy-tv/TheMarshmallow) (private).
- **Testing:** phases 4 and 5 test real work on a throwaway sandbox repo (for example `Mallowy-tv/marshmallow-sandbox`).
- **Later:** TheMarshmallow becomes a floor (Marshmallow building itself) only once the pipeline has proven itself there.

## Approach: a fresh repo, ported module by module

Don't fork cubefarm. Its `server/swarm.ts` is one 5,500-line class that mixes the pipeline with coins, the journal, voice, previews and the office's self-update. Pulling the pipeline out while porting is easier than deleting around it. Most of the decision logic is already in small pure files you can copy almost as they are.

cubefarm is MIT-licensed: keep its copyright notice in a `NOTICE` file for the code you port.

## Layout

```
marshmallow/
  server/
    index.ts            REST routes, /ws, /ws/term, serves the client build
    config.ts           MARSHMALLOW_HOME, MARSHMALLOW_PORT, host, --demo
    exec.ts             execFile without a shell
    store.ts            state, atomic saves, broadcast
    backend/            backend.ts (the interface), real.ts, demo.ts
    github/             github.ts (the gh CLI)
    machines/           machines.ts (the interface), local.ts, box/ (later)
    sessions/           session.ts (the contract), cliRunner.ts, clis.ts, terminal.ts
    pipeline/           scheduler.ts, build.ts, qa.ts, fix.ts, merge.ts, plus pure rule files
    team/               workers.ts (hire, fire), autoscale.ts, ceo/ (tools, prompts)
    prompts/            what workers are told for each task
  shared/               types.ts (the contract), issues.ts
  client/
    src/                store.ts, net.ts, debug/ first; world/ when the game starts
```

## Phase 0: skeleton

1. `package.json` (`"type": "module"`), strict `tsconfig`, `tsx`, Vitest, Vite with React.
2. `config.ts`:
   - `MARSHMALLOW_HOME` (default `~/.marshmallow`)
   - `MARSHMALLOW_PORT` (default 4600, clear of cubefarm's 4317/5317)
   - host 127.0.0.1
   - `--demo`
3. Express and ws: `GET /api/state`; `/ws` sends `{ type: 'snapshot' }` on connect.
4. Port `exec.ts` and `httpError.ts` as they are.
5. CI on Ubuntu and Windows: typecheck, test, build.

**Done when:** `npm run dev -- --demo` prints `DEMO MODE` with its state path, and the page shows an empty snapshot.

## Phase 1: contract, state, debug page

1. `shared/types.ts`: `Floor`, `Worker`, `Task`, `QaRecord`, `Settings`, `Snapshot`, and the `ServerEvent` union.
   - Put the fields the game will need in from day one:
     - a worker's `status`
     - their `activity` (reading, editing, testing, browsing, git…)
     - `idleSince`
     - a stable `seed` for their look
   - Add lifecycle events: `hired`, `left`, `issuesFiled`, `prOpened`, `qaPassed`, `qaFailed`, `merged`.
   - Models are named after their server: `ollama/<name>` runs on Ollama, any other name is Claude's (port the naming from cubefarm's `shared/models.ts`; the server list starts with Ollama alone).
2. `store.ts`: load and save `state.json` (temp file + rename); broadcast each change.
3. Client: a zustand store whose `apply(event)` folds events in; `net.ts` with reconnect.
4. Debug page: floors → workers (status, task, last log line), the queue, QA records. It stays on as the admin view.

**Done when:** a change made through a test route shows up on the page live.

## Phase 2: the Backend seam and the demo

1. `backend.ts`: one interface for GitHub calls, workspace and machine calls, and `startSession`. Port the shape of cubefarm's `server/backend.ts`, minus voice, weather, previews and notifications.
2. `demo.ts`:
   - an in-memory GitHub (issues, PRs, checks)
   - fake sessions that print log lines, report tool calls and open a PR after about 20 seconds
   - QA that passes or fails at random

**Done when:** the pipeline in phase 3 runs end to end against it with no network.

## Phase 3: scheduler and pipeline, on the demo

1. Pure rules with their tests, ported from cubefarm:
   - `shared/issues.ts`: dependencies and ordering
   - `handOut.ts`: who tests, who fixes
   - `qaOutcome.ts`, `qaRetry.ts`, `fixOutcome.ts`, `mergeGate.ts`, `pacing.ts`
2. `scheduler.ts`: a tick; finishing beats starting; the session limit; floors take turns. See `schedule()` and `startPipelineWork()` in cubefarm's `swarm.ts`.
3. The task flow:
   - build an issue → find its PR → queue QA
   - QA in a fresh session → post the report
   - fix loop → merge gate → merge
4. Usage pacing and the pause at the limit.

**Done when:** a demo floor with 5 issues ends with 5 merged PRs, including at least one QA fail and its fix.

## Phase 4: real GitHub and local machines

1. `github.ts` over the `gh` CLI (port it).
2. The floor's clone, plus the local `MachineProvider` per worker:
   - a clone that borrows the floor's objects
   - a worktree on `mm/issue-<n>-<name>`
   - a temp folder and a dev-server port
3. Sweeps: delete finished branches; save unpushed work as patches.
4. Questions to you, on GitHub and in the demo's fake GitHub:
   - Asking: the office posts the 🤖 question as a comment on the issue, adds `mm:needs-answer`, and frees the issue. The scheduler skips labelled issues.
   - Answering: a later comment without the office's marker is the answer. The office's comments carry a hidden `<!-- marshmallow -->` marker, since they're posted as you too.
   - Back to work: the sync removes the label, and the next build's prompt includes the question and your answer.
   - The office's own record of open questions, sent to the debug page (the phone later).

**Done when:** connecting the sandbox repo clones it, a worker's desk gets set up on its branch, and a question asked on one of its issues comes back answered.

## Phase 5: Claude sessions

1. The session contract: `SessionOptions` → callbacks (`log`, `tool`, `screenshot`, `finished`) → `send` / `stop`. Port the types at the top of cubefarm's `agentRunner.ts`.
2. `cliRunner.ts`, Claude Code only (cut the Codex and OpenCode branches):
   - spawn the CLI in node-pty with `--settings` hooks that POST to `/api/hooks/:token`
   - `PreToolUse` answers allow
   - `Stop` plus a 3-second grace means finished
   - the status line reports cost and usage
   - strip `ANTHROPIC_*` / `CLAUDE_*` from its environment
3. Local models: a worker on `ollama/<name>` gets, after the stripping:
   - `ANTHROPIC_BASE_URL` set to the Ollama server (`http://127.0.0.1:11434`; `MARSHMALLOW_OLLAMA_URL` overrides it)
   - `ANTHROPIC_AUTH_TOKEN=ollama` and an empty `ANTHROPIC_API_KEY`
   - `--model <name>`

   Ollama reports no usage limits and no cost, so pacing leaves these workers alone. Local machines only: a Box can't reach your computer.
4. `terminal.ts`: a headless xterm mirror per worker with saved scrollback, viewed over `/ws/term`; an xterm.js panel on the debug page.
5. `prompts/`: the build, QA and fix prompts (ported in phase 3), with QA answering through a JSON schema. Since phase 4, the build prompt says that an issue too unclear to build ends with a line starting `QUESTION FOR THE MANAGER:`. Phase 5 makes sure real sessions do it.
6. The Playwright MCP for browser testing.

**Done when:** one real issue on the sandbox repo goes build → QA → merge on a local Ollama model, then once more on your subscription.

## Phase 6: workers and autospawning

1. Hire and fire workers, with a names pool and a seed per worker (the game draws their look from it).
2. Autoscale:
   - The rules version first: free and testable.
   - Then the CEO: a Claude session with office tools over MCP (`company_status`, `worker_detail`, `set_floor_profile`, `scale_team`, `configure_worker`, `file_issue`, `set_dependencies`, `close_issue`, and `ask_manager` for when the brief or the backlog leaves it unsure what to build) and its job queue (onboard, plan, chat). See cubefarm's `server/ceo.ts`.
3. Team changes apply at once, within the floor's max (approval is unchecked in FEATURES.md). The rules size every floor nobody holds at a size; a size the CEO or the manager sets holds until the floor is handed back to the rules.

**Done when:** a backlog of 8 issues grows a floor from 1 worker to 3, and it shrinks back once they sit idle.

## Phase 7: the Upstash Box option

1. Wrap `@upstash/box` behind a `BoxApi` interface, with a fake in the demo (port `box.ts`).
2. A Box `MachineProvider`: create, set up, prepare a desk, pause, remove (`boxMachines.ts`, `boxScripts.ts`).
3. `BoxPty`: the CLI under tmux; its `events.jsonl` read from a saved byte offset; reattach after drops (`boxCli.ts`, `boxHelpers.ts`).
4. Credentials:
   - keys in `secrets.json`, never in the state file
   - passed only as one command's environment
   - sign-in run in the worker's terminal (`cloud.ts`)

**Done when:** a worker set to "Box" starts an issue, you stop the server mid-task and start it again, and the server catches up with the PR the worker opened meanwhile. (Proven on a fake Upstash account in `server/team/cloudRestart.test.ts`; the real run waits for an Upstash key.)

## Phase 8: hardening

1. Restart reconciliation: what was running, and whether to resume or requeue it (`reconcile.ts`, `restartRecovery.ts`).
2. Closing cleanup, and a watchdog for stuck sessions (`closeCleanup.ts`, `watchdog.ts`).
3. The terminal keeper, if checked (`ptyHost.ts`, `ptyClient.ts`). (Unchecked, so not built: local workers' CLIs stop with the office, and their sessions resume after it.)

**Done** (`server/pipeline/hardening.test.ts`): an office killed mid-task starts again and picks up where it left off; closing an issue or PR stops whoever works on it; a quiet session is nudged, then put back in line.

## The game

The server sends everything the game needs. The game has a client-side **world model** (`client/src/world/model.ts`, pure and tested): each worker's game state, derived from server events and local timers:

- at their desk working
- idle
- on an errand
- celebrating
- arriving or leaving

The 3D scene, faces, speech bubbles and idle activities all read that model, so none of them talks to the server directly. The view is cubefarm's: you're inside one floor (one repo) at a time, and the city and the rest of the tower are seen through its windows. Each phase ports a slice of cubefarm's `client/src/world/` (docs/porting-map.md), pure modules first with their tests.

## Phase 9: the floor and its people

1. React Three Fiber, toon materials and ink outlines (`materials.ts`, `Outlines.tsx`, `Toon.tsx`); the floor and desk layout (`layout.ts`).
2. The world model, with working, idle and celebrating for now.
3. The canvas and the overview camera, looking down into the floor with its near walls cut away (`Game.tsx`, `cameraMath.ts`, `rig.ts`), with adaptive resolution (`perf.tsx`, `dprControl.ts`).
4. The building: the floor's room, the floors above and below as balconies and facade, and a few blocks of city outside (`Shell.tsx`, `Outside.tsx`, `cityLayout.ts`). A floor picker switches repos; the lobby holds the CEO.
5. Workers: seeded looks (`appearance.ts`, `characterParts.ts`, `Figure.tsx`), seated at their desks, typing while they work, faces that follow their state (`face.ts`, `typing.ts`, `Character.tsx`), and activity signs over their heads.
6. Desks with live monitors drawn from each worker's log, and name tags (`Desk.tsx`, `draw.ts`).
7. The game becomes the main page; the debug page moves to `/debug`.

**Done when:** `npm run dev -- --demo` opens on a floor of the demo office: each hired worker sits at a desk, types while their session runs (their monitor scrolling their log), looks pleased when their PR opens, and the floor picker moves between repos and the lobby. (Done: seen in a browser on the demo; the cheer is covered by `client/src/world/model.test.ts`.)

## Phase 10: the player and the room

1. You have a body: first-person walking (WASD, mouse look, collisions) on every floor and out on the balconies, and Tab between first person and the overview (`Player.tsx`, `rig.ts`).
2. The room as cubefarm furnishes it: the whiteboard Kanban on the north wall with the floor's live issues and PRs, the kitchenette with the coffee machine and fridge, the couch corner, the water cooler, the wall clock, and a ping-pong table.
3. `E` to use: a desk opens its worker's terminal, the whiteboard the floor's board (`interact.ts`).

**Done when:** in the demo you walk round a floor in first person, can't walk through walls or furniture, see the board fill and empty as issues are built and merged, and open a worker's terminal with `E`. (Done: seen in a browser on the demo; collisions and doors are tested in `layout.test.ts` and `doors.test.ts`.)

## Phase 11: idle life

Workers get up: walking (walk grid, paths, named spots), the errand system, coffee runs, fridge snacks, stretches, chats and desk visits, fidgets, naps after a long idle, stand-ups at the whiteboard when new issues land, lunch, ping-pong between idle workers, speech bubbles about real work, the merge celebration, and arrivals by elevator and leavers carrying a box.

**Done when:** in the demo, idle workers wander off for coffee, chat, nap and play ping-pong, come back to their desks for the next task, and cheer a merge. (Done: seen in a browser on the demo, from hires arriving by elevator through a stand-up, builds, QA and merges to gong runs, coffee, snacks, chats, a ping-pong game and a leaver with a box; the rules are tested in `client/src/world/*.test.ts`.)

## Phase 12: you in the office

1. Your own character: a body you see when you look down, holding what you carry, and all of you in the overview (`Me.tsx`), in a look you pick in an editor with a live preview (`myLook.ts`, `ui/LookPanel.tsx`).
2. What E does grows from opening panels to acting in the room (`view.ts` actions and what you hold, `actions.ts`).
3. Say hi to an idle worker: they answer about their work and wave back.
4. Coffee and snacks: take a mug, brew it at the machine and sip it; grab a snack from the fridge.
5. Ride the elevator: its doors open as you come near, you choose a floor in the cabin, and arrive in the cabin on that floor.
6. Ping-pong against a worker: pick up a paddle, and a free worker comes to play you.

**Done when:** in the demo you pick your look, see your body in first person and yourself in the overview, say hi to a worker, make a coffee and drink it, eat a snack, ride the elevator to another floor, and play a game of ping-pong against a worker. (Done: seen in a browser on the demo, every step of it; the new rules are tested in `myLook.test.ts`, `elevatorRide.test.ts`, `sip.test.ts`, `chatterEvents.test.ts` and the pong tests.)

## Phase 13: the building and the city

1. The building's floors: the lobby at the bottom, a floor per repo, the CEO's floor above them and the roof terrace on top, in the elevator and the floor picker (`floors.ts`).
2. The lobby as an entrance: a front desk with a guide who gives you a tour of the floors and their projects, today's status, a floor directory and a trophy cabinet (`Lobby.tsx`, `tour.ts`).
3. The CEO's floor: an executive office with its own desk and chair, where the CEO works; now and then the CEO rides down and walks a floor (`CeoFloor.tsx`, the rituals).
4. The roof terrace: lookouts over the city, billboards, a fireplace, deck chairs and a garden; idle workers come up for a break (`roof/`).
5. The city: skyscrapers downtown, billboards on rooftops, a red suspension bridge in the distance (`cityLayout.ts`, `Billboards.tsx`, `Bridge.tsx`).
6. World events: planes, blimps and the odd surprise in the sky; free workers go to the windows to watch (`events/`).
7. Third person: on foot V switches from your eyes to a camera that follows behind you, and back (`Player.tsx`).

**Done when:** in the demo you step out into a lobby with a front desk, take the guide's tour of the floors, ride up to the CEO's office and the roof terrace, see workers come up to the roof on a break, see the CEO walk a floor, and watch a plane or a blimp go by over a skyline with skyscrapers and a bridge. (Done: seen in a browser on the demo: the tour end to end, the CEO's walk on floor 1 and their office, the roof's fire pit, deck and lookouts, a blimp, a UFO, a plane and skywriting, with the workers going to the windows; the new rules are tested in `floors.test.ts`, `tour.test.ts`, `ceoWalk.test.ts`, the `roof/` tests, `cityLayout.test.ts`, `bridgeLayout.test.ts`, `billboardLayout.test.ts`, `haze.test.ts` and the `events/` tests.)

## Phase 14: the day and the senses

The day/night clock (lunch and going home need it), synthesized sound effects, and the overview camera's click-a-worker.

## Phase 15: the manager UI

The setup wizard, the manager console, the worker panel (live terminal, message box, setup), the 2D Kanban, the phone overlay, toasts and the help screen.

## Watch out for

- **node-pty on Windows:** use the prebuilt `@lydell/node-pty`, as cubefarm does, so nobody needs build tools.
- **Claude Code version:** run the copy bundled with `@anthropic-ai/claude-agent-sdk`, so the hook and settings formats match what you coded against.
- **Ollama:**
  - Claude Code needs a long context, and Ollama's docs ask for 64K or more. Ollama's default is shorter, so set `OLLAMA_CONTEXT_LENGTH`.
  - Pick a model that's good at tool calls.
  - Claude Code's background calls ask for Haiku by name. Check in phase 5 whether `ANTHROPIC_DEFAULT_HAIKU_MODEL` must point at the local model too.
  - Expect more QA fails than on Claude. That's useful for exercising the fix loop, but says nothing about quality.
- **Workers are unsandboxed:** test on throwaway repos only.
- **Never copy or collect claude.ai logins** (Anthropic's terms, and copied logins log each other out). Boxes sign in through the CLI's own login in the worker's terminal.
