// The real backend: GitHub through the manager's gh login, floors' checkouts and workers' machines as folders on this
// computer or Upstash Boxes, and each worker's session the real Claude Code CLI in their terminal (on Claude, or a local
// Ollama model).
// Adapted from cubefarm server/backend.ts (MIT).
import { run } from '../exec.ts';
import { realGithub } from '../github/github.ts';
import { upstashBoxes } from '../machines/box/box.ts';
import { localMachines } from '../machines/local.ts';
import { ensureClone, mainDir } from '../machines/workspace.ts';
import { realPreviews } from '../previewRunner.ts';
import { detachBoxClis, officeProcesses, reconnectBoxClis, startBoxSignIn, startCliSession } from '../sessions/cliRunner.ts';
import type { Backend, CloudBackend } from './backend.ts';

/** The real cloud: Upstash, the manager's gh and git. */
export const realCloud: CloudBackend = {
  boxes: upstashBoxes,
  env: () => process.env,
  ghToken: () => run('gh', ['auth', 'token'], { timeoutMs: 15_000 }).then((t) => t.trim()),
  gitIdentity: async (login) => {
    const get = (key: string) => run('git', ['config', '--global', key], { timeoutMs: 10_000 }).then((v) => v.trim(), () => '');
    const [name, email] = await Promise.all([get('user.name'), get('user.email')]);
    return { name: name || login || 'Marshmallow', email: email || (login ? `${login}@users.noreply.github.com` : '') };
  },
  reconnect: reconnectBoxClis,
  detach: detachBoxClis,
  signIn: startBoxSignIn,
};

export const realBackend: Backend = {
  demo: false,
  github: realGithub,
  ensureClone,
  mainDir,
  // Releasing a desk never stops the office's own CLIs, even a worker's CLI waiting at its prompt.
  machines: localMachines(officeProcesses),
  startSession: startCliSession,
  cloud: realCloud,
  previews: realPreviews(officeProcesses),
};
