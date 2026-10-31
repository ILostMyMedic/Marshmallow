// The current floor's fridge (fridge.ts has its rules): the door, the stock, who stands at it, the player's E on it and
// the workers' hands in it (fridgeErrand.ts). KitchenFridge.tsx draws it and runs its clock. One fridge is drawn at a
// time (the floor you're on); each floor keeps its own stock for the session, while the door starts shut on every
// visit. window.__mmFridge reports it and __mmFridgeDo works it, for QA.
// Adapted from cubefarm client/src/world/fridgeState.ts (MIT): the tupperware's label and the sounds are cut.
import { DOOR, SNACKS, closeDoor, doorTick, isSnackId, newDoor, newPantry, openDoor, restock, takeSnack, type Pantry, type SnackId, type Stock } from './fridge';
import { snackHolders } from './people';
import { playerAt } from './rig';
import { useView } from './view';

const pantries = new Map<number, Pantry>();
let pantry: Pantry | null = null;
const door = newDoor();
/** The worker at the door (one at a time). */
let atDoor: string | null = null;
let seq = 1;
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

/** The player is standing at the fridge: the door stays open for them, and workers wait. */
export const playerAtFridge = () => fridgeAt.on && Math.hypot(playerAt.x - fridgeAt.x, playerAt.z - fridgeAt.z) < DOOR.reach;

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

/** The fridge's clock (KitchenFridge.tsx calls it a few times a second): the door closes by itself once everyone has walked away, and the stock comes back. */
export function tickFridge() {
  const now = performance.now();
  if (pantry && restock(pantry, now) > 0) changed();
  if (doorTick(door, now / 1000, playerAtFridge() || atDoor !== null) === 'close') changed();
}

// ---------- the player (E on the fridge) ----------

/** E on the fridge: open or shut the door, or grab a snack (hands free, door open). */
export function fridgeAction(op: 'door' | 'take', snack?: SnackId) {
  const view = useView.getState();
  if (op === 'door') {
    if (!close()) open();
    return;
  }
  if (!isSnackId(snack)) return;
  const def = SNACKS[snack];
  if (view.held) {
    view.showToast(view.held.kind === 'snack' ? `${SNACKS[view.held.snack].emoji} One at a time: finish that one first (E)` : '🙌 Your hands are full');
    return;
  }
  if (!take(snack)) {
    if (door.open) view.showToast(`${def.emoji} Out of ${def.short}: more comes in every few minutes`);
    return;
  }
  view.setHeld({ kind: 'snack', id: `snack-player-${seq++}`, snack, left: def.portions });
}

// ---------- the workers (fridgeErrand.ts) ----------

/** The fridge as a worker on a snack break uses it: one at the door at a time, never while the player is at it. */
export const fridge = {
  playerBusy: playerAtFridge,
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

// ---------- probes ----------

if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__mmFridge')) {
  // atDoor is 'player', a worker's id or null; held is the snack in your hands and what's left of it.
  Object.defineProperty(window, '__mmFridge', {
    get: () => {
      const h = useView.getState().held;
      return {
        here: fridgeAt.on,
        open: door.open,
        atDoor: playerAtFridge() ? 'player' : atDoor,
        stock: { ...(pantry?.stock ?? {}) },
        held: h?.kind === 'snack' ? { snack: h.snack, left: h.left } : null,
        eating: snackHolders(),
      };
    },
    enumerable: false,
    configurable: false,
  });
  // __mmFridgeDo('open' | 'close' | 'take', snack?): work the fridge without aiming (pointer lock doesn't work headless).
  // 'take' opens the door first if it's shut. Returns whether it happened.
  Object.defineProperty(window, '__mmFridgeDo', {
    value: (op: 'open' | 'close' | 'take', snack?: SnackId): boolean => {
      if (op === 'open') return open() || door.open;
      if (op === 'close') return close() || !door.open;
      if (op !== 'take' || !isSnackId(snack)) return false;
      open();
      const before = useView.getState().held;
      fridgeAction('take', snack);
      const after = useView.getState().held;
      return after !== before && after?.kind === 'snack';
    },
    enumerable: false,
    configurable: false,
  });
}
