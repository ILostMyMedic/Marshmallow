// The notification sounds' decisions, pure (no WebAudio, so they're tested): which cue each piece of news gets (a merge,
// a PR opened, QA's verdict, a worker in trouble, a question, a message on the desktop…), which one wins when several
// arrive together, and how often one may play. notifySfx.ts plays them; Toasts.tsx spots the news. New in Marshmallow,
// after cubefarm's event cues (client/src/ui/sfx.ts `cue`).

import type { Moment, OfficeMessage } from '../../../shared/types';

export type Cue = 'trouble' | 'question' | 'merged' | 'message' | 'failed' | 'notice' | 'passed' | 'opened' | 'joined' | 'issues';

/** How much each cue matters: when news arrives together, the highest plays. */
export const RANK: Record<Cue, number> = { trouble: 7, question: 6, merged: 5, message: 4, failed: 3, notice: 2, passed: 2, opened: 1, joined: 1, issues: 0 };

/** Cues arriving within this long (ms) of each other are one moment: the most important of them plays. */
export const GATHER_MS = 150;
/** After a cue, only a more important one plays within this long (ms). */
export const GAP_MS = 900;

/** The cue for one of the server's moments. */
export function momentCue(type: Moment['type']): Cue {
  switch (type) {
    case 'merged':
      return 'merged';
    case 'prOpened':
      return 'opened';
    case 'qaPassed':
      return 'passed';
    case 'qaFailed':
      return 'failed';
    case 'issuesFiled':
      return 'issues';
    case 'hired':
      return 'joined';
    case 'left':
      return 'notice';
    case 'trophy':
      return 'merged';
  }
}

/** The cue for a new message: the CEO's reply, the office's notice, or none for your own. */
export const messageCue = (from: OfficeMessage['from']): Cue | null => (from === 'ceo' ? 'message' : from === 'office' ? 'notice' : null);

/** The more important of two cues (the first on a tie). */
export const better = (a: Cue | null, b: Cue): Cue => (a && RANK[a] >= RANK[b] ? a : b);

/** Whether a cue of `rank` may play `sinceLast` ms after one of `lastRank`: once the gap is over, or when it matters more. */
export const mayCue = (sinceLast: number, lastRank: number, rank: number) => sinceLast >= GAP_MS || rank > lastRank;
