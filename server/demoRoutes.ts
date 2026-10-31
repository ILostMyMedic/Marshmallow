// Demo-only routes that change the state directly, so the debug page can be watched updating live: BUILD-PLAN phase 1's
// test route. The demo backend and the pipeline (phases 2 and 3) take over from them.
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import express from 'express';
import type { ActivityKind, Floor, IssueInfo, PullInfo, Worker } from '../shared/types.ts';
import { HttpError } from './httpError.ts';
import { route } from './route.ts';
import type { Store } from './store.ts';

const PROJECTS = ['todo-app', 'weather-dash', 'pixel-pets', 'recipe-box', 'tiny-blog'];
const COLORS = ['#ff8a5b', '#4fb3e8', '#8fd14f', '#c77dff', '#ffc93c', '#ff6fb5', '#2ec4b6', '#f25f5c'];
const NAMES = ['Ada', 'Grace', 'Linus', 'Ken', 'Barbara', 'Dennis', 'Margaret', 'Alan', 'Radia', 'Guido', 'Hedy', 'Edsger'];
const ISSUES = ['Add a dark mode toggle', 'Fix the broken sign-up link', 'Show a spinner while loading', 'Sort the list by date', 'Add keyboard shortcuts', 'Write a README'];
/** A pretend task's steps: the sign over the worker's head and the line it adds to their log. After the last, the PR. */
const STEPS: { kind: ActivityKind; detail: string; line: string }[] = [
  { kind: 'read', detail: 'the issue', line: 'Reading the issue and the code around it' },
  { kind: 'edit', detail: 'App.tsx', line: 'Editing App.tsx' },
  { kind: 'test', detail: 'npm test', line: 'Running the tests: 12 passed' },
  { kind: 'git', detail: 'git push', line: 'Pushed the branch' },
];

