import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { homeDir, isDemo, stateFile } from './config.ts';

describe('isDemo', () => {
  it('is on with --demo or MARSHMALLOW_DEMO', () => {
    expect(isDemo(['node', 'server/index.ts', '--demo'], {})).toBe(true);
    expect(isDemo([], { MARSHMALLOW_DEMO: '1' })).toBe(true);
    expect(isDemo([], { MARSHMALLOW_DEMO: 'true' })).toBe(true);
  });

  it('is off otherwise', () => {
    expect(isDemo(['node', 'server/index.ts'], {})).toBe(false);
    expect(isDemo([], { MARSHMALLOW_DEMO: '0' })).toBe(false);
  });
});

describe('homeDir', () => {
  const home = path.join(os.tmpdir(), 'someone');

  it('is ~/.marshmallow unless MARSHMALLOW_HOME names another folder', () => {
    expect(homeDir({}, home)).toBe(path.join(home, '.marshmallow'));
    expect(homeDir({ MARSHMALLOW_HOME: '  ' }, home)).toBe(path.join(home, '.marshmallow'));
  });

  it('resolves a relative MARSHMALLOW_HOME against the folder it was started in', () => {
    expect(homeDir({ MARSHMALLOW_HOME: './.mm-home' }, home)).toBe(path.resolve('.mm-home'));
  });
});

describe('stateFile', () => {
  it('keeps the demo apart from the real office', () => {
    expect(stateFile('home', false)).toBe(path.join('home', 'state.json'));
    expect(stateFile('home', true)).toBe(path.join('home', 'demo-state.json'));
  });
});
