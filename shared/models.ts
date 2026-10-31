// Which model a worker's session asks for. A model named `<server>/<model>` runs on that model server on this computer
// (Ollama for now, more later); any other name is Claude's.
// Adapted from cubefarm shared/models.ts (MIT).

/** Claude models offered as suggestions in the model fields; any other name can still be typed. */
export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

/** Model servers on this computer. Claude Code reaches each through its Anthropic-compatible API at `url`. */
export const LOCAL_SERVERS = [{ id: 'ollama', label: 'Ollama', url: 'http://127.0.0.1:11434' }] as const;

export type LocalServer = (typeof LOCAL_SERVERS)[number];

/** A model on a local server: the server, and the server's own name for it (which may hold more slashes); else null. */
export function localModel(model: string): { server: LocalServer; model: string } | null {
  const m = model.trim().match(/^([a-z.]+)\/(.+)$/i);
  const server = LOCAL_SERVERS.find((s) => s.id === m?.[1].toLowerCase());
  return server && m ? { server, model: m[2] } : null;
}

/** The model a worker's session runs: their own, else the office default. */
export function effectiveModel(own: string, officeDefault: string): string {
  return own.trim() || officeDefault.trim();
}
