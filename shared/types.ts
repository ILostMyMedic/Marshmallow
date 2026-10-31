// The contract between the server and the browser: a snapshot on connect, then typed events.
// Phase 1 fills it in with floors, workers, the queue and QA records.

/** What a tab needs to draw everything, sent when it connects. */
export interface Snapshot {
  version: string;
  /** Running on the fakes: no GitHub, git, npm or Claude usage. */
  demo: boolean;
}

/** Everything the server sends over /ws. */
export type ServerEvent = { type: 'snapshot'; data: Snapshot };
