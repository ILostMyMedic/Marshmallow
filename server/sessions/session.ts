// The session contract: one Claude Code session on one task, in a worker's worktree. The pipeline starts sessions
// through Backend.startSession and only ever sees these types, so it can't tell the real CLI from the demo's fakes.
// Adapted from cubefarm server/agentRunner.ts (MIT).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CeoJobKind, EffortLevel, LogEntry, TaskKind } from '../../shared/types.ts';
import type { UsageWarning } from '../pipeline/pacing.ts';
import type { BoxTarget } from './boxCli.ts';
import type { WorkerTerminal } from './terminal.ts';

export interface SessionOptions {
  cwd: string;
  prompt: string;
  /** Appended to Claude Code's system prompt: the office's instructions for this kind of task. */
  systemAppend: string;
  /** A Claude model, or `ollama/<name>` (shared/models.ts). */
  model: string;
  effort: EffortLevel;
  browserTesting: boolean;
  role: 'worker' | 'ceo';
  /** The task the session is for; null or absent for the CEO. */
  task?: TaskKind | null;
  /** What the task is about: the status line shows it, and the demo's fake sessions act on it. */
  subject?: { issueNumber: number | null; prNumber: number | null; title: string; round?: number };
  /** The worker's machine's environment (its temp folder), on top of the office's. */
  env?: Record<string, string>;
  /** JSON schema for a structured final answer (QA reports). */
  outputSchema?: Record<string, unknown>;
  resumeSessionId?: string;
  /** Who and on what, for the CLI's session name and status line, e.g. "Ada · #12 Add dark mode". */
  label?: string;
  /** Leave the CLI waiting at its prompt when the task is done, for the manager and for follow-ups. */
  keepAlive?: boolean;
  workerId?: string;
  /** The worker's terminal: the real CLI runs in it, the demo prints into it. */
  terminal?: WorkerTerminal;
  /** The CEO's office tools, served to its CLI over MCP. */
  office?: OfficeTools;
  /** Folders the session may read besides its own (the CEO reads the floors' clones). */
  addDirs?: string[];
  /** What the CEO's job is: the demo's scripted CEO acts on it. */
  ceoJob?: { kind: CeoJobKind; floorId: string | null; text: string };
  /** A Box worker's session: where its CLI runs (absent: on this computer). */
  box?: BoxTarget;
  /** Pick up the worker's CLI that kept working while the office restarted, instead of starting one. */
  reattach?: boolean;
}

/** The office's tools for the CEO. */
export interface OfficeTools {
  /** A fresh MCP server with the tools, for one request (a shared one left later sessions without tools). */
  serve(): McpServer;
  /** Runs a tool without a model in the loop (the demo's CEO); a refusal comes back as text starting "Refused:". */
  call(name: string, args: Record<string, unknown>): Promise<string>;
}

export interface SessionResult {
  ok: boolean;
  /** The final message: where a build's PR link is. */
  text: string;
  costUsd: number;
  turns: number;
  errors: string[];
  /** The structured final answer, when outputSchema asked for one. */
  structured?: unknown;
  /** The manager interrupted the turn in the worker's terminal (Esc). */
  interrupted?: boolean;
  /** A Box's Claude Code isn't signed in: the worker waits for the manager to sign it in. */
  signedOut?: boolean;
}

export interface SessionCallbacks {
  log(entries: LogEntry[]): void;
  /** The tool running now; null between tools. */
  tool(name: string | null): void;
  /** The session to resume next time; null: there's none to resume. */
  sessionId(id: string | null): void;
  browserUrl(url: string): void;
  screenshot(data: Buffer, mime: string): void;
  /** The final text of each turn: the reply to the prompt and to every message sent while it ran. */
  turn?(text: string): void;
  /** Claude turned the session away at the subscription's usage limit (epoch ms when it resets, if known). */
  limited?(resetsAt: number | null): void;
  /** Claude warned that the subscription's usage is getting high. */
  usageWarning?(info: UsageWarning): void;
  finished(result: SessionResult): void;
}

export interface SessionHandle {
  /** A message from the manager, injected while the session runs. */
  send(text: string): void;
  stop(): void;
}
