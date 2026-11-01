import { describe, expect, it } from 'vitest';
import type { ProposalTask } from '../../shared/types.ts';
import { checkRepo, checkTasks, issueList, keepTasks, PLAN_FOOTER, proposalFrom, repoFromBody, taskBody, type ProposeInput, type ProposalRules } from './proposals.ts';

const rules: ProposalRules = { owners: ['sam', 'acme'], maxWorkers: 6, floors: ['acme/shop'] };
const input = (over: Partial<ProposeInput> = {}): ProposeInput => ({
  new_repo_name: 'kids-recipes',
  brief: 'Recipes kids can cook',
  team_size: 2,
  tasks: [
    { title: 'Skeleton', body: 'App shell and CI' },
    { title: 'Recipes', body: 'A list of recipes', depends_on: [0] },
  ],
  ...over,
});
const status = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (err) {
    return (err as { status?: number }).status ?? 'error';
  }
};

describe('proposalFrom (propose_project)', () => {
  it("makes a private repository under the gh login by default, and keeps the CEO's tasks in order", () => {
    expect(proposalFrom(input(), rules)).toEqual({
      repo: { kind: 'new', owner: 'sam', name: 'kids-recipes', description: '', private: true },
      brief: 'Recipes kids can cook',
      teamSize: 2,
      tasks: [
        { title: 'Skeleton', body: 'App shell and CI', dependsOn: [] },
        { title: 'Recipes', body: 'A list of recipes', dependsOn: [0] },
      ],
    });
    expect(proposalFrom(input({ new_repo_owner: 'ACME', private: false, description: '  Kids \n cook  ' }), rules).repo).toEqual({ kind: 'new', owner: 'acme', name: 'kids-recipes', description: 'Kids cook', private: false });
    expect(proposalFrom(input({ new_repo_name: undefined, existing_repo: 'acme/kitchen' }), rules).repo).toEqual({ kind: 'existing', fullName: 'acme/kitchen' });
  });

  it('refuses bad names, owners it may not use, floors it has, team sizes out of range and a missing brief', () => {
    expect(() => proposalFrom(input({ new_repo_name: 'kids recipes' }), rules)).toThrow(/can't be a repository name/);
    expect(status(() => proposalFrom(input({ new_repo_name: 'x'.repeat(101) }), rules))).toBe(400);
    expect(status(() => proposalFrom(input({ new_repo_name: '..' }), rules))).toBe(400);
    expect(() => proposalFrom(input({ new_repo_owner: 'someone' }), rules)).toThrow('A new repository can go under sam or acme, not "someone"');
    expect(() => proposalFrom(input(), { ...rules, owners: [] })).toThrow(/couldn't read your GitHub login/);
    expect(status(() => proposalFrom(input({ new_repo_name: 'shop', new_repo_owner: 'acme' }), rules))).toBe(409);
    expect(status(() => proposalFrom(input({ new_repo_name: undefined, existing_repo: 'ACME/Shop' }), rules))).toBe(409);
    expect(() => proposalFrom(input({ existing_repo: 'acme/kitchen' }), rules)).toThrow(/either new_repo_name .* or existing_repo/);
    expect(() => proposalFrom(input({ new_repo_name: undefined }), rules)).toThrow(/either new_repo_name/);
    expect(() => proposalFrom(input({ team_size: 7 }), rules)).toThrow('The team size must be a whole number from 1 to 6');
    expect(status(() => proposalFrom(input({ team_size: 0 }), rules))).toBe(400);
    expect(status(() => proposalFrom(input({ team_size: 1.5 }), rules))).toBe(400);
    expect(() => proposalFrom(input({ brief: '  ' }), rules)).toThrow('The project needs a brief');
  });
});

describe('checkTasks', () => {
  const t = (title: string, depends_on?: number[]) => ({ title, body: '', depends_on });

  it('takes 1 to 12 titled tasks that wait only on tasks before them', () => {
    expect(checkTasks([t('a'), t('b', [0, 0]), t('c', [1, 0])]).map((x) => x.dependsOn)).toEqual([[], [0], [0, 1]]);
    expect(() => checkTasks([])).toThrow('Propose 1 to 12 starting tasks');
    expect(() => checkTasks(Array.from({ length: 13 }, (_, i) => t(`t${i}`)))).toThrow('Propose 1 to 12 starting tasks');
    expect(() => checkTasks([t(' ')])).toThrow('tasks[0] needs a title');
    expect(() => checkTasks([t('a', [0])])).toThrow('tasks[0] can only depend on tasks before it');
    expect(() => checkTasks([t('a'), t('b', [2]), t('c')])).toThrow('tasks[1] can only depend on tasks before it (indices 0 to 0), not 2');
    expect(() => checkTasks([t('a'), t('b', [-1])])).toThrow(/not -1/);
  });

  it('keeps dependency chains to two steps', () => {
    expect(checkTasks([t('a'), t('b', [0]), t('c', [1])])).toHaveLength(3);
    expect(() => checkTasks([t('a'), t('b', [0]), t('c', [1]), t('d', [2])])).toThrow('tasks[3] makes a dependency chain 3 steps deep');
  });
});

describe("the manager's edits", () => {
  const tasks: ProposalTask[] = [
    { title: 'Skeleton', body: '', dependsOn: [] },
    { title: 'Recipes', body: '', dependsOn: [0] },
    { title: 'Shopping list', body: '', dependsOn: [0, 1] },
    { title: 'Print view', body: '', dependsOn: [1] },
  ];

  it('keeps the chosen tasks in their order and drops dependencies on the others', () => {
    expect(keepTasks(tasks, [3, 0, 2, 2]).map((x) => [x.title, x.dependsOn])).toEqual([
      ['Skeleton', []],
      ['Shopping list', [0]],
      ['Print view', []],
    ]);
    expect(keepTasks(tasks, [])).toEqual([]);
    expect(status(() => keepTasks(tasks, [4]))).toBe(400);
    expect(status(() => keepTasks(tasks, '0,1'))).toBe(400);
  });

  it('reads an edited repository and checks it like a proposed one', () => {
    expect(repoFromBody({ kind: 'existing', fullName: 'acme/kitchen' })).toEqual({ kind: 'existing', fullName: 'acme/kitchen' });
    expect(repoFromBody({ kind: 'new', owner: 'acme', name: 'pantry' })).toEqual({ kind: 'new', owner: 'acme', name: 'pantry', description: '', private: true });
    expect(status(() => repoFromBody({ kind: 'new', owner: 'acme' }))).toBe(400);
    expect(status(() => repoFromBody({ kind: 'new', owner: 'acme', name: 'x', private: 'yes' }))).toBe(400);
    expect(status(() => repoFromBody('acme/kitchen'))).toBe(400);
    expect(status(() => checkRepo({ kind: 'existing', fullName: 'not a repo' }, rules))).toBe(400);
    expect(checkRepo({ kind: 'new', owner: 'Sam', name: ' pantry ', description: '', private: false }, rules)).toEqual({ kind: 'new', owner: 'sam', name: 'pantry', description: '', private: false });
  });
});

describe('the tasks as issues', () => {
  it('turns task indices into "Depends on #N" with the numbers the earlier tasks were filed as, under the footer', () => {
    const filed = [41, 43];
    expect(taskBody({ title: 'x', body: 'Build it.', dependsOn: [] }, filed)).toBe(`Build it.${PLAN_FOOTER}`);
    expect(taskBody({ title: 'x', body: 'Build it.', dependsOn: [0, 1] }, filed)).toBe(`Depends on #41, #43\n\nBuild it.${PLAN_FOOTER}`);
    // A "Depends on" the CEO wrote itself gives way to the real numbers.
    expect(taskBody({ title: 'x', body: 'Depends on #2\n\nBuild it.', dependsOn: [1] }, filed)).toBe(`Depends on #43\n\nBuild it.${PLAN_FOOTER}`);
    expect(PLAN_FOOTER).toBe("\n\n_Filed by Marshmallow's CEO from the plan you approved._");
  });

  it('lists issue numbers as a range when they run in a row', () => {
    expect(issueList([1, 2, 3, 4, 5])).toBe('#1–#5');
    expect(issueList([4, 6, 9])).toBe('#4, #6 and #9');
    expect(issueList([7, 8])).toBe('#7 and #8');
    expect(issueList([7])).toBe('#7');
  });
});
