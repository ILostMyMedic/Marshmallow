// Who on a floor has something to say, and what: from the server's moments (a PR opened, QA's verdict, a merge and a
// teammate's "Nice one!"), from how the office changed (someone starting an issue or a fix, asking whoever tests their
// PR to look at it, a conflict, red or slow CI, an error) and from the new lines in someone's log (tests going green or
// red, a fix pushed, a merge conflict); and what they answer when you say hi. Pure, so every rule is tested; Chatter.tsx
// feeds it the store and speaks.
// Adapted from cubefarm client/src/world/chatterEvents.ts (MIT): PRs opening, QA verdicts and merges come from moments
// instead of diffs.
import type { Floor, LogLine, Moment, PullInfo, QaRecord, Worker } from '../../../shared/types';
import { readLog, shortFile, workOf, type ChatterEvent, type WorkKind } from './chatterLines';
import type { Priority } from './chatterRules';

/** A line someone should say, `delay` seconds from now. With `near`, the nearest other person on the floor says it. */
export interface Said {
  who: string;
  near?: boolean;
  event: ChatterEvent;
  delay: number;
  priority: Priority;
}

/** The parts of the store the news comes from. */
export interface OfficeSlice {
  workers: Record<string, Worker>;
  qa: Record<string, QaRecord>;
  floors: readonly Floor[];
}

/** Seconds of pending checks before the PR's author grumbles about CI; the demo office runs on a much faster clock. */
export const CI_SLOW = 180;
export const DEMO_CI_SLOW = 20;
/** Log lines older than this (ms) are history, not news (a reconnect replays the whole log). */
export const LOG_FRESH_MS = 20_000;
/** The author speaks once the gong has rung, and a teammate after them (s). */
const MERGE_DELAY = 2.6;
const CONGRATS_DELAY = 4.4;
/** The tester answers the author's request after this long (s). */
const REPLY_DELAY = 2.6;

const isBusy = (w: Worker | undefined) => w?.status === 'working' || w?.status === 'preparing';

/** Who wrote a PR on a floor: by QA's record, else the one whose PR or branch it is (not one testing it). */
export function authorOf(workers: Record<string, Worker>, floorId: string, pr: Pick<PullInfo, 'number' | 'headRefName'>, qa?: Pick<QaRecord, 'devWorkerId'>): Worker | undefined {
  const byQa = qa?.devWorkerId ? workers[qa.devWorkerId] : undefined;
  if (byQa) return byQa;
  const team = Object.values(workers).filter((w) => w.role !== 'ceo' && w.floorId === floorId && w.task?.kind !== 'qa');
  return team.find((w) => w.task?.prNumber === pr.number) ?? team.find((w) => !!w.task?.branch && w.task.branch === pr.headRefName);
}

const said = (who: string, event: ChatterEvent, delay = 0, priority: Priority = 'event', near?: boolean): Said => ({ who, event, delay, priority, ...(near ? { near } : {}) });

/** What a moment from the server has someone say. */
export function momentNews(m: Moment, workers: Record<string, Worker>): Said[] {
  switch (m.type) {
    case 'prOpened':
      return [said(m.workerId, { kind: 'prOpened', pr: m.prNumber })];
    case 'qaPassed':
      return m.qaWorkerId ? [said(m.qaWorkerId, { kind: 'qaPassed', pr: m.prNumber })] : [];
    case 'qaFailed':
      return m.qaWorkerId ? [said(m.qaWorkerId, { kind: 'qaFailed', pr: m.prNumber })] : [];
    case 'merged': {
      const author = m.devWorkerId ? workers[m.devWorkerId] : undefined;
      if (!author) return [];
      return [said(author.id, { kind: 'merged', pr: m.prNumber }, MERGE_DELAY), said(author.id, { kind: 'congrats', to: author.name, pr: m.prNumber }, CONGRATS_DELAY, 'event', true)];
    }
    default:
      return [];
  }
}

/** What changed between two states of the office, as lines to say. `lastFile` is the file someone last edited. */
export function storeNews(prev: OfficeSlice, next: OfficeSlice, lastFile: (id: string) => string | null = () => null): Said[] {
  const out: Said[] = [];
  for (const w of Object.values(next.workers)) {
    const p = prev.workers[w.id];
    if (!p) continue; // someone new: their arrival by elevator is news of its own
    const started = !isBusy(p) && isBusy(w);
    if (started && w.task?.kind === 'issue' && w.task.issueNumber != null) out.push(said(w.id, { kind: 'start', issue: w.task.issueNumber }));
    if (started && w.task?.kind === 'fix' && w.task.prNumber != null) out.push(said(w.id, { kind: 'fixing', pr: w.task.prNumber }));
    if (p.status !== 'error' && w.status === 'error') out.push(said(w.id, { kind: 'error' }));
  }

  for (const f of next.floors) {
    const before = prev.floors.find((x) => x.id === f.id);
    if (!before) continue;
    for (const q of f.pulls) {
      const old = before.pulls.find((x) => x.number === q.number);
      if (!old || q.state !== 'OPEN') continue;
      const author = authorOf(next.workers, f.id, q, next.qa[`${f.id}#${q.number}`]);
      if (!author) continue;
      if (old.mergeable !== 'CONFLICTING' && q.mergeable === 'CONFLICTING') out.push(said(author.id, { kind: 'conflict', pr: q.number, file: lastFile(author.id) }));
      if (old.checks !== 'failing' && q.checks === 'failing') out.push(said(author.id, { kind: 'ciRed', pr: q.number }));
    }
  }

  for (const [key, q] of Object.entries(next.qa)) {
    if (q.status !== 'testing' || prev.qa[key]?.status === 'testing') continue;
    const tester = q.qaWorkerId ? next.workers[q.qaWorkerId] : undefined;
    if (!tester) continue;
    const dev = q.devWorkerId ? next.workers[q.devWorkerId] : undefined;
    // the author asks a teammate to look; testing their own PR, they just get on with it
    if (dev && dev.floorId === q.floorId && dev.id !== tester.id) {
      out.push(said(dev.id, { kind: 'askQa', pr: q.prNumber, tester: tester.name }));
      out.push(said(tester.id, { kind: 'qaStart', pr: q.prNumber }, REPLY_DELAY));
    } else out.push(said(tester.id, { kind: 'qaStart', pr: q.prNumber }));
  }
  return out;
}

