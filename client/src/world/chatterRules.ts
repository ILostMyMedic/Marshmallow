// Adapted from cubefarm client/src/ui/babbleRules.ts and ui/sfxMix.ts (MIT): who speaks and how often, without the
// babble voices (no sound yet).

// The speech bubbles' pacing, pure: how long a bubble stays up, how many may speak at once (the nearest win) and how
// often (the chatter level's pace). Chatter.tsx runs the talking by these.

/** How chatty the office is: no bubbles, news only, or small talk about their work too. */
export type ChatterLevel = 'off' | 'quiet' | 'lively';

/** How long a line's bubble stays up (s): long enough to read it. */
export const bubbleSeconds = (text: string) => Math.min(5.5, Math.max(2.4, 1.6 + text.length * 0.06));

// ---------- who speaks, and how often ----------

/** At most this many people speak at once on a floor. */
export const MAX_SPEAKERS = 3;

/** `admitSpeaker` results besides an index into `active`: the new line plays, or it's dropped. */
export const PLAY = -1;
export const DROP_NEW = -2;

/**
 * Whether a new line from someone `d` metres away may start while `active` people speak: PLAY when there's room,
 * DROP_NEW when it's full of nearer (or as near) voices, else the index of the farthest one, whom the new one cuts off.
 */
export function admitSpeaker(active: readonly { d: number }[], d: number, cap = MAX_SPEAKERS): number {
  if (active.length < cap) return PLAY;
  let far = -1;
  for (let i = 0; i < active.length; i++) if (far < 0 || active[i].d > active[far].d) far = i;
  return far < 0 || d >= active[far].d ? DROP_NEW : far;
}

/** Why a line is said: the player said hi, something happened, a chat at the cooler, or just their work (lively). */
export type Priority = 'greet' | 'event' | 'chat' | 'ambient';

export interface Pace {
  /** Seconds between someone's lines about their work (ambient), and the least between any two lines on the floor. */
  workerGap: number;
  floorGap: number;
  /** Seconds between a busy person's lines about what they're doing (null: they don't), and the CEO's musings. */
  ambient: readonly [number, number] | null;
  ceo: readonly [number, number];
}

export const PACE: Record<Exclude<ChatterLevel, 'off'>, Pace> = {
  quiet: { workerGap: 20, floorGap: 3, ambient: null, ceo: [60, 120] },
  lively: { workerGap: 7, floorGap: 1.2, ambient: [14, 32], ceo: [25, 55] },
};

/** One person never starts lines closer together than this (s), whatever happened. */
export const EVENT_GAP = 3;
/** Lines that can't be said within this long (s) of what made them are dropped: old news. */
export const LINE_TTL = 8;

/**
 * Whether a line may start now (s): a greeting or a chat line always may (they have their own pace); news waits for
 * the floor's gap and EVENT_GAP since that person last spoke; small talk about work also waits out the person's gap.
 */
export function mayTalk(priority: Priority, pace: Pace, now: number, workerLast: number, floorLast: number): boolean {
  if (priority === 'greet' || priority === 'chat') return true;
  if (now - floorLast < pace.floorGap * (priority === 'ambient' ? 2 : 1)) return false;
  return now - workerLast >= (priority === 'ambient' ? pace.workerGap : EVENT_GAP);
}
