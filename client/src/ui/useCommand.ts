// A command from a panel: busy while it runs (to disable its buttons), and the server's refusal to show. What the
// command changes comes back over /ws, so nothing else needs handling.
import { useState } from 'react';

export function useCommand() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Runs `fn`; true when the server accepted it. */
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}
