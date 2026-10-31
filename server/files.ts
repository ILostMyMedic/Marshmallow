// Writing state files safely: a temp file, then a rename, so a crash mid-write never leaves half a file.
import fs from 'node:fs/promises';
import path from 'node:path';

/** Windows briefly locks a file another program (an antivirus, the indexer) has just opened, so a rename gets retries. */
export async function replaceFile(from: string, to: string, tries = 5): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      return await fs.rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= tries || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw err;
      await new Promise((r) => setTimeout(r, 50 * i));
    }
  }
}

/** Writes `value` as JSON to `file` through a temp file, making its folder if needed. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await replaceFile(tmp, file);
}
