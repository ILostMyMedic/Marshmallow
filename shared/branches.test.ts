import { describe, expect, it } from 'vitest';
import { branchProblem, workBranchOf } from './branches.ts';

describe('workBranchOf', () => {
  it("is the floor's work branch, else the repository's default branch", () => {
    expect(workBranchOf({ workBranch: 'dev', defaultBranch: 'main' })).toBe('dev');
    expect(workBranchOf({ workBranch: null, defaultBranch: 'main' })).toBe('main');
    expect(workBranchOf({ workBranch: '', defaultBranch: 'trunk' })).toBe('trunk');
  });
});

describe('branchProblem', () => {
  it('takes ordinary branch names', () => {
    for (const name of ['dev', 'develop', 'release/2.0', 'feature/x_y-z', 'v1.2']) expect(branchProblem(name)).toBeNull();
  });

  it("refuses what git wouldn't take, or a shell could misread", () => {
    for (const name of ['', '-dev', '/dev', 'dev/', 'dev.', '.dev', 'a..b', 'a//b', 'a/.b', 'dev.lock', 'my branch', "x'; rm -rf ~", 'dev~1', 'a:b']) expect(branchProblem(name)).not.toBeNull();
  });
});
