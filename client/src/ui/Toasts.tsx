// The office's toasts, bottom left: what just happened (officeToasts.ts has the words), stacked and fading, a click
// dismissing one. What was already there when the tab connected isn't news, so the first snapshot only sets the
// baseline. Messages, questions and the CEO's words in chats and discussions don't toast while the desktop, which shows
// them, is open, but each piece of news still sounds its notification (notifySfx.ts). Adapted from cubefarm client/src/store.ts's toasts and ui/HUD.tsx (MIT).
import { useEffect, useState } from 'react';
import type { Moment, WorkerStatus } from '../../../shared/types';
import { useStore, type Office } from '../store';
import { useView } from '../world/view';
import { cue } from './notifySfx';
import { messageCue, momentCue } from './notifyRules';
import { deskLines, deskToast, errorToast, MAX_TOASTS, messageToast, momentToast, questionToast, toastMs, type ToastLine } from './officeToasts';

/** One moment's identity, for telling the new ones from those already shown. */
const keyOf = (m: Moment) =>
  `${m.type}:${m.at}:${m.type === 'earned' ? `${m.floorId}#${m.prNumber}` : 'prNumber' in m ? m.prNumber : 'worker' in m ? m.worker.id : 'trophy' in m ? m.trophy.id : m.numbers.join(',')}`;

interface Seen {
  moments: Set<string>;
  question: number;
  message: number;
  status: Map<string, WorkerStatus>;
  desk: Set<string>; // deskLines' keys
}

const baseline = (o: Office): Seen => ({
  moments: new Set(o.moments.map(keyOf)),
  question: Math.max(0, ...o.questions.map((q) => q.id)),
  message: Math.max(0, ...o.messages.map((m) => m.id)),
  status: new Map(Object.values(o.workers).map((w) => [w.id, w.status])),
  desk: new Set(deskLines(o.desk).map((l) => l.key)),
});

export function Toasts() {
  const [toasts, setToasts] = useState<(ToastLine & { id: number })[]>([]);
  useEffect(() => {
    let seq = 1;
    const push = (t: ToastLine) => {
      const id = seq++;
      setToasts((all) => [...all.slice(-(MAX_TOASTS - 1)), { ...t, id }]);
      setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), toastMs(t.level));
    };
    let seen: Seen | null = null;
    let lastDesk: Office['desk'] | null = null;
    const check = (o: Office) => {
      if (!o.loaded) return;
      if (!seen) {
        seen = baseline(o);
        lastDesk = o.desk;
        return;
      }
      const keys = new Set<string>();
      for (const m of o.moments) {
        const k = keyOf(m);
        keys.add(k);
        if (seen.moments.has(k)) continue;
        cue(momentCue(m.type));
        const t = momentToast(m, o.floors, o.workers);
        if (t) push(t);
      }
      seen.moments = keys;
      for (const w of Object.values(o.workers)) {
        if (w.status === 'error' && seen.status.get(w.id) !== 'error') {
          cue('trouble');
          push(errorToast(w));
        }
        seen.status.set(w.id, w.status);
      }
      const deskOpen = useView.getState().overlay?.kind === 'desktop';
      for (const q of o.questions) {
        if (q.id <= seen.question || q.answer !== null) continue;
        cue('question');
        if (!deskOpen) push(questionToast(q));
      }
      seen.question = Math.max(seen.question, ...o.questions.map((q) => q.id));
      const ceo = Object.values(o.workers).find((w) => w.role === 'ceo')?.name ?? null;
      for (const m of o.messages) {
        if (m.id <= seen.message) continue;
        const ring = messageCue(m.from);
        if (ring) cue(ring);
        if (deskOpen) continue;
        const t = messageToast(m, ceo);
        if (t) push(t);
      }
      seen.message = Math.max(seen.message, ...o.messages.map((m) => m.id));
      // The whole desk comes with each change to it; the logs come far more often, so only a new desk is looked through.
      if (o.desk !== lastDesk) {
        lastDesk = o.desk;
        const lines = deskLines(o.desk);
        for (const l of lines) {
          if (seen.desk.has(l.key)) continue;
          const t = deskToast(l, ceo);
          if (!t) continue;
          cue(l.kind === 'discussion' ? 'question' : 'message');
          if (!deskOpen) push(t);
        }
        seen.desk = new Set(lines.map((l) => l.key));
      }
    };
    check(useStore.getState());
    return useStore.subscribe(check);
  }, []);
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <button key={t.id} className={`toast toast-${t.level}`} onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
          {t.text}
        </button>
      ))}
    </div>
  );
}
