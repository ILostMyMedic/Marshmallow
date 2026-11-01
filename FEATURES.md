# Marshmallow: feature checklist

Flip `[ ]` to `[x]` (or back) and tell me when you're done: the checked set becomes the scope of [BUILD-PLAN.md](BUILD-PLAN.md).

- **Pre-checked:** what you asked for (game, Claude, the Upstash option, workers, autospawning, idle activities) plus what those depend on.
- **Unchecked:** mobile, world events, and extras I'd leave for later.
- **Size** is the rough effort to port it from cubefarm: **S** under a day, **M** a few days, **L** a week or more.
- **→** points at the cubefarm code it comes from (`server/…`, `client/src/…`).

## 1. Foundation (everything needs this)

- [x] **TypeScript monorepo**: `server/`, `shared/`, `client/`; ESM, strict, Vitest · S
- [x] **Node server**: Express REST for commands, one WebSocket for state · S → `server/index.ts`
- [x] **Shared contract**: a snapshot on connect, then typed events · S → `shared/types.ts`
- [x] **State file**, written atomically (temp + rename): the live office (floors, workers, tasks, QA); GitHub is the source of truth for the work · S
- [x] **The office database**: Postgres built in (PGlite, running inside the server, no install), in `<home>/db` (`demo-db` for the demo), for what keeps growing: shipped work, trophies, floor plans, coins and purchases, your look, the environment's state. Numbered migrations; tests on an in-memory database · M → `server/db/` (new: not in cubefarm)
- [ ] **A Postgres server instead**: `MARSHMALLOW_DATABASE_URL` points the same tables at a server you run · S
- [x] **Config**: home folder, port, host (127.0.0.1 only), `--demo` · S → `server/config.ts`
- [x] **Backend interface**: every GitHub, git, disk and session call behind one seam · S → `server/backend.ts`
- [x] **Demo mode**: fake GitHub, fake sessions, fake Upstash; no Claude usage · M → `server/demo.ts`
- [x] **Safe process runner**: `execFile` without a shell, timeouts, kill whole process trees · S → `server/exec.ts`
- [x] **CI**: typecheck, test and build on Windows and Ubuntu · S
- [ ] **Batched state patches** (4 a second) and per-tab terminal filtering, for big teams · M → `server/outbox.ts`
- [ ] **`npx marshmallow` command** with `doctor` and `login` · M → `bin/cubefarm.js`
- [ ] **Self-updating launcher** (pull, install, build, restart, roll back) · M → `scripts/office.mjs`
- [ ] **npm publishing** workflow · S

## 2. Projects and the work queue

