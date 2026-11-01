// Adapted from cubefarm server/ceo.test.ts (MIT): jobLabel, office tools, checkCloseIssue, planDependencies, the
// planning guidance and IssueCap.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { HttpError } from '../../httpError.ts';
import { checkCloseIssue, IssueCap, planDependencies, type DependsRequest } from './issueRules.ts';
import { askedFor, ceoJobPrompt, ceoSystemPrompt, jobLabel, type CeoJob, type JobThread } from './prompts.ts';
import { createOfficeTools, type OfficeHandlers } from './tools.ts';

describe('jobLabel', () => {
  const floor = { floor: 3, fullName: 'acme/office-app' };

  it('names the floor and repo for floor jobs, and says so when the floor is gone', () => {
    expect(jobLabel({ kind: 'onboard' }, floor)).toBe('Onboarding floor 3 · office-app');
    expect(jobLabel({ kind: 'plan' }, { floor: 1, fullName: 'solo' })).toBe('Planning floor 1 · solo');
    expect(jobLabel({ kind: 'plan' }, null)).toBe('Planning a removed floor');
    expect(jobLabel({ kind: 'chat' }, null)).toBe('Replying to you');
    expect(jobLabel({ kind: 'discussion' }, null)).toBe('Replying in a discussion');
  });
});

describe('office tools', () => {
  const connect = async () => {
    const calls: unknown[] = [];
    const h: OfficeHandlers = {
      companyStatus: () => '{}',
      workerDetail: () => '{}',
      setFloorProfile: (a) => (calls.push(a), 'saved'),
      scaleTeam: () => {
        throw new Error('Floor 9 does not exist.');
      },
      configureWorker: () => '',
      fileIssue: async () => '',
      setDependencies: async () => '',
      closeIssue: async () => '',
      askManager: async () => '',
      startDiscussion: async () => '',
      resolveDiscussion: async () => '',
      proposeProject: async (a) => (calls.push(a), 'proposed'),
      proposePlaybookChange: async (a) => (calls.push(a), 'proposed a change'),
    };
    const office = createOfficeTools(h);
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await office.serve().connect(serverSide);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientSide);
    return { client, calls, office };
  };

  it('lists every tool the CEO relies on', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'ask_manager',
      'close_issue',
      'company_status',
      'configure_worker',
      'file_issue',
      'propose_playbook_change',
      'propose_project',
      'resolve_discussion',
      'scale_team',
      'set_dependencies',
      'set_floor_profile',
      'start_discussion',
      'worker_detail',
    ]);
  });

  it("describes propose_project's tasks and flags as plain JSON Schema, and takes a project through", async () => {
    const { client, calls } = await connect();
    const propose = (await client.listTools()).tools.find((t) => t.name === 'propose_project')!;
    const props = propose.inputSchema.properties as Record<string, { type?: string; items?: { type?: string; properties?: Record<string, unknown> } }>;
    expect(props.private.type).toBe('boolean');
    expect(props.tasks.type).toBe('array');
    expect(props.tasks.items?.type).toBe('object');
    expect(Object.keys(props.tasks.items?.properties ?? {}).sort()).toEqual(['body', 'depends_on', 'title']);
    expect(propose.inputSchema.required?.sort()).toEqual(['brief', 'tasks', 'team_size']);
    const project = { new_repo_name: 'todo', brief: 'A todo app', team_size: 2, tasks: [{ title: 'Skeleton', body: '' }, { title: 'Lists', body: 'x', depends_on: [0] }] };
    await client.callTool({ name: 'propose_project', arguments: project });
    expect(calls).toEqual([project]);
  });

  it("describes propose_playbook_change's scope and kind as plain enums, and passes a change through", async () => {
    const { client, calls } = await connect();
    const tool = (await client.listTools()).tools.find((t) => t.name === 'propose_playbook_change')!;
    const props = tool.inputSchema.properties as Record<string, { type?: string; enum?: string[] }>;
    expect(props.scope.enum).toEqual(['office', 'floor']);
    expect(props.kind.enum).toEqual(['rules', 'skill', 'agent', 'command']);
    expect(tool.inputSchema.required?.sort()).toEqual(['body', 'kind', 'name', 'scope', 'why']);
    const change = { scope: 'floor', floor: 1, kind: 'rules', name: 'tests-first', body: '- Run the tests', why: 'PRs keep failing CI' };
    await client.callTool({ name: 'propose_playbook_change', arguments: change });
    expect(calls).toEqual([change]);
  });

  it('passes the arguments through, and turns a handler error into a refusal', async () => {
    const { client, calls, office } = await connect();
    await client.callTool({ name: 'set_floor_profile', arguments: { floor: 1, summary: 'A todo app' } });
    expect(calls).toEqual([{ floor: 1, summary: 'A todo app' }]);
    expect(await office.call('scale_team', { floor: 9, size: 2, reason: 'x' })).toBe('Refused: Floor 9 does not exist.');
  });
});

