// Adapted from cubefarm client/src/world/appearance.ts (MIT): the seeded look, from the worker's seed instead of a hash
// of their id, with the colours cubefarm picks at hire drawn from it too.
import {
  ACCENT_COLORS,
  HAIR_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  type BodyLook,
  type Build,
  type FacialHair,
  type Glasses,
  type HairStyle,
  type Headwear,
  type Outfit,
} from './looks';

// Everything that makes one cartoon person look different from the next, picked from the worker's seed so the same
// person looks the same after a reload and in every tab. Pure: no three.js, easy to test.

export type { Build, FacialHair, Glasses, HairStyle, Headwear, Outfit };

export interface Appearance {
  look: BodyLook;
  hair: HairStyle;
  facialHair: FacialHair;
  glasses: Glasses;
  headphones: boolean;
  headwear: Headwear;
  outfit: Outfit;
  /** Upper-body scale, about ±10%. */
  height: number;
  /** A little shoulder-width variation on top of the build, about ±5%. */
  shoulders: number;
  build: Build;
  /** Index into a small accent palette (glasses frames, beanie/cap, stripe). */
  accent: number;
  shirt: string;
  hairColor: string;
  skin: string;
}

export const ACCENTS = ACCENT_COLORS;

/** How each build scales the torso: width (with the shoulders) and depth. */
export const BUILD_SHAPE: Record<Build, { width: number; depth: number }> = {
  slim: { width: 0.88, depth: 0.92 },
  average: { width: 1, depth: 1 },
  broad: { width: 1.15, depth: 1.1 },
};

/** Styles that sit on top of or bulge out from the head and would poke through a beanie or cap. */
export const TALL_HAIR: readonly HairStyle[] = ['quiff', 'afro', 'bun', 'curls', 'mohawk'];

type Weighted<T> = [T, number][];

const HAIR: Record<BodyLook, Weighted<HairStyle>> = {
  feminine: [
    ['long', 4],
    ['ponytail', 3],
    ['bun', 3],
    ['curls', 2],
    ['afro', 2],
    ['sidePart', 2],
    ['buzz', 1],
  ],
  masculine: [
    ['crop', 2],
    ['quiff', 3],
    ['sidePart', 3],
    ['buzz', 2],
    ['bald', 2],
    ['curls', 2],
    ['afro', 2],
    ['long', 1],
    ['ponytail', 1],
    ['bun', 1],
  ],
};
/** cubefarm's later styles, drawn by a separate number. */
const NEW_HAIR: Record<BodyLook, Weighted<HairStyle>> = {
  feminine: [
    ['bob', 3],
    ['locs', 2],
    ['mohawk', 1],
  ],
  masculine: [
    ['locs', 2],
    ['mohawk', 2],
    ['bob', 1],
  ],
};
const NEW_HAIR_SHARE = 0.22;
const NEW_OUTFIT_SHARE = 0.3;

/** FNV-1a: a small, stable 32-bit string hash. */
export function hashId(id: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: turns a seed into a stream of numbers in [0, 1), so each pick below is independent. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: number, options: Weighted<T>): T {
  const total = options.reduce((n, [, w]) => n + w, 0);
  let x = r * total;
  for (const [v, w] of options) if ((x -= w) < 0) return v;
  return options[options.length - 1][0];
}

const oneOf = <T>(r: number, list: readonly T[]) => list[Math.min(list.length - 1, Math.floor(r * list.length))];

/** A worker's look, from their seed: the same in every tab and after every reload. */
export function seededAppearance(w: { seed: number; role: 'worker' | 'ceo' }): Appearance {
  const next = rng(w.seed);
  // Always draw every number in the same order, so tweaking one rule doesn't reshuffle everything else; new draws go
  // on the end.
  const [rHair, rFacial, rGlasses, rPhones, rHat, rOutfit, rHeight, rShoulders, rAccent, rBuild, rNewHair, rNewOutfit, rLook, rShirt, rHairColor, rSkin] = Array.from({ length: 16 }, next);
  // the CEO keeps their suit and a bare head; hats, headphones and outfits are for everyone else
  const staff = w.role !== 'ceo';
  const look: BodyLook = rLook < 0.5 ? 'feminine' : 'masculine';
  const masculine = look === 'masculine';

  const hair = rNewHair < NEW_HAIR_SHARE ? pick(rHair, NEW_HAIR[look]) : pick(rHair, HAIR[look]);
  const facialHair = masculine
    ? pick<FacialHair>(rFacial, [
        ['none', 5],
        ['stubble', 2],
        ['beard', 2],
        ['moustache', 1],
      ])
    : 'none';
  const glasses = pick<Glasses>(rGlasses, [
    ['none', 6],
    ['round', 2],
    ['square', 2],
  ]);
  // Headphones and hats both sit on the head, so a person gets at most one of them.
  const headphones = staff && hair !== 'afro' && hair !== 'mohawk' && rPhones < 0.3;
  const headwear =
    staff && !headphones && !TALL_HAIR.includes(hair)
      ? pick<Headwear>(rHat, [
          ['none', 7],
          ['beanie', 1],
          ['cap', 1],
        ])
      : 'none';
  const outfit = !staff
    ? 'tee'
    : rNewOutfit < NEW_OUTFIT_SHARE
      ? pick<Outfit>(rOutfit, [
          ['cardigan', 1],
          ['turtleneck', 1],
        ])
      : pick<Outfit>(rOutfit, [
          ['tee', 1],
          ['hoodie', 1],
          ['stripe', 1],
          ['sweater', 1],
        ]);

  return {
    look,
    hair,
    facialHair,
    glasses,
    headphones,
    headwear,
    outfit,
    height: +(0.9 + rHeight * 0.2).toFixed(3),
    shoulders: +(0.95 + rShoulders * 0.1).toFixed(3),
    build: pick<Build>(rBuild, [
      ['slim', 1],
      ['average', 2],
      ['broad', 1],
    ]),
    accent: Math.floor(rAccent * ACCENTS.length),
    shirt: oneOf(rShirt, SHIRT_COLORS),
    hairColor: oneOf(rHairColor, HAIR_COLORS),
    skin: oneOf(rSkin, SKIN_TONES),
  };
}