- [x] **GitHub issues as the backlog, PRs as the output**, through the `gh` CLI · M → `server/github.ts`
- [x] **Your GitHub account** through the `gh` login (GitHub's own OAuth sign-in, no app to register). Issues, PRs, comments and commits are yours; the office's own comments open with a 🤖 line naming the worker who wrote them · S
- [x] **One floor per repository** · S
- [x] **Connect an existing GitHub repo** · S
- [ ] **Connect a local project folder** · S → `server/workspace.ts`
- [x] **Create a new repo** on GitHub, from a project the CEO proposes and you approve: private or public, under your account or one of your organisations, with a first commit so workers can start at once · S
- [ ] **Publish a local folder** to GitHub · S
- [x] **Issue ordering**: `Depends on #N` waits; the longest blocking chain goes first, then the oldest · S → `shared/issues.ts`
- [x] **Skip labels**: `skip`, `wontfix`, `question` · S
- [x] **Questions to you**: a worker or the CEO that finds an issue unclear (or a backlog with nothing ready) asks on GitHub, as a 🤖 comment on the issue with the `mm:needs-answer` label. The issue is skipped until you reply there; the next sync takes the label off and the issue goes back to the queue with your answer in its prompt. Open questions also show in the office · M (new: not in cubefarm)
- [x] **File a task from the board**: a title and details, from the whiteboard or the console's Issues tab, become a plain issue on the floor's repository, which auto-assign takes like any other · S → `client/src/ui/KanbanView.tsx`, `server/floors.ts`
- [x] **Closing an issue or PR stops whoever works on it** · M → `server/closeCleanup.ts`
- [ ] **Linked repos**: a floor's workers can read other floors' code · S
- [ ] **Keep your own project folder up to date** after merges (fast-forward only) · S

## 3. Workers

- [x] **Interchangeable workers**: no roles; any free worker builds, tests or fixes · S
- [x] **A machine per worker**: own clone, worktree, temp folder and dev-server port · M → `server/machines.ts`, `server/workspace.ts`
- [x] **Claude Code** as the coding agent
- [x] **Real CLI in a pseudo-terminal**, reporting through HTTP hooks (which also approve its tool calls) · L → `server/cliRunner.ts`, `server/clis.ts`
- [ ] **Agent SDK runtime** instead: simpler, but no real terminal · M → `server/agentRunner.ts`
- [ ] **Codex** as an option · M
- [ ] **OpenCode** as an option · M
- [x] **Local models through Ollama** for Claude Code: the testing ground before spending Claude usage; local workers only · S → `shared/models.ts` (naming only)
- [ ] **More model servers** (LM Studio, llama.cpp, hosted gateways) behind the same `<server>/<model>` names · S
- [ ] **Local models for Codex/OpenCode** · S
- [x] **Per-worker model and effort**, falling back to office defaults. `ollama/<name>` runs on Ollama; any other name is Claude's · S
- [x] **Live terminal per worker**: watch it, type into it, `Esc` interrupts · M → `server/terminal.ts`, `client/src/ui/LiveTerminal.tsx`
- [x] **Message a worker**: injected while running, resumes their session afterwards · S
- [x] **Stop / reset a worker** · S
- [x] **Session limit**: most sessions running at once · S
- [x] **Usage pacing**: slow down after Claude's usage warning, pause at the limit · S → `server/pacing.ts`
- [x] **Sweeps**: delete finished branches and orphan machines; unpushed work saved as a patch · M
- [ ] **Terminal keeper**: workers keep running through a server restart · L → `server/ptyHost.ts`, `server/ptyClient.ts`
- [ ] **Free disk on idle desks** (drop `node_modules` after N minutes) · S → `server/deskTrim.ts`

## 4. The pipeline (issue → merged PR)

- [x] **Auto-assign**: free workers take the next ready issue · S
- [x] **Finishing beats starting**: QA and fixes go before new issues · S
- [x] **QA by a different worker in a fresh session**, returning a structured JSON report · M → `server/prompts.ts`, `server/qaPrompt.ts`
- [x] **Browser testing in QA** with the Playwright MCP · S → `server/browser.ts`
- [x] **QA report with screenshots posted on the PR** (images on an orphan branch) · M
- [x] **Fix loop**: a failed QA goes back to the author's own session · M
- [x] **Auto-merge**: wait for green checks, merge exactly the commit QA passed · M → `server/mergeGate.ts`
- [x] **Merge fixes**: failing checks or conflicts go back for a fix · M
- [x] **Round limits, then "needs you"** · S
- [ ] **Manual merge button** (auto-merge off per floor) · S
- [ ] **Send people's own PRs to QA** · S

## 5. Autospawning (team size)

- [x] **Workers are added and removed automatically** to fit the work · M
- [x] **Decided by plain rules** by default (queue length, idle time): free and predictable · S
- [x] **Decided by a CEO agent** when it's on: a Claude session with office tools over MCP, no shell. It runs on the office default model unless given its own · L → `server/ceo.ts`
- [x] **Changes apply at once**, within the floor's max · S
- [ ] **Changes wait for your approval**: candidates wait on chairs in the lobby · M
- [x] **Max workers per floor** · S
- [x] **CEO onboards a new floor**: summary, QA brief, starting team size · S
- [x] **CEO plans your brief into issues** (only when you ask) · S
- [x] **Chat with the CEO** · S
- [ ] **CEO's periodic company review** (heartbeat) · S
- [ ] **CEO triages stuck PRs** before they reach you · M → `server/triage.ts`
- [ ] **CEO's notes file** (memory between jobs) · S

## 6. Cloud workers (Upstash Box)

- [x] **Per worker: a local folder or an Upstash Box** · L → `server/box.ts`, `server/boxMachines.ts`
- [x] **Box setup**: pinned CLIs, tmux, a git credential helper · M → `server/boxScripts.ts`
- [x] **CLI under tmux**; its hooks write to an events file the server reads (and catches up on) · L → `server/boxCli.ts`, `server/boxHelpers.ts`
- [x] **Keeps working with the server closed**; the server catches up when it's back (part of the above)
- [x] **Sign-in**: the CLI's own login, run in the worker's terminal · M
- [x] **Or one credential for every Box**: an Anthropic API key or a `claude setup-token` token from the environment · S → `server/cloud.ts`
- [x] **GitHub token per command** (`gh auth token`, or a pasted fine-grained token) · S
- [x] **Pause idle Boxes**; delete departed workers' Boxes and orphans · S
- [x] **Box size and plan-limit settings** · S
- [ ] **Codex in Boxes** · S

## 7. Game: the world

- [x] **3D office** in React Three Fiber: toon shading and ink outlines, built from primitives · L → `client/src/world/Toon.tsx`, `materials.ts`
- [x] **Building**: lobby, one floor per repo, an elevator between them · L → `layout.ts`, `Lobby.tsx`, `OfficeFloor.tsx`, `Elevator.tsx`
- [x] **Lobby entrance**: a front desk with a guide who tours you round the floors and their projects, today's status, a floor directory · M → `Lobby.tsx`, `tour.ts`
- [x] **The CEO's floor**, below the roof: an executive office with its own desk and chair · M → `CeoFloor.tsx`
- [x] **Desks with live monitors** showing each worker's terminal · M → `Desk.tsx`, `draw.ts`
- [x] **Characters with seeded looks** (id hash → hair, colours, outfit, build) · L → `appearance.ts`, `characterParts.ts`
- [x] **Faces that follow state**: focused, puzzled, joyful, sleepy · M → `face.ts`
- [x] **Activity signs over heads**: 📖 reading, ✏️ editing, 🧪 testing… · S → `activitySign.ts`
- [x] **Walking**: walk grid, paths, steering, named spots · L → `walkways.ts`
- [x] **Whiteboard Kanban** on the wall · M → `KanbanBoard.tsx`
- [x] **Merge celebration**: confetti, gong, cheering · M → `MergeConfetti.tsx`, `Gong.tsx`
- [x] **Arrivals by elevator, leavers carrying a box** (pairs with autospawning) · M → `socials.ts`, `Leavers.tsx`
- [x] **Speech bubbles about real work** (a phrasebook, no Claude calls) · M → `client/src/ui/chatterLines.ts`, `Chatter.tsx`
- [x] **Synthesized sound effects** (no audio files) · M → `client/src/ui/sfx.ts`
- [x] **Day/night clock** (lunch and going home need it) · M → `sky/`
- [x] **Babble voices**, Animal Crossing style · M → `client/src/ui/babble.ts`
- [ ] **Look editor** for workers · M → `LookPreview.tsx`, `client/src/ui/AgentSettings.tsx`
- [ ] **Carry a whiteboard sticky to a desk** to assign it · M → `StickyNotes.tsx`
- [ ] **Mission control screens** in the lobby · M → `MissionControl.tsx`
- [x] **City outside the windows**: skyscrapers downtown, billboards on the rooftops, a red suspension bridge in the distance · M → `outside/`, `cityLayout.ts`
- [x] **Roof terrace** on the top floor: lookouts over the city, billboards, a fireplace, deck chairs, a garden · L → `roof/`
- [x] **Seasons** from the office's date: snow in December and January, the northern lights on winter nights (a world event), a Christmas tree and lights, Halloween pumpkins, autumn leaves, spring blossom, a summer pool, New Year fireworks; an office setting picks one to see it now · L (new; the falling snow adapted from cubefarm's precipitation)
- [ ] **Weather**: rain, or your real weather · M → `weather/`
- [x] **World events**: planes, blimps and the odd surprise in the sky, and workers going to the windows to watch · M → `events/`
- [x] **Street events**: surprises down on the street round the office, starting with a rock bus with a band playing on its roof; best seen from the lobby's windows, looking down from the floors and from the roof · M (new: not in cubefarm)
- [x] **World events on the debug page**: trigger any of them now, see what's on and end it, bring the next pick forward, and the log of what ran · S (new)
- [ ] **Holiday themes** · M → `themes/`
- [ ] **Graphics tiers and post-processing** (bloom, ambient occlusion) · M → `gfx/`
- [ ] **Instanced batching** for 10 floors of 15 workers · L → `batch.ts`

