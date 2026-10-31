// The tour the guide at the front desk gives (TourGuide.tsx runs it, ui/TourCard.tsx shows where you are): whether one
// is on, its stops (tour.ts) and which you're at. Kept in the tab, like view.ts.
import { create } from 'zustand';
import type { TourStop } from './tour';

interface Tour {
  active: boolean;
  stops: TourStop[];
  /** The stop you're at, or on your way to. */
  at: number;
  start(stops: TourStop[]): void;
  /** On to the next stop; the end of the tour after the last. */
  next(): void;
  end(): void;
}

export const useTour = create<Tour>()((set, get) => ({
  active: false,
  stops: [],
  at: 0,
  start: (stops) => set({ active: stops.length > 0, stops, at: 0 }),
  next: () => {
    const { at, stops } = get();
    if (at + 1 < stops.length) set({ at: at + 1 });
    else set({ active: false });
  },
  end: () => set({ active: false }),
}));

/** The stop you're at, while a tour is on. */
export const currentStop = () => {
  const t = useTour.getState();
  return t.active ? (t.stops[t.at] ?? null) : null;
};
