// The session contract: one Claude Code session on one task, in a worker's worktree. The pipeline starts sessions
// through Backend.startSession and only ever sees these types, so it can't tell the real CLI from the demo's fakes.
// Adapted from cubefarm server/agentRunner.ts (MIT).
import type { EffortLevel, LogEntry, TaskKind } from '../../shared/types.ts';
import type { UsageWarning } from '../pipeline/pacing.ts';

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
