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
- [x] **State file**, written atomically (temp + rename); no database, GitHub is the source of truth · S
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
- [x] **One floor per repository** · S
- [x] **Connect an existing GitHub repo** · S
- [ ] **Connect a local project folder** · S → `server/workspace.ts`
- [ ] **Create a new repo / publish a local folder** to GitHub · S
- [x] **Issue ordering**: `Depends on #N` waits; the longest blocking chain goes first, then the oldest · S → `shared/issues.ts`
- [x] **Skip labels**: `skip`, `wontfix`, `question` · S
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
- [x] **Decided by a CEO agent**: a Claude session with office tools over MCP, no shell · L → `server/ceo.ts`
- [ ] **Decided by plain rules** instead (queue length, idle time): free and predictable · S
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
- [ ] **Babble voices**, Animal Crossing style · M → `client/src/ui/babble.ts`
- [ ] **Look editor** for workers · M → `LookPreview.tsx`, `client/src/ui/AgentSettings.tsx`
- [ ] **Carry a whiteboard sticky to a desk** to assign it · M → `StickyNotes.tsx`
- [ ] **Mission control screens** in the lobby · M → `MissionControl.tsx`
- [ ] **City outside the windows** · M → `outside/`
- [ ] **Roof**: garden, deck chairs, telescope, grill · L → `roof/`
- [ ] **Weather**: rain, snow, or your real weather · M → `weather/`
- [ ] **World events** (UFO, kaiju, blimp, fireworks…): you said skip · M → `events/`
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
- [ ] **CEO walks the floors** · S
- [ ] **Welcome tour** for new hires · S
- [ ] **Hoops, toss and catch** with toys (needs physics toys) · M → `toyErrands.ts`
- [ ] **Ping-pong** between workers · L → `toys/pong*`
- [ ] **Roof breaks** (needs the roof) · S
- [ ] **Office dog**: naps, fetches, rides the elevator · L → `toys/dog*`
- [ ] **Roomba** · M

## 9. Game: the player

- [x] **First-person walking**: WASD, mouse look, collisions · M → `Player.tsx`
- [x] **`E` to use**: a desk's terminal, the whiteboard, the elevator, the console · M → `interact.ts`
- [x] **Say hi** to an idle worker · S
- [x] **Overview camera**: the floor from above, click a worker · M → `camera/`
- [ ] **Follow cam** on a worker · S
- [ ] **Throw balls** (Rapier physics) · M → `toys/balls.tsx`
- [ ] **Coffee mug and fridge snacks** for the player · M
- [ ] **Ping-pong against a worker** · L
- [ ] **Jukebox** with synthesized songs · L → `client/src/ui/music.ts`, `jukeboxSongs.ts`
- [ ] **Foam blasters** · M
- [ ] **Gamepad** · S
- [ ] **Rebindable keys** · S → `client/src/ui/keymap.ts`
- [ ] **Shared presence**: other open tabs walk around as visitors · L → `server/presence.ts`, `presence/`
- [ ] **Photo mode** · L → `client/src/photo/`
- [ ] **Time-lapse replay** of the day · L → `server/journal.ts`, `client/src/replay.ts`

## 10. Game: progression

- [ ] **Coins** from merges and first-time QA passes · M → `server/ledger.ts`
- [ ] **Decorations kiosk** to spend them · L → `decor/`
- [ ] **Achievements** on a trophy shelf · M
- [ ] **Career cards**: rank, badges, last merged PRs · M
- [ ] **Desks that tell a story**: PR plaques, a plant that grows with tenure · M → `desk/DeskStory.tsx`
- [ ] **Ping-pong leaderboard** · S

## 11. Manager UI (HTML over the 3D view)

- [x] **Debug list view** of floors, workers and the queue: the first UI we build · S → `client/src/ui/FloorList.tsx`
- [x] **Setup wizard**: your name, company, CEO · S
- [x] **Manager console**: floors, team, issues, settings · L → `client/src/ui/ManagerConsole.tsx`
- [x] **Worker panel**: live terminal, message box, setup · M → `client/src/ui/TerminalView.tsx`
- [x] **2D Kanban view** · M → `client/src/ui/KanbanView.tsx`
- [x] **Phone overlay** (on the desktop): CEO chat, office messages · M → `client/src/ui/Phone.tsx`
- [x] **Toasts** · S
- [x] **Help screen** with the controls · S
- [ ] **Phone mini-games** (tetris, snake, pet) · M
- [ ] **Tutorial** · M
- [ ] **Mission control table**: throughput, lead time, cost · M → `server/metrics.ts`
- [ ] **Floor previews**: run each floor's app and open it in the office · L → `server/previews.ts`
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

1. **Who decides the team size?**
   - (a) Rules by default, CEO on top when it's on. Free and predictable; Claude only when you want judgement.
   - (b) CEO only, as cubefarm does: every decision costs a session.
   - (c) Rules only.
2. **Hires: automatic or approved?** I pre-checked automatic, since you said autospawning. Approval adds the lobby-chairs game moment.
3. **Runtime: real terminal or Agent SDK?** I pre-checked the real terminal, because the desk monitors and the worker panel show it.
4. **Coding agents for v1:** decided: Claude Code only, on Claude or on a local Ollama model, with room for more model servers later.
5. **Fresh repo or a fork of cubefarm?** I recommend a fresh repo, porting module by module (see BUILD-PLAN.md).
6. **Vocabulary:** keep floors / agents / CEO, or Marshmallow names of your own?
