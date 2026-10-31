// Adapted from cubefarm server/reconcile.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import { reconcileStep, restartMessage, workState, type ReconcileWorker } from './reconcile.ts';

const worker = (over: Partial<ReconcileWorker> = {}): ReconcileWorker => ({
  role: 'worker',
  status: 'working',
  task: 'issue',
  work: 'open',
  deskExists: true,
  cliAlive: false,
  resumable: true,
  ...over,
});

describe('workState', () => {
  it('reads GitHub: a merge wins, a closed issue or PR ends the work, unknown when nobody answered', () => {
    expect(workState('OPEN', 'MERGED')).toBe('merged');
    expect(workState('CLOSED', null)).toBe('closed');
    expect(workState('OPEN', 'CLOSED')).toBe('closed');
    expect(workState(null, 'OPEN')).toBe('open');
    expect(workState('OPEN', null)).toBe('open');
    expect(workState(null, null)).toBe('unknown');
  });
});

describe('reconcileStep', () => {
  it('leaves the CEO and workers without a task alone', () => {
    expect(reconcileStep(worker({ role: 'ceo' }))).toBe('none');
    expect(reconcileStep(worker({ task: null }))).toBe('none');
  });

  it('clears work that closed or merged while the office was down, whatever the worker was doing', () => {
    for (const status of ['working', 'preparing', 'error', 'stopped', 'done']) {
      expect(reconcileStep(worker({ status, work: 'closed', deskExists: false }))).toBe('clear');
      expect(reconcileStep(worker({ status, task: 'fix', work: 'merged', cliAlive: true }))).toBe('clear');
    }
  });

  it('reattaches a live CLI only when its desk is still there', () => {
    expect(reconcileStep(worker({ cliAlive: true }))).toBe('reattach');
    expect(reconcileStep(worker({ cliAlive: true, work: 'unknown' }))).toBe('reattach');
    expect(reconcileStep(worker({ cliAlive: true, deskExists: false }))).toBe('requeue');
  });

  it('never resumes a session in a desk that is gone (exit 267: the directory name is invalid)', () => {
    expect(reconcileStep(worker({ deskExists: false }))).toBe('requeue');
    expect(reconcileStep(worker({ status: 'preparing', deskExists: false, resumable: false }))).toBe('requeue');
  });

  it('resumes what can be resumed and puts the rest back in line', () => {
    expect(reconcileStep(worker())).toBe('resume');
    expect(reconcileStep(worker({ resumable: false }))).toBe('requeue');
    expect(reconcileStep(worker({ task: 'qa', resumable: false }))).toBe('requeue');
  });

  it('keeps cards that wait for something, and requeues a failed or stopped one whose desk is gone', () => {
    expect(reconcileStep(worker({ status: 'done', deskExists: false }))).toBe('keep');
    expect(reconcileStep(worker({ status: 'error' }))).toBe('keep');
    expect(reconcileStep(worker({ status: 'stopped' }))).toBe('keep');
    expect(reconcileStep(worker({ status: 'error', deskExists: false }))).toBe('requeue');
    expect(reconcileStep(worker({ status: 'stopped', deskExists: false }))).toBe('requeue');
  });
});

describe('restartMessage', () => {
  it('says what the restart did in one message', () => {
    expect(restartMessage({ cleared: 7, reattached: 2, resumed: 0, requeued: 0 })).toBe('↻ Restarted: cleared 7 finished tasks and reattached 2 live sessions.');
    expect(restartMessage({ cleared: 1, reattached: 1, resumed: 1, requeued: 1 })).toBe('↻ Restarted: cleared 1 finished task, reattached 1 live session, resumed 1 session and put 1 task back in line.');
    expect(restartMessage({ cleared: 0, reattached: 0, resumed: 0, requeued: 3 })).toBe('↻ Restarted: put 3 tasks back in line.');
  });

  it('says nothing when there was nothing to do', () => {
    expect(restartMessage({ cleared: 0, reattached: 0, resumed: 0, requeued: 0 })).toBeNull();
  });
});
