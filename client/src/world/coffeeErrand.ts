// The coffee break errand: coffeeBreak.ts's actor wired to the kitchenette's machine (CoffeeMachine.tsx) and the
// people's hands and desks (people.ts). The player goes first at the machine. Imported by ErrandDirector.tsx, which
// registers it. The mugs clink and the sips slurp from the worker's hands.
// Adapted from cubefarm client/src/world/coffeeErrand.ts (MIT).
import { useStore } from '../store';
import { sipSound } from '../ui/sipSfx';
import { seededAppearance } from './appearance';
import { BREAK, CoffeeBreak, fanciesCoffee, SPOTS, type BreakWorld } from './coffeeBreak';
import { line, machine } from './CoffeeMachine';
import { isFree, registerErrand } from './errands';
import { shade } from './materials';
import { tintMug } from './mugLook';
import { bodyState, setDeskMug, setHandMug } from './people';

const seats = new Map<string, string>();
let seq = 1;

/** Where someone's hands are, for their sounds. */
const at = (who: string) => {
  const s = bodyState(who);
  return { x: s?.x ?? 0, y: 1.2, z: s?.z ?? 0 };
};

const world: BreakWorld = {
  slot: machine.slot,
  playerFirst: machine.playerFirst,
  line,
  seats,
  place: machine.place,
  press: machine.press,
  take: machine.take,
  abandon: machine.abandon,
  newMug(who) {
    const id = `mug-${who}-${seq++}`;
    const w = useStore.getState().workers[who];
    if (w) tintMug(id, shade(seededAppearance({ seed: w.seed, role: w.role }).shirt, 0.1)); // the colour of the mug on their desk
    machine.clink(at(who));
    return { id, sips: 0 };
  },
  putBack: (who) => machine.clink(at(who)),
  hold: (who, mug) => setHandMug(who, mug),
  sip: (who) => sipSound('slurp', at(who)),
  toDesk: (who, mug) => setDeskMug(who, mug, BREAK.desk / 1000),
};

registerErrand({
  name: 'coffee',
  max: BREAK.max,
  // Now and then, a little before they'd get up to stretch; not while the player's mug sits in the machine.
  when: (worker, s) =>
    s.floor === 'office' && isFree(worker.status) && s.seatedFor >= s.restless * BREAK.early && fanciesCoffee(s.restless) && !machine.playerOwns(),
  spot: [SPOTS.mugs],
  steps: [],
  act: (id) => new CoffeeBreak(id, world),
});
