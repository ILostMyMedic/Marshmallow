// The real backend: GitHub through the manager's gh login, floors' checkouts and workers' machines as folders on this
// computer, and each worker's session the real Claude Code CLI in their terminal (on Claude, or a local Ollama model).
// Adapted from cubefarm server/backend.ts (MIT).
import { realGithub } from '../github/github.ts';
import { localMachines } from '../machines/local.ts';
import { ensureClone, mainDir } from '../machines/workspace.ts';
import { officeProcesses, startCliSession } from '../sessions/cliRunner.ts';
import type { Backend } from './backend.ts';

export const realBackend: Backend = {
  demo: false,
  github: realGithub,
  ensureClone,
  mainDir,
  // Releasing a desk never stops the office's own CLIs, even a worker's CLI waiting at its prompt.
  machines: localMachines(officeProcesses),
  startSession: startCliSession,
};
