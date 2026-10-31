// The manager's secrets file (<home>/secrets.json, demo-secrets.json in a demo): the Upstash Box API key and the keys
// and tokens Box workers use. Never in the state, the snapshot, events, logs or workers' environments. Writes merge
// into what's there and run one after another, written to a temp file and renamed.
// Adapted from cubefarm server/secrets.ts (MIT).
import fs from 'node:fs/promises';
import path from 'node:path';

const queues = new Map<string, Promise<unknown>>();

export async function readSecrets(file: string): Promise<Record<string, unknown>> {
  try {
    const s = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
    return s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Merge `patch` into the file (other secrets stay; undefined removes a key), owner-only where the OS has file modes. */
export function mergeSecrets(file: string, patch: Record<string, unknown>): Promise<void> {
  const write = (queues.get(file) ?? Promise.resolve()).then(async () => {
    const next: Record<string, unknown> = { ...(await readSecrets(file)), ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await fs.rename(tmp, file);
    await fs.chmod(file, 0o600).catch(() => undefined);
  });
  queues.set(
    file,
    write.catch(() => undefined),
  );
  return write;
}
