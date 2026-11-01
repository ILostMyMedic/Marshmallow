// The current floor's vending machines and beer fridges (Decor.tsx draws them), as the errands and you use them: which
// big spot holds one (set while it's drawn, like fridgeState.ts's fridgeAt, since the errand director runs on the floor
// you're on), who stands at each (one at a time, you included: playerMachines.ts), a vending machine's drop into its
// tray and a beer fridge's door. Their sounds come from their fronts. New in Marshmallow.
import { SHOP_SPOTS } from '../../../../shared/shop';
import { fridgeClose, fridgeOpen, fridgeTake, noise, tone, type Vec3 } from '../../ui/sfx';
import type { SnackId } from '../fridge';

export type MachineKind = 'vending' | 'beer';

/** A machine on the floor: its spot, and the middle of its front (for its sounds and who is near it). */
export interface MachineAt {
  spot: string;
  x: number;
  z: number;
}

const mounted: Record<MachineKind, Map<string, MachineAt>> = { vending: new Map(), beer: new Map() };
const order = SHOP_SPOTS.map((s) => s.id);
const key = (kind: MachineKind, spot: string) => `${kind}:${spot}`;
/** Who stands at each machine (kind:spot), one at a time. */
const users = new Map<string, string>();

/** A machine drawn on the floor you're on; returns its unmount. */
export function mountMachine(kind: MachineKind, at: MachineAt) {
  mounted[kind].set(at.spot, at);
  return () => {
    if (mounted[kind].get(at.spot) === at) mounted[kind].delete(at.spot);
    users.delete(key(kind, at.spot));
    drops.delete(at.spot);
    doors.delete(at.spot);
  };
}

/** The first spot (in SHOP_SPOTS's order) holding a machine of `kind` on the floor you're on; null for none. */
export function machineSpot(kind: MachineKind): string | null {
  let best: string | null = null;
  for (const spot of mounted[kind].keys()) if (best === null || order.indexOf(spot) < order.indexOf(best)) best = spot;
  return best;
}

export const machineAt = (kind: MachineKind, spot: string) => mounted[kind].get(spot);

/** Takes the machine (true when it's theirs now), and lets go of it. */
export function claimMachine(kind: MachineKind, spot: string, who: string): boolean {
  const k = key(kind, spot);
  const now = users.get(k);
  if (now !== undefined && now !== who) return false;
  users.set(k, who);
  return true;
}

export function releaseMachine(kind: MachineKind, spot: string, who: string) {
  if (users.get(key(kind, spot)) === who) users.delete(key(kind, spot));
}

/** Who has the machine now (a worker's id, or decor/machineRules.ts's PLAYER); null when it's free. */
export const machineUser = (kind: MachineKind, spot: string) => users.get(key(kind, spot)) ?? null;

const where = (kind: MachineKind, spot: string, y = 1): Vec3 => {
  const m = mounted[kind].get(spot);
  return { x: m?.x ?? 0, y, z: m?.z ?? 0 };
};

// ---------- the vending machine ----------

/** Something on its way down to a vending machine's tray: what, and when it started falling (performance.now()). */
export interface Drop {
  snack: SnackId;
  at: number;
  taken: boolean;
}

const drops = new Map<string, Drop>();

/** The drop in the machine in `spot`, while there is one. */
export const dropIn = (spot: string) => drops.get(spot);

/** Someone presses the buttons: a few beeps. */
export function pressButtons(spot: string) {
  const pos = where('vending', spot, 1.2);
  for (const [i, f] of [1568, 1760, 1976].entries()) tone({ name: 'vending:button', group: 'room', pos, freq: f, type: 'square', at: i * 0.32, dur: 0.06, peak: 0.03 });
}

/** The machine turns its coil and drops `snack` into the tray: a whirr, then a clunk. */
export function vend(spot: string, snack: SnackId) {
  drops.set(spot, { snack, at: performance.now(), taken: false });
  const pos = where('vending', spot, 0.8);
  noise({ name: 'vending:whirr', group: 'room', pos, dur: 0.6, peak: 0.03, filter: 'bandpass', freq: 380, to: 520, q: 2, attack: 0.05 });
  tone({ name: 'vending:whirr', group: 'room', pos, freq: 92, to: 110, type: 'sawtooth', dur: 0.6, peak: 0.012, attack: 0.05 });
  tone({ name: 'vending:clunk', group: 'room', pos: { ...pos, y: 0.35 }, freq: 150, to: 60, at: 0.75, dur: 0.14, peak: 0.08, attack: 0.003 });
  noise({ name: 'vending:clunk', group: 'room', pos: { ...pos, y: 0.35 }, at: 0.75, dur: 0.08, peak: 0.04, filter: 'lowpass', freq: 600, attack: 0.002 });
}

/** It's taken out of the tray. */
export function takeDrop(spot: string) {
  const d = drops.get(spot);
  if (d) d.taken = true;
  tone({ name: 'vending:flap', group: 'room', pos: where('vending', spot, 0.35), freq: 520, to: 380, type: 'triangle', dur: 0.06, peak: 0.02 });
}

// ---------- the beer fridge ----------

const doors = new Map<string, boolean>();

/** Whether the beer fridge in `spot` stands open. */
export const doorOpenIn = (spot: string) => doors.get(spot) ?? false;

export function openBeerDoor(spot: string) {
  if (doors.get(spot)) return;
  doors.set(spot, true);
  fridgeOpen(where('beer', spot));
}

export function closeBeerDoor(spot: string) {
  if (!doors.get(spot)) return;
  doors.set(spot, false);
  fridgeClose(where('beer', spot));
}

/** A bottle lifted off the shelf. */
export const bottleClink = (spot: string) => fridgeTake(where('beer', spot, 1.1));

/** What the probe shows. */
export function machinesReport() {
  return {
    vending: [...mounted.vending.keys()],
    beer: [...mounted.beer.keys()],
    users: Object.fromEntries(users),
    drops: Object.fromEntries([...drops].map(([s, d]) => [s, { snack: d.snack, taken: d.taken }])),
    doors: Object.fromEntries(doors),
  };
}
