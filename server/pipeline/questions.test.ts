import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Question } from '../../shared/types.ts';
import { createDemoBackend, type DemoBackend } from '../backend/demo.ts';
import { Floors } from '../floors.ts';
import { Store } from '../store.ts';
import { createPipeline, type Pipeline } from './pipeline.ts';
import { ANSWER_LEAD, findAnswer, managerQuestion, OFFICE_MARK, QUESTION_LABEL, questionComment, questionsPrompt } from './questions.ts';

describe('managerQuestion', () => {
  it('reads the question after its line, however it was dressed up', () => {
    expect(managerQuestion('I looked around.\nQUESTION FOR THE MANAGER: Which colours?')).toBe('Which colours?');
    expect(managerQuestion('**QUESTION FOR THE MANAGER:** Should dark mode follow the system?\nOr a toggle?')).toBe('Should dark mode follow the system?\nOr a toggle?');
    expect(managerQuestion('> question for the manager: lowercase works too')).toBe('lowercase works too');
  });

  it('is null without the line, or with nothing after it', () => {
    expect(managerQuestion('Opened https://github.com/o/r/pull/3')).toBeNull();
    expect(managerQuestion('I had a QUESTION FOR THE MANAGER: but not at the start of a line')).toBeNull();
    expect(managerQuestion('QUESTION FOR THE MANAGER:   ')).toBeNull();
  });
});

describe('questions on GitHub', () => {
  it("are posted with the office's marker, and the manager's reply is the first comment without it", () => {
    const body = questionComment('Ada', 'Animations or colours?\nOr both?');
    expect(body).toContain('🤖 **Ada**');
    expect(body).toContain('> Animations or colours?\n> Or both?');
    expect(body).toContain(OFFICE_MARK);
    const at = Date.parse('2026-10-31T10:00:00Z');
    const comments = [
      { id: '1', body: 'an old comment', createdAt: '2026-10-30T09:00:00Z', url: '' },
      { id: '2', body, createdAt: '2026-10-31T10:00:00Z', url: '' },
      { id: '3', body: `🤖 another office note ${OFFICE_MARK}`, createdAt: '2026-10-31T10:05:00Z', url: '' },
      { id: '4', body: 'Colours: pastel.', createdAt: '2026-10-31T11:00:00Z', url: '' },
    ];
    expect(findAnswer(comments, at)?.id).toBe('4');
    expect(findAnswer(comments.slice(0, 3), at)).toBeNull();
  });

  it("go into the issue's next prompt once answered", () => {
    const q = (o: Partial<Question>): Question => ({ id: 1, floorId: 'o/r', issueNumber: 7, from: 'Ada', text: 'Which colours?', askedAt: 0, url: null, answer: null, answeredAt: null, ...o });
    expect(questionsPrompt([q({})])).toBe('');
    expect(questionsPrompt([q({ answer: 'Pastel.' })])).toContain(`- Ada asked: Which colours?\n  ${ANSWER_LEAD} Pastel.`);
  });
});

