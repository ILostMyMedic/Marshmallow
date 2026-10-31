import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LogEntry } from '../../shared/types.ts';
import type { SessionCallbacks, SessionOptions, SessionResult } from '../sessions/session.ts';
import { WorkerTerminal } from '../sessions/terminal.ts';
import { createDemoBackend, type DemoBackend } from './demo.ts';

const INSTANT = { stepMs: () => 1, prepareMs: 1, installMs: 1, cloneMs: 1, checksMs: () => 5, closeAfterMergeMs: 5 };
const REPO = 'demo-co/pixel-todo';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let backends: DemoBackend[] = [];
const dirs: string[] = [];
/** A demo backend that does everything at once; `rand` decides every coin toss (0.9: checks pass, QA passes). */
function demo(rand = 0.9, home: string | null = null) {
  const b = createDemoBackend({ home, timing: INSTANT, rand: () => rand });
  backends.push(b);
  return b;
}
afterEach(() => {
  for (const b of backends) b.github.close();
  backends = [];
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});

/** Runs a session to its end, keeping what it reported. */
function runSession(b: DemoBackend, opts: SessionOptions) {
  const logs: LogEntry[] = [];
  const tools: string[] = [];
  let sessionId: string | null = null;
  const done = new Promise<SessionResult>((resolve) => {
    const cb: SessionCallbacks = {
      log: (e) => logs.push(...e),
      tool: (t) => t && tools.push(t),
      sessionId: (id) => (sessionId = id),
      browserUrl: () => undefined,
      screenshot: () => undefined,
      finished: resolve,
    };
    b.startSession(opts, cb);
  });
  return { logs, tools, done, sessionId: () => sessionId };
}

const options = (cwd: string, over: Partial<SessionOptions> = {}): SessionOptions => ({
  cwd,
  prompt: '',
  systemAppend: '',
  model: 'claude-opus-5-5',
  effort: 'medium',
  browserTesting: true,
  role: 'worker',
  ...over,
});

describe('the fake GitHub', () => {
  it('starts with the seeded repositories and their issues', async () => {
    const { github } = demo();
    expect((await github.listMyRepos()).map((r) => r.nameWithOwner)).toContain(REPO);
    expect((await github.listIssues(REPO)).length).toBeGreaterThan(0);
    await expect(github.repoMeta('nobody/nothing')).rejects.toThrow(/Could not resolve/);
  });

  it('hands out copies, so nothing changes under the caller', async () => {
    const { github } = demo();
    const issues = await github.listIssues(REPO);
    issues[0].title = 'changed';
    expect((await github.listIssues(REPO))[0].title).not.toBe('changed');
  });

  it('runs checks on a new PR, merges only the head it was asked to, and then closes the issue', async () => {
    const { github } = demo();
    const pr = github.openPull(REPO, { title: 'Dark mode', branch: 'mm/issue-1-ada', closes: 1 });
    expect(pr.checks).toBe('pending');
    expect(await github.prForBranch(REPO, 'mm/issue-1-ada')).toEqual({ number: pr.number, url: pr.url });
    await wait(20);
    expect((await github.prDetails(REPO, pr.number)).checks).toBe('passing');

    await expect(github.mergePull(REPO, pr.number, 'squash', 'not-the-head')).rejects.toThrow(/Head branch was modified/);
    await github.mergePull(REPO, pr.number, 'squash', pr.headSha);
    expect((await github.listPulls(REPO)).find((p) => p.number === pr.number)?.state).toBe('MERGED');
    expect(await github.issueState(REPO, 1)).toBe('OPEN'); // GitHub closes it a moment later
    await wait(20);
    expect(await github.issueState(REPO, 1)).toBe('CLOSED');
  });

  it('fails checks now and then, and a re-run of the failed job passes', async () => {
    const { github } = demo(0.1);
    const pr = github.openPull(REPO, { title: 'Due dates', branch: 'mm/issue-2-ken', closes: 2 });
    await wait(20);
    const failed = (await github.listPulls(REPO)).find((p) => p.number === pr.number)!;
    expect(failed.checks).toBe('failing');
    const runId = Number(failed.failedChecks[0].url!.match(/runs\/(\d+)/)![1]);
    await github.rerunFailedJobs(REPO, [runId]);
    await wait(20);
    expect((await github.prDetails(REPO, pr.number)).checks).toBe('passing');
  });

  it('picks up where it left off after a restart', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-demo-'));
    dirs.push(home);
    const first = demo(0.9, home);
    const n = await first.github.createIssue(REPO, 'Remember me', '');
    const pr = first.github.openPull(REPO, { title: 'Pending at shutdown', branch: 'mm/issue-1-ada', closes: 1 });
    first.github.close();
    await first.github.flush();

    const again = demo(0.9, home);
    expect((await again.github.listIssues(REPO)).some((i) => i.number === n && i.title === 'Remember me')).toBe(true);
    // checks left running have finished
    expect((await again.github.prDetails(REPO, pr.number)).checks).toBe('passing');
    // and numbers carry on
    expect(await again.github.createIssue(REPO, 'Next', '')).toBe(pr.number + 1);
  });
});

