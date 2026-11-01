// The sign-ins the office runs on, as the console's Settings tab shows them (GET /api/setup/status): who or whether,
// never a key or a token.

/** ok: signed in (or reachable); signed-out: there, but not signed in; missing: the program isn't installed; unknown: it couldn't tell. */
export type SignInState = 'ok' | 'signed-out' | 'missing' | 'unknown';

export interface SetupStatus {
  /** The GitHub account gh acts as, which the office and its workers act as on GitHub. */
  github: { state: SignInState; login: string | null };
  /** Claude Code on this computer, as workers run it (without the office's ANTHROPIC_ and CLAUDE_ variables). */
  claude: { state: SignInState; method: string | null; plan: string | null; account: string | null };
  /** The local model servers (shared/models.ts LOCAL_SERVERS): reachable or not, and their models. */
  localServers: { id: string; label: string; url: string; reachable: boolean; models: string[] }[];
  /** Cloud workers' Upstash Box API key: saved or not, and Upstash's last word on it. */
  upstash: { keySet: boolean; keyError: string | null };
  checkedAt: number;
}
