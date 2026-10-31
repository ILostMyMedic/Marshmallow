// The snack break errand: snackBreak.ts's actor wired to the kitchenette fridge (fridgeState.ts) and the people's
// hands and speech bubbles (people.ts); nobody goes to the door while the player stands at it. Imported by
// ErrandDirector.tsx, which registers it.
// Adapted from cubefarm client/src/world/fridgeErrand.ts (MIT): the sounds are cut.
import { BREAK } from './coffeeBreak';
import { isFree, registerErrand } from './errands';
import { fridge, fridgeAt } from './fridgeState';
import { say, setHandSnack } from './people';
import { fanciesSnack, SNACK, SNACK_SPOTS, SnackBreak, type FridgeWorld } from './snackBreak';

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
  sound: () => {},
  say: (who, text) => say(who, text, 1.6),
  line: new Map(),
  seats: new Map(),
};

registerErrand({
  name: 'fridge',
  max: SNACK.max,
  // Now and then instead of a coffee, a little before they'd get up to stretch, on a floor with a fridge.
  when: (worker, s) => s.floor === 'office' && fridgeAt.on && isFree(worker.status) && s.seatedFor >= s.restless * BREAK.early && fanciesSnack(s.restless),
  spot: [SNACK_SPOTS.line[0]],
  steps: [],
  act: (id) => new SnackBreak(id, world),
});
