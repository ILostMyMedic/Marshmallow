// What this tab is looking at and doing, kept in the tab, not on the server: which floor (0 is the lobby), whether you
// walk it (the camera behind you or in your eyes) or look down on it, what's under the crosshair, whether the mouse is
// locked for looking round, the panel that's open over the view, what you hold, and a passing note. Adapted from
// cubefarm client/src/store.ts (MIT): overlay, focus, locked, held and toasts.
import { create } from 'zustand';
import type { SnackId } from './fridge';
import type { End } from './pongPhysics';

/** The manager's console's tabs (ui/ManagerConsole.tsx). */
export type ConsoleTab = 'floors' | 'team' | 'issues' | 'settings';

/**
 * A panel over the view: a worker's panel (their terminal), a floor's board, the elevator's buttons, your look, the
 * front desk, the manager's console, the phone, the help screen, or the first-run setup.
 */
export type Overlay =
  | { kind: 'terminal'; workerId: string }
  | { kind: 'kanban'; floorId: string }
  | { kind: 'elevator' }
  | { kind: 'look' }
  | { kind: 'frontdesk' }
  | { kind: 'console'; tab?: ConsoleTab; floorId?: string }
  | { kind: 'phone' }
  | { kind: 'help' }
  | { kind: 'setup' };

const PANELS: readonly string[] = ['terminal', 'kanban', 'elevator', 'look', 'frontdesk', 'console', 'phone', 'help', 'setup'] satisfies Overlay['kind'][];

/**
 * What E does with what's under the crosshair: open a panel, or do something in the room (actions.ts hands those to
 * whoever registered for them): say hi, take a mug, work the coffee machine or the fridge, pick up a paddle, look
 * through a lookout's binoculars.
 */
export type Action =
  | Overlay
  | { kind: 'greet'; workerId: string }
  | { kind: 'mugs' }
  | { kind: 'coffee'; op: 'place' | 'brew' | 'take' }
  | { kind: 'fridge'; op: 'door' | 'take'; snack?: SnackId }
  | { kind: 'paddle'; end: End }
  | { kind: 'lookout'; id: string };

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
/** On foot (ViewMode 'first'), whether the camera looks out of your eyes (the default) or follows behind you. */
export type Person = 'third' | 'first';

const PERSON_KEY = 'marshmallow:camera'; // not 'marshmallow:person': that held the old default, third person
function loadPerson(): Person {
  try {
    return localStorage.getItem(PERSON_KEY) === 'third' ? 'third' : 'first';
  } catch {
    return 'first';
  }
}

interface View {
  floor: number | null; // until the manager picks one: the first floor with workers on it
  mode: ViewMode;
  person: Person;
  overlay: Overlay | null;
  focus: Focus | null;
  /** In the overview: what a click would open, under the mouse (picking.ts). */
  hover: Focus | null;
  locked: boolean;
  held: Held | null;
  /** A passing note over the view ("Put a mug under the machine first"), and when it was shown (performance.now()). */
  toast: { text: string; at: number } | null;
  setFloor(floor: number): void;
  setMode(mode: ViewMode): void;
  setPerson(p: Person): void;
  openOverlay(o: Overlay): void;
  closeOverlay(): void;
  setFocus(f: Focus | null): void;
  setHover(f: Focus | null): void;
  setLocked(locked: boolean): void;
  setHeld(h: Held | null): void;
  showToast(text: string): void;
}

export const useView = create<View>()((set, get) => ({
  floor: null,
  mode: 'overview',
  person: typeof window === 'undefined' ? 'first' : loadPerson(),
  overlay: null,
  focus: null,
  hover: null,
  locked: false,
  held: null,
  toast: null,
  setFloor: (floor) => set({ floor }),
  setMode: (mode) => set({ mode }),
  setPerson: (person) => {
    set({ person });
    try {
      localStorage.setItem(PERSON_KEY, person);
    } catch {
      // not saved: it holds for this visit
    }
  },
  openOverlay: (overlay) => set({ overlay, focus: null }),
  closeOverlay: () => set({ overlay: null }),
  // The player sets it every few frames: only a change of target re-renders the hint.
  setFocus: (focus) => {
    const now = get().focus;
    if (now?.id === focus?.id && now?.label === focus?.label) return;
    set({ focus });
  },
  setHover: (hover) => {
    const now = get().hover;
    if (now?.id === hover?.id && now?.label === hover?.label) return;
    set({ hover });
  },
  setLocked: (locked) => set({ locked }),
  setHeld: (held) => set({ held }),
  showToast: (text) => set({ toast: { text, at: performance.now() } }),
}));
