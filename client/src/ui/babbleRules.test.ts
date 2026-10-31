// Adapted from cubefarm client/src/ui/babbleRules.test.ts (MIT): the pacing's cases are chatterRules.test.ts's; the
// interjections' are new.
import { describe, expect, it } from 'vitest';
import { MAX_SYLLABLES, babbleVoice, interjection, planBabble, spokenText, syllables, tuneOf } from './babbleRules';

const fixed = (x: number) => () => x;

describe('babbleVoice', () => {
  it('is the same for the same person on every load', () => {
    expect(babbleVoice('ken', 'masculine')).toEqual(babbleVoice('ken', 'masculine'));
    expect(babbleVoice('ceo', 'feminine', 'ceo')).toEqual(babbleVoice('ceo', 'feminine', 'ceo'));
  });

  it('differs from person to person: pitch, timbre, speed or accent', () => {
    const ids = ['ada', 'ken', 'grace', 'linus', 'marple', 'barbara', 'dennis', 'radia'];
    const voices = ids.map((id) => babbleVoice(id, id.length % 2 ? 'feminine' : 'masculine'));
    const keys = new Set(voices.map((v) => `${v.pitch}|${v.wave}|${v.rate}|${v.accent.join()}`));
    expect(keys.size).toBe(ids.length);
    expect(new Set(voices.map((v) => v.wave)).size).toBeGreaterThan(1);
    expect(new Set(voices.map((v) => v.accent.join())).size).toBeGreaterThan(4);
  });

  it('keeps every voice in a cute, quick, sensible range', () => {
    for (let i = 0; i < 200; i++) {
      const look = i % 2 ? 'feminine' : 'masculine';
      const v = babbleVoice(`worker-${i}`, look);
      expect(v.pitch).toBeGreaterThanOrEqual(look === 'feminine' ? 330 : 215);
      expect(v.pitch).toBeLessThanOrEqual(look === 'feminine' ? 480 : 330);
      expect(v.rate).toBeGreaterThanOrEqual(10);
      expect(v.rate).toBeLessThanOrEqual(15);
      expect(v.range).toBeGreaterThanOrEqual(3);
      expect(v.range).toBeLessThanOrEqual(8);
      expect(v.breath).toBeGreaterThan(0);
      expect(v.breath).toBeLessThanOrEqual(0.75);
      expect(v.accent[0]).toBe(0);
      for (const s of v.accent) expect(Math.abs(s)).toBeLessThanOrEqual(5);
    }
  });

  it('gives the CEO a distinct voice: lower, slower and grander than anyone on the team', () => {
    const ceo = babbleVoice('ceo', 'masculine', 'ceo');
    for (let i = 0; i < 100; i++) {
      const v = babbleVoice(`dev-${i}`, 'masculine');
      expect(ceo.pitch).toBeLessThan(v.pitch);
      expect(ceo.rate).toBeLessThan(v.rate);
    }
    expect(ceo.wave).toBe('sawtooth');
    expect(babbleVoice('ceo', 'feminine', 'ceo').pitch).toBeLessThan(babbleVoice('ada', 'feminine').pitch);
  });
});

describe('syllables', () => {
  it('makes a syllable of each vowel group, with the consonant before it', () => {
    expect(syllables('Hi').map((s) => [s.vowel, s.onset])).toEqual([['i', 'hiss']]);
    expect(syllables('merge').map((s) => s.vowel)).toEqual(['e', 'e']);
    expect(syllables('tests').map((s) => [s.vowel, s.onset])).toEqual([['e', 'stop']]);
    expect(syllables('Coffee?').map((s) => s.onset)).toEqual(['stop', 'hiss']);
    expect(syllables('on it').map((s) => s.onset)).toEqual(['none', 'none']);
  });

  it('says numbers digit by digit and keeps emoji and symbols silent', () => {
    expect(syllables('#212')).toHaveLength(3);
    expect(syllables('🎉 ✅ → !!')).toEqual([]);
    expect(syllables('PR #212 🚀')).toHaveLength(4);
  });

  it('pauses a little between words and longer at commas and full stops', () => {
    const s = syllables('Hi, Ken. On it now');
    expect(s.map((x) => x.pause)).toEqual([1.2, 1.6, 0.4, 0.4, 0.4]);
    expect(syllables('store.ts')[1].pause).toBe(0.4); // a dot inside a word isn't a full stop
  });

  it('caps a long line', () => {
    expect(syllables('a e i o u '.repeat(20))).toHaveLength(MAX_SYLLABLES);
  });
});

