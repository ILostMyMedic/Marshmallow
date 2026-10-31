// What this tab is looking at: which floor (0 is the lobby). Kept in the tab, not on the server: each tab can look at a
// different floor.
import { create } from 'zustand';

export const useView = create<{ floor: number | null; setFloor(floor: number): void }>()((set) => ({
  floor: null, // until the manager picks one: the first floor with workers on it
  setFloor: (floor) => set({ floor }),
}));
