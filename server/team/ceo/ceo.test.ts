// Adapted from cubefarm server/ceo.test.ts (MIT): jobLabel, office tools, checkCloseIssue, planDependencies, the
// planning guidance and IssueCap.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { HttpError } from '../../httpError.ts';
import { checkCloseIssue, IssueCap, planDependencies, type DependsRequest } from './issueRules.ts';
import { askedFor, ceoJobPrompt, ceoSystemPrompt, jobLabel, type CeoJob } from './prompts.ts';
import { createOfficeTools, type OfficeHandlers } from './tools.ts';

describe('jobLabel', () => {
  const floor = { floor: 3, fullName: 'acme/office-app' };

  it('names the floor and repo for floor jobs, and says so when the floor is gone', () => {
    expect(jobLabel({ kind: 'onboard' }, floor)).toBe('Onboarding floor 3 · office-app');
    expect(jobLabel({ kind: 'plan' }, { floor: 1, fullName: 'solo' })).toBe('Planning floor 1 · solo');
    expect(jobLabel({ kind: 'plan' }, null)).toBe('Planning a removed floor');
    expect(jobLabel({ kind: 'chat' }, null)).toBe('Replying to you');
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
    expect(tools.map((t) => t.name).sort()).toEqual(['ask_manager', 'close_issue', 'company_status', 'configure_worker', 'file_issue', 'scale_team', 'set_dependencies', 'set_floor_profile', 'worker_detail']);
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
  const job = (kind: CeoJob['kind']): CeoJob => ({ kind, floorId: 'acme/app', text: 'Shrink floor 2', at: 0 });

  it('keeps the CEO to the office tools, whole features, and work the manager asked for', () => {
    expect(system).toContain('You cannot edit files or run commands');
    expect(system).toContain('An issue is a whole feature the manager would recognise');
    expect(system).toContain('Never decide on new work yourself');
    expect(system).toContain('A floor holds at most 8.');
    expect(system).toContain('File at most 12 issues per job.');
    expect(askedFor(job('plan')) && askedFor(job('chat')) && !askedFor(job('onboard'))).toBe(true);
  });

  it('onboards with a profile and a team size and files nothing; plans from the brief; passes chat through', () => {
    const onboard = ceoJobPrompt(job('onboard'), { ...floor, mission: '', backlog: 3 });
    expect(onboard).toContain('set_floor_profile');
    expect(onboard).toContain('scale_team');
    expect(onboard).toContain('File no issues: leave its 3 open issues as they are.');
    expect(ceoJobPrompt(job('plan'), floor)).toContain('"""Add voice messages"""');
    expect(ceoJobPrompt(job('chat'), null)).toBe('Message from the manager:\nShrink floor 2');
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
