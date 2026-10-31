// Adapted from cubefarm server/pacing.ts (MIT).
import type { UsageView, UsageWarningView } from '../../shared/types.ts';
import { clock, limitName, usedPercent } from '../../shared/usage.ts';

export { clock };

// Pacing new work on Claude's usage warnings (#40). Every worker shares one subscription. When Claude warns that
// usage is getting high, the office slows down instead of running into the hard limit: finishing beats starting.
// QA, QA fixes and CEO jobs start as normal; new issues only while fewer than settings.pacingSessions sessions run.

/** How long pacing lasts when Claude doesn't say when the window resets. */
export const PACING_MS = 60 * 60_000;
export const DEFAULT_PACING_SESSIONS = 3;

/** What a session is started for. Only new issues are held back while pacing. */
export type WorkKind = 'issue' | 'qa' | 'fix' | 'ceo';

export interface UsageClock {
  now: number;
  pausedUntil: number; // Claude rejected a session for the usage limit: nothing new starts before this
  pacingUntil: number; // Claude warned about usage: new issues are paced until this
}

/** May work of this kind start now? A rejection pauses everything; pacing caps new issues at `pacingSessions` running. */
export function mayStart(kind: WorkKind, c: UsageClock & { running: number; pacingSessions: number }): boolean {
  if (c.now < c.pausedUntil) return false;
  if (kind === 'issue' && c.now < c.pacingUntil) return c.running < c.pacingSessions;
  return true;
}

/** The usage state for the snapshot, with the last warning's details for the usage meter. */
export function usageView(c: UsageClock, warning: UsageWarningView | null = null): UsageView {
  if (c.now < c.pausedUntil) return { state: 'paused', until: c.pausedUntil, warning };
  if (c.now < c.pacingUntil) return { state: 'pacing', until: c.pacingUntil, warning };
  return { state: 'normal', until: null, warning };
}

/** company.usage for the CEO: "normal", "pacing until 14:30" or "paused until 14:30". */
export function usageLabel(u: Pick<UsageView, 'state' | 'until'>, now: number): string {
  return u.state === 'normal' || u.until === null ? 'normal' : `${u.state} until ${clock(u.until, now)}`;
}

/** Clamp the pacing cap from the settings (1-32, default 3). */
export function clampPacingSessions(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(32, n) : DEFAULT_PACING_SESSIONS;
}

/** A usage warning as the SDK reports it. utilization may be a fraction (0.82) or a percentage (82). */
export interface UsageWarning {
  resetsAt: number | null; // epoch ms
  rateLimitType: string | null;
  utilization: number | null;
}

/** The phone message when pacing starts. */
export function pacingMessage(w: UsageWarning, until: number, sessions: number, now: number): string {
  const v = warningView(w, now);
  const what = [v.limit, v.pct === null ? null : `${v.pct}%`].filter(Boolean).join(', ');
  return `🐢 Claude's usage is getting high${what ? ` (${what})` : ''}. Until ${clock(until, now)} the office finishes open work first and starts at most ${sessions} session${sessions === 1 ? '' : 's'} at a time.`;
}

/** A warning as the usage meter shows it: which limit, how full (0-100) and when it resets. */
export function warningView(w: UsageWarning, at: number): UsageWarningView {
  return { limit: w.rateLimitType ? limitName(w.rateLimitType) : null, pct: w.utilization === null ? null : usedPercent(w.utilization), resetsAt: w.resetsAt, at };
}
