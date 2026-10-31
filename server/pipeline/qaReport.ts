// A QA session's report: the JSON schema the session answers with, reading the answer back (from the structured
// result, or from the last JSON block in its final message), and the comment the office posts on the PR.
// Adapted from cubefarm server/swarm.ts (MIT): QA_SCHEMA, parseReport, renderQaComment.
import type { QaCheck } from '../../shared/types.ts';
import type { SessionResult } from '../sessions/session.ts';

export interface QaReport {
  verdict: 'pass' | 'fail';
  summary: string;
  checks: QaCheck[];
  commands: { command: string; result: string }[];
  screenshots: string[];
  fixInstructions?: string;
}

export const QA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'checks', 'commands', 'screenshots'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'], description: 'pass only if the change works and meets the issue requirements' },
    summary: { type: 'string', description: 'Two to four sentences for the pull request comment.' },
    checks: {
      type: 'array',
      description: 'Each acceptance criterion, test run or scenario you verified.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'result', 'details'],
        properties: {
          name: { type: 'string' },
          result: { type: 'string', enum: ['pass', 'fail', 'skip'] },
          details: { type: 'string', description: 'What you did and what you observed.' },
        },
      },
    },
    commands: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['command', 'result'],
        properties: { command: { type: 'string' }, result: { type: 'string', description: 'e.g. "42 passed, 0 failed"' } },
      },
    },
    screenshots: { type: 'array', items: { type: 'string' }, description: 'One short caption per screenshot you took with browser_take_screenshot, in the order you took them.' },
    fixInstructions: { type: 'string', description: 'When the verdict is fail: precise, actionable instructions for the developer.' },
  },
} as const;

/** The report in a finished QA session, or null when there's none (no JSON, or no verdict). */
export function parseReport(result: Pick<SessionResult, 'structured' | 'text'>): QaReport | null {
  let raw: unknown = result.structured;
  if (raw === undefined) {
    const blocks = [...result.text.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g)].map((m) => m[1]).reverse();
    for (const candidate of [...blocks, result.text.match(/\{[\s\S]*\}/)?.[0]]) {
      if (!candidate) continue;
      try {
        raw = JSON.parse(candidate);
        break;
      } catch {
        // the next candidate
      }
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.verdict !== 'pass' && r.verdict !== 'fail') return null;
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    verdict: r.verdict,
    summary: String(r.summary ?? ''),
    checks: list(r.checks).map((c: Record<string, unknown>) => ({
      name: String(c?.name ?? ''),
      result: c?.result === 'fail' || c?.result === 'skip' ? c.result : 'pass',
      details: String(c?.details ?? ''),
    })),
    commands: list(r.commands).map((c: Record<string, unknown>) => ({ command: String(c?.command ?? ''), result: String(c?.result ?? '') })),
    screenshots: list(r.screenshots).map(String),
    ...(r.fixInstructions ? { fixInstructions: String(r.fixInstructions) } : {}),
  };
}

/** Screenshots posted with a report: the newest this many of the session's. */
export const SHOTS_POSTED = 8;

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp' };

/** Where each posted screenshot goes on the evidence branch, with its caption from the report. */
export function evidenceFiles(shots: { mime: string }[], report: QaReport, prNumber: number, round: number, now: number): { index: number; path: string; caption: string }[] {
  const first = Math.max(0, shots.length - SHOTS_POSTED);
  return shots.slice(first).map((s, i) => ({
    index: first + i,
    path: `pr-${prNumber}/round-${round}-${now.toString(36)}/${String(i + 1).padStart(2, '0')}.${EXTENSIONS[s.mime] ?? 'img'}`,
    caption: report.screenshots[first + i] ?? `Screenshot ${first + i + 1}`,
  }));
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const MARKS = { pass: '✅', fail: '❌', skip: '⏭️' } as const;

/** The PR comment for a QA report, with the screenshots that made it to the evidence branch. */
export function renderQaComment(report: QaReport, o: { round: number; tester: string; shots: { url: string; caption: string }[] }): string {
  const pass = report.verdict === 'pass';
  return [
    `## ${pass ? '✅ QA passed' : '❌ QA failed'} (round ${o.round})`,
    '',
    report.summary,
    ...(report.checks.length ? ['', '| | Check | Details |', '| --- | --- | --- |', ...report.checks.map((c) => `| ${MARKS[c.result]} | ${cell(c.name)} | ${cell(c.details)} |`)] : []),
    ...(report.commands.length ? ['', '**Commands run**', ...report.commands.map((c) => `- \`${c.command.replace(/`/g, "'")}\`: ${c.result}`)] : []),
    ...(!pass && report.fixInstructions ? ['', '**What needs fixing**', report.fixInstructions] : []),
    ...(o.shots.length ? ['', '**Screenshots**', ...o.shots.map((s) => `![${s.caption.replace(/[[\]]/g, '')}](${s.url})\n${s.caption}`)] : []),
    '',
    `<sub>Tested by ${o.tester}, a Marshmallow worker, in a fresh session.</sub>`,
  ].join('\n');
}