## 8. Game: idle activities

- [x] **Errand system**: who may get up, where they go, for how long · M → `errands.ts`, `ErrandDirector.tsx`
- [x] **Coffee run** · S → `coffeeErrand.ts`
- [x] **Fridge snack** · S → `fridgeErrand.ts`
- [x] **Stretch at the desk** · S
- [x] **Chats and desk visits** between idle workers · M → `socials.ts`
- [x] **Fidgets while seated** · S → `fidgets.ts`
- [x] **Sleepy after a long idle** (Zzz) · S → `Zzz.tsx`
- [x] **Stand-up at the whiteboard** when new issues land · M → `Rituals.tsx`
- [x] **Lunch** from noon to one · S → `meals.ts`
- [ ] **Evening wind-down**: lamps on, idle workers go home, back in the morning with a coffee · M
- [ ] **Pizza Friday** · S
- [x] **CEO walks the floors** · S
- [ ] **Welcome tour** for new hires · S
- [x] **A basketball hoop** for a floor's big spot: shoot with the mouse, a scoreboard, streaks; workers shoot hoops · M (from cubefarm's `Hoop.tsx`, its own small ball simulation instead of physics toys)
- [x] **Darts**: a dartboard for a wall spot, scored like a real board; workers throw a turn · S (new)
- [ ] **Toss and catch** with toys (needs physics toys) · M → `toyErrands.ts`
- [x] **Ping-pong** between workers · L → `toys/pong*`
- [x] **Roof breaks**: idle workers go up to the roof terrace · S
- [ ] **Office dog**: naps, fetches, rides the elevator · L → `toys/dog*`
- [ ] **Roomba** · M