describe('tuneOf', () => {
  it('hears questions, exclamations and trailing off, past any emoji', () => {
    expect(tuneOf('Marple, can you look at #212?')).toBe('ask');
    expect(tuneOf('Tests are green! ✅')).toBe('exclaim');
    expect(tuneOf('CI is so slow today…')).toBe('trail');
    expect(tuneOf('Reading App.tsx...')).toBe('trail');
    expect(tuneOf('PR #212 is up for QA')).toBe('say');
  });
});

describe('planBabble', () => {
  const v = babbleVoice('ken', 'masculine');

  it('gives each syllable a blip in time, in the voice, within its range', () => {
    const { notes, length } = planBabble('Ugh, a merge conflict in store.ts', v, fixed(0.5));
    expect(notes).toHaveLength(syllables('Ugh, a merge conflict in store.ts').length);
    for (let i = 1; i < notes.length; i++) expect(notes[i].at).toBeGreaterThan(notes[i - 1].at);
    for (const n of notes) {
      expect(n.freq).toBeGreaterThan(v.pitch * 2 ** (-(v.range + 4) / 12));
      expect(n.freq).toBeLessThan(v.pitch * 2 ** ((v.range + 4) / 12));
      expect(n.level).toBeGreaterThan(0);
      expect(n.level).toBeLessThanOrEqual(1);
      expect(n.dur).toBeGreaterThan(0);
    }
    expect(length).toBeGreaterThan(0.5);
    expect(length).toBeLessThan(3);
  });

  it('is a second or two at most, however long the line', () => {
    expect(planBabble('word '.repeat(60), v, fixed(0.5)).length).toBeLessThan(3);
    expect(planBabble('🎉', v).notes).toEqual([]);
    expect(planBabble('🎉', v).length).toBe(0);
  });

  it('rises at the end of a question and sits higher when exclaiming', () => {
    const ask = planBabble('can you look', v, fixed(0.5)).notes;
    const asked = planBabble('can you look?', v, fixed(0.5)).notes;
    expect(asked[asked.length - 1].freq).toBeGreaterThan(ask[ask.length - 1].freq);
    expect(asked[asked.length - 1].to).toBeGreaterThan(asked[asked.length - 1].freq);
    const said = planBabble('tests are green', v, fixed(0.5)).notes;
    const shout = planBabble('tests are green!', v, fixed(0.5)).notes;
    expect(shout[0].freq).toBeGreaterThan(said[0].freq);
  });

  it('follows the speaker: two workers say the same line differently', () => {
    const a = planBabble('Tests are green!', babbleVoice('ada', 'feminine'), fixed(0.5));
    const b = planBabble('Tests are green!', babbleVoice('ken', 'masculine'), fixed(0.5));
    expect(a.notes.map((n) => n.freq)).not.toEqual(b.notes.map((n) => n.freq));
    expect(a.length).not.toBe(b.length);
  });

  it('shapes each vowel with the voice-scaled formants', () => {
    const [n] = planBabble('a', { ...v, formant: 1 }, fixed(0.5)).notes;
    expect([n.f1, n.f2]).toEqual([800, 1250]);
    const [m] = planBabble('a', { ...v, formant: 1.2 }, fixed(0.5)).notes;
    expect(m.f1).toBe(960);
  });
});

describe('interjection', () => {
  it('voices an emoji-only bubble by its mood, the same way each time for the same person', () => {
    expect(['yay!', 'woo!', 'wahoo!']).toContain(interjection('🎉', 'ceo'));
    expect(['aww…', 'oh no…', 'ugh…']).toContain(interjection('😩', 'ken'));
    expect(['hi!', 'hey!', 'hello!']).toContain(interjection('👋', 'mia'));
    expect(['mm-hm!', 'nice!', 'yes!']).toContain(interjection('👍', 'ceo'));
    expect(interjection('👍', 'ceo')).toBe(interjection('👍', 'ceo'));
    expect(interjection('🦄', 'x')).not.toBeNull();
  });

  it('stays out of the way of words, and of empty bubbles', () => {
    expect(interjection('Hi! Welcome 👋')).toBeNull();
    expect(interjection('#212')).toBeNull();
    expect(interjection('   ')).toBeNull();
  });

  it('always leaves something with syllables to say', () => {
    for (const e of ['🎉', '😩', '👋', '👍', '🍕', '📋', '🦄', '🔥🙌']) expect(syllables(spokenText(e, 'ada') ?? '').length).toBeGreaterThan(0);
    expect(spokenText('Tests are green! ✅')).toBe('Tests are green! ✅');
    expect(spokenText('')).toBeNull();
  });
});