describe('the fake sessions', () => {
  it('builds an issue: tool calls, a screenshot, and a PR from the desk branch', async () => {
    const b = demo();
    const cwd = await b.machines.prepareDesk('ada12345', REPO, { defaultBranch: 'main' }, 'mm/issue-3-ada');
    const s = runSession(b, options(cwd, { task: 'issue', subject: { issueNumber: 3, prNumber: null, title: 'Drag and drop to reorder' } }));
    const result = await s.done;
    expect(result.ok).toBe(true);
    expect(s.sessionId()).toMatch(/^demo-/);
    expect(s.tools).toEqual(expect.arrayContaining(['Read', 'Edit', 'Bash', 'mcp__playwright__browser_navigate']));
    const pr = await b.github.prForBranch(REPO, 'mm/issue-3-ada');
    expect(pr).not.toBeNull();
    expect(result.text).toContain(pr!.url);
  });

  it('gives QA a structured verdict, failing some first rounds', async () => {
    const pass = await runSession(demo(0.9), options('/x', { task: 'qa', subject: { issueNumber: 1, prNumber: 9, title: 'x' } })).done;
    expect(pass.structured).toMatchObject({ verdict: 'pass' });
    const fail = await runSession(demo(0.1), options('/x', { task: 'qa', subject: { issueNumber: 1, prNumber: 9, title: 'x', round: 1 } })).done;
    expect(fail.structured).toMatchObject({ verdict: 'fail', fixInstructions: expect.any(String) });
  });

  it('pushes a fix to the PR, so its head moves on', async () => {
    const b = demo();
    const pr = b.github.openPull(REPO, { title: 'Dark mode', branch: 'mm/issue-1-ada', closes: 1 });
    const cwd = await b.machines.prepareDesk('ada12345', REPO, { defaultBranch: 'main', pr: pr.number }, 'mm/issue-1-ada');
    await runSession(b, options(cwd, { task: 'fix', resumeSessionId: 'demo-earlier', subject: { issueNumber: 1, prNumber: pr.number, title: 'Dark mode' } })).done;
    expect((await b.github.prDetails(REPO, pr.number)).headSha).not.toBe(pr.headSha);
  });

  it('ends at once when stopped', async () => {
    const b = createDemoBackend({ home: null, timing: { ...INSTANT, stepMs: () => 60_000 } });
    backends.push(b);
    let result: SessionResult | null = null;
    const handle = b.startSession(options('/x'), { log: () => undefined, tool: () => undefined, sessionId: () => undefined, browserUrl: () => undefined, screenshot: () => undefined, finished: (r) => (result = r) });
    handle.stop();
    expect(result).toMatchObject({ ok: false, errors: ['Stopped by the manager'] });
  });

  it("shows the manager's message in the terminal, as typed at the prompt, and answers it", async () => {
    const b = createDemoBackend({ home: null, timing: { ...INSTANT, stepMs: () => 20 } });
    backends.push(b);
    const terminal = new WorkerTerminal();
    const logs: LogEntry[] = [];
    const handle = b.startSession(options('/x', { terminal }), { log: (e) => logs.push(...e), tool: () => undefined, sessionId: () => undefined, browserUrl: () => undefined, screenshot: () => undefined, finished: () => undefined });
    handle.send('Keep the hook as it is');
    await wait(60);
    handle.stop();
    await terminal.flush();
    expect(terminal.screen()).toContain('> Keep the hook as it is');
    expect(terminal.screen()).toContain('Got it: "Keep the hook as it is"');
    expect(logs.some((e) => e.text.includes('Got it'))).toBe(true);
  });
});

describe('the fake machines', () => {
  it('install dependencies on the first task at a desk and skip them after', async () => {
    const b = demo();
    await b.machines.prepareDesk('ada12345', REPO, { defaultBranch: 'main' }, 'mm/issue-1-ada');
    const cb = { log: () => undefined, installing: () => undefined };
    expect(await b.machines.installDeps('ada12345', REPO, cb)).toBe('installed');
    expect(await b.machines.installDeps('ada12345', REPO, cb)).toBe('skipped');
    expect(await b.machines.list()).toEqual(['ada12345']);
    await b.machines.remove('ada12345');
    expect(await b.machines.exists('ada12345', REPO)).toBe(false);
  });
});
