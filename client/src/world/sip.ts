// Drinking your coffee and eating a snack from the fridge, as pure rules: what E does with something in your hands,
// the timeline of a sip and of the big last gulp (when the coffee goes down), a snack's sips or bites (the first opens
// it, the last finishes it and it leaves your hand), and the pose along the way. sipping.ts plays them; the player's
// body draws them. The cues keep their sounds' names for when sound effects come.
// Adapted from cubefarm client/src/world/toys/sip.ts (MIT): the roof's sausage and the dropped mug's clunk are cut,
// and the last gulp keeps the empty mug in your hand (it's refilled at the machine) instead of dropping it.

import { SNACKS, SNACK_IDS, type Snack, type SnackCue, type SnackId } from './fridge';

/** What E does with something in your hands: sip (or bite) it, say it's empty, or act on the target. */
export type EAction = 'sip' | 'empty' | 'target';

/**
 * E with a mug of coffee sips it, whatever the crosshair is on, except the coffee machine and the mug stand (where E
 * works them). With an empty mug E acts on the target as usual, or says it's empty when there is none. A snack is
 * eaten the same way; at the fridge E works the fridge whatever you hold (it shuts the door, or says your hands are full).
 */
export function eAction(held: { kind: string; sips?: number; left?: number } | null, focusKind: string | null): EAction {
  if (held && focusKind === 'fridge') return 'target';
  if (held?.kind === 'snack') return (held.left ?? 0) > 0 ? 'sip' : focusKind ? 'target' : 'empty';
  if (held?.kind !== 'mug' || focusKind === 'coffee' || focusKind === 'mugs') return 'target';
  if ((held.sips ?? 0) > 0) return 'sip';
  return focusKind ? 'target' : 'empty';
}

/** The hint for E when eAction says 'sip': sip the coffee, or sip or bite the snack. */
export function sipLabel(held: { kind: string; snack?: SnackId } | null): string {
  const s = held?.kind === 'snack' && held.snack ? SNACKS[held.snack] : null;
  if (s) return `${s.kind === 'drink' ? 'Sip' : 'Bite'} the ${s.short}`;
  return 'Sip coffee';
}

/** `drink` takes a sip (or bite) off what you hold; `drop` lets a finished snack go; the rest are sounds to come. */
export type SipCue = 'drink' | 'drop' | SnackCue;

export interface SipPlan {
  /** Seconds the whole thing takes. */
  dur: number;
  /** Seconds from the start: it's up by `up`, held at the mouth until `down`, and back in place by `dur`. */
  up: number;
  down: number;
  /** How far it tips towards you at the mouth (radians), and how far the view tilts back (radians, up). */
  tilt: number;
  head: number;
  /** What happens when, in order. */
  cues: readonly { at: number; cue: SipCue }[];
}

/** An ordinary sip: about 0.7 s, a slurp at the mouth and a contented "mm" on the way down. */
export const SIP: SipPlan = {
  dur: 0.7,
  up: 0.22,
  down: 0.45,
  tilt: 1.1,
  head: 0,
  cues: [
    { at: 0.18, cue: 'slurp' },
    { at: 0.32, cue: 'drink' },
    { at: 0.46, cue: 'mm' },
  ],
};

/** The last sip: the mug tips right up, the view tilts back, three big glugs and an "ahh"; the empty mug stays in hand. */
export const GULP: SipPlan = {
  dur: 1.75,
  up: 0.3,
  down: 1.15,
  tilt: 2.3,
  head: 0.16,
  cues: [
    { at: 0.3, cue: 'gulp' },
    { at: 0.95, cue: 'drink' },
    { at: 1.2, cue: 'ahh' },
  ],
};

/** The plan for the next sip of a mug with `sips` left: the last one is the gulp. Null when it's empty. */
export function planFor(sips: number): SipPlan | null {
  if (!(sips > 0)) return null;
  return sips <= 1 ? GULP : SIP;
}

/** A bite: up to the mouth level, a chomp, and a munch on the way down. */
export const BITE: SipPlan = {
  dur: 0.8,
  up: 0.22,
  down: 0.4,
  tilt: 0,
  head: 0,
  cues: [
    { at: 0.2, cue: 'chomp' },
    { at: 0.3, cue: 'drink' },
    { at: 0.45, cue: 'munch' },
  ],
};

