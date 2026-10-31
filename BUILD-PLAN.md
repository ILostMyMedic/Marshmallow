# Marshmallow: where to start

The goal before any game work: a service that turns a GitHub issue into a merged pull request. It runs in demo mode first and on real repos after, with a plain debug page to watch it. The game sits on top of the service's event stream later, so the foundation's job is to report every worker's status, activity and comings and goings accurately.

Every phase ends in something you can run. Scope follows [FEATURES.md](FEATURES.md); the cubefarm files named here are in `D:\Projects\cubefarm-main`.

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

**Done when:** connecting a throwaway test repo clones it, and a worker's desk gets set up on its branch.

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
5. `prompts/`: the build, QA and fix prompts; QA answers through a JSON schema.
6. The Playwright MCP for browser testing.

**Done when:** one real issue on a throwaway repo goes build → QA → merge on a local Ollama model, then once more on your subscription.

## Phase 6: workers and autospawning

1. Hire and fire workers, with a names pool and a seed per worker (the game draws their look from it).
2. Autoscale:
   - The rules version first: free and testable.
   - Then the CEO: a Claude session with office tools over MCP (`company_status`, `scale_team`, `file_issue`, `set_floor_profile`) and its job queue (onboard, plan, chat). See cubefarm's `server/ceo.ts`.
3. Scaling mode: automatic, or approved by you.

**Done when:** a backlog of 8 issues grows a floor from 1 worker to 3, and it shrinks back once they sit idle.

## Phase 7: the Upstash Box option

1. Wrap `@upstash/box` behind a `BoxApi` interface, with a fake in the demo (port `box.ts`).
2. A Box `MachineProvider`: create, set up, prepare a desk, pause, remove (`boxMachines.ts`, `boxScripts.ts`).
3. `BoxPty`: the CLI under tmux; its `events.jsonl` read from a saved byte offset; reattach after drops (`boxCli.ts`, `boxHelpers.ts`).
4. Credentials:
   - keys in `secrets.json`, never in the state file
   - passed only as one command's environment
   - sign-in run in the worker's terminal (`cloud.ts`)

**Done when:** a worker set to "Box" starts an issue, you stop the server mid-task and start it again, and the server catches up with the PR the worker opened meanwhile.

## Phase 8: hardening

1. Restart reconciliation: what was running, and whether to resume or requeue it (`reconcile.ts`, `restartRecovery.ts`).
2. Closing cleanup, and a watchdog for stuck sessions (`closeCleanup.ts`, `watchdog.ts`).
3. The terminal keeper, if checked (`ptyHost.ts`, `ptyClient.ts`).

## Then: game states

With phases 5 and 6 done, the server sends everything the game needs. Game work starts with a client-side **world model** (pure and tested): each worker's game state, derived from server events and local timers:

- at their desk working
- idle
- on an errand
- celebrating
- arriving or leaving

The 3D scene, faces, speech bubbles and idle activities all read that model, so none of them talks to the server directly.

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