const iso = (t: number) => new Date(t).toISOString();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function demoRoutes(store: Store) {
  const r = express.Router();

  /** The worker's PR: on the floor, queued for QA. */
  function openPull(w: Worker, floor: Floor, now: number) {
    const task = w.task!;
    const number = Math.max(0, ...floor.issues.map((i) => i.number), ...floor.pulls.map((p) => p.number)) + 1;
    const url = `${floor.url}/pull/${number}`;
    const pull: PullInfo = {
      number,
      title: task.title,
      url,
      headRefName: task.branch ?? '',
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      reviewDecision: null,
      closesIssues: task.issueNumber ? [task.issueNumber] : [],
      createdAt: iso(now),
      mergedAt: null,
      additions: randomInt(5, 120),
      deletions: randomInt(0, 40),
      checks: 'passing',
      headSha: randomBytes(20).toString('hex'),
      mergeState: 'CLEAN',
      failedChecks: [],
      pendingChecks: [],
    };
    store.patchFloor(floor.id, { pulls: [...floor.pulls, pull] });
    store.patchWorker(w.id, { status: 'done', task: { ...task, prNumber: number, prUrl: url }, activity: null, endedAt: now }, now);
    store.appendLog(w.id, [{ kind: 'done', text: `Opened PR #${number}` }], now);
    store.putQa({ floorId: floor.id, prNumber: number, status: 'queued', round: 1, devWorkerId: w.id, qaWorkerId: null, summary: null, checks: [], commentUrl: null, mergeNote: null, updatedAt: now });
    store.moment({ type: 'prOpened', at: now, floorId: floor.id, prNumber: number, workerId: w.id, issueNumber: task.issueNumber });
  }

  // A new floor with three issues on it
  r.post(
    '/floors',
    route(() => {
      const floors = store.floorList();
      const n = floors.length ? Math.max(...floors.map((f) => f.floor)) + 1 : 1;
      const id = `demo/${PROJECTS[(n - 1) % PROJECTS.length]}${n > PROJECTS.length ? `-${n}` : ''}`;
      const now = Date.now();
      const issues = [1, 2, 3].map((number): IssueInfo => ({ number, title: ISSUES[(n + number) % ISSUES.length], body: '', url: `https://github.com/${id}/issues/${number}`, labels: [], createdAt: iso(now) }));
      store.putFloor({
        id,
        fullName: id,
        description: 'A pretend project',
        url: `https://github.com/${id}`,
        defaultBranch: 'main',
        floor: n,
        color: COLORS[(n - 1) % COLORS.length],
        autoAssign: true,
        browserTesting: true,
        mission: '',
        summary: '',
        qaBrief: '',
        cloneStatus: 'ready',
        cloneError: null,
        issues,
        pulls: [],
        lastSync: now,
        syncError: null,
      });
      store.moment({ type: 'issuesFiled', at: now, floorId: id, numbers: issues.map((i) => i.number) });
      return { id };
    }),
  );

  r.post(
    '/floors/:floor/workers',
    route((req) => {
      const floor = store.floor(String(req.params.floor));
      const everyone = store.workerList();
      const team = everyone.filter((w) => w.floorId === floor.id);
      if (team.length >= store.getSettings().maxWorkers) throw new HttpError(409, `${floor.fullName} is full`);
      const name = NAMES.find((x) => !everyone.some((w) => w.name === x)) ?? `Worker ${everyone.length + 1}`;
      let desk = 0;
      while (team.some((w) => w.desk === desk)) desk++;
      const now = Date.now();
      const worker: Worker = {
        id: randomUUID(),
        name,
        floorId: floor.id,
        role: 'worker',
        seed: randomInt(2 ** 31),
        desk,
        model: '',
        effort: '',
        host: 'local',
        status: 'idle',
        task: null,
        activity: null,
        idleSince: now,
        startedAt: null,
        endedAt: null,
        costUsd: 0,
        turns: 0,
        lastError: null,
      };
      store.putWorker(worker);
      store.appendLog(worker.id, [{ kind: 'system', text: `Joined ${floor.fullName}` }], now);
      store.moment({ type: 'hired', at: now, worker });
      return { id: worker.id };
    }),
  );

  // One step of a pretend task: take the next free issue, work through STEPS, open a PR, then free again
  r.post(
    '/workers/:id/step',
    route((req) => {
      const w = store.worker(String(req.params.id));
      const floor = store.floor(w.floorId);
      const now = Date.now();
      if (w.status === 'working' && w.task) {
        const next = STEPS.findIndex((s) => s.kind === w.activity?.kind) + 1;
        if (next >= STEPS.length) return openPull(w, floor, now);
        const step = STEPS[next];
        store.patchWorker(w.id, { activity: { kind: step.kind, detail: step.detail }, turns: w.turns + 1, costUsd: w.costUsd + 0.05 }, now);
        store.appendLog(w.id, [{ kind: 'tool', text: step.line }], now);
        return;
      }
      if (w.task) {
        store.patchWorker(w.id, { status: 'idle', task: null, activity: null }, now);
        return;
      }
      const taken = new Set([
        ...store.workerList().flatMap((x) => (x.floorId === floor.id && x.task?.issueNumber ? [x.task.issueNumber] : [])),
        ...floor.pulls.filter((p) => p.state === 'OPEN').flatMap((p) => p.closesIssues),
      ]);
      const issue = floor.issues.find((i) => !taken.has(i.number));
      if (!issue) throw new HttpError(409, `No issue on ${floor.fullName} is free to take`);
      const step = STEPS[0];
      store.patchWorker(
        w.id,
        {
          status: 'working',
          task: { kind: 'issue', issueNumber: issue.number, title: issue.title, branch: `mm/issue-${issue.number}-${slug(w.name)}`, prNumber: null, prUrl: null },
          activity: { kind: step.kind, detail: step.detail },
          startedAt: now,
          endedAt: null,
          lastError: null,
        },
        now,
      );
      store.appendLog(w.id, [{ kind: 'system', text: `Took issue #${issue.number}: ${issue.title}` }, { kind: 'tool', text: step.line }], now);
    }),
  );

  // One step of a pretend QA round: queued → testing → passed (or, for even PRs' first round, failed → queued again) → merged
  r.post(
    '/floors/:floor/pulls/:n/qa-step',
    route((req) => {
      const floor = store.floor(String(req.params.floor));
      const rec = store.qaRecord(floor.id, Number(req.params.n));
      const now = Date.now();
      const at = { floorId: floor.id, prNumber: rec.prNumber };
      if (rec.status === 'queued') {
        const tester = store.workerList().find((x) => x.floorId === floor.id && x.id !== rec.devWorkerId);
        store.putQa({ ...rec, status: 'testing', qaWorkerId: tester?.id ?? null, updatedAt: now });
      } else if (rec.status === 'testing' && rec.round === 1 && rec.prNumber % 2 === 0) {
        store.putQa({ ...rec, status: 'failed', summary: 'The new button does nothing on mobile.', checks: [{ name: 'Works on a phone-sized screen', result: 'fail', details: 'No response to taps' }], updatedAt: now });
        store.moment({ type: 'qaFailed', at: now, ...at, qaWorkerId: rec.qaWorkerId });
      } else if (rec.status === 'testing') {
        store.putQa({ ...rec, status: 'passed', summary: 'Works as the issue asks; the tests pass.', checks: [{ name: 'Does what the issue asks', result: 'pass', details: '' }], mergeNote: 'merging once the checks pass', updatedAt: now });
        store.moment({ type: 'qaPassed', at: now, ...at, qaWorkerId: rec.qaWorkerId });
      } else if (rec.status === 'failed') {
        store.putQa({ ...rec, status: 'queued', round: rec.round + 1, updatedAt: now });
      } else if (rec.status === 'passed') {
        const closes = floor.pulls.find((p) => p.number === rec.prNumber)?.closesIssues ?? [];
        store.patchFloor(floor.id, {
          pulls: floor.pulls.map((p) => (p.number === rec.prNumber ? { ...p, state: 'MERGED' as const, mergedAt: iso(now) } : p)),
          issues: floor.issues.filter((i) => !closes.includes(i.number)),
        });
        store.removeQa(floor.id, rec.prNumber);
        store.moment({ type: 'merged', at: now, ...at, devWorkerId: rec.devWorkerId });
      } else throw new HttpError(409, `PR #${rec.prNumber} is ${rec.status}`);
    }),
  );

  r.delete(
    '/workers/:id',
    route((req) => {
      const w = store.worker(String(req.params.id));
      store.removeWorker(w.id);
      store.moment({ type: 'left', at: Date.now(), worker: w });
    }),
  );

  r.post(
    '/reset',
    route(() => store.reset()),
  );

  return r;
}
