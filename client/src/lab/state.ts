// The lab's settings (what plays, how it's shown, whose look) and its clock, which pauses and runs at any speed. The
// figures read both every frame; the panel changes them.
import { create } from 'zustand';
import { seededAppearance, type Appearance } from '../world/appearance';
import { DESIGNS, type DesignId } from './designs';
import type { AnimName } from './poses';

/** The lab's own time (seconds), advanced by the clock in LabScene; dt is this frame's step (0 while paused). */
export const labClock = { t: 0, dt: 0 };

export interface Stats {
  /** Draw calls for one figure in the colour pass, and again in the shadow pass; its triangles. */
  draws: number;
  shadows: number;
  triangles: number;
  /** Of those, the game's head (the same for every design but its scale). */
  headDraws: number;
  headTriangles: number;
}

export type View = 'all' | DesignId;

interface Lab {
  anim: AnimName;
  /** When the animation started, on the lab clock. */
  at: number;
  inTurn: boolean;
  paused: boolean;
  speed: number;
  turntable: boolean;
  outlines: boolean;
  view: View;
  /** Designs left out of the side-by-side view. */
  hidden: DesignId[];
  /** Whose look: 'me', a worker's id, or a seed's label. */
  lookKey: string;
  look: Appearance;
  stats: Partial<Record<DesignId, Stats>>;
  play(anim: AnimName): void;
  set(patch: Partial<Pick<Lab, 'inTurn' | 'paused' | 'speed' | 'turntable' | 'outlines' | 'view'>>): void;
  toggle(id: DesignId): void;
  setLook(key: string, look: Appearance): void;
  setStats(id: DesignId, s: Stats): void;
}

export const randomLook = (seed: number) => seededAppearance({ seed, role: 'worker' });

export const useLab = create<Lab>()((set) => ({
  anim: 'idle',
  at: 0,
  inTurn: false,
  paused: false,
  speed: 1,
  turntable: false,
  outlines: true,
  view: 'all',
  hidden: [],
  lookKey: 'seed:1',
  look: randomLook(1),
  stats: {},
  play: (anim) => set({ anim, at: labClock.t }),
  set: (patch) => set(patch),
  toggle: (id) => set((s) => ({ hidden: s.hidden.includes(id) ? s.hidden.filter((h) => h !== id) : [...s.hidden, id] })),
  setLook: (lookKey, look) => set({ lookKey, look }),
  setStats: (id, st) =>
    set((s) => {
      const old = s.stats[id];
      return old && old.draws === st.draws && old.shadows === st.shadows && old.triangles === st.triangles && old.headDraws === st.headDraws ? s : { stats: { ...s.stats, [id]: st } };
    }),
}));

/** The designs on show: the one picked, or every one not left out. */
export const shownDesigns = (view: View, hidden: readonly DesignId[]): DesignId[] => (view === 'all' ? DESIGNS.map((d) => d.id).filter((id) => !hidden.includes(id)) : [view]);