## 9. Game: the player

- [x] **First-person walking**: WASD, mouse look, collisions · M → `Player.tsx`
- [x] **Your own character**: a body you see when you look down and in the overview, in a look you pick in an editor · M → `Me.tsx`, `myLook.ts`, `client/src/ui/LookPanel.tsx`
- [x] **`E` to use**: a desk's terminal, the whiteboard, the elevator, the console · M → `interact.ts`
- [x] **Say hi** to an idle worker · S
- [x] **Overview camera**: the floor from above, click a worker · M → `camera/`
- [ ] **Follow cam** on a worker · S
- [ ] **Throw balls** (Rapier physics) · M → `toys/balls.tsx`
- [x] **Coffee mug and fridge snacks** for the player · M
- [x] **Sitting down** on benches, sofas, armchairs and deckchairs, and toasting marshmallows at the roof's fire · M (new)
- [x] **Body styles**: the office's people in one of two styles from the character lab, chibi or stylized human, picked in the setup and changeable in the settings · L (new)
- [x] **Ping-pong against a worker** · L
- [ ] **Jukebox** with synthesized songs · L → `client/src/ui/music.ts`, `jukeboxSongs.ts`
- [ ] **Foam blasters** · M
- [ ] **Gamepad** · S
- [ ] **Rebindable keys** · S → `client/src/ui/keymap.ts`
- [ ] **Shared presence**: other open tabs walk around as visitors · L → `server/presence.ts`, `presence/`
- [ ] **Photo mode** · L → `client/src/photo/`
- [ ] **Time-lapse replay** of the day · L → `server/journal.ts`, `client/src/replay.ts`

## 10. Game: progression

