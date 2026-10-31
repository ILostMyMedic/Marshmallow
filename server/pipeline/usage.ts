// Claude's usage, as the scheduler sees it: a warning paces new issues for a while, a session turned away at the
// limit pauses everything until it resets. In memory only: a restart starts at full speed, and the next session tells
// the office again.
// Adapted from cubefarm server/swarm.ts (MIT): pauseForLimit, paceForWarning, tickUsage.
import type { UsageWarningView } from '../../shared/types.ts';
import { clock, mayStart, pacingMessage, PACING_MS, usageView, warningView, type UsageWarning, type WorkKind } from './pacing.ts';
import type { Store } from '../store.ts';

/** How long the office pauses when Claude turns a session away without saying when the limit resets. */
export const LIMIT_PAUSE_MS = 15 * 60_000;

export class Usage {
  private pausedUntil = 0;
  private pacingUntil = 0;
  private warning: UsageWarningView | null = null;

  constructor(
    private readonly store: Store,
    private readonly now: () => number = Date.now,
  ) {}

  /** Claude's limit is in force: nothing new starts, and failures now aren't anyone's fault. */
  paused(): boolean {
    return this.now() < this.pausedUntil;
  }

  /** May work of this kind start, with `running` sessions going? */
  mayStart(kind: WorkKind, running: number): boolean {
    return mayStart(kind, { now: this.now(), pausedUntil: this.pausedUntil, pacingUntil: this.pacingUntil, running, pacingSessions: this.store.getSettings().pacingSessions });
  }

  /** A session was turned away at the limit: pause until it resets (and half a minute more). */
  limited(resetsAt: number | null) {
    const now = this.now();
    const until = (resetsAt ?? now + LIMIT_PAUSE_MS) + 30_000;
    if (until <= this.pausedUntil) return;
    const fresh = now >= this.pausedUntil;
    this.pausedUntil = until;
    if (fresh) this.store.say(`⛔ Claude's usage limit is reached. Nothing new starts until ${clock(until, now)}; work in progress carries on.`);
    this.publish();
  }

  /** Claude warned that usage is getting high: pace new issues until the window resets (or an hour). */
  warned(info: UsageWarning) {
    const now = this.now();
    this.warning = warningView(info, now);
    const until = info.resetsAt && info.resetsAt > now ? info.resetsAt : now + PACING_MS;
    if (until > this.pacingUntil) {
      const fresh = now >= this.pacingUntil;
      this.pacingUntil = until;
      if (fresh) this.store.say(pacingMessage(info, until, this.store.getSettings().pacingSessions, now));
    }
    this.publish();
  }

  /** The scheduler's tick: pacing that ran out ends, with a word to the manager. */
  tick() {
    if (this.pacingUntil && this.now() >= this.pacingUntil) {
      this.pacingUntil = 0;
      this.store.say('🐇 Back to full speed: Claude\'s usage window has reset.');
    }
    this.publish();
  }

  private publish() {
    this.store.setUsage(usageView({ now: this.now(), pausedUntil: this.pausedUntil, pacingUntil: this.pacingUntil }, this.warning));
  }
}
