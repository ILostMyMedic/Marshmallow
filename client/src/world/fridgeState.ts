// The current floor's fridge (fridge.ts has its rules): the door, the stock, and who stands at it (fridgeErrand.ts).
// KitchenFridge.tsx draws it and runs its clock. One fridge is drawn at a time (the floor you're on); each floor keeps
// its own stock for the session, while the door starts shut on every visit. window.__mmFridge reports it for QA.
// Adapted from cubefarm client/src/world/fridgeState.ts (MIT): the player's E on the fridge, the tupperware's label and
// the sounds are cut.
import { closeDoor, doorTick, newDoor, newPantry, openDoor, restock, takeSnack, type Pantry, type SnackId, type Stock } from './fridge';
import { snackHolders } from './people';

const pantries = new Map<number, Pantry>();
let pantry: Pantry | null = null;
const door = newDoor();
/** The worker at the door (one at a time). */
let atDoor: string | null = null;
/** Where its door is (the middle of its front), for who is near; set once it's drawn. */
export const fridgeAt = { x: 0, z: 0, on: false };

// ---------- redraws ----------

const listeners = new Set<() => void>();
let version = 0;
let queued = false;

/** KitchenFridge.tsx redraws when the door or the stock changes (rarely), once for a burst of changes. */
export function subscribeFridge(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export const fridgeVersion = () => version;

function changed() {
  version++;
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    for (const fn of listeners) fn();
  });
}

// ---------- the floor ----------

/** KitchenFridge.tsx is drawn on `floor`, its front at (x, z): that floor's stock comes out, and the door starts shut. */
export function mountFridge(floor: number, x: number, z: number) {
  const now = performance.now();
  let p = pantries.get(floor);
  if (!p) pantries.set(floor, (p = newPantry(floor, now)));
  restock(p, now); // what came back while you were away
  pantry = p;
  closeDoor(door);
  atDoor = null;
  Object.assign(fridgeAt, { x, z, on: true });
  changed();
  return () => {
    if (pantry === p) pantry = null;
    closeDoor(door);
    atDoor = null;
    fridgeAt.on = false;
    changed();
  };
}

export const doorOpen = () => door.open;
export const stockOf = (id: SnackId) => pantry?.stock[id] ?? 0;

function open(): boolean {
  if (!fridgeAt.on || !openDoor(door, performance.now() / 1000)) return false;
  changed();
  return true;
}

function close(): boolean {
  if (!closeDoor(door)) return false;
  changed();
  return true;
}

function take(id: SnackId): boolean {
  if (!pantry || !door.open) return false;
  restock(pantry, performance.now());
  if (!takeSnack(pantry, id)) return false;
  changed();
  return true;
}

/** The fridge's clock (KitchenFridge.tsx calls it a few times a second): the door closes by itself once nobody is at it, and the stock comes back. */
export function tickFridge() {
  const now = performance.now();
  if (pantry && restock(pantry, now) > 0) changed();
  if (doorTick(door, now / 1000, atDoor !== null) === 'close') changed();
}

/** The fridge as a worker on a snack break uses it: one at the door at a time. */
export const fridge = {
  /** Takes the door (true), or someone else has it. */
  claim(who: string): boolean {
    if (atDoor !== null && atDoor !== who) return false;
    atDoor = who;
    return true;
  },
  release(who: string) {
    if (atDoor === who) atDoor = null;
  },
  isOpen: doorOpen,
  open,
  close,
  stock: (): Readonly<Stock> | null => pantry?.stock ?? null,
  take,
};

if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__mmFridge')) {
  Object.defineProperty(window, '__mmFridge', {
    get: () => ({ here: fridgeAt.on, open: door.open, atDoor, stock: { ...(pantry?.stock ?? {}) }, eating: snackHolders() }),
    enumerable: false,
    configurable: false,
  });
}
