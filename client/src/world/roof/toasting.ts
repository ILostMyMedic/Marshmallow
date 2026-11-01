// The marshmallow in your hands (view.ts held), toasting: the roof's fire (Marshmallows.tsx) moves it along every frame
// from where its tip is (marshmallow.ts), and catching fire goes whoosh. Its toast lives here, live, for the stick's
// colour; the store's `held` hears of it only when the word for it changes (golden, toasty…), so nothing re-renders by
// the frame. Eating it (E) is sipping.ts's, a bite like a snack's. New in Marshmallow.
import { noise } from '../../ui/sfx';
import { sipping } from '../sipping';
import { useView, type Held } from '../view';
import { heatAt, stickTip, toastStep, toastWord } from './marshmallow';

type Mallow = Extract<Held, { kind: 'marshmallow' }>;

/** The one you hold, as it is now: Me.tsx colours its stick from this. */
export const toasting = { id: '', toast: 0, flame: 0 };

let seq = 1;

/** A fresh marshmallow for your hands. */
export const newMarshmallow = (): Mallow => ({ kind: 'marshmallow', id: `mallow-player-${seq++}`, toast: 0 });

/** The live state of `held` (its own toast until the fire has had it). */
export function liveOf(held: Mallow) {
  if (toasting.id !== held.id) Object.assign(toasting, { id: held.id, toast: held.toast, flame: 0 });
  return toasting;
}

/**
 * `dt` seconds of your marshmallow held by someone at (x, z) facing `yaw` (on the roof: it's the only fire). Not while
 * it's being eaten.
 */
export function tickToast(dt: number, x: number, z: number, yaw: number) {
  const view = useView.getState();
  const held = view.held;
  if (held?.kind !== 'marshmallow' || held.eaten || sipping()) return;
  const live = liveOf(held);
  const next = toastStep(live, heatAt(stickTip(x, z, yaw)), dt);
  live.toast = next.toast;
  live.flame = next.flame;
  if (next.caught) whoosh();
  const alight = live.flame > 0;
  if (toastWord(live.toast, live.flame) !== toastWord(held.toast, held.alight ? 1 : 0)) view.setHeld({ ...held, toast: live.toast, alight });
}

/** It catches: a soft whoosh of flame. */
function whoosh() {
  noise({ name: 'mallow:whoosh', group: 'people', dur: 0.45, peak: 0.08, filter: 'bandpass', freq: 500, to: 1600, q: 0.8, attack: 0.05 });
}

// window.__mmToast, for QA: `state` is the live toast of what you hold, `set(toast, flame?)` puts the one in your hands
// at that toast (and alight for `flame` seconds).
if (typeof window !== 'undefined')
  (window as unknown as Record<string, unknown>).__mmToast = {
    state: toasting,
    set(toast: number, flame = 0) {
      const view = useView.getState();
      if (view.held?.kind !== 'marshmallow') return false;
      Object.assign(liveOf(view.held), { toast, flame });
      view.setHeld({ ...view.held, toast, alight: flame > 0 });
      return true;
    },
  };
