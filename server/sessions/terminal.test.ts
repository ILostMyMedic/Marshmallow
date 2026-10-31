// Adapted from cubefarm server/terminal.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import { WorkerTerminal } from './terminal.ts';

describe('WorkerTerminal', () => {
  it('keeps what was printed, so a late viewer sees the same screen', async () => {
    const t = new WorkerTerminal();
    t.write('\x1b[32mhello\x1b[0m world\r\n');
    await t.flush();
    expect(t.screen()).toContain('hello world');
    const again = new WorkerTerminal();
    again.write(t.snapshot());
    await again.flush();
    expect(again.screen()).toContain('hello world');
    t.dispose();
    again.dispose();
  });

  it('sends keystrokes and sizes to the running CLI, within sane bounds', () => {
    const t = new WorkerTerminal();
    const got: string[] = [];
    t.bind({ write: (d) => got.push(d), resize: (c, r) => got.push(`${c}x${r}`) });
    expect(got).toEqual([`${t.cols}x${t.rows}`]);
    t.resize(5000, 1);
    expect([t.cols, t.rows]).toEqual([400, 5]);
    expect(got.at(-1)).toBe('400x5');
    t.bind(null);
    expect(t.live).toBe(false);
    t.dispose();
  });
});