describe('asking and answering, with the demo', () => {
  const REPO = 'demo-co/pixel-todo';
  let dir: string;
  let store: Store;
  let backend: DemoBackend;
  let floors: Floors;
  let pipeline: Pipeline;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshmallow-questions-'));
    store = new Store(path.join(dir, 'state.json'), { version: '0', demo: true });
    backend = createDemoBackend({ home: null, timing: { stepMs: () => 1, prepareMs: 1, installMs: 1, cloneMs: 1, checksMs: () => 5, closeAfterMergeMs: 5 }, rand: () => 0.9 });
    floors = new Floors(store, backend);
    pipeline = createPipeline(store, backend, floors);
    await floors.connect(REPO);
    await floors.sync(REPO);
  });
  afterEach(async () => {
    pipeline.scheduler.stop();
    pipeline.stopAll();
    backend.github.close();
    await store.flush();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });

  it('labels the issue and comments on it, then takes the label off when the manager replies on GitHub', async () => {
    const q = await pipeline.ctx.questions.ask(REPO, 2, 'Should overdue dates be red?', 'Ada');
    expect((await backend.github.issueComments(REPO, 2))[0].body).toContain('Should overdue dates be red?');
    expect((await backend.github.listIssues(REPO)).find((i) => i.number === 2)?.labels).toContain(QUESTION_LABEL);
    expect(store.floor(REPO).issues.find((i) => i.number === 2)?.labels).toContain(QUESTION_LABEL); // skipped at once
    await expect(pipeline.ctx.questions.ask(REPO, 2, 'Again?', 'Ada')).rejects.toMatchObject({ status: 409 });

    await pipeline.ctx.questions.check(REPO);
    expect(store.question(q.id).answer).toBeNull(); // nothing yet

    await backend.github.commentIssue(REPO, 2, 'Yes, red, and bold.'); // the manager, on GitHub
    await floors.sync(REPO);
    await pipeline.ctx.questions.check(REPO);
    expect(store.question(q.id)).toMatchObject({ answer: 'Yes, red, and bold.' });
    expect((await backend.github.listIssues(REPO)).find((i) => i.number === 2)?.labels).not.toContain(QUESTION_LABEL);
    expect(store.snapshot().messages.map((m) => m.text)).toEqual([expect.stringMatching(/^❓ Ada asks about #2/), expect.stringMatching(/^💬 Your answer on #2/)]);
    expect(pipeline.ctx.questions.promptFor(REPO, 2)).toContain('Yes, red, and bold.');
  });

  it('takes an answer given in the office to GitHub, and forgets questions whose issue closed', async () => {
    const q = await pipeline.ctx.questions.ask(REPO, 3, 'Mouse only, or touch too?', 'Grace');
    await pipeline.ctx.questions.answer(q.id, 'Touch too.');
    expect((await backend.github.issueComments(REPO, 3)).at(-1)?.body).toBe('Touch too.');
    expect(store.question(q.id).answer).toBe('Touch too.');
    await backend.github.closeIssue(REPO, 3, 'done');
    await floors.sync(REPO);
    await pipeline.ctx.questions.check(REPO);
    expect(store.questionList(REPO)).toEqual([]);
  });

  it('a worker on a vague issue asks instead of guessing, and builds it once answered', async () => {
    store.patchFloor(REPO, { autoAssign: true });
    for (const n of [1, 2, 3, 4, 5, 6]) await backend.github.closeIssue(REPO, n, 'not now'); // leave only "Make it pop"
    await floors.sync(REPO);
    store.putWorker({ id: 'ada-0000', name: 'Ada', floorId: REPO, role: 'worker', seed: 1, desk: 0, model: '', effort: '', host: 'local', status: 'idle', task: null, activity: null, idleSince: 0, startedAt: null, endedAt: null, costUsd: 0, turns: 0, lastError: null, sessionId: null, leaving: false });
    const syncing = setInterval(() => void floors.syncAll(), 25);
    pipeline.scheduler.start(20);
    try {
      const until = async (done: () => boolean) => {
        for (let i = 0; i < 500 && !done(); i++) await new Promise((r) => setTimeout(r, 20));
        expect(done()).toBe(true);
      };
      await until(() => store.questionList(REPO).length === 1);
      const [q] = store.questionList(REPO);
      expect(q).toMatchObject({ from: 'Ada', issueNumber: 7, answer: null });
      expect(q.text).toMatch(/What should "pop" mean/);
      expect(store.worker('ada-0000').status).toBe('idle'); // not a failure
      await new Promise((r) => setTimeout(r, 100));
      expect(store.worker('ada-0000').task).toBeNull(); // the issue waits, nobody takes it

      await pipeline.ctx.questions.answer(q.id, 'Playful animations.');
      await until(() => store.floor(REPO).pulls.some((p) => p.closesIssues.includes(7)));
    } finally {
      clearInterval(syncing);
    }
  });
});
