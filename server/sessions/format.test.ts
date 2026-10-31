// The screenshotFile test is adapted from cubefarm server/clis.test.ts (MIT).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeTool, screenshotFile, summariseResult, tidyPaths, todoLines } from './format.ts';

const cwd = path.join(os.tmpdir(), 'desk');

describe('describeTool', () => {
  it('says what each tool call does, with paths inside the worktree shown relative', () => {
    expect(describeTool(cwd, 'Read', { file_path: path.join(cwd, 'src', 'a.ts') })).toBe('Read src/a.ts');
    expect(describeTool(cwd, 'Bash', { command: `cd "${cwd}" && npm test\nmore` })).toBe('$ npm test');
    expect(describeTool(cwd, 'Grep', { pattern: 'useTodos' })).toBe('Grep "useTodos"');
    expect(describeTool(cwd, 'mcp__playwright__browser_navigate', { url: 'http://localhost:5200/' })).toBe('🌐 navigate http://localhost:5200/');
    expect(describeTool(cwd, 'Mystery', { a: 1 })).toBe('Mystery({"a":1})');
  });
});

describe('summariseResult', () => {
  it('gives the file tools their one-liners and anything else its first lines', () => {
    expect(summariseResult(cwd, 'Edit', 'whatever')).toEqual([{ kind: 'result', text: '  ⎿ Updated' }]);
    expect(summariseResult(cwd, 'Read', 'a\nb\n\nc')).toEqual([{ kind: 'result', text: '  ⎿ Read 3 lines' }]);
    expect(summariseResult(cwd, 'Bash', '')).toEqual([{ kind: 'result', text: '  ⎿ (no output)' }]);
    const many = summariseResult(cwd, 'Bash', ['1', '2', '3', '4', '5'].join('\n'));
    expect(many.map((l) => l.text)).toEqual(['  ⎿ 1', '    2', '    3', '    … +2 lines']);
  });
});

describe('tidyPaths and todoLines', () => {
  it('shows the worktree as ./ and a todo list with its ticks', () => {
    expect(tidyPaths(cwd, `${cwd}${path.sep}src${path.sep}x.ts failed`)).toMatch(/^\.\/src/);
    expect(todoLines({ todos: [{ content: 'Write the test', status: 'completed' }, { content: 'Fix it', status: 'in_progress' }] }).map((l) => l.text)).toEqual(['  ☒ Write the test', '  ◐ Fix it']);
  });
});

describe('screenshotFile', () => {
  it('reads a Playwright screenshot that was saved to a file instead of returned inline', () => {
    const desk = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-shot-'));
    fs.mkdirSync(path.join(desk, '.playwright-mcp'));
    fs.writeFileSync(path.join(desk, '.playwright-mcp', 'pr16-375.png'), 'png-bytes');
    const shot = screenshotFile(desk, '### Result\n- [Screenshot of viewport](.playwright-mcp/pr16-375.png)');
    expect(shot?.mime).toBe('image/png');
    expect(shot?.data.toString()).toBe('png-bytes');
    expect(screenshotFile(desk, '### Result\n- no link here')).toBeNull();
    fs.rmSync(desk, { recursive: true, force: true });
  });
});