- [x] **Shipped work**: every merged PR kept (floor, title, who built and tested it, when), backfilled from GitHub when a floor connects; the lobby shows a shipped wall and the floors' totals · M (new: not in cubefarm)
- [x] **Achievements** on a trophy shelf: the company's and each floor's milestones (first merge, 10, 50, 100 merges, a floor's first week…), in the lobby's trophy cabinet and on the CEO's floor · M
- [x] **Awards**: achievements beyond merges (clean QA passes, fixes, streaks, a full team, a furnished floor, a project started from a chat…), each a trophy that pays coins, on an awards wall in the CEO's office with how far along each one is · M (new)
- [x] **Your look on the server**: the same in every browser, kept in the database · S
- [x] **The environment's state, office-wide**: the office clock's mode as an office setting, and the world events chosen by the server and kept in the database, so every tab sees the same sky and a reload doesn't start it over · M (new)
- [x] **Floor plans**: each floor's items and the spots they stand in, starting with what every floor has today · M (new)
- [x] **Coins** per floor from merges, first-time QA passes and fixes · M → `server/ledger.ts`
- [x] **The shop** to spend them, per floor: extras and upgrades snapping into a floor's fixed spots (a vending machine, a beer fridge, a better coffee machine, a nicer ping-pong table, plants, rugs, posters); floors keep what they have · L → `decor/`
- [x] **Posters with art from each repo**: generated from the repository (its name, languages, colour), unique to every floor · M (new)
- [ ] **Career cards**: rank, badges, last merged PRs · M
- [ ] **Desks that tell a story**: PR plaques, a plant that grows with tenure · M → `desk/DeskStory.tsx`
- [ ] **Ping-pong leaderboard** · S

## 11. Manager UI (HTML over the 3D view)

- [x] **Debug list view** of floors, workers and the queue: the first UI we build · S → `client/src/ui/FloorList.tsx`
- [x] **Setup wizard**: your name, company, CEO · S
- [x] **Manager console**: floors, team, issues, settings · L → `client/src/ui/ManagerConsole.tsx`
- [x] **Worker panel**: live terminal, message box, setup · M → `client/src/ui/TerminalView.tsx`
- [x] **2D Kanban view** · M → `client/src/ui/KanbanView.tsx`
- [x] **The desktop** (P): a computer screen in place of the phone, with a dock of apps and their badges: Chat, Discussions and Notices · M → `client/src/ui/desktop/` (new)
- [x] **Chats with the CEO**: a separate conversation per idea, each with its own context, to shape an idea into a plan; when it's ready the CEO proposes the project as a card (the repository, the brief, the team size, the starting tasks), and approving it starts the repo, the floor, the team and the tasks · L (new)
- [x] **Discussions**: the CEO opens a thread whenever something needs settling before it plans or acts, and you go back and forth until it's resolved; workers' questions on issues are threads too · M (new)
- [x] **Toasts** · S
- [x] **Help screen** with the controls · S
- [ ] **Desktop mini-games** (tetris, snake, pet) · M
- [ ] **Tutorial** · M
- [ ] **Mission control table**: throughput, lead time, cost · M → `server/metrics.ts`
- [x] **Floor previews**: run each floor's app (its default branch, from a worktree of its own, on a port kept for the floor) and open it in the office: a big app monitor on every floor, and E on it for the app viewer with the live app · L → `server/previews.ts`, `client/src/ui/AppViewer.tsx`
- [ ] **PR theatre**: run a PR beside main · L
- [ ] **Office doctor**: find and fix stuck work · M → `server/watchdog.ts`
- [ ] **Activity ticker** · S → `server/ticker.ts`
- [ ] **Accessibility**: captions, colour-blind-safe shapes, motion comfort · M

## 12. Notifications and voice

- [ ] **Desktop notifications** · S
- [ ] **Chat webhooks** (Discord, Slack, ntfy) · M → `server/notifier.ts`
- [ ] **CEO messages read aloud** (browser voice or ElevenLabs) · M → `server/voice.ts`
- [ ] **Talk instead of typing** (mic) · M

## 13. Mobile (you said skip)

- [ ] **Pocket mode**: the 2D phone app · M → `client/src/pocket/`
- [ ] **Installable app** (PWA, service worker) · S → `server/pwa.ts`
- [ ] **Web Push** · M → `server/webPush.ts`

## Decisions to make

Pick one in each; my recommendation comes first.

1. **Who decides the team size?** decided: plain rules by default, the CEO on top when it's on. The CEO runs on the office default model unless given its own.
2. **Hires: automatic or approved?** I pre-checked automatic, since you said autospawning. Approval adds the lobby-chairs game moment.
3. **Runtime: real terminal or Agent SDK?** I pre-checked the real terminal, because the desk monitors and the worker panel show it.
4. **Coding agents for v1:** decided: Claude Code only, on Claude or on a local Ollama model, with room for more model servers later.
5. **Fresh repo or a fork of cubefarm?** I recommend a fresh repo, porting module by module (see BUILD-PLAN.md).
6. **Vocabulary:** keep floors / agents / CEO, or Marshmallow names of your own?
