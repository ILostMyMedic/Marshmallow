// The manager's console's forms as plain data: the settings form and the patch its Save sends, the repositories you
// could still connect, and a typed repository checked before it goes to the server.
import type { BoxSize, DayMode, EffortLevel, Floor, GhRepoSummary, MachineHost, Settings } from '../../../../shared/types';

export const EFFORTS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** server/settings.ts's ranges and shared/cloud.ts's Box limit, so the form says what's wrong before the server does. */
export const LIMITS = { sessionLimit: [0, 64], pacingSessions: [1, 32], maxWorkers: [1, 15], boxLimit: [1, 1000] } as const;

/** The settings tab's fields as typed: numbers stay text until Save, so a half-typed one isn't lost. */
export interface SettingsForm {
  managerName: string;
  companyName: string;
  sessionLimit: string; // '' = no limit
  pacingSessions: string;
  maxWorkers: string;
  autoscale: boolean;
  defaultModel: string;
  defaultEffort: EffortLevel;
  dayMode: DayMode;
  machineKind: MachineHost;
  boxSize: BoxSize;
  boxLimit: string;
}

export type FormEdits = Partial<SettingsForm>;
export type FormProblems = Partial<Record<keyof SettingsForm, string>>;

/** The form showing `s` as it is. */
export function settingsForm(s: Settings): SettingsForm {
  return {
    managerName: s.managerName,
    companyName: s.companyName,
    sessionLimit: s.sessionLimit ? String(s.sessionLimit) : '',
    pacingSessions: String(s.pacingSessions),
    maxWorkers: String(s.maxWorkers),
    autoscale: s.autoscale,
    defaultModel: s.defaultModel,
    defaultEffort: s.defaultEffort,
    dayMode: s.dayMode,
    machineKind: s.cloud.machineKind,
    boxSize: s.cloud.boxSize,
    boxLimit: String(s.cloud.boxLimit),
  };
}

/** Edits that still differ from `base`: the rest are dropped, so a change made elsewhere shows through. */
export function pruneEdits(edits: FormEdits, base: SettingsForm): FormEdits {
  const out: FormEdits = {};
  for (const [k, v] of Object.entries(edits) as [keyof SettingsForm, SettingsForm[keyof SettingsForm]][]) if (v !== base[k]) (out as Record<string, unknown>)[k] = v;
  return out;
}

function whole(text: string, [lo, hi]: readonly [number, number], blank?: number): number | string {
  const t = text.trim();
  if (!t && blank !== undefined) return blank;
  const n = Number(t);
  return t && Number.isInteger(n) && n >= lo && n <= hi ? n : `A whole number from ${lo} to ${hi}`;
}

/**
 * What Save sends (PATCH /api/settings): only the fields that differ from `now`, checked, and a problem for each field
 * that wouldn't pass. The cloud fields go together as `cloud`, which the server merges with what it has.
 */
export function settingsPatch(form: SettingsForm, now: Settings): { patch: Partial<Settings>; problems: FormProblems } {
  const patch: Partial<Settings> = {};
  const problems: FormProblems = {};
  for (const key of ['managerName', 'companyName'] as const) {
    const v = form[key].trim().slice(0, 80);
    if (v !== now[key]) patch[key] = v;
  }
  const numbers = [
    ['sessionLimit', 0],
    ['pacingSessions', undefined],
    ['maxWorkers', undefined],
  ] as const;
  for (const [key, blank] of numbers) {
    const n = whole(form[key], LIMITS[key], blank);
    if (typeof n === 'string') problems[key] = n;
    else if (n !== now[key]) patch[key] = n;
  }
  if (form.autoscale !== now.autoscale) patch.autoscale = form.autoscale;
  const model = form.defaultModel.trim();
  if (!model) problems.defaultModel = 'A model name, like claude-opus-5-5 or ollama/gpt-oss:20b';
  else if (model !== now.defaultModel) patch.defaultModel = model;
  if (form.defaultEffort !== now.defaultEffort) patch.defaultEffort = form.defaultEffort;
  if (form.dayMode !== now.dayMode) patch.dayMode = form.dayMode;
  const boxLimit = whole(form.boxLimit, LIMITS.boxLimit);
  if (typeof boxLimit === 'string') problems.boxLimit = boxLimit;
  else {
    const cloud = { machineKind: form.machineKind, boxSize: form.boxSize, boxLimit };
    if (cloud.machineKind !== now.cloud.machineKind || cloud.boxSize !== now.cloud.boxSize || cloud.boxLimit !== now.cloud.boxLimit) patch.cloud = cloud;
  }
  return { patch, problems };
}

/** A repository as typed or pasted ("owner/name", its GitHub URL, or its clone URL) as owner/name; null if it isn't one. */
export function repoName(input: string): string | null {
  const t = input
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  return /^[\w.-]+\/[\w.-]+$/.test(t) ? t : null;
}

/** Repositories that aren't floors yet, matching `q` in their name or description. */
export function freeRepos(repos: readonly GhRepoSummary[], floors: readonly Pick<Floor, 'id'>[], q: string): GhRepoSummary[] {
  const taken = new Set(floors.map((f) => f.id.toLowerCase()));
  const needle = q.trim().toLowerCase();
  return repos.filter((r) => !taken.has(r.nameWithOwner.toLowerCase()) && (!needle || r.nameWithOwner.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle)));
}
