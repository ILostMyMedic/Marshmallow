// Adapted from cubefarm shared/cloud.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import { cloudSettings, DEFAULT_CLOUD, hostLabel, MAX_BOX_LIMIT } from './cloud.ts';

describe('cloudSettings', () => {
  it('starts with workers on this computer', () => {
    expect(DEFAULT_CLOUD.machineKind).toBe('local');
    expect(cloudSettings(DEFAULT_CLOUD, undefined)).toEqual(DEFAULT_CLOUD);
  });

  it('takes what is valid and keeps the rest', () => {
    expect(cloudSettings(DEFAULT_CLOUD, { machineKind: 'box', boxSize: 'large', boxLimit: 25.4 })).toEqual({ machineKind: 'box', boxSize: 'large', boxLimit: 25 });
    expect(cloudSettings(DEFAULT_CLOUD, { machineKind: 'mars', boxSize: 'huge', boxLimit: -3 })).toEqual(DEFAULT_CLOUD);
    expect(cloudSettings(DEFAULT_CLOUD, { boxLimit: 1e9 }).boxLimit).toBe(MAX_BOX_LIMIT);
  });

  it('says where a worker works', () => {
    expect(hostLabel('box')).toMatch(/Cloud/);
    expect(hostLabel('')).toBe('This computer');
  });
});