/** The last bite: a bigger one, a long munch and a contented "mm", and then it's gone. */
export const LAST_BITE: SipPlan = {
  dur: 1.5,
  up: 0.24,
  down: 0.5,
  tilt: 0,
  head: 0.05,
  cues: [
    { at: 0.22, cue: 'chomp' },
    { at: 0.32, cue: 'drink' },
    { at: 0.55, cue: 'munch' },
    { at: 1.05, cue: 'mm' },
    { at: 1.4, cue: 'drop' },
  ],
};

// ---------- snacks ----------

/** A first sip or bite takes this much longer (s): the can or wrapper is opened on the way up. */
const OPENING = 0.35;

/** `plan` held back a moment, with `cue` (opening it) at the very start. */
function opened(plan: SipPlan, cue: SnackCue | undefined): SipPlan {
  if (!cue) return plan;
  return {
    ...plan,
    dur: plan.dur + OPENING,
    up: plan.up + OPENING,
    down: plan.down + OPENING,
    cues: [{ at: 0.05, cue }, ...plan.cues.map((c) => ({ at: c.at + OPENING, cue: c.cue }))],
  };
}

/** A snack's three plans: the first sip or bite (opening it), one in the middle, and the last (then it's gone). */
function snackPlans(s: Snack): { first: SipPlan; next: SipPlan; last: SipPlan } {
  const drink = s.kind === 'drink';
  // a can or bottle tips further than a mug: there's less in it
  const next: SipPlan = drink
    ? { ...SIP, tilt: 1.3, cues: [{ at: 0.18, cue: s.bite }, { at: 0.32, cue: 'drink' }, { at: 0.46, cue: s.after }] }
    : { ...BITE, cues: [{ at: 0.2, cue: s.bite }, { at: 0.3, cue: 'drink' }, { at: 0.45, cue: s.after }] };
  const lastCues: { at: number; cue: SipCue }[] = drink
    ? [{ at: 0.3, cue: s.last }, { at: 0.95, cue: 'drink' }, { at: 1.2, cue: 'ahh' }]
    : [{ at: 0.22, cue: s.last }, { at: 0.32, cue: 'drink' }, { at: 0.55, cue: s.after }, { at: 1.05, cue: 'mm' }];
  if (s.done) lastCues.push({ at: drink ? 1.45 : 1.3, cue: s.done });
  lastCues.push({ at: drink ? 1.6 : 1.4, cue: 'drop' });
  const last: SipPlan = { ...(drink ? GULP : LAST_BITE), tilt: drink ? 2.5 : 0, cues: lastCues };
  return { first: opened(next, s.open), next, last };
}

/** Every snack's plans, made once. */
export const SNACK_PLANS = Object.fromEntries(SNACK_IDS.map((id) => [id, snackPlans(SNACKS[id])])) as Record<SnackId, { first: SipPlan; next: SipPlan; last: SipPlan }>;

/** The plan for the next sip or bite of `snack` with `left` to go: the first opens it, the last finishes it. Null when it's gone. */
export function snackFor(snack: SnackId, left: number): SipPlan | null {
  const p = SNACK_PLANS[snack];
  if (!p || !(left > 0)) return null;
  if (left <= 1) return p.last;
  return left >= SNACKS[snack].portions ? p.first : p.next;
}

/** The index of the first cue still to come `t` seconds in, having played those before `from`. */
export function cuesDue(plan: SipPlan, from: number, t: number): number {
  let i = from;
  while (i < plan.cues.length && plan.cues[i].at <= t) i++;
  return i;
}

const smooth = (x: number) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/** How far up it is at `t` seconds: 0 resting in view, 1 at the mouth. */
export function lift(plan: SipPlan, t: number): number {
  if (t <= 0 || t >= plan.dur) return 0;
  if (t < plan.up) return smooth(t / plan.up);
  if (t < plan.down) return 1;
  return 1 - smooth((t - plan.down) / (plan.dur - plan.down));
}

/** The pose at `t` seconds: how far up (0-1), how far tipped (radians) and the view's tilt back (radians). */
export function pose(plan: SipPlan, t: number, out = { lift: 0, tilt: 0, head: 0 }) {
  const l = lift(plan, t);
  out.lift = l;
  out.tilt = l * plan.tilt;
  out.head = l * plan.head;
  return out;
}