/**
 * Open PRs whose checks have been pending for `slow` seconds: their author grumbles, once per wait. `since` (when each
 * PR's checks started pending, epoch ms) and `done` (whose grumble is said) are kept between calls.
 */
export function slowChecks(floors: readonly Floor[], workers: Record<string, Worker>, since: Map<string, number>, done: Set<string>, now: number, slow = CI_SLOW): Said[] {
  const out: Said[] = [];
  const seen = new Set<string>();
  for (const f of floors) {
    for (const q of f.pulls) {
      const key = `${f.id}#${q.number}`;
      if (q.state !== 'OPEN' || q.checks !== 'pending') continue;
      seen.add(key);
      if (!since.has(key)) since.set(key, now);
      if (now - since.get(key)! < slow * 1000 || done.has(key)) continue;
      done.add(key);
      const author = authorOf(workers, f.id, q);
      if (author) out.push(said(author.id, { kind: 'ciSlow', pr: q.number }));
    }
  }
  for (const key of [...since.keys()]) {
    if (seen.has(key)) continue;
    since.delete(key);
    done.delete(key);
  }
  return out;
}

/** The news in someone's newest log lines (epoch ms `now`): the last of tests passing or failing, a fix pushed, a conflict. */
export function logNews(w: Worker, lines: readonly LogLine[], now: number): Said[] {
  let news: ChatterEvent | null = null;
  for (const l of lines) {
    if (now - l.t > LOG_FRESH_MS) continue;
    const n = readLog(l);
    if (!n) continue;
    if (n.kind === 'testsGreen' || n.kind === 'testsRed') news = { kind: n.kind };
    else if (n.kind === 'pushed' && w.task?.kind === 'fix') news = { kind: 'fixPushed', pr: w.task.prNumber };
    else if (n.kind === 'conflict') news = { kind: 'conflict', pr: w.task?.prNumber ?? null, file: n.file };
  }
  return news ? [said(w.id, news)] : [];
}

/** The file someone last edited or wrote, from their log (newest last). */
export function lastFile(lines: readonly LogLine[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.kind !== 'tool' || !l.tool) continue;
    const w = workOf(l.tool, l.text);
    if (w?.work === 'edit' && w.detail) return shortFile(w.detail);
  }
  return null;
}

/** What someone is doing right now, from their latest tool call (within `freshMs`), for small talk about their work. */
export function currentWork(lines: readonly LogLine[], now: number, freshMs = 45_000): { work: WorkKind; detail: string | null } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (now - l.t > freshMs) return null;
    if (l.kind === 'thinking') return { work: 'think', detail: null };
    if (l.kind === 'tool' && l.tool) {
      const w = workOf(l.tool, l.text);
      if (w) return w;
    }
  }
  return null;
}

/** A merge stays someone's news for a greeting this long (ms). */
export const SHIPPED_MS = 10 * 60_000;

/** What someone says when you say hi: a quip about their work (a fresh merge, QA, a fix) or just hello. */
export function greeting(w: Worker, office: Pick<OfficeSlice, 'qa' | 'floors'>, manager: string, now: number): Extract<ChatterEvent, { kind: 'greet' }> {
  const pr = w.task?.prNumber ?? null;
  const base = { kind: 'greet' as const, manager, pr, issue: w.task?.issueNumber ?? null };
  if (w.role === 'ceo') return { ...base, mood: 'ceo' };
  const pull = pr != null ? office.floors.find((f) => f.id === w.floorId)?.pulls.find((p) => p.number === pr) : undefined;
  const qa = pr != null ? office.qa[`${w.floorId}#${pr}`] : undefined;
  if (w.task?.kind === 'qa') return { ...base, mood: isBusy(w) && pr != null ? 'testing' : 'free' };
  if (pull?.state === 'MERGED' && pull.mergedAt && now - Date.parse(pull.mergedAt) < SHIPPED_MS) return { ...base, mood: 'shipped' };
  if (isBusy(w) && w.task?.kind === 'fix') return { ...base, mood: 'fixing' };
  if (pull?.state === 'OPEN' && (qa?.status === 'queued' || qa?.status === 'testing')) return { ...base, mood: 'inQa' };
  if (isBusy(w) && w.task?.issueNumber != null) return { ...base, mood: 'working' };
  return { ...base, mood: 'free' };
}
