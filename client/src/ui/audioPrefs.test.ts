// Adapted from cubefarm client/src/ui/audioPrefs.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO_PREFS, normalizeAudioPrefs, parseAudioPrefs, sliderGain } from './audioPrefs';

describe('parseAudioPrefs', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(parseAudioPrefs(null)).toEqual(DEFAULT_AUDIO_PREFS);
    expect(DEFAULT_AUDIO_PREFS).toEqual({ volume: 70, muted: false });
  });

  it('round-trips saved settings', () => {
    for (const saved of [
      { volume: 40, muted: true },
      { volume: 0, muted: false },
      { volume: 100, muted: true },
    ])
      expect(parseAudioPrefs(JSON.stringify(saved))).toEqual(saved);
  });

  it("keeps cubefarm-style settings' volume and mute, and drops the rest", () => {
    expect(parseAudioPrefs('{"volume":55,"muted":true,"steps":0,"typing":35,"chatter":"lively"}')).toEqual({ volume: 55, muted: true });
  });

  it('falls back to the defaults for corrupt JSON or a non-object', () => {
    for (const text of ['{oops', 'undefined', '42', '"loud"', '[1,2]', 'null']) expect(parseAudioPrefs(text)).toEqual(DEFAULT_AUDIO_PREFS);
  });
});

describe('normalizeAudioPrefs', () => {
  it('replaces an out-of-range or non-numeric volume with the default', () => {
    for (const volume of [140, -5, '50', NaN, Infinity, null, {}, []]) expect(normalizeAudioPrefs({ volume }).volume).toBe(70);
  });

  it('keeps the ends of the range and rounds to whole percent', () => {
    expect(normalizeAudioPrefs({ volume: 0 }).volume).toBe(0);
    expect(normalizeAudioPrefs({ volume: 100 }).volume).toBe(100);
    expect(normalizeAudioPrefs({ volume: 33.6 }).volume).toBe(34);
  });

  it('only mutes when it was saved muted', () => {
    expect(normalizeAudioPrefs({ muted: true }).muted).toBe(true);
    for (const muted of [false, 'true', 1, null, undefined]) expect(normalizeAudioPrefs({ muted }).muted).toBe(false);
  });
});

describe('sliderGain', () => {
  it('maps 0-100 to a squared 0-1 gain', () => {
    expect(sliderGain(0)).toBe(0);
    expect(sliderGain(50)).toBe(0.25);
    expect(sliderGain(100)).toBe(1);
  });
});
