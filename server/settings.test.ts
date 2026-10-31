import { describe, expect, it } from 'vitest';
import { settingsPatch } from './settings.ts';

describe('settingsPatch', () => {
  it('takes the fields it knows, checked, and leaves the rest alone', () => {
    expect(settingsPatch({ sessionLimit: 3, defaultModel: ' ollama/gpt-oss:20b ', defaultEffort: 'high', companyName: ' Fluff ', other: 1 })).toEqual({
      sessionLimit: 3,
      defaultModel: 'ollama/gpt-oss:20b',
      defaultEffort: 'high',
      companyName: 'Fluff',
    });
    expect(settingsPatch(null)).toEqual({});
  });

  it('refuses what is out of shape', () => {
    expect(() => settingsPatch({ sessionLimit: -1 })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => settingsPatch({ maxWorkers: 2.5 })).toThrow(/whole number/);
    expect(() => settingsPatch({ defaultModel: '  ' })).toThrow(/model name/);
    expect(() => settingsPatch({ defaultEffort: 'turbo' })).toThrow(/defaultEffort/);
  });
});
