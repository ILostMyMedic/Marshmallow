// Everyone's speech bubbles, out loud: every bubble that goes up (world/people.ts `say`: the chatter, an answer to your
// hello, Mia's tour, the CEO's stand-up and walk, a snack or a game's reaction) is babbled in the speaker's own voice
// from their head, and a bubble of only emoji gets a little interjection ("yay!", "mm-hm"). Character.tsx says who's
// who (their name, look and role, for their voice). The nearest MAX_SPEAKERS voices win; a farther one stays a bubble.
// Nothing new is voiced behind a panel, while the elevator carries you or in a hidden tab. New in Marshmallow: cubefarm
// voices its chatter's lines only (Chatter.tsx).

import { admitSpeaker, DROP_NEW, MAX_SPEAKERS, PLAY } from '../world/chatterRules';
import { useRide } from '../world/elevatorRide';
import { bodyState, onSay } from '../world/people';
import { useView } from '../world/view';
import { babble, hushBabble, moveBabble } from './babble';
import { babbleVoice, planBabble, spokenText, type BabbleVoice } from './babbleRules';
import { listenerAt, recordSfx } from './sfx';

interface Person {
  name: string;
  voice: BabbleVoice;
}

interface Voicing {
  id: string;
  /** performance.now() when the line ends. */
  until: number;
  /** How far from you (m), for who gives way to a nearer voice. */
  d: number;
}

const people = new Map<string, Person>();
const slots: (Voicing | null)[] = Array.from({ length: MAX_SPEAKERS }, () => null);
/** What each person last said out loud and when (performance.now()): the same bubble put up again soon isn't said twice. */
const lastSaid = new Map<string, { text: string; at: number }>();
const REPEAT_MS = 2500;

/** Character.tsx: someone drawn on this floor, and the voice they speak in. The returned function forgets them. */
export function registerVoice(id: string, name: string, look: 'feminine' | 'masculine', role: 'worker' | 'ceo') {
  const p: Person = { name, voice: babbleVoice(id, look, role) };
  people.set(id, p);
  return () => {
    if (people.get(id) === p) people.delete(id);
  };
}

/** Their mouth, more or less: lower while seated. */
const headY = (sit: number) => 1.25 * sit + 1.6 * (1 - sit);

function expire(now: number) {
  for (let i = 0; i < slots.length; i++) if (slots[i] && now >= slots[i]!.until) slots[i] = null;
}

/** A bubble went up (or came down: its voice stops with it). */
function voice(id: string, text: string | null) {
  const now = performance.now();
  expire(now);
  const mine = slots.findIndex((s) => s?.id === id);
  if (text === null) {
    if (mine >= 0) {
      hushBabble(mine);
      slots[mine] = null;
    }
    return;
  }
  const p = people.get(id);
  const b = bodyState(id);
  const said = spokenText(text, id);
  if (!p || !b || !said) return;
  const last = lastSaid.get(id);
  if (last && last.text === text && now - last.at < REPEAT_MS) return;
  lastSaid.set(id, { text, at: now });
  if (useView.getState().overlay || useRide.getState().phase === 'dark' || document.hidden) return;
  const ear = listenerAt();
  const pos = { x: b.x, y: headY(b.sit), z: b.z };
  const d = Math.hypot(pos.x - ear.x, pos.y - ear.y, pos.z - ear.z);
  let slot = mine;
  if (slot < 0) {
    const active = slots.flatMap((s, i) => (s ? [{ d: s.d, i }] : []));
    const r = admitSpeaker(active, d);
    if (r === DROP_NEW) {
      recordSfx(`babble:${p.name}`, { group: 'people', pos, peak: 0, played: false, reach: 'far' }); // crowded out by nearer voices
      return;
    }
    slot = r === PLAY ? slots.findIndex((s) => !s) : active[r].i;
  }
  const plan = planBabble(said, p.voice);
  slots[slot] = babble(slot, pos, plan.notes, p.voice, p.name) ? { id, until: now + plan.length * 1000 + 100, d } : null;
}

/** Every frame (world/Sounds.tsx): the voices follow their speakers' heads as they walk and talk. Allocates nothing. */
export function followVoices() {
  const now = performance.now();
  const ear = listenerAt();
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!s) continue;
    const b = bodyState(s.id);
    if (now >= s.until || !b) {
      slots[i] = null;
      continue;
    }
    const y = headY(b.sit);
    moveBabble(i, b.x, y, b.z);
    s.d = Math.hypot(b.x - ear.x, y - ear.y, b.z - ear.z);
  }
}

/** Whether someone is saying something out loud right now (their chat's murmur waits for it, peopleSounds.ts). */
export const voicing = (id: string) => slots.some((s) => s?.id === id && performance.now() < s.until);

// A hot reload runs this file again: swap the old listener for this one rather than voicing every bubble twice.
if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  (w.__mmVoicesOff as (() => void) | undefined)?.();
  w.__mmVoicesOff = onSay(voice);
  w.__mmVoices = {
    /** Who is speaking out loud now. */
    get speaking() {
      const now = performance.now();
      return slots.flatMap((s, slot) => (s && now < s.until ? [{ slot, id: s.id, name: people.get(s.id)?.name ?? s.id, d: Math.round(s.d * 10) / 10 }] : []));
    },
    /** Everyone on this floor's voice (seeded from their id and look, so the same on every load). */
    get voices() {
      return Object.fromEntries([...people].map(([id, p]) => [id, { name: p.name, ...p.voice }]));
    },
  };
}
