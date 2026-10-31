// Adapted from cubefarm shared/looks.ts (MIT): the parts a look is made of, without the look editor's picks. Pure.

export const HAIR_STYLES = ['crop', 'long', 'ponytail', 'bun', 'quiff', 'afro', 'sidePart', 'buzz', 'bald', 'curls', 'bob', 'mohawk', 'locs'] as const;
export const FACIAL_HAIR = ['none', 'stubble', 'beard', 'moustache'] as const;
export const GLASSES = ['none', 'round', 'square'] as const;
export const HEADWEAR = ['none', 'beanie', 'cap'] as const;
export const OUTFITS = ['tee', 'hoodie', 'stripe', 'sweater', 'cardigan', 'turtleneck'] as const;
export const BUILDS = ['slim', 'average', 'broad'] as const;

export type HairStyle = (typeof HAIR_STYLES)[number];
export type FacialHair = (typeof FACIAL_HAIR)[number];
export type Glasses = (typeof GLASSES)[number];
export type Headwear = (typeof HEADWEAR)[number];
export type Outfit = (typeof OUTFITS)[number];
export type Build = (typeof BUILDS)[number];
/** Which set of hairstyles a character draws from, and whether facial hair is in it. */
export type BodyLook = 'feminine' | 'masculine';

/** The small accent palette: glasses frames, beanies and caps, the stripe. */
export const ACCENT_COLORS = ['#ffffff', '#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#2b2d42'] as const;
export const HAIR_COLORS = ['#2b2118', '#6b4226', '#c68642', '#f2d16b', '#d94f30', '#1c1c1c', '#8e8e8e', '#5b3cc4', '#e76f51', '#e8e2d0'];
export const SKIN_TONES = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffe0bd', '#a86b3c', '#5c3a21'];
export const SHIRT_COLORS = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#9b5de5', '#f15bb5', '#00bbf9', '#06d6a0', '#ffbe0b', '#8338ec', '#fb5607', '#3a86ff'];
