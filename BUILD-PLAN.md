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

1. The day/night clock and the sky (`sky/`): a day every 30 minutes by default, or the viewer's own clock, or always day (picked on the debug page, kept per browser). The sun, the sky, the fog, the city's lit windows and the light indoors follow it; desk lamps, the roof's string lights and the fire glow at night. Lunch follows the same clock. Going home in the evening stays out (unchecked).
2. Synthesized sound effects, no audio files (`client/src/ui/sfx.ts` and its neighbours): the room (the coffee machine, the fridge, the elevator, the gong and the cheering, ping-pong), people (footsteps, typing, sips and bites) and outside (the city by day and by night, the world events). M mutes, and the volume is kept per browser. Music, babble voices and the weather's sounds stay out (unchecked).
3. The overview's click-a-worker (`camera/picking.ts`, `OverviewChips.tsx`): a status chip over each desk with the person's name and what they're doing; a click on a chip, or on anything with a panel, opens it, and the hint says what a click would open.

**Done when:** in the demo the office goes from morning to night and back in 30 minutes, with the lamps on and the city lit at night; you hear the machine brew, the elevator ding, the gong and the cheering, ping-pong and footsteps, and M mutes them; and in the overview a click on a worker's chip opens their terminal. (Done: seen in a browser on the demo: the sky from morning through golden hour to night, lamps, halos and a lit city, the roof at night; the brew, the fridge, the gong with confetti and cheers, footsteps, sips, a UFO and the outside, with M muting them; the chips, the hover hint and a click opening a terminal or the board. The brew's ready beep, the elevator's ding and ping-pong were heard only in the sound agent's own headless run. The new rules are tested in `sky/*.test.ts`, the `ui/` sound rules' tests and `overviewInfo.test.ts`.)

## Phase 15: the manager UI

Everything the debug page does, over the game, in the game's style. O, P and H open the console, the phone and help (`ui/OfficeKeys.tsx`), and so do the HUD's buttons.

1. The setup wizard (`ui/SetupWizard.tsx`): what the office calls you, your company's name, and whether to hire a CEO (and on which model). It opens by itself until it's finished or skipped (`settings.setupDone`).
2. The manager's console (`ui/ManagerConsole.tsx`):
   - Floors: connect a repo (one of yours on GitHub, or by name), a floor's settings, sync, the CEO's planning of a brief, held issues.
   - Team: hire, let go, stop, reset, move, model and effort, the CEO, a cloud worker's sign-in.
   - Issues: a floor's board, and the workers' questions to answer.
   - Settings: your name and company, the session limit and pacing, team size and autoscale, the default model and effort, cloud workers (key, token, machine, Box size and limit, test, orphans).
3. The worker panel (`ui/WorkerPanel.tsx`): the live terminal, a message box that drops a note into their running session (a new `POST /api/workers/:id/message`, with the demo's fake), and their setup (model, effort, stop, reset, let go, sign in).
4. The 2D Kanban view (`ui/KanbanView.tsx`): the whiteboard's panel and the console's Issues tab.
5. The phone (`ui/Phone.tsx`): the CEO's chat, and the office's messages: workers' questions to answer (counted on the HUD's button) and the office's notices.
6. Toasts: what happens in the office as notes that stack and fade: a merge, a PR opened, a question, a worker in trouble, a hire or a leaver.
7. The help screen (`ui/HelpPanel.tsx`): every control.

**Done when:** in the demo a fresh office opens on the setup; from the console, without the debug page, you connect a fake repo, hire workers and change a setting; a message typed in a worker's panel shows in their terminal; the phone carries a chat with the CEO and a question answered; a toast tells you of a merge; H shows the controls. (Done: seen in a browser on the demo: the setup opened on a fresh office, saved the names and hired the CEO; the console connected a fake repo, hired a worker and saved a setting; a message typed in a working worker's panel showed in their terminal and was answered; the phone answered a question (the issue went back to work) and carried a chat with the CEO; toasts for a hire, a PR opened, QA passed and the CEO's reports; H showed the controls. The merge toast is covered by `officeToasts.test.ts` rather than seen. The new rules are tested in `ui/console/forms.test.ts` and `ui/officeToasts.test.ts`, and the message route in `pipeline.test.ts` and `demo.test.ts`.)

