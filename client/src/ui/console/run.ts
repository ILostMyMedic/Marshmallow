// The console's commands: sent over REST, with the server's refusal shown at the top of the console. What a command
// changes comes back over /ws like everything else, so a success needs nothing more here.
import { useCallback, useState } from 'react';
import { create } from 'zustand';
import type { Worker } from '../../../../shared/types';
import { command } from '../../api';

type Method = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** The last refusal, for the console's problem line ('' when there's none). */
export const useProblem = create<{ text: string }>(() => ({ text: '' }));

export const clearProblem = () => useProblem.setState({ text: '' });

/** Sends a command; resolves to the server's answer, or to null after showing why it refused. */
export async function run<T = unknown>(method: Method, url: string, body?: unknown): Promise<T | null> {
  clearProblem();
  try {
    return (await command(method, url, body)) as T;
  } catch (err) {
    useProblem.setState({ text: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** The office gets a CEO, on `model` when one is given ('' = the office default). Null when it was refused. */
export async function hireCeo(model: string): Promise<Worker | null> {
  return run<Worker>('POST', '/api/ceo', { model: model.trim() });
}

/** True while `go`'s promise runs, for a button that says "Syncing…" and can't be pressed twice. */
export function useBusy(): [boolean, <T>(p: Promise<T>) => Promise<T>] {
  const [busy, setBusy] = useState(false);
  const go = useCallback(<T,>(p: Promise<T>) => {
    setBusy(true);
    return p.finally(() => setBusy(false));
  }, []);
  return [busy, go];
}
