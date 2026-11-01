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
    expect(settingsPatch({ dayMode: 'clock' })).toEqual({ dayMode: 'clock' });
    expect(settingsPatch({ bodyStyle: 'chibi' })).toEqual({ bodyStyle: 'chibi' });
    expect(settingsPatch({ bodyStyle: 'human' })).toEqual({ bodyStyle: 'human' });
    expect(settingsPatch({ season: 'christmas' })).toEqual({ season: 'christmas' });
    expect(settingsPatch({ season: 'auto' })).toEqual({ season: 'auto' });
    expect(settingsPatch({ inkOutlines: false })).toEqual({ inkOutlines: false });
    expect(settingsPatch({ inkOutlines: true })).toEqual({ inkOutlines: true });
    expect(settingsPatch({ workersUseMySetup: true })).toEqual({ workersUseMySetup: true });
    expect(settingsPatch({ workersUseMySetup: false })).toEqual({ workersUseMySetup: false });
  });

  it('refuses what is out of shape', () => {
    expect(() => settingsPatch({ sessionLimit: -1 })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => settingsPatch({ maxWorkers: 2.5 })).toThrow(/whole number/);
    expect(() => settingsPatch({ defaultModel: '  ' })).toThrow(/model name/);
    expect(() => settingsPatch({ defaultEffort: 'turbo' })).toThrow(/defaultEffort/);
    expect(() => settingsPatch({ dayMode: 'night' })).toThrow(/dayMode/);
    expect(() => settingsPatch({ bodyStyle: 'blocks' })).toThrow(/bodyStyle must be one of chibi, human/);
    expect(() => settingsPatch({ bodyStyle: 1 })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => settingsPatch({ season: 'monsoon' })).toThrow(/season must be one of auto, spring/);
    expect(() => settingsPatch({ season: null })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => settingsPatch({ inkOutlines: 'no' })).toThrow(/inkOutlines must be true or false/);
    expect(() => settingsPatch({ inkOutlines: 0 })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => settingsPatch({ workersUseMySetup: 'yes' })).toThrow(/workersUseMySetup must be true or false/);
  });
});
