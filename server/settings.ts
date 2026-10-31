// The office's settings as the manager changes them (PATCH /api/settings): each field checked, the rest left alone.
import { cloudSettings } from '../shared/cloud.ts';
import { DAY_MODES, type DayMode, type EffortLevel, type Settings } from '../shared/types.ts';
import { HttpError } from './httpError.ts';

export const EFFORTS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const whole = (v: unknown, name: string, lo: number, hi: number) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new HttpError(400, `${name} must be a whole number from ${lo} to ${hi}`);
  return n;
};

/** The changes a request asks for, checked; throws HttpError(400) for anything out of shape. `now`: the cloud settings it changes. */
export function settingsPatch(body: unknown, now?: Settings): Partial<Settings> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const patch: Partial<Settings> = {};
  if (b.sessionLimit !== undefined) patch.sessionLimit = whole(b.sessionLimit, 'sessionLimit', 0, 64);
  if (b.pacingSessions !== undefined) patch.pacingSessions = whole(b.pacingSessions, 'pacingSessions', 1, 32);
  if (b.maxWorkers !== undefined) patch.maxWorkers = whole(b.maxWorkers, 'maxWorkers', 1, 15);
  if (b.defaultModel !== undefined) {
    if (typeof b.defaultModel !== 'string' || !b.defaultModel.trim()) throw new HttpError(400, 'defaultModel must be a model name, like claude-opus-5-5 or ollama/gpt-oss:20b');
    patch.defaultModel = b.defaultModel.trim();
  }
  if (b.defaultEffort !== undefined) {
    if (!EFFORTS.includes(b.defaultEffort as EffortLevel)) throw new HttpError(400, `defaultEffort must be one of ${EFFORTS.join(', ')}`);
    patch.defaultEffort = b.defaultEffort as EffortLevel;
  }
  for (const key of ['managerName', 'companyName'] as const) {
    if (b[key] === undefined) continue;
    if (typeof b[key] !== 'string') throw new HttpError(400, `${key} must be text`);
    patch[key] = (b[key] as string).trim().slice(0, 80);
  }
  if (b.dayMode !== undefined) {
    if (!DAY_MODES.includes(b.dayMode as DayMode)) throw new HttpError(400, `dayMode must be one of ${DAY_MODES.join(', ')}`);
    patch.dayMode = b.dayMode as DayMode;
  }
  if (b.setupDone !== undefined) patch.setupDone = b.setupDone === true;
  if (b.autoscale !== undefined) patch.autoscale = b.autoscale === true;
  if (b.cloud !== undefined && now) patch.cloud = cloudSettings(now.cloud, b.cloud);
  return patch;
}
