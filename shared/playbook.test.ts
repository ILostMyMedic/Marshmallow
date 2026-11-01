import { describe, expect, it } from 'vitest';
import {
  cleanDoc,
  docProblem,
  docProblems,
  fill,
  lineDiff,
  playbookFor,
  pluginFile,
  RULES_LINES_WARN,
  TEMPLATES,
  templateDraft,
  textSize,
  withRules,
  type PlaybookDoc,
  type PlaybookDraft,
  type PlaybookFloor,
} from './playbook.ts';

const floor: PlaybookFloor = { id: 'acme/app', fullName: 'acme/app', defaultBranch: 'main', workBranch: 'dev' };
let nextId = 1;
const doc = (o: Partial<PlaybookDoc> = {}): PlaybookDoc => ({
  id: nextId++,
  scope: 'office',
  floorId: null,
  kind: 'rules',
  name: 'rules',
  description: '',
  body: 'Be kind.',
  tools: '',
  model: '',
  enabled: true,
  updatedAt: 0,
  ...o,
});
const draft = (o: Partial<PlaybookDraft> = {}): PlaybookDraft => ({ scope: 'office', floorId: null, kind: 'skill', name: 'write-tests', description: 'Use it.', body: 'Do it.', tools: '', model: '', ...o });

describe('docProblems', () => {
  it('takes lowercase-hyphen names only', () => {
    expect(docProblems(draft())).toEqual({});
    for (const name of ['Write-Tests', 'write_tests', 'write--tests', '-write', 'write tests', 'x'.repeat(65)]) expect(docProblems(draft({ name })).name).toBeTruthy();
    expect(docProblems(draft({ name: '' })).name).toBe('Give it a name');
    expect(docProblems(draft({ name: 'a1-b2-c3' }))).toEqual({});
  });

  it('wants a description for what Claude chooses by it, and a body for everything', () => {
    expect(docProblems(draft({ description: '' })).description).toMatch(/when Claude should use this skill/);
    expect(docProblems(draft({ kind: 'rules', description: '' }))).toEqual({});
    expect(docProblems(draft({ body: '  \n ' })).body).toBe('Write what it says');
    expect(docProblem(draft({ kind: 'command', description: '' }))).toMatch(/^description: .*command/);
    expect(docProblem(draft())).toBeNull();
  });

  it("checks a subagent's tools and model", () => {
    expect(docProblems(draft({ kind: 'agent', tools: 'Read, Grep, Bash(git *)', model: 'sonnet' }))).toEqual({});
    expect(docProblems(draft({ kind: 'agent', tools: 'Read; rm -rf' })).tools).toBeTruthy();
    expect(docProblems(draft({ kind: 'agent', model: 'son net' })).model).toBeTruthy();
  });
});

describe('cleanDoc', () => {
  it('keeps a description to one line, the body to LF line ends, and tools only on subagents', () => {
    const d = cleanDoc(draft({ name: ' write-tests ', description: ' Use\n it  now ', body: 'a\r\nb\r\n\r\n', tools: 'Read', model: 'x' }));
    expect(d).toMatchObject({ name: 'write-tests', description: 'Use it now', body: 'a\nb', tools: '', model: '' });
    expect(cleanDoc(draft({ kind: 'agent', tools: ' Read ,Grep,, Bash ' })).tools).toBe('Read, Grep, Bash');
  });
});

describe('fill', () => {
  it("fills the floor's branches and repository, the work branch falling back to the default one", () => {
    expect(fill('PRs into {workBranch}, never {defaultBranch}, on {repo}.', floor)).toBe('PRs into dev, never main, on acme/app.');
    expect(fill('{workBranch}', { ...floor, workBranch: null })).toBe('main');
    expect(fill('{workBranch}', { id: 'x/y', fullName: 'x/y', defaultBranch: 'trunk' })).toBe('trunk');
    expect(fill('{workBranch} {unknown}', null)).toBe("the floor's work branch {unknown}");
  });
});

