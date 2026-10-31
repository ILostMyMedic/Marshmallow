import { describe, expect, it } from 'vitest';
import { evidenceFiles, parseReport, renderQaComment, SHOTS_POSTED, type QaReport } from './qaReport.ts';

const report: QaReport = {
  verdict: 'fail',
  summary: 'The toolbar overflows on phones.',
  checks: [
    { name: 'Desktop', result: 'pass', details: 'Works at 1280px' },
    { name: 'Mobile | 375px', result: 'fail', details: 'Overflows\nbutton cut off' },
  ],
  commands: [{ command: 'npm test', result: '41 passed' }],
  screenshots: ['Desktop', 'Mobile'],
  fixInstructions: 'Let the toolbar wrap.',
};

describe('parseReport', () => {
  it('takes the structured answer when the session gave one', () => {
    expect(parseReport({ structured: report, text: '' })).toEqual(report);
  });

  it('reads the last JSON block of the final message, then any JSON at all', () => {
    const text = 'Notes\n```json\n{"verdict":"pass","summary":"old"}\n```\nThen:\n```json\n{"verdict":"fail","summary":"new"}\n```';
    expect(parseReport({ text })?.summary).toBe('new');
    expect(parseReport({ text: 'Done. {"verdict": "pass", "summary": "inline"}' })?.summary).toBe('inline');
  });

  it('is null without a verdict or any JSON', () => {
    expect(parseReport({ text: 'All good!' })).toBeNull();
    expect(parseReport({ text: '```json\n{"summary":"no verdict"}\n```' })).toBeNull();
    expect(parseReport({ structured: 'pass', text: '' })).toBeNull();
  });

  it('fills in what a sloppy report leaves out', () => {
    expect(parseReport({ structured: { verdict: 'pass', checks: [{ name: 'x', result: 'odd' }], screenshots: 'nope' }, text: '' })).toEqual({
      verdict: 'pass',
      summary: '',
      checks: [{ name: 'x', result: 'pass', details: '' }],
      commands: [],
      screenshots: [],
    });
  });
});

describe('evidenceFiles', () => {
  it('posts the newest screenshots with their captions, numbered per round', () => {
    const shots = Array.from({ length: SHOTS_POSTED + 2 }, (_, i) => ({ mime: i % 2 ? 'image/png' : 'image/svg+xml' }));
    const captions = { ...report, screenshots: shots.map((_, i) => `shot ${i}`) };
    const files = evidenceFiles(shots, captions, 12, 2, 36 ** 3);
    expect(files).toHaveLength(SHOTS_POSTED);
    expect(files[0]).toEqual({ index: 2, path: 'pr-12/round-2-1000/01.svg', caption: 'shot 2' });
    expect(files.at(-1)?.path).toBe(`pr-12/round-2-1000/${String(SHOTS_POSTED).padStart(2, '0')}.png`);
    expect(evidenceFiles([{ mime: 'image/png' }], { ...report, screenshots: [] }, 1, 1, 0)[0].caption).toBe('Screenshot 1');
  });
});

describe('renderQaComment', () => {
  it('says the verdict, the checks, the commands, what to fix and who tested it', () => {
    const text = renderQaComment(report, { round: 1, tester: 'Grace', shots: [{ url: 'https://x/1.png', caption: 'Mobile' }] });
    expect(text).toMatch(/^## ❌ QA failed \(round 1\)/);
    expect(text).toContain('| ❌ | Mobile \\| 375px | Overflows<br>button cut off |');
    expect(text).toContain('- `npm test`: 41 passed');
    expect(text).toContain('**What needs fixing**\nLet the toolbar wrap.');
    expect(text).toContain('![Mobile](https://x/1.png)');
    expect(text).toContain('Tested by Grace, a Marshmallow worker');
  });

  it('leaves out what to fix on a pass', () => {
    expect(renderQaComment({ ...report, verdict: 'pass' }, { round: 2, tester: 'Ada', shots: [] })).not.toContain('What needs fixing');
  });
});
