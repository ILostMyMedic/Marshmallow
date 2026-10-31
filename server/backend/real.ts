// The real backend: GitHub through the manager's gh login, floors' checkouts and workers' machines as folders on this
// computer. Claude Code sessions come in BUILD-PLAN phase 5; until then a session ends at once, saying so.
// Adapted from cubefarm server/backend.ts (MIT).
import { realGithub } from '../github/github.ts';
import { localMachines } from '../machines/local.ts';
import { ensureClone, mainDir } from '../machines/workspace.ts';
import type { SessionHandle } from '../sessions/session.ts';
import type { Backend } from './backend.ts';

export const realBackend: Backend = {
  demo: false,
  github: realGithub,
  ensureClone,
  mainDir,
  machines: localMachines(() => ({ pids: [], markers: [] })),
  startSession: (_opts, cb): SessionHandle => {
    setImmediate(() => cb.finished({ ok: false, text: '', costUsd: 0, turns: 0, errors: ["Claude Code sessions aren't wired up yet (BUILD-PLAN phase 5): the desk is ready, nothing ran."] }));
    return { send: () => undefined, stop: () => undefined };
  },
};
