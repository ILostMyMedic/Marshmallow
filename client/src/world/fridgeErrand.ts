// The snack break errand: snackBreak.ts's actor wired to the kitchenette fridge (fridgeState.ts) and the people's
// hands and speech bubbles (people.ts); nobody goes to the door while the player stands at it. Imported by
// ErrandDirector.tsx, which registers it. The snacks make their sounds from the worker's hands.
// Adapted from cubefarm client/src/world/fridgeErrand.ts (MIT).
import { sipSound } from '../ui/sipSfx';
import { BREAK } from './coffeeBreak';
import { isFree, registerErrand } from './errands';
import { fridge, fridgeAt } from './fridgeState';
import { bodyState, say, setHandSnack } from './people';
import { fanciesSnack, SNACK, SNACK_SPOTS, SnackBreak, type FridgeWorld } from './snackBreak';
import { fanciesVending } from './vendingBreak';
import { vendingHere } from './vendingErrand';

/** Where someone's hands are, for their sounds. */
const at = (who: string) => {
  const s = bodyState(who);
  return { x: s?.x ?? 0, y: 1.2, z: s?.z ?? 0 };
};

const world: FridgeWorld = {
  playerBusy: fridge.playerBusy,
  claim: fridge.claim,
  release: fridge.release,
  isOpen: fridge.isOpen,
  open: () => void fridge.open(),
  close: () => void fridge.close(),
  stock: fridge.stock,
  take: (_, snack) => fridge.take(snack),
  hold: (who, s) => setHandSnack(who, s),
  sound: (who, cue) => sipSound(cue, at(who)),
  say: (who, text) => say(who, text, 1.6),
  line: new Map(),
  seats: new Map(),
};

registerErrand({
  name: 'fridge',
  max: SNACK.max,
  // Now and then instead of a coffee, a little before they'd get up to stretch, on a floor with a fridge; the top of
  // its slice goes to the vending machine on a floor that bought one (vendingErrand.ts).
  when: (worker, s) =>
    s.floor === 'office' && fridgeAt.on && isFree(worker.status) && s.seatedFor >= s.restless * BREAK.early && fanciesSnack(s.restless) && !(vendingHere() && fanciesVending(s.restless)),
  spot: [SNACK_SPOTS.line[0]],
  steps: [],
  act: (id) => new SnackBreak(id, world),
});