describe('checkCloseIssue (close_issue)', () => {
  const pulls = [
    { number: 20, state: 'OPEN', closesIssues: [4] },
    { number: 21, state: 'MERGED', closesIssues: [5] },
  ];
  const status = (state: 'OPEN' | 'CLOSED' | null, number = 6) => {
    try {
      checkCloseIssue({ floor: 1, number, state, pulls });
      return 'ok';
    } catch (err) {
      return (err as HttpError).status;
    }
  };

  it('closes an open issue, even one a merged PR once named', () => {
    expect(status('OPEN')).toBe('ok');
    expect(status('OPEN', 5)).toBe('ok');
  });

  it("refuses a closed or unknown issue, and one an open PR closes", () => {
    expect(status('CLOSED')).toBe(404);
    expect(status(null)).toBe(404);
    expect(() => checkCloseIssue({ floor: 1, number: 4, state: 'OPEN', pulls })).toThrow('PR #20 closes #4. Close or finish that pull request first.');
  });

  it("refuses one the office's open PR into a work branch is for, which GitHub doesn't link", () => {
    const onDev = [{ number: 22, state: 'OPEN', closesIssues: [], headRefName: 'mm/issue-7-ada' }];
    expect(() => checkCloseIssue({ floor: 1, number: 7, state: 'OPEN', pulls: onDev })).toThrow('PR #22 closes #7.');
  });
});

