// The world model: each worker's game state, from their status and the office's moments (shared/types.ts Moment).
// The scene reads it every frame and never talks to the server itself. Pure: phase 9 has working, idle and
// celebrating; arriving, leaving and errands join it as their phases come.

import type { Moment, Worker } from '../../../shared/types';

export type GameState = 'working' | 'idle' | 'celebrating';

/** How long a worker cheers their PR opening or merging. */
export const CHEER_MS = 7_000;
/** How long the author of a merged PR stays proud of it once the cheering is over. */
export const PROUD_MS = 90_000;

export interface Life {
  state: GameState;
  /** Arms up: their PR just opened or merged. */
  cheering: boolean;
  /** Their PR merged within PROUD_MS. */
  justMerged: boolean;
}

/** When `workerId` last had cause to cheer, and when their PR last merged (0: never), from the moments a tab has seen. */
function lastWins(workerId: string, moments: readonly Moment[]) {
  let cheer = 0;
  let merged = 0;
  for (const m of moments) {
    if (m.type === 'prOpened' && m.workerId === workerId) cheer = Math.max(cheer, m.at);
    if (m.type === 'merged' && m.devWorkerId === workerId) cheer = merged = Math.max(merged, m.at);
  }
  return { cheer, merged };
}

/** A worker's game state at `now` (epoch ms, the server's clock: moments carry its times). */
export function lifeOf(w: Pick<Worker, 'id' | 'status'>, moments: readonly Moment[], now: number): Life {
  const wins = lastWins(w.id, moments);
  const busy = w.status === 'working' || w.status === 'preparing';
  const cheering = !busy && now - wins.cheer < CHEER_MS;
  return {
    state: busy ? 'working' : cheering ? 'celebrating' : 'idle',
    cheering,
    justMerged: now - wins.merged < PROUD_MS,
  };
}
