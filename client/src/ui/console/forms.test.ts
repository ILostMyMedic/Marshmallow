import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type GhRepoSummary, type Settings } from '../../../../shared/types';
import { freeRepos, pruneEdits, repoName, settingsForm, settingsPatch } from './forms';

const now: Settings = { ...DEFAULT_SETTINGS, managerName: 'Sam', companyName: 'Toasted Labs' };
const form = (o: Partial<ReturnType<typeof settingsForm>> = {}) => ({ ...settingsForm(now), ...o });

describe('settingsForm', () => {
  it('shows no session limit as an empty field', () => {
    expect(settingsForm(now).sessionLimit).toBe('');
    expect(settingsForm({ ...now, sessionLimit: 4 }).sessionLimit).toBe('4');
  });
});

describe('settingsPatch', () => {
  it('sends nothing for an untouched form', () => {
    expect(settingsPatch(form(), now)).toEqual({ patch: {}, problems: {} });
  });

  it('sends only what changed, trimmed and as numbers', () => {
    const { patch, problems } = settingsPatch(form({ managerName: '  Alex ', sessionLimit: '6', maxWorkers: '10', autoscale: false, defaultEffort: 'high', dayMode: 'clock' }), now);
    expect(problems).toEqual({});
    expect(patch).toEqual({ managerName: 'Alex', sessionLimit: 6, autoscale: false, defaultEffort: 'high', dayMode: 'clock' });
  });

  it('turns an emptied session limit into no limit', () => {
    expect(settingsPatch(form({ sessionLimit: ' ' }), { ...now, sessionLimit: 3 }).patch).toEqual({ sessionLimit: 0 });
  });

  it("names the fields that wouldn't pass, with the server's ranges", () => {
    const { patch, problems } = settingsPatch(form({ pacingSessions: '0', maxWorkers: '2.5', sessionLimit: '65', defaultModel: ' ', boxLimit: '' }), now);
    expect(patch).toEqual({});
    expect(Object.keys(problems).sort()).toEqual(['boxLimit', 'defaultModel', 'maxWorkers', 'pacingSessions', 'sessionLimit']);
    expect(problems.maxWorkers).toBe('A whole number from 1 to 15');
  });

  it('still sends the fields that pass when another one does not', () => {
    expect(settingsPatch(form({ companyName: 'Gooey Bits', maxWorkers: 'lots' }), now).patch).toEqual({ companyName: 'Gooey Bits' });
  });

  it('sends the cloud settings together when any of them changed', () => {
    expect(settingsPatch(form({ boxSize: 'large' }), now).patch).toEqual({ cloud: { machineKind: 'local', boxSize: 'large', boxLimit: 10 } });
    expect(settingsPatch(form({ boxLimit: '25', machineKind: 'box' }), now).patch).toEqual({ cloud: { machineKind: 'box', boxSize: 'small', boxLimit: 25 } });
  });

  it('cuts names at 80 characters, as the server does', () => {
    expect(settingsPatch(form({ companyName: 'x'.repeat(100) }), now).patch.companyName).toHaveLength(80);
  });
});

describe('pruneEdits', () => {
  it('drops edits that match what the office has now', () => {
    expect(pruneEdits({ managerName: 'Sam', maxWorkers: '4', autoscale: true }, settingsForm(now))).toEqual({ maxWorkers: '4' });
  });
});

describe('repoName', () => {
  it.each([
    ['acme/app', 'acme/app'],
    ['  acme/app  ', 'acme/app'],
    ['https://github.com/acme/my.app', 'acme/my.app'],
    ['github.com/acme/app/', 'acme/app'],
    ['https://github.com/acme/app.git', 'acme/app'],
    ['git@github.com:acme/app.git', 'acme/app'],
  ])('%s → %s', (input, out) => expect(repoName(input)).toBe(out));

  it.each(['', 'app', 'acme/app/issues', 'acme app/x', 'https://gitlab.com/acme/app'])('refuses %j', (input) => expect(repoName(input)).toBeNull());
});

describe('freeRepos', () => {
  const repo = (nameWithOwner: string, description = ''): GhRepoSummary => ({ nameWithOwner, description, visibility: 'PRIVATE', updatedAt: '' });
  const repos = [repo('acme/app', 'The shop'), repo('acme/site', 'Our website'), repo('Acme/Game', 'A cozy game')];

  it('leaves out repositories that are floors already, whatever their case', () => {
    expect(freeRepos(repos, [{ id: 'acme/game' }], '').map((r) => r.nameWithOwner)).toEqual(['acme/app', 'acme/site']);
  });

  it('matches the filter in the name or the description', () => {
    expect(freeRepos(repos, [], 'SITE').map((r) => r.nameWithOwner)).toEqual(['acme/site']);
    expect(freeRepos(repos, [], 'cozy').map((r) => r.nameWithOwner)).toEqual(['Acme/Game']);
  });
});
