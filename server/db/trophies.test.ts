import { describe, expect, it } from 'vitest';
import { builderFromBranch } from './trophies.ts';

describe('builderFromBranch', () => {
  it("reads the worker's name back from the office's branch", () => {
    expect(builderFromBranch('mm/issue-7-ada')).toBe('Ada');
    expect(builderFromBranch('mm/issue-12-mary-jane')).toBe('Mary Jane');
  });

  it("gives nothing for anyone else's branch", () => {
    expect(builderFromBranch('feature/login')).toBeNull();
    expect(builderFromBranch('mm/qa-3')).toBeNull();
    expect(builderFromBranch(null)).toBeNull();
  });
});
