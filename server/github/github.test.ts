// Adapted from cubefarm server/github.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import { checksOf, readTwice } from './github.ts';

describe('readTwice', () => {
  it('tries a failed read once more', async () => {
    let calls = 0;
    const read = async () => {
      calls++;
      if (calls === 1) throw new Error('gh pr list -R failed: timed out after 60 s');
      return [1, 2];
    };
    await expect(readTwice(read, 0)).resolves.toEqual([1, 2]);
    expect(calls).toBe(2);
  });

  it('gives up with the second error', async () => {
    let calls = 0;
    const read = async () => {
      calls++;
      throw new Error(`failure ${calls}`);
    };
    await expect(readTwice(read, 0)).rejects.toThrow('failure 2');
    expect(calls).toBe(2);
  });
});

describe('checksOf', () => {
  it('is failing when any check failed, pending while any runs, else passing; none without checks', () => {
    expect(checksOf(null)).toBe('none');
    expect(checksOf([])).toBe('none');
    expect(checksOf([{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }, { context: 'Vercel', state: 'SUCCESS' }])).toBe('passing');
    expect(checksOf([{ name: 'build', status: 'IN_PROGRESS' }, { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }])).toBe('pending');
    expect(checksOf([{ name: 'build', status: 'IN_PROGRESS' }, { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' }])).toBe('failing');
    expect(checksOf([{ context: 'Vercel', state: 'ERROR' }])).toBe('failing');
  });
});
