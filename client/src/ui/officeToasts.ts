// What the office's toasts say (Toasts.tsx shows them): a line for each moment the server sends (a merge, a PR opened,
// QA's verdict, new issues, a hire or a leaver), a worker whose session failed, a question from a worker, and the CEO's
// replies and the office's notices while the phone is shut. Pure, so the tests check every line. Adapted from cubefarm
// server/swarm.ts's toasts and client/src/store.ts's pushToast (MIT): built in the browser from what the server already
// sends, and the update, usage, alarm and coin toasts are cut.
import type { Floor, Moment, OfficeMessage, Question, Worker } from '../../../shared/types';

export type ToastLevel = 'info' | 'good' | 'warn' | 'error';

export interface ToastLine {
  level: ToastLevel;
  text: string;
}

/** How long a toast stays (ms): errors and questions longer, since they want you. */
export const toastMs = (level: ToastLevel) => (level === 'error' || level === 'warn' ? 9000 : 5000);

/** At most this many toasts at once; a new one pushes the oldest out. */
export const MAX_TOASTS = 5;

const clip = (s: string, n = 100) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** A floor's short name: the repo's, without its owner. */
export const floorName = (floors: Floor[], id: string | null) => {
  const f = floors.find((x) => x.id === id);
  return f ? f.fullName.split('/').pop()! : (id ?? '');
};

const nameOf = (workers: Record<string, Worker>, id: string | null) => (id && workers[id]?.name) || null;

/** The toast for moment `m`, or null for none. */
export function momentToast(m: Moment, floors: Floor[], workers: Record<string, Worker>): ToastLine | null {
  switch (m.type) {
    case 'merged': {
      const dev = nameOf(workers, m.devWorkerId);
      return { level: 'good', text: `🎉 ${dev ? `${dev}'s ` : ''}PR #${m.prNumber} merged on ${floorName(floors, m.floorId)}` };
    }
    case 'prOpened': {
      const dev = nameOf(workers, m.workerId) ?? 'Someone';
      return { level: 'info', text: `📬 ${dev} opened PR #${m.prNumber}${m.issueNumber ? ` for issue #${m.issueNumber}` : ''}` };
    }
    case 'qaPassed':
      return { level: 'good', text: `✅ PR #${m.prNumber} passed QA on ${floorName(floors, m.floorId)}` };
    case 'qaFailed':
      return { level: 'info', text: `🔁 PR #${m.prNumber} failed QA: back for a fix` };
    case 'issuesFiled':
      return { level: 'info', text: m.numbers.length === 1 ? `📋 Issue #${m.numbers[0]} filed on ${floorName(floors, m.floorId)}` : `📋 ${m.numbers.length} new issues on ${floorName(floors, m.floorId)}` };
    case 'hired':
      return { level: 'info', text: m.worker.role === 'ceo' ? `👔 ${m.worker.name} is your CEO` : `👋 ${m.worker.name} joined ${floorName(floors, m.worker.floorId)}` };
    case 'left':
      return { level: 'info', text: m.worker.role === 'ceo' ? `👔 ${m.worker.name} left the company` : `📦 ${m.worker.name} left ${floorName(floors, m.worker.floorId)}` };
    case 'trophy':
      return { level: 'good', text: `🏆 Trophy: ${m.trophy.icon} ${m.trophy.title}` };
  }
}

/** A worker's session failing: the status went to error. */
export const errorToast = (w: Worker): ToastLine => ({ level: 'error', text: `⚠️ ${w.name} needs help: their session failed` });

/** A new question from a worker, waiting for an answer on the phone. */
export const questionToast = (q: Question): ToastLine => ({ level: 'warn', text: `❓ ${q.from} asks about #${q.issueNumber}: “${clip(q.text, 80)}” (P to answer)` });

/** The CEO's reply or the office's notice, while the phone is shut; null for your own messages. */
export function messageToast(m: OfficeMessage, ceoName: string | null): ToastLine | null {
  if (m.from === 'manager') return null;
  if (m.from === 'ceo') return { level: 'info', text: `📱 ${ceoName ?? 'The CEO'}: ${clip(m.text)}` };
  return { level: 'info', text: `📣 ${clip(m.text)}` };
}
