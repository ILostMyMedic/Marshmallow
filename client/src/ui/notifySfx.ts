// The notification sounds (notifyRules.ts picks which): a phone buzz and chime for a new message or notice, a ping for
// a worker's question, a happy chime for a merge, a soft blip for a PR opened or QA passed, a soft "womp" when QA
// fails, a low tone for a worker in trouble, a jingle for a new hire. Without a place: they're for you, wherever you
// are. News arriving together plays one cue, the most important. Toasts.tsx calls cue(). Adapted from cubefarm
// client/src/ui/sfx.ts (MIT): its event cues, chirp and welcome jingle; the buzz, the ping and the blips are new.

import { better, GATHER_MS, mayCue, RANK, type Cue } from './notifyRules';
import { noise, tone } from './sfx';

const A = { group: 'alerts' } as const;

/** The phone vibrating on the desk: two short low buzzes. */
function buzz(name: string, times = 2) {
  for (let i = 0; i < times; i++) {
    tone({ ...A, name, freq: 155, to: 150, type: 'square', at: i * 0.22, dur: 0.15, peak: 0.035, attack: 0.01 });
    noise({ ...A, name, at: i * 0.22, dur: 0.15, peak: 0.02, filter: 'bandpass', freq: 300, q: 2, attack: 0.01 });
  }
}

const PLAY: Record<Cue, () => void> = {
  // a worker's session failed: a low, soft two-tone call
  trouble: () => {
    for (const at of [0, 0.32]) tone({ ...A, name: 'cue:trouble', freq: 146.8, to: 138.6, type: 'triangle', at, dur: 0.26, peak: 0.12, attack: 0.02 });
    tone({ ...A, name: 'cue:trouble', freq: 110, type: 'sine', at: 0.64, dur: 0.5, peak: 0.08, attack: 0.03 });
  },
  // a worker has a question: a bright bell ping and a buzz
  question: () => {
    tone({ ...A, name: 'cue:question', freq: 1568, type: 'sine', dur: 0.9, peak: 0.1, attack: 0.005 });
    tone({ ...A, name: 'cue:question', freq: 2093, type: 'sine', at: 0.12, dur: 0.8, peak: 0.07, attack: 0.005 });
    buzz('cue:question', 1);
  },
  // a PR merged: a pop and a happy rising chime
  merged: () => {
    noise({ ...A, name: 'cue:merged', dur: 0.07, peak: 0.12, filter: 'bandpass', freq: 1400, q: 1.2, attack: 0.002 });
    [1046.5, 1318.5, 1568, 2093].forEach((freq, i) => tone({ ...A, name: 'cue:merged', freq, type: 'triangle', at: 0.06 + i * 0.09, dur: i === 3 ? 0.7 : 0.3, peak: 0.09, attack: 0.008 }));
    noise({ ...A, name: 'cue:merged', at: 0.12, dur: 0.6, peak: 0.025, filter: 'bandpass', freq: 2500, q: 0.6, attack: 0.08 });
  },
  // the CEO's reply on the phone: a buzz, then two quick rising blips
  message: () => {
    buzz('cue:message');
    [1046.5, 1568].forEach((freq, i) => tone({ ...A, name: 'cue:message', freq, type: 'triangle', at: 0.5 + i * 0.11, dur: 0.18, peak: 0.1 }));
  },
  // QA failed a PR: a gentle descending "womp"
  failed: () => {
    tone({ ...A, name: 'cue:failed', freq: 392, to: 370, type: 'triangle', dur: 0.26, peak: 0.1 });
    tone({ ...A, name: 'cue:failed', freq: 311, to: 196, type: 'triangle', at: 0.26, dur: 0.55, peak: 0.1 });
  },
  // the office's notice on the phone: a buzz and a soft "bloop"
  notice: () => {
    buzz('cue:notice', 1);
    tone({ ...A, name: 'cue:notice', freq: 660, to: 990, type: 'sine', at: 0.25, dur: 0.18, peak: 0.08, attack: 0.01 });
  },
  // a PR passed QA: a soft bright three-note blip
  passed: () => [880, 1108.7, 1318.5].forEach((freq, i) => tone({ ...A, name: 'cue:passed', freq, type: 'triangle', at: i * 0.07, dur: 0.2, peak: 0.07 })),
  // a PR opened: a soft two-note blip
  opened: () => [880, 1174.7].forEach((freq, i) => tone({ ...A, name: 'cue:opened', freq, type: 'sine', at: i * 0.09, dur: 0.18, peak: 0.07 })),
  // someone joined: a small welcome jingle
  joined: () => [659.3, 784, 1046.5].forEach((freq, i) => tone({ ...A, name: 'cue:joined', freq, type: 'sine', at: i * 0.12, dur: i === 2 ? 0.5 : 0.2, peak: 0.09 })),
  // new issues on the board: a paper flick and a tiny tick
  issues: () => {
    noise({ ...A, name: 'cue:issues', dur: 0.12, peak: 0.05, filter: 'bandpass', freq: 3000, to: 1800, q: 1.2, attack: 0.005 });
    tone({ ...A, name: 'cue:issues', freq: 1318.5, type: 'triangle', at: 0.08, dur: 0.12, peak: 0.05 });
  },
};

let pending: Cue | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastAt = -Infinity;
let lastRank = -1;

/** Play a notification, rate-limited: news arriving together plays its most important cue, once. */
export function cue(c: Cue) {
  if (!mayCue(performance.now() - lastAt, lastRank, RANK[c]) && !pending) return;
  pending = better(pending, c);
  if (!timer) timer = setTimeout(flush, GATHER_MS);
}

function flush() {
  timer = null;
  const c = pending;
  pending = null;
  if (!c) return;
  lastAt = performance.now();
  lastRank = RANK[c];
  PLAY[c]();
}
