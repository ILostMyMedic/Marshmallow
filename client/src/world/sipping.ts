// Drinking the coffee in your hands, or eating a snack from the fridge: E starts a sip or a bite (whatever you hold
// gets first go at E, through actions.ts's onUseHeld, registered here), Player.tsx calls tickSip every frame, and the
// player's body and the camera read `sipPose`. The timings are in sip.ts. Walking carries on throughout. The sip comes
// off what you hold at the plan's 'drink' cue: an empty mug stays in your hand (refill it at the machine), a finished
// snack leaves it.
// Adapted from cubefarm client/src/world/toys/sipping.ts (MIT): the sounds wait for the sound effects, and the roof's
// sausage and the dropped mug are cut.
import { onUseHeld } from './actions';
import { cuesDue, eAction, planFor, pose, snackFor, type SipPlan } from './sip';
import { useView, type Action, type Held } from './view';

let sip: { plan: SipPlan; id: string; start: number; next: number } | null = null;

/**
 * The current sip's pose, written by tickSip every frame (all 0 between sips). `lift`: 0 resting in view to 1 at the
 * mouth. `tilt`: how far the mug or can tips towards you (radians, 0 to about 2.5; 0 for food, which comes up level).
 * `head`: how far the view tilts back (radians, up; 0 to 0.16, only on a last gulp or bite).
 */
export const sipPose = { lift: 0, tilt: 0, head: 0 };

const heldId = (h: Held | null) => (h && h.kind !== 'paddle' ? h.id : null);

/** E with coffee or a snack in hand: start a sip (the last one a gulp) or a bite. False mid-sip, or with nothing to sip. */
export function sipCoffee(now = performance.now()): boolean {
  const held = useView.getState().held;
  if (sip || !held || held.kind === 'paddle') return false;
  const plan = held.kind === 'mug' ? planFor(held.sips) : snackFor(held.snack, held.left);
  if (!plan) return false;
  sip = { plan, id: held.id, start: now, next: 0 };
  return true;
}

/** Whether a sip or a bite is under way. */
export const sipping = () => sip !== null;

/**
 * Moves the current sip along: takes the sip (or bite) off what you hold at its 'drink' cue, and lets a finished snack
 * go. Player.tsx calls it every frame, before anything that returns early, so a sip still finishes in the overview.
 */
export function tickSip(now = performance.now()) {
  if (!sip) return;
  const view = useView.getState();
  // It left your hands some other way (put back, into the machine, a floor change): the sip is off.
  if (heldId(view.held) !== sip.id) return endSip();
  const { plan } = sip;
  const t = (now - sip.start) / 1000;
  const to = cuesDue(plan, sip.next, t);
  for (let i = sip.next; i < to; i++) {
    const cue = plan.cues[i].cue;
    const held = useView.getState().held;
    if (cue === 'drink') {
      if (held?.kind === 'mug') view.setHeld({ ...held, sips: Math.max(0, held.sips - 1) });
      else if (held?.kind === 'snack') view.setHeld({ ...held, left: Math.max(0, held.left - 1) });
    } else if (cue === 'drop' && held?.kind === 'snack') {
      endSip();
      view.setHeld(null); // all gone
      return;
    }
  }
  sip.next = to;
  pose(plan, t, sipPose);
  if (t >= plan.dur) endSip();
}

function endSip() {
  sip = null;
  sipPose.lift = 0;
  sipPose.tilt = 0;
  sipPose.head = 0;
}

/**
 * E with something in your hands (actions.ts heldTakesE): a sip or a bite (true, even mid-sip, so the target doesn't
 * get it), or a word that it's empty when there's nothing to aim at; false lets the crosshair's target have it.
 */
export function eWithHeld(focusKind: Action['kind'] | null): boolean {
  const view = useView.getState();
  const what = eAction(view.held, focusKind);
  if (what === 'sip') {
    sipCoffee();
    return true;
  }
  if (what === 'empty') {
    view.showToast(view.held?.kind === 'mug' ? "☕ It's empty: refill it at the machine" : 'All gone');
    return true;
  }
  return false;
}

onUseHeld(eWithHeld);

// window.__mmSip, for QA: `pose` is sipPose itself (set it between sips to hold the arm still at any point of a sip),
// `start()` sips or bites what you hold, `sipping()` says whether one is under way.
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__mmSip = { pose: sipPose, start: () => sipCoffee(), sipping };