describe('planDependencies (set_dependencies)', () => {
  // #1 ← #2 ← #3 is a two-step chain; #5 waits for #4; #9 is closed.
  const base: DependsRequest = {
    floor: 1,
    number: 4,
    dependsOn: [],
    issues: [
      { number: 1, body: 'Set up the skeleton' },
      { number: 2, body: 'Depends on #1' },
      { number: 3, body: 'Depends on #2\n\nThe rest' },
      { number: 4, body: 'Some text' },
      { number: 5, body: 'Intro\n\nDepends on #4\n\nMore' },
      { number: 6, body: 'Free' },
    ],
    closed: (n) => n === 9,
    inProgress: false,
  };
  const deps = (over: Partial<DependsRequest>) => planDependencies({ ...base, ...over });

  it('rewrites the Depends on line and leaves the rest of the body alone', () => {
    expect(deps({ number: 5, dependsOn: [6] }).body).toBe('Depends on #6\n\nIntro\n\nMore');
    expect(deps({ number: 6, dependsOn: [1, 4] })).toEqual({ body: 'Depends on #1, #4\n\nFree', summary: '#6 on floor 1: depends on #1, #4.' });
    expect(deps({ number: 4, dependsOn: [] })).toEqual({ body: null, summary: '#4 on floor 1: no dependencies.' });
  });

  it('refuses closed, unknown and self dependencies, cycles, and chains deeper than two steps', () => {
    expect(() => deps({ number: 9 })).toThrow('#9 is closed.');
    expect(() => deps({ dependsOn: [4] })).toThrow("#4 can't depend on itself.");
    expect(() => deps({ dependsOn: [42] })).toThrow('There is no open issue #42 on floor 1.');
    expect(() => deps({ number: 1, dependsOn: [3] })).toThrow('#3 already waits for #1, directly or through other issues, so that would be a cycle.');
    expect(() => deps({ number: 1, dependsOn: [6] })).toThrow(/3 steps deep through #1/);
    expect(() => deps({ inProgress: true })).toThrow("#4 is already in progress, so its dependencies can't change.");
  });
});

describe('the prompts', () => {
  const system = ceoSystemPrompt({ name: 'Mallow', company: 'Acme', manager: 'Sam', sessionLimit: 0, maxWorkers: 8 });
  const floor = { floor: 2, fullName: 'acme/app', clone: '/clones/app', mission: 'Add voice messages', backlog: 0 };
  const job = (kind: CeoJob['kind'], over: Partial<CeoJob> = {}): CeoJob => ({ kind, floorId: 'acme/app', chatId: null, discussionId: null, text: '', at: 0, ...over });
  const thread = (over: Partial<JobThread> = {}): JobThread => ({ title: 'A recipe app', context: '', resumed: false, messages: [{ from: 'manager', text: 'Recipes for kids?' }], ...over });

  it('keeps the CEO to the office tools, whole features, and work the manager asked for', () => {
    expect(system).toContain('You cannot edit files or run commands');
    expect(system).toContain('An issue is a whole feature the manager would recognise');
    expect(system).toContain('Never decide on new work yourself');
    expect(system).toContain('A floor holds at most 8.');
    expect(system).toContain('File at most 12 issues per job.');
    expect(system).toContain('start_discussion');
    expect(system).toContain('propose_project');
    expect(system).toContain('propose_playbook_change');
    expect(askedFor(job('plan')) && askedFor(job('chat')) && askedFor(job('discussion')) && !askedFor(job('onboard'))).toBe(true);
  });

  it('onboards with a profile and a team size and files nothing; plans from the brief', () => {
    const onboard = ceoJobPrompt(job('onboard'), { ...floor, mission: '', backlog: 3 });
    expect(onboard).toContain('set_floor_profile');
    expect(onboard).toContain('scale_team');
    expect(onboard).toContain('File no issues: leave its 3 open issues as they are.');
    expect(ceoJobPrompt(job('plan'), floor)).toContain('"""Add voice messages"""');
  });

  it("onboards a project from an approved card keeping the agreed team, and plans nothing", () => {
    const onboard = ceoJobPrompt(job('onboard', { project: { teamSize: 3 } }), floor);
    expect(onboard).toContain('the manager approved it from your plan in a chat');
    expect(onboard).toContain("Keep the team at 3: the manager agreed that size on the card, so don't call scale_team.");
    expect(onboard).toContain('File no issues: the starting tasks are filed from the plan.');
  });

  it("opens a chat's first job with how chats work and the thread so far; later ones carry only what's new", () => {
    const first = ceoJobPrompt(job('chat', { chatId: 1 }), null, thread());
    expect(first).toContain("You're in a chat with the manager about an idea");
    expect(first).toContain('call propose_project');
    expect(first.endsWith('The chat so far:\nManager: Recipes for kids?')).toBe(true);
    const later = ceoJobPrompt(job('chat', { chatId: 1 }), null, thread({ resumed: true, messages: [{ from: 'manager', text: 'Go ahead' }, { from: 'office', text: '🚀 Started floor 2' }] }));
    expect(later).toBe('New in the chat:\nManager: Go ahead\nOffice: 🚀 Started floor 2');
  });

  it("opens a discussion's first job with where it was opened and the thread, and asks to settle it", () => {
    const messages: JobThread['messages'] = [
      { from: 'ceo', text: 'A slice or the whole thing?' },
      { from: 'manager', text: 'A slice' },
    ];
    const first = ceoJobPrompt(job('discussion', { discussionId: 4 }), null, thread({ title: 'Scope', context: 'while planning floor 2 (acme/app)', messages }));
    expect(first).toContain('You opened the discussion "Scope" while planning floor 2 (acme/app), to settle something');
    expect(first).toContain('You: A slice or the whole thing?\nManager: A slice');
    expect(first).toContain('call resolve_discussion with the outcome, then carry on with the work it was holding up');
    expect(ceoJobPrompt(job('discussion', { discussionId: 4 }), null, thread({ resumed: true, messages: [{ from: 'manager', text: 'Actually, all of it' }] }))).toBe('New in the discussion:\nManager: Actually, all of it');
  });
});

describe('IssueCap', () => {
  it('refuses the 13th issue, and remembers the floors that got issues', () => {
    const cap = new IssueCap(12);
    for (let i = 0; i < 12; i++) {
      cap.check();
      cap.record(i % 2 ? 'a/b' : 'c/d');
    }
    expect(() => cap.check()).toThrow("You already filed 12 issues in this job. That's plenty for one milestone. The manager's next message allows more.");
    expect([...cap.floors]).toEqual(['c/d', 'a/b']);
  });
});
