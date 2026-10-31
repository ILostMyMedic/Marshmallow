// You: how your character looks (the look editor, ui/LookPanel.tsx, changes it), kept in this browser. A look read
// back from storage is checked field by field, so an old or hand-edited one can't break the figure.
import { create } from 'zustand';
import { hashId, seededAppearance, type Appearance } from './appearance';
import { ACCENT_COLORS, BUILDS, FACIAL_HAIR, GLASSES, HAIR_STYLES, HEADWEAR, OUTFITS } from './looks';

const KEY = 'marshmallow:me';
const HEX = /^#[0-9a-f]{6}$/i;

/** The look you start with, before you pick your own: drawn like a worker's, from a seed of its own. */
export const DEFAULT_LOOK: Appearance = seededAppearance({ seed: hashId('marshmallow-manager'), role: 'worker' });

const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const within = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const colour = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v : fallback);

/** A look from anywhere (storage, a probe), every field checked against what the figure can draw; the rest from `base`. */
export function sanitizeLook(raw: unknown, base: Appearance = DEFAULT_LOOK): Appearance {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    look: oneOf(r.look, ['feminine', 'masculine'] as const, base.look),
    hair: oneOf(r.hair, HAIR_STYLES, base.hair),
    facialHair: oneOf(r.facialHair, FACIAL_HAIR, base.facialHair),
    glasses: oneOf(r.glasses, GLASSES, base.glasses),
    headphones: typeof r.headphones === 'boolean' ? r.headphones : base.headphones,
    headwear: oneOf(r.headwear, HEADWEAR, base.headwear),
    outfit: oneOf(r.outfit, OUTFITS, base.outfit),
    height: within(r.height, 0.9, 1.1, base.height),
    shoulders: within(r.shoulders, 0.95, 1.05, base.shoulders),
    build: oneOf(r.build, BUILDS, base.build),
    accent: Math.round(within(r.accent, 0, ACCENT_COLORS.length - 1, base.accent)),
    shirt: colour(r.shirt, base.shirt),
    hairColor: colour(r.hairColor, base.hairColor),
    skin: colour(r.skin, base.skin),
  };
}

function load(): { look: Appearance; chosen: boolean } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { look: sanitizeLook(JSON.parse(raw)), chosen: true };
  } catch {
    // private window or bad JSON: start from the default
  }
  return { look: DEFAULT_LOOK, chosen: false };
}

interface Me {
  look: Appearance;
  /** You've saved a look of your own (the editor opens by itself the first time you walk the floor until you have). */
  chosen: boolean;
  setLook(patch: Partial<Appearance>): void;
}

export const useMe = create<Me>()((set, get) => ({
  ...(typeof window === 'undefined' ? { look: DEFAULT_LOOK, chosen: false } : load()),
  setLook: (patch) => {
    const look = sanitizeLook({ ...get().look, ...patch }, get().look);
    set({ look, chosen: true });
    try {
      localStorage.setItem(KEY, JSON.stringify(look));
    } catch {
      // not saved: it still holds for this visit
    }
  },
}));
