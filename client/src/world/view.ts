// What this tab is looking at and doing, kept in the tab, not on the server: which floor (0 is the lobby), whether you
// walk it in first person or look down on it, what's under the crosshair, whether the mouse is locked for looking
// round, and the panel that's open over the view. Adapted from cubefarm client/src/store.ts (MIT): overlay, focus and
// locked.
import { create } from 'zustand';

/** A panel over the view: a worker's terminal, or a floor's board. */
export type Overlay = { kind: 'terminal'; workerId: string } | { kind: 'kanban'; floorId: string };

/** What's under the crosshair, and what E (or a click) does with it. */
export interface Focus {
  id: string;
  label: string;
  action: Overlay;
}

export type ViewMode = 'first' | 'overview';

interface View {
  floor: number | null; // until the manager picks one: the first floor with workers on it
  mode: ViewMode;
  overlay: Overlay | null;
  focus: Focus | null;
  locked: boolean;
  setFloor(floor: number): void;
  setMode(mode: ViewMode): void;
  openOverlay(o: Overlay): void;
  closeOverlay(): void;
  setFocus(f: Focus | null): void;
  setLocked(locked: boolean): void;
}

export const useView = create<View>()((set, get) => ({
  floor: null,
  mode: 'overview',
  overlay: null,
  focus: null,
  locked: false,
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
}));
