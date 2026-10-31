import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, sanitizeLook } from './myLook';

describe('sanitizeLook', () => {
  it('keeps a good look as it is', () => {
    expect(sanitizeLook(DEFAULT_LOOK)).toEqual(DEFAULT_LOOK);
    const mine = { ...DEFAULT_LOOK, hair: 'afro' as const, shirt: '#123abc', build: 'broad' as const };
    expect(sanitizeLook(mine)).toEqual(mine);
  });

  it("drops what the figure can't draw, field by field, and keeps the rest", () => {
    const out = sanitizeLook({ ...DEFAULT_LOOK, hair: 'spikes', shirt: 'red', height: 7, accent: 99.4, headphones: 'yes', glasses: 'square' });
    expect(out.hair).toBe(DEFAULT_LOOK.hair);
    expect(out.shirt).toBe(DEFAULT_LOOK.shirt);
    expect(out.height).toBe(1.1);
    expect(out.accent).toBe(5);
    expect(out.headphones).toBe(DEFAULT_LOOK.headphones);
    expect(out.glasses).toBe('square');
  });

  it('falls back to the default for anything that is not a look at all', () => {
    expect(sanitizeLook(null)).toEqual(DEFAULT_LOOK);
    expect(sanitizeLook('nope')).toEqual(DEFAULT_LOOK);
  });
});
