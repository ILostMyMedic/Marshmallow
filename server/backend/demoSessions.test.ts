import { describe, expect, it } from 'vitest';
import { playbookFor, type PlaybookDoc } from '../../shared/playbook.ts';
import { playbookLines, projectName } from './demoSessions.ts';

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

describe("a demo session's header", () => {
  const doc = (o: Partial<PlaybookDoc>): PlaybookDoc => ({ id: 1, scope: 'office', floorId: null, kind: 'rules', name: 'tests-first', description: '', body: '- Run the tests', tools: '', model: '', enabled: true, updatedAt: 0, ...o });
  const floor = { id: 'acme/app', fullName: 'acme/app', defaultBranch: 'main' };

  it('says what the session got from the playbook, and whether your own setup came along', () => {
    const playbook = playbookFor([doc({}), doc({ id: 2, kind: 'skill', name: 'write-tests', description: 'Tests' })], floor);
    expect(playbookLines({ playbook, ownSetup: false }).map((l) => l.text)).toEqual([
      `  📘 playbook rules: tests-first · 3 lines, about ${playbook.size.tokens} tokens a turn`,
      '  📘 plugin marshmallow: skill write-tests',
      '  your own Claude setup: left out (--setting-sources project,local, auto memory off)',
    ]);
    expect(playbookLines({ playbook: playbookFor([], floor), ownSetup: true }).map((l) => l.text)).toEqual(['  your own Claude setup: loaded']);
    expect(playbookLines({})).toEqual([]);
  });
});
