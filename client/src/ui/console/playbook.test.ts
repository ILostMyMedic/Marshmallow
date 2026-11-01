import { describe, expect, it } from 'vitest';
import type { PlaybookDoc } from '../../../../shared/playbook';
import type { Floor } from '../../../../shared/types';
import { blankForm, docForm, docGroups, docReadout, entryUse, formDraft, formPatch, formProblems, nameTaken, placeholderHints, placeOf, preview, rulesReadout, templateCards } from './playbook';

const floor = { id: 'acme/app', fullName: 'acme/app', defaultBranch: 'main', workBranch: 'dev', floor: 1 } as Floor;
const office = { scope: 'office' as const, floorId: null };
const onFloor = { scope: 'floor' as const, floorId: 'acme/app' };
const doc = (o: Partial<PlaybookDoc>): PlaybookDoc => ({ id: 1, scope: 'office', floorId: null, kind: 'rules', name: 'r', description: '', body: '- x', tools: '', model: '', enabled: true, updatedAt: 0, ...o });
const docs = [
  doc({ id: 1, name: 'tests-first', body: '- Run the tests on {repo}' }),
  doc({ id: 2, scope: 'floor', floorId: 'acme/app', name: 'work-branch-flow', body: '- PRs into {workBranch}' }),
  doc({ id: 3, kind: 'skill', name: 'write-tests', description: 'Tests', body: 'Write them' }),
  doc({ id: 4, scope: 'floor', floorId: 'other/repo', name: 'elsewhere' }),
];

describe('placeOf', () => {
  it('is the floor the console names, else the office', () => {
    expect(placeOf([floor], 'acme/app')).toEqual(onFloor);
    expect(placeOf([floor], undefined)).toEqual(office);
    expect(placeOf([floor], 'gone/away')).toEqual(office);
  });
});

describe('docGroups', () => {
  it("lists the place's docs under every kind, empty kinds too", () => {
    const groups = docGroups(docs, office);
    expect(groups.map((g) => [g.kind, g.docs.map((d) => d.name)])).toEqual([
      ['rules', ['tests-first']],
      ['skill', ['write-tests']],
      ['agent', []],
      ['command', []],
    ]);
    expect(docGroups(docs, onFloor)[0].docs.map((d) => d.name)).toEqual(['work-branch-flow']);
  });
});

describe('the editor', () => {
  it('checks the form as the server would, and makes a doc for the place', () => {
    expect(formProblems({ ...blankForm('skill'), name: 'Write Tests', body: 'x' }, 'skill')).toMatchObject({ name: expect.any(String), description: expect.any(String) });
    expect(formProblems({ ...blankForm('rules'), name: 'small-prs', body: '- Small' }, 'rules')).toEqual({});
    expect(formDraft({ ...blankForm('agent'), name: ' reviewer ', description: 'Reviews', body: 'Look', tools: 'Read ,Grep' }, 'agent', onFloor)).toEqual({ scope: 'floor', floorId: 'acme/app', kind: 'agent', name: 'reviewer', description: 'Reviews', body: 'Look', tools: 'Read, Grep', model: '' });
  });

  it('sends only what changed, tidied', () => {
    const d = docs[2];
    expect(formPatch(docForm(d), d)).toEqual({});
    expect(formPatch({ ...docForm(d), body: 'Write them first\r\n', description: ' Tests ' }, d)).toEqual({ body: 'Write them first' });
  });

  it('knows a name another doc of the kind has in the place', () => {
    expect(nameTaken(docs, 'rules', office, 'tests-first', null)).toBe(true);
    expect(nameTaken(docs, 'rules', office, 'tests-first', 1)).toBe(false); // itself
    expect(nameTaken(docs, 'skill', office, 'tests-first', null)).toBe(false);
    expect(nameTaken(docs, 'rules', onFloor, 'tests-first', null)).toBe(false);
  });
});

describe('the size readouts', () => {
  it('says rules are paid on every turn, and the rest when used', () => {
    expect(docReadout('rules', { body: 'a\nb\nc', description: '' })).toEqual({ text: '3 lines · about 2 tokens on every turn of every session', heavy: false });
    expect(docReadout('skill', { body: 'x'.repeat(40), description: 'y'.repeat(8) }).text).toBe('1 line · about 10 tokens when a worker uses it; its description (about 2) is always loaded');
    expect(docReadout('rules', { body: Array(201).fill('- r').join('\n'), description: '' }).heavy).toBe(true);
  });

  it('warns when all the rules together get long', () => {
    expect(rulesReadout(preview([], [floor], onFloor)).text).toMatch(/^No rules yet/);
    expect(rulesReadout(preview(docs, [floor], onFloor))).toEqual({ text: expect.stringMatching(/^5 lines of rules, about \d+ tokens on every turn$/), heavy: false });
    const long = doc({ id: 9, body: Array(220).fill('- r').join('\n') });
    expect(rulesReadout(preview([long], [floor], onFloor))).toMatchObject({ heavy: true, text: expect.stringContaining('under 200 lines') });
  });
});

describe('templateCards', () => {
  it('marks the templates the place has already', () => {
    const cards = templateCards([doc({ name: 'tests-first' })], office);
    expect(cards.find((c) => c.template.id === 'tests-first')?.added).toBe(true);
    expect(cards.find((c) => c.template.id === 'work-branch-flow')?.added).toBe(false);
    const onTheFloor = templateCards([doc({ name: 'tests-first' })], onFloor);
    expect(onTheFloor.every((c) => !c.added)).toBe(true);
    expect(onTheFloor.filter((c) => c.fromOffice).map((c) => c.template.id)).toEqual(['tests-first']); // a floor gets it from the office
    expect(cards.some((c) => c.fromOffice)).toBe(false);
  });
});

describe('preview', () => {
  it("fills a floor's in for it, the office's first", () => {
    const pb = preview(docs, [floor], onFloor);
    expect(pb.rules).toContain('- Run the tests on acme/app\n\n- PRs into dev');
    expect(pb.entries.map((e) => [e.path, entryUse(e)])).toEqual([['skills/write-tests/SKILL.md', 'marshmallow:write-tests']]);
  });

  it("shows the office's own with the placeholders as written", () => {
    const pb = preview(docs, [floor], office);
    expect(pb.rules).toContain('- Run the tests on {repo}');
    expect(pb.rules).not.toContain('work-branch');
    expect(pb.entries).toHaveLength(1);
  });

  it('says what each placeholder becomes', () => {
    expect(placeholderHints([floor], onFloor)).toEqual([
      { key: '{workBranch}', value: 'dev' },
      { key: '{defaultBranch}', value: 'main' },
      { key: '{repo}', value: 'acme/app' },
    ]);
    expect(placeholderHints([floor], office)[0].value).toBe("each floor's work branch");
    expect(entryUse({ kind: 'command', name: 'ship' })).toBe('/marshmallow:ship');
  });
});
