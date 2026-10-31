// Adapted from cubefarm client/src/world/camera/overviewInfo.test.ts (MIT): chipFor only.
import { describe, expect, it } from 'vitest';
import type { Task, Worker } from '../../../shared/types';
import { chipFor } from './overviewInfo';

const task = (kind: Task['kind']): Task => ({ kind, issueNumber: 1, title: 'Add a thing', branch: null, prNumber: null, prUrl: null });
const worker = (status: Worker['status'], kind?: Task['kind']) => ({ status, task: kind ? task(kind) : null });

describe('chipFor', () => {
  it('names what someone is doing', () => {
    expect(chipFor(worker('working', 'issue'))).toBe('working');
    expect(chipFor(worker('preparing', 'issue'))).toBe('working');
    expect(chipFor(worker('working', 'fix'))).toBe('fixing');
    expect(chipFor(worker('working', 'qa'))).toBe('testing');
    expect(chipFor(worker('error', 'issue'))).toBe('error');
    expect(chipFor(worker('idle'))).toBe('idle');
    expect(chipFor(worker('done', 'issue'))).toBe('idle');
    expect(chipFor(worker('stopped', 'fix'))).toBe('idle');
  });
});
