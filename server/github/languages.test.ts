import { describe, expect, it } from 'vitest';
import { fakeLanguages } from '../backend/demoGithub.ts';
import { languageShares } from './languages.ts';

const sum = (l: { share: number }[]) => Math.round(l.reduce((s, x) => s + x.share, 0) * 1000) / 1000;

describe('languageShares', () => {
  it('turns bytes per language into shares that add up to 1, biggest first', () => {
    expect(languageShares([{ name: 'CSS', size: 250 }, { name: 'TypeScript', size: 700 }, { name: 'HTML', size: 50 }])).toEqual([
      { name: 'TypeScript', share: 0.7 },
      { name: 'CSS', share: 0.25 },
      { name: 'HTML', share: 0.05 },
    ]);
    const thirds = languageShares([{ name: 'A', size: 1 }, { name: 'B', size: 1 }, { name: 'C', size: 1 }]);
    expect(thirds.map((l) => l.share)).toEqual([0.334, 0.333, 0.333]);
  });

  it('keeps the six biggest, shared out among them, and leaves out empty ones', () => {
    const many = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((name, i) => ({ name, size: 800 - i * 100 }));
    const kept = languageShares([...many, { name: 'Empty', size: 0 }]);
    expect(kept.map((l) => l.name)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(sum(kept)).toBe(1);
    expect(languageShares([])).toEqual([]);
    expect(languageShares([{ name: 'Nothing', size: 0 }])).toEqual([]);
  });
});

describe("the demo's languages", () => {
  it('are made up from the repository name: the same every time, different between repositories', () => {
    const todo = fakeLanguages('demo-co/pixel-todo');
    expect(fakeLanguages('demo-co/pixel-todo')).toEqual(todo);
    expect(fakeLanguages('demo-co/weather-api')).not.toEqual(todo);
    for (const name of ['demo-co/pixel-todo', 'demo-co/weather-api', 'demo-co/recipe-box', 'demo-manager/new-app']) {
      const langs = fakeLanguages(name);
      expect(langs.length).toBeGreaterThanOrEqual(3);
      expect(sum(langs)).toBe(1);
      expect([...langs].sort((a, b) => b.share - a.share)).toEqual(langs);
    }
  });
});
