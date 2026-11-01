// New in Marshmallow.
import { describe, expect, it } from 'vitest';
import { SHOP_SPOTS } from '../../../../shared/shop';
import { POSTER_STYLES, blend, hashString, languageColor, legendOf, luminance, posterPlan, rng, shortName, styleOf, type PosterInput } from './poster';

const repo = (over: Partial<PosterInput> = {}): PosterInput => ({
  floorId: 'acme/rocket',
  spot: 'wall-1',
  fullName: 'acme/rocket',
  color: '#3a86ff',
  floor: 2,
  languages: [
    { name: 'TypeScript', share: 0.7 },
    { name: 'CSS', share: 0.2 },
    { name: 'HTML', share: 0.1 },
  ],
  ...over,
});
const WALLS = SHOP_SPOTS.filter((s) => s.kind === 'wall').map((s) => s.id);

describe('a repo poster', () => {
  it('looks the same every time for the same floor and spot', () => {
    expect(posterPlan(repo())).toEqual(posterPlan(repo()));
    expect(hashString('acme/rocket|wall-1')).toBe(hashString('acme/rocket|wall-1'));
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('differs between two spots on one floor: each wall spot takes the next style', () => {
    const styles = WALLS.map((spot) => posterPlan(repo({ spot })).style);
    expect(new Set(styles).size).toBe(WALLS.length);
    expect(posterPlan(repo({ spot: 'wall-1' }))).not.toEqual(posterPlan(repo({ spot: 'wall-2' })));
  });

  it('differs between two floors, in its palette and its name', () => {
    const a = posterPlan(repo());
    const b = posterPlan(repo({ floorId: 'acme/lander', fullName: 'acme/lander', color: '#ff006e', languages: [{ name: 'Python', share: 1 }] }));
    expect(a.title).toBe('rocket');
    expect(b.title).toBe('lander');
    expect(a.palette.accents[0]).toBe('#3a86ff');
    expect(b.palette.accents[0]).toBe('#ff006e');
    expect(a.palette.accents).not.toEqual(b.palette.accents);
    // every style turns up across floors
    const seen = new Set(Array.from({ length: 60 }, (_, i) => styleOf(`o/repo-${i}`, 'wall-1')));
    expect([...seen].sort()).toEqual([...POSTER_STYLES].sort());
  });

  it('builds its palette from the floor’s colour and its languages’ colours, with type that reads on its paper', () => {
    const p = posterPlan(repo());
    expect(p.palette.accents.slice(0, 4)).toEqual(['#3a86ff', '#3178c6', '#663399', '#e34c26']);
    expect(p.palette.accents.length).toBeGreaterThanOrEqual(3);
    for (const s of WALLS) {
      const { palette } = posterPlan(repo({ spot: s }));
      expect(Math.abs(luminance(palette.bg) - luminance(palette.ink)), s).toBeGreaterThan(0.5);
    }
  });

  it('knows GitHub’s language colours, and makes a steady one up for the rest', () => {
    expect(languageColor('TypeScript')).toBe('#3178c6');
    expect(languageColor('javascript')).toBe('#f1e05a');
    expect(languageColor('Python')).toBe('#3572a5');
    const odd = languageColor('Brainfudge');
    expect(odd).toMatch(/^#[0-9a-f]{6}$/);
    expect(languageColor('Brainfudge')).toBe(odd);
    expect(languageColor('Whitespace2')).not.toBe(odd);
  });

  it('shows the biggest languages in its legend, the rest as Other, in whole percentages adding up to 100', () => {
    const legend = legendOf([
      { name: 'Go', share: 0.4 },
      { name: 'Shell', share: 0.05 },
      { name: 'TypeScript', share: 0.3 },
      { name: 'HTML', share: 0.13 },
      { name: 'CSS', share: 0.12 },
      { name: 'Makefile', share: 0 },
    ]);
    expect(legend.map((r) => r.name)).toEqual(['Go', 'TypeScript', 'HTML', 'Other']);
    expect(legend.reduce((n, r) => n + r.pct, 0)).toBe(100);
    expect(legend.find((r) => r.name === 'Other')!.pct).toBe(17);
    // thirds still add up
    expect(legendOf(['A', 'B', 'C'].map((name) => ({ name, share: 1 }))).reduce((n, r) => n + r.pct, 0)).toBe(100);
  });

  it('still makes a poster for a repository with no languages yet', () => {
    for (const languages of [[], undefined]) {
      const p = posterPlan(repo({ languages }));
      expect(p.legend).toEqual([]);
      expect(p.palette.accents.length).toBeGreaterThanOrEqual(3);
      expect(p.title).toBe('rocket');
    }
    expect(shortName('rocket')).toBe('rocket');
    expect(blend('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});
