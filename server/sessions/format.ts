// A session's tool calls and results as log lines, the way Claude Code shows them: "⏺ Read src/store.ts", "⎿ Read 120
// lines". Paths inside the worktree show relative to it.
// Adapted from cubefarm server/agentRunner.ts (MIT): its formatting helpers.
import fs from 'node:fs';
import path from 'node:path';
import type { LogEntry } from '../../shared/types.ts';

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function rel(cwd: string, p: unknown) {
  const s = String(p ?? '');
  if (!s) return '';
  const r = path.relative(cwd, path.resolve(cwd, s));
  return r && !r.startsWith('..') ? r.replaceAll('\\', '/') : s;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Workers often prefix commands with `cd "<worktree>" &&` and print absolute paths; show them relative instead. */
export function tidyPaths(cwd: string, text: string): string {
  let out = text;
  for (const v of new Set([cwd, cwd.replaceAll('\\', '/')])) {
    out = out.replace(new RegExp(`^cd\\s+"?${escapeRe(v)}"?\\s*(&&|;)\\s*`, 'i'), '');
    out = out.replace(new RegExp(`${escapeRe(v)}[\\\\/]?`, 'gi'), './');
  }
  return out;
}

/** One line for a tool call. */
export function describeTool(cwd: string, name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return `$ ${clip(tidyPaths(cwd, String(input.command ?? '')).split('\n')[0], 220)}`;
    case 'Read':
      return `Read ${rel(cwd, input.file_path)}`;
    case 'Write':
      return `Write ${rel(cwd, input.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
      return `Edit ${rel(cwd, input.file_path)}`;
    case 'Glob':
      return `Glob ${input.pattern}`;
    case 'Grep':
      return `Grep "${clip(String(input.pattern ?? ''), 80)}"`;
    case 'WebFetch':
      return `Fetch ${input.url}`;
    case 'WebSearch':
      return `Search "${input.query}"`;
    case 'Task':
    case 'Agent':
      return `Subagent: ${input.description ?? ''}`;
    case 'TodoWrite':
      return 'Update todo list';
    case 'ToolSearch':
      return `Load tools ${String(input.query ?? '').replace(/^select:/, '')}`;
  }
  if (name.startsWith('mcp__playwright__')) {
    const action = name.replace('mcp__playwright__browser_', '').replace('mcp__playwright__', '');
    const detail = input.url ?? input.element ?? input.text ?? '';
    return `🌐 ${action}${detail ? ` ${clip(String(detail), 120)}` : ''}`;
  }
  if (name.startsWith('mcp__office__')) return describeOfficeTool(name.slice('mcp__office__'.length), input);
  return `${name}(${clip(JSON.stringify(input), 140)})`;
}

/** One of the CEO's office tool calls, for its log. Adapted from cubefarm server/agentRunner.ts (MIT). */
export function describeOfficeTool(action: string, input: Record<string, unknown>): string {
  const floor = input.floor != null ? ` → floor ${input.floor}` : '';
  const why = (key: string) => (input[key] ? `: ${clip(String(input[key]), 90)}` : '');
  switch (action) {
    case 'company_status':
      return '🏢 company_status';
    case 'worker_detail':
      return `🔎 worker_detail ${String(input.worker_id ?? '')}`;
    case 'set_floor_profile':
      return `🗂️ set_floor_profile${floor}${why('summary')}`;
    case 'scale_team':
      return `📈 scale_team floor ${String(input.floor ?? '?')} → ${String(input.size ?? '?')}${why('reason')}`;
    case 'configure_worker': {
      const set = [input.model, input.effort].filter((x) => typeof x === 'string' && x !== '');
      return `⚙️ configure_worker ${String(input.worker_id ?? '')}${set.length ? `: ${set.join(' · ')}` : ''}`;
    }
    case 'file_issue':
      return `📝 file_issue "${clip(String(input.title ?? ''), 70)}"${floor}`;
    case 'set_dependencies':
      return `🔗 set_dependencies #${String(input.number ?? '?')}${floor}${Array.isArray(input.depends_on) ? ` · depends on ${input.depends_on.map((n) => `#${n}`).join(', ') || 'nothing'}` : ''}`;
    case 'close_issue':
      return `🗂️ close_issue #${String(input.number ?? '?')}${floor}`;
    case 'ask_manager':
      return `❓ ask_manager #${String(input.number ?? '?')}${floor}${why('question')}`;
  }
  return `🏢 ${action}(${clip(JSON.stringify(input), 120)})`;
}

/** A TodoWrite's list, one line per item. */
export function todoLines(input: Record<string, unknown>): LogEntry[] {
  const todos = Array.isArray(input.todos) ? (input.todos as { content?: string; status?: string }[]) : [];
  return todos.slice(0, 12).map((t) => ({
    kind: 'result' as const,
    text: `  ${t.status === 'completed' ? '☒' : t.status === 'in_progress' ? '◐' : '☐'} ${clip(t.content ?? '', 150)}`,
  }));
}

/** The text of a tool result's content blocks. */
export function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: 'text'; text: string } => b?.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

const lineCount = (text: string) => text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '').length;

/** A tool's result in a line or few: Claude Code's one-liners for the file tools, the first lines of anything else. */
export function summariseResult(cwd: string, tool: string, text: string): LogEntry[] {
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return [{ kind: 'result', text: '  ⎿ Updated' }];
  if (tool === 'Write') return [{ kind: 'result', text: '  ⎿ Saved' }];
  if (tool === 'Read') return [{ kind: 'result', text: `  ⎿ Read ${lineCount(text)} lines` }];
  if (tool === 'Glob') return [{ kind: 'result', text: `  ⎿ Found ${lineCount(text)} files` }];
  const lines = tidyPaths(cwd, text)
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim() !== '');
  if (lines.length === 0) return [{ kind: 'result', text: '  ⎿ (no output)' }];
  const shown = lines.slice(0, 3).map((l, i) => ({ kind: 'result' as const, text: `${i === 0 ? '  ⎿ ' : '    '}${clip(l, 170)}` }));
  if (lines.length > 3) shown.push({ kind: 'result', text: `    … +${lines.length - 3} lines` });
  return shown;
}

/**
 * A Playwright screenshot saved to a file (browser_take_screenshot with a filename) comes back as a link, not an
 * image: the file, read from the worker's worktree, so it still counts as QA evidence.
 */
export function screenshotFile(cwd: string, text: string): { data: Buffer; mime: string } | null {
  const file = text.match(/\]\(([^)\s]+\.(png|jpe?g))\)/i);
  if (!file) return null;
  try {
    return { data: fs.readFileSync(path.resolve(cwd, file[1])), mime: /png$/i.test(file[2]) ? 'image/png' : 'image/jpeg' };
  } catch {
    return null;
  }
}
