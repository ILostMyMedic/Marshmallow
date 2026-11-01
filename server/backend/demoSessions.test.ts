import { describe, expect, it } from 'vitest';
import { projectName } from './demoSessions.ts';

describe("the scripted CEO's project name", () => {
  it('takes the first few words of the idea, up to a colon or comma', () => {
    expect(projectName('A tiny recipe app: save recipes, pick a few for the week')).toBe('Tiny recipe app');
    expect(projectName('the bookmarks page, for the team')).toBe('Bookmarks page');
    expect(projectName('Habit tracker with streaks and reminders for every day')).toBe('Habit tracker with streaks');
  });

  it('falls back when there are no words', () => {
    expect(projectName('   ')).toBe('New project');
    expect(projectName(': nothing first')).toBe('New project');
  });
});
