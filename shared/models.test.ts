import { describe, expect, it } from 'vitest';
import { effectiveModel, localModel } from './models.ts';

describe('localModel', () => {
  it('reads the server and its own name for the model', () => {
    expect(localModel('ollama/qwen3-coder')).toMatchObject({ server: { id: 'ollama' }, model: 'qwen3-coder' });
    expect(localModel(' Ollama/gpt-oss:20b ')).toMatchObject({ server: { id: 'ollama' }, model: 'gpt-oss:20b' });
    expect(localModel('ollama/hf.co/someone/model:Q4')?.model).toBe('hf.co/someone/model:Q4');
  });

  it("is null for Claude's models and servers it doesn't know", () => {
    for (const m of ['claude-opus-5-5', 'opus', '', 'lmstudio/qwen', 'ollama/']) expect(localModel(m)).toBeNull();
  });
});

describe('effectiveModel', () => {
  it("is the worker's own model, else the office default", () => {
    expect(effectiveModel('ollama/qwen3-coder', 'claude-opus-5-5')).toBe('ollama/qwen3-coder');
    expect(effectiveModel('  ', 'claude-opus-5-5')).toBe('claude-opus-5-5');
  });
});