## Phase 16: the office database

Postgres built into the server (PGlite: no install, no service) for the data that keeps growing; the live office stays in the state file.

1. The database (`server/db/`): PGlite in `<home>/db` (`<home>/demo-db` in the demo), numbered migrations in order, a small typed query layer, closed cleanly on shutdown; tests on an in-memory database.
2. Shipped work and trophies: every merge recorded (floor, PR, title, who built it, who tested it, when) and backfilled from each floor's merged PRs on sync, so merges made outside the office count too; milestones (the company's and each floor's) earned from it. In the snapshot (recent work, totals, trophies), with events as they happen.
3. The lobby and the CEO's floor show them: the trophy cabinet holds the real trophies, a shipped wall lists the latest merges and each floor's total, the CEO's floor has the company's milestones, and the front desk and the tour mention them.
4. Your look on the server: saved to the database and the same in every browser (the browser's copy moves up the first time).
5. The environment's state, office-wide: the office clock's mode becomes an office setting, and the server chooses the world events (the director moves to `shared/`) and keeps them in the database, so every tab sees the same blimp at the same moment.
6. Floor plans: each floor's items and their spots, seeded with what every floor has today (the default kit), which the shop builds on.

**Done when:** in the demo the database comes up in the home folder and survives a restart; a merge shows on the shipped wall and earns a floor its first trophy in the lobby's cabinet; your look follows you to a second browser; two tabs see the same world event; and `npm test` runs it all on an in-memory database. (Done: seen in a browser on the demo: the database came up in the home folder, backfilled the floors' merged PRs and four trophies, and kept them through a restart; a task filed and merged went on the shipped wall built by Ada and tested by Grace; the cabinet, the trophies panel and the CEO's milestones showed them; a look picked in one browser reached a fresh one; two tabs drew the same blimp and a reload rejoined it; the office clock moved every tab's sky. The office clock became an office setting rather than a database row. Tested in `server/db/*.test.ts` on an in-memory database, `shared/worldEvents.test.ts`, `trophyShelf.test.ts`, `shipped.test.ts` and `eventsState.test.ts`.)

## Phase 17: floor previews

Each floor's app, running, to verify what the team shipped. Adapted from cubefarm's `server/previews.ts` and `client/src/ui/AppViewer.tsx`, without the PR theatre (unchecked).

1. The previews (`server/previews.ts`): one per floor, run from a worktree of its own on the floor's default branch, refreshed to the latest commit on every start, on a port kept for the floor (127.0.0.1 only). It finds how to run the app (the package.json's dev, start or preview script, with the port passed the usual ways) or takes a command set on the floor, installs dependencies when they're missing or changed, and watches the output until the app answers. Started only by hand, never by itself; restarted after a merge so it shows what just shipped; stopped (its process tree killed) on demand and when the office closes. Its settings are kept; after a restart every preview reads stopped. In the snapshot, with an event on every change (state, address, the last lines of its output).
2. The demo's fake: a small generated app per floor, served by the server, so the demo shows a preview without running anything.
3. In the office: a big app monitor on every floor showing whether the app is up, and E on it (or a click in the overview) for the app viewer: the live app in a frame with its address, reload, phone, tablet and desktop widths, open in a new tab, start, stop and restart, and its output.
4. The manager's console: each floor's card gets the preview's start, stop and restart, its address, and the command and port to use.

