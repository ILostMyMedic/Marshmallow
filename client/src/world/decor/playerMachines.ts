// You at a floor's vending machine or beer fridge (E on one: view.ts's 'vending' and 'beer' actions, which Decor.tsx
// hands here): machineRules.ts says whether it's yours now and what you get; this works the machine on screen
// (decor/machines.ts). The vending machine beeps, drops a can or a bar into its tray and it's in your hands; the beer
// fridge's door swings open, a bottle comes out and the door shuts. You hold the machine's claim while you use it, so
// no worker steps up meanwhile (and you wait for one who's at it). New in Marshmallow.
import { useStore } from '../../store';
import { afterHours, BOTTLE } from '../beerBreak';
import { dayTime } from '../dayTime';
import { useView } from '../view';
import { heldFrom, PLAYER, refusal, USE, vendFor } from './machineRules';
import { bottleClink, claimMachine, closeBeerDoor, machineAt, machineUser, openBeerDoor, pressButtons, releaseMachine, takeDrop, vend, type MachineKind } from './machines';

let seq = 1;
const timers = new Set<ReturnType<typeof setTimeout>>();

function later(seconds: number, fn: () => void) {
  const t = setTimeout(() => {
    timers.delete(t);
    fn();
  }, seconds * 1000);
  timers.add(t);
}

/** You left the floor: whatever you were getting is left behind (the machines' unmount lets go of their claims). */
export function leaveMachines() {
  for (const t of timers) clearTimeout(t);
  timers.clear();
}

/** Takes the machine for you, or says in a passing note why not; false while you're at it already (E twice). */
function take(kind: MachineKind, spot: string): boolean {
  const user = machineUser(kind, spot);
  if (user === PLAYER || !machineAt(kind, spot)) return false;
  const view = useView.getState();
  const why = refusal(kind, { held: view.held, user, userName: user ? useStore.getState().workers[user]?.name : null, open: kind === 'vending' || afterHours(dayTime.t) });
  if (why) {
    view.showToast(why);
    return false;
  }
  return claimMachine(kind, spot, PLAYER);
}

/** Into your hands; false when they've filled meanwhile (it stays where it came from, then). */
function hand(kind: MachineKind, snack: Parameters<typeof heldFrom>[1]): boolean {
  const view = useView.getState();
  if (view.held) return false;
  view.setHeld(heldFrom(kind, snack, seq++));
  return true;
}

/** E on the vending machine in `spot`: the buttons, the drop into the tray, and it's yours. */
export function vendAt(spot: string) {
  if (!take('vending', spot)) return;
  const snack = vendFor(Math.random());
  pressButtons(spot);
  later(USE.vending.press, () => vend(spot, snack));
  later(USE.vending.take, () => {
    releaseMachine('vending', spot, PLAYER);
    if (machineAt('vending', spot) && hand('vending', snack)) takeDrop(spot);
  });
}

/** E on the beer fridge in `spot`, after hours: the door, a bottle, the door shut again. */
export function beerAt(spot: string) {
  if (!take('beer', spot)) return;
  openBeerDoor(spot);
  later(USE.beer.take, () => {
    if (machineAt('beer', spot) && hand('beer', BOTTLE)) bottleClink(spot);
  });
  later(USE.beer.shut, () => {
    closeBeerDoor(spot);
    releaseMachine('beer', spot, PLAYER);
  });
}
