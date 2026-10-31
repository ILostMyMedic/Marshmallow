// What this tab is looking at and doing, kept in the tab, not on the server: which floor (0 is the lobby), whether you
// walk it in first person or look down on it, what's under the crosshair, whether the mouse is locked for looking
// round, the panel that's open over the view, what you hold, and a passing note. Adapted from cubefarm
// client/src/store.ts (MIT): overlay, focus, locked, held and toasts.
import { create } from 'zustand';
import type { SnackId } from './fridge';
import type { End } from './pongPhysics';

/** A panel over the view: a worker's terminal, a floor's board, the elevator's buttons, or your look. */
export type Overlay = { kind: 'terminal'; workerId: string } | { kind: 'kanban'; floorId: string } | { kind: 'elevator' } | { kind: 'look' };

const PANELS: readonly string[] = ['terminal', 'kanban', 'elevator', 'look'] satisfies Overlay['kind'][];

/**
 * What E does with what's under the crosshair: open a panel, or do something in the room (actions.ts hands those to
 * whoever registered for them): say hi, take a mug, work the coffee machine or the fridge, pick up a paddle.
 */
export type Action =
  | Overlay
  | { kind: 'greet'; workerId: string }
  | { kind: 'mugs' }
  | { kind: 'coffee'; op: 'place' | 'brew' | 'take' }
  | { kind: 'fridge'; op: 'door' | 'take'; snack?: SnackId }
  | { kind: 'paddle'; end: End };

export const isPanel = (a: Action): a is Overlay => PANELS.includes(a.kind);

/** What's under the crosshair, and what E (or a click) does with it. */
export interface Focus {
  id: string;
  label: string;
  action: Action;
}

/** What's in your hands: a mug (and the sips of coffee in it), a snack from the fridge, or a ping-pong paddle. */
export type Held = { kind: 'mug'; id: string; sips: number } | { kind: 'snack'; id: string; snack: SnackId; left: number } | { kind: 'paddle'; end: End };

export type ViewMode = 'first' | 'overview';

interface View {
  floor: number | null; // until the manager picks one: the first floor with workers on it
  mode: ViewMode;
  overlay: Overlay | null;
  focus: Focus | null;
  locked: boolean;
  held: Held | null;
  /** A passing note over the view ("Put a mug under the machine first"), and when it was shown (performance.now()). */
  toast: { text: string; at: number } | null;
  setFloor(floor: number): void;
  setMode(mode: ViewMode): void;
  openOverlay(o: Overlay): void;
  closeOverlay(): void;
  setFocus(f: Focus | null): void;
  setLocked(locked: boolean): void;
  setHeld(h: Held | null): void;
  showToast(text: string): void;
}

export const useView = create<View>()((set, get) => ({
  floor: null,
  mode: 'overview',
  overlay: null,
  focus: null,
  locked: false,
  held: null,
  toast: null,
  setFloor: (floor) => set({ floor }),
  setMode: (mode) => set({ mode }),
  openOverlay: (overlay) => set({ overlay, focus: null }),
  closeOverlay: () => set({ overlay: null }),
  // The player sets it every few frames: only a change of target re-renders the hint.
  setFocus: (focus) => {
    const now = get().focus;
    if (now?.id === focus?.id && now?.label === focus?.label) return;
    set({ focus });
  },
  setLocked: (locked) => set({ locked }),
  setHeld: (held) => set({ held }),
  showToast: (text) => set({ toast: { text, at: performance.now() } }),
}));