**Done when:** in the demo a floor's preview starts from its monitor, the app viewer shows the running app, a merge restarts it, and stopping it frees the port; in real mode the sandbox repo's app runs and shows in the viewer. (Done: seen in a browser on the demo: floor 1's preview started from its monitor's viewer, ran on 127.0.0.1:6601 as `npm run dev`, showed in the viewer and live on the monitor, restarted on the commit a merge made, and stopping it freed the port. In real mode, on a throwaway office with no workers: the sandbox repo has no dev, start or preview script, so the preview said so and asked for a command; with a one-line server set as the command it fetched main into its worktree, ran `npm ci`, came up on 6601 and answered, and stopping it freed the port. Tested in `server/previews.test.ts`, `server/previewRunner.test.ts` and `client/src/preview.test.ts`.)

Also done alongside it: street events (a rock band's tour bus, an ice cream truck, a fire engine, a food truck and a parade, one at a time, with the city's cars giving way) and the world events on the debug page (start any of them, see what's on and end it, bring the next pick forward, the log). See FEATURES.md and docs/porting-map.md.

## Phase 18: the desktop, chats and discussions

The phone becomes a desktop: a bigger surface for planning with the CEO and settling things with them, not just a chat. New: cubefarm has no desktop, discussions or CEO repo tool; its repo creation (`server/workspace.ts` `publishFolder`, `server/swarm.ts` `createRepo`) is the reference for starting a repo.

1. The desktop (`client/src/ui/desktop/`): P opens a computer screen with a dock of apps (Chat, Discussions, Notices), their badges and a clock, in place of the phone.
2. Chats (`server/db/desk.ts`, kept in the office database): a separate conversation with the CEO per idea, each resuming its own CEO session, so ideas don't mix and a floor's onboarding never takes over a chat. The CEO helps shape the idea, and when the plan is ready it proposes the project as a card in the chat: a new repository (owner, name, private or public) or an existing one, the brief, the team size and the starting tasks.
3. Starting a project (`server/desk/projects.ts`): nothing touches GitHub until the manager approves the card, which they may edit first. Then the office creates the repository with a first commit (`gh repo create --add-readme`) or checks the existing one isn't empty, connects it as a floor with the brief and the agreed team size, files the tasks in order with their dependencies, and says so in the chat; the CEO onboards the floor as usual. A step that fails says what was already done.
4. Discussions: the CEO opens a thread (`start_discussion`) whenever something needs settling before it plans or acts, goes back and forth with the manager, and resolves it with the outcome before carrying on. The workers' questions on issues show as threads too, answered on GitHub as before.
5. Notices: the office's notices and the CEO's job reports, in one feed.

**Done when:** in the demo, a new chat with the CEO turns an idea into a project card; approving it creates the repository in the fake GitHub, a new floor appears with its team and the planned issues, and the work starts; a discussion the CEO opens is answered and resolved from the desktop; a worker's question is answered from Discussions; and two chats keep their own context. (Done: seen in a browser on the demo: an idea in a new chat got a reply, "go ahead" brought a card for a new private repo with a team of 2 and three tasks, and approving it created the repository in the fake GitHub, connected it as floor 3 with its brief, filed #1–#3 with their dependencies, and its two workers started on them; a second chat kept its own thread; planning floor 1's brief opened a discussion, and the reply settled it and filed the plan; a worker's question on an issue was answered from Discussions. Tested in `server/db/desk.test.ts`, `server/desk/proposals.test.ts`, `server/desk/projects.test.ts`, `server/team/ceo/jobs.test.ts` and `client/src/ui/desktop/desk.test.ts`. `gh repo create --add-readme` and the organisations list have not yet been run against the real GitHub.)

## Phase 19: coins and the shop

1. Coins per floor (`server/ledger.ts`, after cubefarm's): 10 for a merge, 5 more when its first QA round passed, 3 more when it was fixed after failing QA; paid once each (a key per payment) and only for PRs the office watched while open, so a floor's old history pays nothing; kept in the database; shown on each floor and in the console.
2. The shop: a kiosk in the lobby and a console tab, buying per floor. Floors keep what they have; the shop sells extras (a vending machine, a beer fridge, plants, rugs, a couch, posters) and upgrades (a better coffee machine, a nicer ping-pong table).
3. Fixed spots per floor where bought items snap in, clear of the walkways; workers use the new things (the vending machine, the beer fridge after hours).
4. Posters with art generated from each floor's repository, unique to it.

**Done when:** in the demo a floor earns coins as its PRs merge, buys a vending machine and a poster in the shop, they appear in their spots and stay after a restart, and a worker uses the vending machine. (Done: seen in a browser on the demo: a PR merged on pixel-todo paid 15 (the merge and its clean QA pass); the shop panel bought a vending machine into the north-east corner and a repo poster onto the north wall, which appeared there; after the server was killed and started again the machine, the poster and the purse were as they were; and workers used the vending machine (in line, a press, the drop, eating by it). Tested in `server/ledger.test.ts`, `server/shopRoutes.test.ts`, `shared/shop.test.ts`, `client/src/world/decor/spots.test.ts`, `poster.test.ts`, `vendingBreak.test.ts`, `beerBreak.test.ts` and `client/src/ui/shop/shop.test.ts`.)

## Phase 20: awards

Achievements beyond the merge milestones, each one a trophy with a coin reward, shown in the CEO's office. New: cubefarm's achievements (`shared/progress.ts`) pay nothing and live only in its state file.

1. The awards (`shared/awards.ts`): the company's and each floor's, in families with tiers: the merge milestones the trophies have today, clean QA passes, PRs fixed after failing QA, streaks (three merges on a floor in an hour, a busy day for the company), a night-owl merge, a full team, more floors, a first purchase, a furnished floor, both upgrades, a project started from a chat, discussions settled. Each says what it takes and what it pays.
2. Winning one (`server/db/awards.ts`, replacing the milestone check in `records.ts`): checked when what it counts changes; won once, kept as a trophy (the lobby's cabinet shows them all), announced, and paid through the ledger: a floor's award to that floor, the company's to every floor. Awards found in a floor's old history are kept but not paid, as merges aren't.
3. The awards wall in the CEO's office: every award as a plaque, the won ones with their trophy and date, the rest greyed with how far along they are, and what each pays; E on it opens the awards panel, which lists them by family with progress bars.

**Done when:** in the demo, merges and clean QA passes win awards whose coins land on the floor, the CEO's awards wall shows them won with the next ones' progress, and buying into every spot wins the furnished-floor award. (Done: seen in a browser on the demo: a clean pass won its award and paid the floor, a first purchase and five purchases won theirs, two and three floors and a project started from a chat paid every floor, the awards wall and panel showed what was won and how far along the rest are, and filling all 14 spots won "fully furnished" (+150). The trophies a floor brought in with its old merges were kept unpaid. Tested in `shared/awards.test.ts`, `server/db/awards.test.ts`, `server/db/office.test.ts`, `client/src/ui/awards/awards.test.ts` and `client/src/world/trophyShelf.test.ts`.)

## Phase 21: bodies, seats and the CEO's office

Asked for after playing Phases 19 and 20.

1. Two body styles from the character lab (`/lab`), the chibi and the stylized human, for everyone in the office: chosen in the first-run setup and changeable in the settings; the old figure goes.
2. The CEO on their phone holds it to their ear, not an arm across the face.
3. The CEO's office furnished: fuller, the meeting table's chairs round it rather than through it, the milestones and the awards wall kept.
4. Sitting down: E on a bench, a sofa, an armchair or a deckchair sits you there (E again stands up), and at the roof's fire you can toast a marshmallow on a stick.

**Done when:** a new office picks a body style in the setup and everyone wears it, the settings switch it; the CEO's office looks lived in with nothing through the furniture; and you can sit on every kind of seat and toast a marshmallow at the roof's fire.

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
