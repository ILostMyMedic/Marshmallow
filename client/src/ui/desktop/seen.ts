// What you've read on the desktop, kept per browser: per chat the newest CEO reply you've seen, and the newest notice.
// Shared with the HUD's badge (useDesktopNews), so it drops as soon as you read something. Threads waiting on you need
// no record: they wait until you reply. Adapted from cubefarm client/src/ui/Phone.tsx's seen tracking (MIT).
import { useMemo } from 'react';
import { create } from 'zustand';
import { useStore } from '../../store';
import { deskNews, type DeskSeen } from './desk';

const SEEN_KEY = 'marshmallow:deskSeen';
const PHONE_KEY = 'marshmallow:phoneSeen'; // the phone's, before the desktop: its notices carry over

function loadSeen(): DeskSeen {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<DeskSeen>;
      return { chats: v.chats && typeof v.chats === 'object' ? v.chats : {}, notices: Number(v.notices) || 0 };
    }
    // The phone kept the CEO's texts and the notices apart; both are notices now, so the older mark holds.
    const old = JSON.parse(localStorage.getItem(PHONE_KEY) ?? '{}') as { chat?: number; notices?: number };
    return { chats: {}, notices: Math.min(Number(old.chat) || 0, Number(old.notices) || 0) };
  } catch {
    return { chats: {}, notices: 0 };
  }
}

function save(seen: DeskSeen) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // not saved: the badges come back on the next visit
  }
}

export const useDeskSeen = create<{ seen: DeskSeen; markChat(id: number, at: number): void; markNotices(at: number): void }>()((set, get) => ({
  seen: typeof window === 'undefined' ? { chats: {}, notices: 0 } : loadSeen(),
  markChat(id, at) {
    const { seen } = get();
    if (at <= (seen.chats[id] ?? 0)) return;
    const next = { ...seen, chats: { ...seen.chats, [id]: at } };
    set({ seen: next });
    save(next);
  },
  markNotices(at) {
    const { seen } = get();
    if (at <= seen.notices) return;
    const next = { ...seen, notices: at };
    set({ seen: next });
    save(next);
  },
}));

/** What's new on the desktop: threads waiting on you, chats with unread replies, notices not read. */
export function useDesktopNews() {
  const desk = useStore((s) => s.desk);
  const questions = useStore((s) => s.questions);
  const messages = useStore((s) => s.messages);
  const seen = useDeskSeen((s) => s.seen);
  return useMemo(() => deskNews({ chats: desk.chats, discussions: desk.discussions, questions, messages }, seen), [desk, questions, messages, seen]);
}
