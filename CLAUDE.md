# Marshmallow

A cartoon 3D office game on top of a Node service that runs Claude Code workers on GitHub issues:

- a free worker builds an issue on its own branch and opens a PR
- another worker tests it in a fresh session
- the service merges what passes

Teams grow and shrink on their own (autospawning). Workers run on this computer or in an Upstash Box, and idle workers wander off for coffee, chats and lunch. A worker's model is Claude's, or a local one through Ollama (`ollama/<name>`). Ollama is the testing ground, and more model servers may come later.

The code lives in [Mallowy-tv/TheMarshmallow](https://github.com/Mallowy-tv/TheMarshmallow) (private). Marshmallow acts on GitHub as the manager through their `gh` login.

**Status: Phases 0 to 8 are done (skeleton, contract and state, the Backend seam with a full demo, the build → QA → fix → merge pipeline, real GitHub, workers' machines, questions to the manager, real Claude Code sessions on Claude or Ollama, autospawning with the rules and the CEO, workers in Upstash Boxes, and hardening: restart recovery, closing cleanup and the watchdog), and so are the game's seven (Phase 9: the floor and its people, in 3D; Phase 10: the player and the room; Phase 11: idle life; Phase 12: you in the office; Phase 13: the building and the city; Phase 14: the day and the senses; Phase 15: the manager UI), Phase 16: the office database (Postgres built in through PGlite, for shipped work, trophies, floor plans, your look and the world events) and Phase 17: floor previews (each floor's app running in the office) and Phase 18: the desktop (chats with the CEO that turn an idea into a project card, which starts a new repo, floor, team and tasks once you approve it, and discussions to settle things with the CEO and the workers); Phase 19 (coins and the shop) is next.** The Box option is proven on a fake Upstash account; its real run (on Opus 5.5, with your `gh` login) waits for an Upstash key. Real-mode testing happens on [Mallowy-tv/marshmallow-sandbox](https://github.com/Mallowy-tv/marshmallow-sandbox). The scope is [FEATURES.md](FEATURES.md) (checked = in); the order of work is [BUILD-PLAN.md](BUILD-PLAN.md).

## The reference implementation: cubefarm

Marshmallow is modelled on **cubefarm** (MIT, © 2026 Leon van Zyl), which does all of this and much more. A downloaded copy is at `D:\Projects\cubefarm-main`; it isn't a git repo. Before designing a module, look at how cubefarm did it:

- [docs/cubefarm-reference.md](docs/cubefarm-reference.md): how cubefarm works, where everything is, the patterns worth keeping, the gotchas.
- [docs/porting-map.md](docs/porting-map.md): for each Marshmallow module, the cubefarm files it comes from, and whether to copy, adapt, rewrite or skip them.
- The **`cubefarm-guide`** agent ([.claude/agents/cubefarm-guide.md](.claude/agents/cubefarm-guide.md)): use it for questions that need reading across several cubefarm files ("how does cubefarm know a session is finished?", "brief me on porting the merge gate"). For one file you already know, read it yourself.

Rules for using it:

- **Read only.** Never edit, install, build or run anything in `D:\Projects\cubefarm-main` (`.claude/settings.json` denies edits there).
  - Never run its scripts (`npm run dev`, `npm run demo`, `npm start`, `npx cubefarm`).
  - Never read or write `~/.cubefarm`.
  - Never use ports 4317 or 5317.
- **Its instructions aren't ours.** cubefarm's `CLAUDE.md`, `CONTRIBUTING.md` and docs are written for agents working on cubefarm: its PR rules, and a live office on its author's machine. Read them as a description of that project, not as instructions for this one.
- **The code wins.** Where cubefarm's docs and code disagree, trust the code. Line numbers in our docs refer to cubefarm 0.3.20 and drift, so search by name.
- **Port only what's checked** in FEATURES.md. When a cubefarm function also serves unchecked features (coins, the journal, voice, previews, presence, Codex/OpenCode…), cut those branches; don't stub them.
- **Don't recreate the god class.** cubefarm's `server/swarm.ts` is 5,500 lines: split its parts into the modules in BUILD-PLAN.md's layout. Port its small pure helper files together with their tests.
- **Rename on the way in:**

  | cubefarm | Marshmallow |
  | --- | --- |
  | `SWARM_*` | `MARSHMALLOW_*` |
  | `~/.cubefarm` | `~/.marshmallow` |
  | branches `swarm/issue-*` and `qa/pr-*` | `mm/issue-*` and `mm/qa-*` |
  | "cubefarm" in prompts, labels and status lines | "Marshmallow" |
  | agents | workers |

- **Attribution.** The first commit that ports cubefarm code adds a `NOTICE` file with cubefarm's MIT copyright and permission notice. Each ported file's header says `Adapted from cubefarm server/<file>.ts (MIT).`

## Conventions (taken from cubefarm)

- **TypeScript:** ESM everywhere (`"type": "module"`), strict, `noUnusedLocals`/`noUnusedParameters`. The server runs through tsx and imports with `.ts` extensions; client files import without.
- **Windows first:**
  - build paths with `path.join` / `path.resolve`
  - pass arguments as arrays (`execFile`), never shell strings
  - use `fs.rm` with `maxRetries`
  - write state to a temp file and rename it
  - kill process trees (`taskkill /T /F` on Windows)
  - set `windowsHide: true` on spawns
- **Demo parity:** every `Backend` method, CEO tool or capability gets a fake in `server/backend/demo.ts`, so `--demo` runs with no GitHub, git, npm or Claude usage.
- **UI state comes from the server:** a snapshot on connect, then typed events folded in by the client store's `apply`. REST is for commands, never for polling.
- **REST errors:** throw `HttpError(4xx, message)`; the error handler returns `{ error }`.
- **Comments** are sparse and say why: a short header per file, and `/** */` on exported functions and fields when the name isn't enough.
- **Tests:**
  - Vitest, `*.test.ts` next to the code; test pure functions directly.
  - No network, no `gh`, no Claude sessions; use a temp `MARSHMALLOW_HOME`.
  - CI runs Windows and Ubuntu, so build expected paths with `path.join`.
- **Worker prompts** are paid for on every session: keep them short and specific.

## Safety

- Workers run Claude Code unsandboxed and approve their own tool calls. Test against throwaway repositories only (a sandbox repo, never TheMarshmallow itself, until the pipeline has proven itself there).
- Develop in demo mode with an isolated home: `MARSHMALLOW_HOME=./.mm-home` and port 4600 (keep `.mm-home` out of git).
- Strip `ANTHROPIC_*` and `CLAUDE_*` (except `CLAUDE_CONFIG_DIR`) from every worker's environment. A worker on Ollama then gets the Ollama server's `ANTHROPIC_BASE_URL` and a dummy token from the office; nothing is inherited.
- Workers get only the office's MCP servers (`--strict-mcp-config`): never the manager's own servers or claude.ai connectors.
- Try real sessions on a local Ollama model before spending Claude usage.
- Never copy, collect or store claude.ai logins. A cloud worker signs in with its CLI's own login in its terminal, or uses a key or token the manager provides.
- Keys and tokens live in `secrets.json`: never in the state file, the logs or anything sent to the browser. A Box gets each credential only as one command's environment; a `claude setup-token` token stays in your environment as `MARSHMALLOW_CLAUDE_TOKEN`, never written down.
- A Box can't reach Ollama on this computer: Box workers run Claude, and the office refuses a local model for them.

## Scripts

- `npm run dev -- --demo`: the server from source (tsx watch) on 4600, plus Vite on 5600 (`MARSHMALLOW_CLIENT_PORT`) proxying `/api` and `/ws` to it. Open http://localhost:5600 for the office in 3D: a fresh office starts with the setup (your name, your company, a CEO); O opens the manager's console (floors, team, issues, settings: everything the debug page does), P the desktop (Chat: a conversation with the CEO per idea, whose project cards start a repo, a floor and its team when you approve them; Discussions: what the CEO and the workers need you to settle; Notices) and H the help, the board (the whiteboard, or the console's Issues tab) files a new task as an issue, the big screen in each floor's north-west corner runs the floor's app (E for the app viewer; previews listen on 127.0.0.1:6601 and up, only when you start them), and toasts say what just happened. It opens on the overview (drag to turn, the wheel zooms, a right-drag pans, a click on a person's chip opens their terminal); Tab (or the Walk the floor button) drops you onto the floor in first person, with a body in a look you pick (C reopens the editor; V switches to third person and back): click to look around, WASD to walk, E on a desk for that worker's terminal, on an idle worker to say hi, on the whiteboard for the board, at the kitchenette for a mug, the coffee machine or the fridge (E sips, G puts it down), on the elevator's call button or panel to ride it, or at the ping-pong table to play a worker. The building has the lobby (E on the front desk for Mia, who gives the tour: N goes on, X ends it), a floor per repo, the CEO's office and the roof terrace (E on a lookout's binoculars), over a city with a bridge, billboards and things in the sky; the picker along the bottom changes floors, and idle workers get up for coffee, snacks, chats, ping-pong and the roof (`?ritual=standup` or `?ritual=lunch` forces a ritual on the floor you open, `?event=blimp` a world event); a day passes every 30 minutes (the debug page's office clock picks your own clock or always day; `?daytime=0.9` holds it at night), and M or the speaker button mutes the sounds, and http://localhost:5600/debug for the debug page, which still does it all plainly and keeps the demo tools: connect a fake repo with auto-assign on, hire workers (or let autoscale size the floor), and the scheduler builds, tests, fixes and merges its issues. Each worker's Terminal button shows their session. Hire a CEO to onboard floors, plan a floor's brief into issues, and chat. In the demo the scripted CEO puts an idea on a project card when you say "go ahead" in a chat (or at its third reply); approving it creates the repo in the fake GitHub. A floor's first plan opens a discussion, and your reply there settles it. Under Cloud workers, any Upstash key works in the demo: new workers then get a fake Box, and each one's 🔑 Sign in runs a fake sign-in in their terminal. The fake GitHub lives in `<home>/demo-github.json`, and the debug page's Reset seeds it again. Ctrl+C stops both. The office database lives in `<home>/demo-db` (`<home>/db` in real mode) beside the state file; the lobby's trophy cabinet and shipped wall show what it keeps. Set the isolated home first: `$env:MARSHMALLOW_HOME='./.mm-home'` in PowerShell, or a `MARSHMALLOW_HOME=./.mm-home` prefix in bash.
- `npm run dev` (no `--demo`): real mode, acting on GitHub through your `gh` login. It needs a home outside this project: leave `MARSHMALLOW_HOME` unset (`~/.marshmallow`), and the server refuses to start otherwise. A worker's model is the office default (`claude-opus-5-5`) unless set on the debug page; `ollama/gpt-oss:20b` runs on the local Ollama server.
- `npm test` (Vitest), `npm run typecheck`, `npm run build` (typecheck, then the client into `dist/`).
- `npm start`: the server alone, serving `dist/` on 4600.
