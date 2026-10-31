// Adapted from cubefarm client/src/world/camera/overviewInfo.ts (MIT): the status chips (the building view's floor
// summaries are cut).

// What the overview says over each desk: the person's name and what they're doing, as a coloured chip. Pure, so the
// tests check it; OverviewChips.tsx draws it.
import type { Worker } from '../../../shared/types';

export type ChipKind = 'working' | 'testing' | 'fixing' | 'error' | 'idle';

export const CHIP_COLORS: Record<ChipKind, string> = {
  working: '#2dc653',
  testing: '#4cc9f0',
  fixing: '#ff9f1c',
  error: '#ef476f',
  idle: '#adb5bd',
};

export const CHIP_LABELS: Record<ChipKind, string> = { working: 'working', testing: 'testing', fixing: 'fixing', error: 'needs help', idle: 'idle' };

/** The chip for someone: in trouble, testing a PR, fixing one, on an issue, or not busy. */
export function chipFor(w: Pick<Worker, 'status' | 'task'>): ChipKind {
  if (w.status === 'error') return 'error';
  if (w.status !== 'working' && w.status !== 'preparing') return 'idle';
  if (w.task?.kind === 'qa') return 'testing';
  return w.task?.kind === 'fix' ? 'fixing' : 'working';
}
