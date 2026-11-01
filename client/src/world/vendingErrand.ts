// The vending machine errand: vendingBreak.ts's actor wired to the machine on screen (decor/machines.ts) and the people's
// hands and speech bubbles (people.ts). Only on a floor that bought one: the machine in the first big spot holding one.
// Nobody goes up to it while the player stands in front of it. Imported by ErrandDirector.tsx, which registers it.
// New in Marshmallow, after fridgeErrand.ts.
import { sipSound } from '../ui/sipSfx';
import { BREAK } from './coffeeBreak';
import { claimMachine, machineSpot, pressButtons, releaseMachine, takeDrop, vend } from './decor/machines';
import { PLACED_SPOTS, kindOf, slotSpotIds, slotSpots } from './decor/spots';
import { isFree, registerErrand } from './errands';
import { bodyState, say, setHandSnack } from './people';
import { playerAt } from './rig';
import { fanciesVending, VEND, VendBreak, type VendWorld } from './vendingBreak';

const at = (who: string) => {
  const s = bodyState(who);
  return { x: s?.x ?? 0, y: 1.2, z: s?.z ?? 0 };
};

const worlds = new Map<string, VendWorld>();

/** The machine in big spot `spot`, as a trip to it uses it (one per spot, so its line and seats are shared). */
function worldFor(spot: string): VendWorld {
  let w = worlds.get(spot);
  if (w) return w;
  const front = slotSpots().find((s) => s.id === `${spot}-front`)!;
  w = {
    spots: slotSpotIds(spot),
    playerBusy: () => Math.hypot(playerAt.x - front.x, playerAt.z - front.z) < 0.9,
    claim: (who) => claimMachine('vending', spot, who),
    release: (who) => releaseMachine('vending', spot, who),
    press: () => pressButtons(spot),
    vend: (_, snack) => vend(spot, snack),
    take: () => takeDrop(spot),
    hold: (who, s) => setHandSnack(who, s),
    sound: (who, cue) => sipSound(cue, at(who)),
    say: (who, text) => say(who, text, 1.6),
    line: new Map(),
    seats: new Map(),
  };
  worlds.set(spot, w);
  return w;
}

const LINES = PLACED_SPOTS.filter((id) => kindOf(id) === 'big').flatMap((id) => slotSpotIds(id).line);

/** A vending machine stands on the floor you're on (its trips take part of the fridge's share: fridgeErrand.ts). */
export const vendingHere = () => machineSpot('vending') !== null;

registerErrand({
  name: 'vending',
  max: VEND.max,
  // Now and then instead of a coffee or the fridge, a little before they'd get up to stretch.
  when: (worker, s) => s.floor === 'office' && vendingHere() && isFree(worker.status) && s.seatedFor >= s.restless * BREAK.early && fanciesVending(s.restless),
  spot: LINES,
  where: () => {
    const spot = machineSpot('vending');
    return spot ? slotSpotIds(spot).line : [];
  },
  steps: [],
  act: (id) => new VendBreak(id, worldFor(machineSpot('vending') ?? 'big-1')),
});