describe('playbookFor', () => {
  const docs = [
    doc({ name: 'office-rules', body: '## Office\n- {defaultBranch} runs live' }),
    doc({ scope: 'floor', floorId: 'acme/app', name: 'floor-rules', body: '## Floor\n- PRs into {workBranch}' }),
    doc({ scope: 'floor', floorId: 'other/repo', name: 'elsewhere', body: 'Not here' }),
    doc({ name: 'off', body: 'Disabled', enabled: false }),
    doc({ kind: 'skill', name: 'write-tests', description: 'Tests for {repo}', body: 'Office version' }),
    doc({ scope: 'floor', floorId: 'acme/app', kind: 'skill', name: 'write-tests', description: 'Floor tests', body: 'Floor version' }),
    doc({ kind: 'command', name: 'ship', description: 'Ship it', body: 'Ship $ARGUMENTS' }),
    doc({ scope: 'floor', floorId: 'acme/app', kind: 'agent', name: 'reviewer', description: 'Reviews', body: 'Review {workBranch}', tools: 'Read, Grep', model: 'sonnet' }),
  ];

  it("gives a floor's sessions the office's rules first, then the floor's, filled in, and nothing disabled or another floor's", () => {
    const pb = playbookFor(docs, floor);
    expect(pb.rules).toBe("# The manager's rules (Marshmallow's playbook)\n\n## Office\n- main runs live\n\n## Floor\n- PRs into dev");
    expect(pb.rulesDocs).toEqual([
      { name: 'office-rules', scope: 'office' },
      { name: 'floor-rules', scope: 'floor' },
    ]);
    expect(pb.size).toEqual({ lines: 7, tokens: Math.ceil(pb.rules.length / 4), heavy: false });
  });

  it("puts skills, subagents and commands in the plugin, a floor's replacing the office's of the same name", () => {
    const pb = playbookFor(docs, floor);
    expect(pb.entries).toEqual([
      { kind: 'skill', name: 'write-tests', scope: 'floor', path: 'skills/write-tests/SKILL.md' },
      { kind: 'agent', name: 'reviewer', scope: 'floor', path: 'agents/reviewer.md' },
      { kind: 'command', name: 'ship', scope: 'office', path: 'commands/ship.md' },
    ]);
    expect(pb.files.map((f) => f.path)).toEqual(['.claude-plugin/plugin.json', 'skills/write-tests/SKILL.md', 'agents/reviewer.md', 'commands/ship.md']);
    expect(JSON.parse(pb.files[0].content)).toMatchObject({ name: 'marshmallow', version: '1.0.0' });
    expect(pb.files[1].content).toBe('---\nname: write-tests\ndescription: "Floor tests"\n---\n\nFloor version\n');
    expect(pb.files[2].content).toBe('---\nname: reviewer\ndescription: "Reviews"\ntools: "Read, Grep"\nmodel: "sonnet"\n---\n\nReview dev\n');
    expect(pb.files[3].content).toBe('---\ndescription: "Ship it"\n---\n\nShip $ARGUMENTS\n');
  });

  it("gives the CEO (no floor) the office's rules only, with plain words for the placeholders, and no plugin", () => {
    const pb = playbookFor(docs, null);
    expect(pb.rules).toBe("# The manager's rules (Marshmallow's playbook)\n\n## Office\n- the default branch runs live");
    expect(pb.entries).toEqual([]);
    expect(pb.files).toEqual([]);
  });

  it('gives nothing when there is nothing, and no plugin without skills, subagents or commands', () => {
    expect(playbookFor([], floor)).toEqual({ rules: '', size: { lines: 0, tokens: 0, heavy: false }, rulesDocs: [], entries: [], files: [] });
    expect(playbookFor([docs[0]], floor).files).toEqual([]);
  });

  it(`warns past ${RULES_LINES_WARN} lines of rules`, () => {
    const long = doc({ body: Array.from({ length: RULES_LINES_WARN }, (_, i) => `- rule ${i}`).join('\n') });
    expect(playbookFor([long], floor).size.heavy).toBe(true);
  });
});

describe('pluginFile', () => {
  it('quotes a description whatever it holds, so the frontmatter always parses', () => {
    const f = pluginFile({ kind: 'command', name: 'check', description: 'Check: "ready?" # now', body: 'x', tools: '', model: '' }, null);
    expect(f.content.split('\n')[1]).toBe('description: "Check: \\"ready?\\" # now"');
  });
});

describe('textSize', () => {
  it('counts lines and about a token per four characters', () => {
    expect(textSize('')).toEqual({ lines: 0, tokens: 0 });
    expect(textSize('abcd\nefgh\n\n')).toEqual({ lines: 2, tokens: 3 });
  });
});

describe('withRules', () => {
  it("puts the rules after the office's instructions, and leaves them alone without rules", () => {
    expect(withRules('Do the task.\n', '# Rules')).toBe('Do the task.\n\n# Rules\n');
    expect(withRules('Do the task.', '')).toBe('Do the task.');
  });
});

describe('templates', () => {
  it('are all docs that pass the checks, with unique ids and names', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    expect(new Set(TEMPLATES.map((t) => `${t.kind}:${t.name}`)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) expect(docProblems(cleanDoc(templateDraft(t, 'office', null))), t.id).toEqual({});
  });

  it('keep their placeholders until a floor fills them, and belong to the floor they were added to', () => {
    const flow = TEMPLATES.find((t) => t.id === 'work-branch-flow')!;
    const d = templateDraft(flow, 'floor', 'acme/app');
    expect(d).toMatchObject({ scope: 'floor', floorId: 'acme/app', kind: 'rules', name: 'work-branch-flow' });
    expect(d.body).toContain('{workBranch}');
    expect(templateDraft(flow, 'office', 'acme/app').floorId).toBeNull();
    expect(fill(d.body, floor)).toContain('open your pull request into `dev`');
  });
});

describe('lineDiff', () => {
  it('keeps what stayed, and marks what went and what came', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { op: 'same', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'add', text: 'B' },
      { op: 'same', text: 'c' },
      { op: 'add', text: 'd' },
    ]);
  });

  it('shows a new text as all added, and copes with Windows line ends', () => {
    expect(lineDiff('', 'x\ny')).toEqual([
      { op: 'add', text: 'x' },
      { op: 'add', text: 'y' },
    ]);
    expect(lineDiff('a\r\nb', 'a\nb').every((l) => l.op === 'same')).toBe(true);
  });
});
