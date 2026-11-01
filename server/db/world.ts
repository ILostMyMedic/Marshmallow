// The world events outside, chosen by the office for every tab at once, so two tabs see the same blimp at the same
// moment: the director (shared/worldEvents.ts) ticked on the server's clock at the pace a tab used to keep, with its
// schedule and a log of what ran in the office database, so neither a reload nor a restart starts it over. What's on
// goes in the snapshot, and every change to the tabs; each tab draws an event from its start time and seed. The
// office's date goes with it, so every tab shows the same season (shared/seasons.ts), and the director picks the
// night-only events (the northern lights, New Year's fireworks) only while it's night on the office clock.
import { nightFor } from '../../shared/dayClock.ts';
import { officeDay, parseSeasonSetting, seasonFor } from '../../shared/seasons.ts';
import { clashes, EVENTS, newDirector, parseEventId, roll, scheduleFirst, startRunning, stepDirector, stopRunning, type Director, type EventId, type EventSide, type Sky, type WorldRun, type WorldView } from '../../shared/worldEvents.ts';
import type { Store } from '../store.ts';
import type { Db } from './db.ts';

const SCHEDULE = 'office';
/** How often the director looks at the clock. */
export const WORLD_TICK_MS = 1000;
/** An event due this long before the office opened was missed while it was closed, not during a restart. */
const MISSED_S = 60;
/** How long the log keeps what ran. */
const LOG_DAYS = 30;
const LOG_RECENT = 20;
/** A night-only event starts only with at least this much of the night left (seconds). */
const NIGHT_LEFT_S = 90;

interface EventRow {
  id: number;
  event: string;
  side: string;
  seed: number;
  forced: boolean;
  started_at: Date;
  ends_at: Date;
}

/** One event in the log of what ran: `endsAt` is earlier than planned when it was cut short. */
export interface WorldLogEntry {
  key: number;
  id: string;
  side: EventSide;
  seed: number;
  forced: boolean;
  startedAt: number;
  endsAt: number;
}

const clock = (ms: number) => ms / 1000;
const sideOf = (s: string): EventSide => (s === 'west' ? 'west' : 'east');
const either = (r: number): EventSide => (r < 0.5 ? 'west' : 'east');
const seedOf = (r: number) => Math.floor(r * 2 ** 31);

export class World {
  private d: Director;
  private runs: WorldRun[] = [];
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private failing = false;
  private today: string;

  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly now: () => number = Date.now,
  ) {
    this.d = newDirector(0, clock(now())); // load() puts the saved one in its place
    this.today = officeDay(now());
  }

  get(): WorldView {
    return { running: this.runs, nextAt: Math.round(this.d.nextAt * 1000), today: this.today };
  }

  /** What may happen at `now`: whether it's night on the office clock, and the season the office shows. */
  sky(now = this.now()): Sky {
    const settings = this.store.getSettings();
    const look = seasonFor(parseSeasonSetting(settings.season), officeDay(now));
    return { night: nightFor(now, settings.dayMode, NIGHT_LEFT_S), season: look.season, holiday: look.holiday };
  }

  /** The saved schedule and what's still running (a new schedule the first time); the log loses what's a month old. */
  async load() {
    const now = this.now();
    await this.db.query('delete from world_events where started_at < $1', [new Date(now - LOG_DAYS * 86_400_000)]);
    const saved = (await this.db.query<{ state: number; next_at: Date }>('select state, next_at from world_schedule where key = $1', [SCHEDULE])).rows[0];
    if (saved) {
      this.d = { clock: clock(now), nextAt: saved.next_at.getTime() / 1000, running: [], state: saved.state >>> 0 };
      // the office was closed when its next event was due: the first comes a minute or two after it opens again
      if (this.d.nextAt < clock(now) - MISSED_S) scheduleFirst(this.d);
    } else this.d = newDirector(Math.floor(Math.random() * 2 ** 32), clock(now));
    this.runs = [];
    for (const r of (await this.db.query<EventRow>('select * from world_events where ends_at > $1 order by started_at', [new Date(now)])).rows) {
      const id = parseEventId(r.event);
      if (!id) continue;
      const startedAt = r.started_at.getTime();
      this.runs.push({ key: r.id, id, side: sideOf(r.side), seed: r.seed, startedAt, seconds: (r.ends_at.getTime() - startedAt) / 1000, forced: r.forced });
      startRunning(this.d, r.id, id, (r.ends_at.getTime() - now) / 1000);
    }
    await this.saveSchedule();
  }

  /** Ticks every `ms` until stop(). A tick that fails says so once, until one works again. */
  start(ms = WORLD_TICK_MS) {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(
      () =>
        void this.tick().then(
          () => (this.failing = false),
          (err: Error) => {
            if (!this.failing) console.warn(`  the world events couldn't move on: ${err.message}`);
            this.failing = true;
          },
        ),
      ms,
    );
    this.timer.unref();
  }

  /** Stops ticking, once what's under way has finished (before the database closes). */
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.queue;
  }

  /** Moves the director to now: what's over ends, and when the next event is due, it starts. */
  tick(): Promise<void> {
    return this.serial(async () => {
      const now = this.now();
      const before = { nextAt: this.d.nextAt, state: this.d.state };
      const over = this.runs.filter((r) => r.startedAt + r.seconds * 1000 <= now);
      if (over.length) this.runs = this.runs.filter((r) => !over.includes(r));
      const id = stepDirector(this.d, Math.max(0, clock(now) - this.d.clock), this.sky(now));
      if (id) await this.begin(id, either(roll(this.d)), seedOf(roll(this.d)), false, now);
      const moved = this.d.nextAt !== before.nextAt || this.d.state !== before.state;
      if (moved) await this.saveSchedule();
      // past midnight: a new day, maybe a new season
      const day = officeDay(now);
      const dawned = day !== this.today;
      this.today = day;
      if (over.length || moved || dawned) this.publish();
    });
  }

  /** Starts `id` now for every tab, on `side` (or either): ?event= and __mmEvents.trigger, through worldRoutes.ts. */
  trigger(id: EventId, side?: EventSide): Promise<WorldRun> {
    return this.serial(async () => {
      const run = await this.begin(id, side ?? either(Math.random()), seedOf(Math.random()), true, this.now());
      this.publish();
      return run;
    });
  }

  /** Ends the running event `id`, or every one. */
  end(id?: EventId): Promise<void> {
    return this.serial(async () => {
      const now = this.now();
      const gone = this.runs.filter((r) => !id || r.id === id);
      for (const r of gone) await this.cut(r.key, now);
      if (gone.length) this.publish();
    });
  }

  /** Has the director pick the next event `seconds` from now (QA: watch it choose). */
  soon(seconds: number): Promise<void> {
    return this.serial(async () => {
      this.d.nextAt = clock(this.now()) + Math.max(0, seconds);
      await this.saveSchedule();
      this.publish();
    });
  }

  /** What ran lately, newest first. */
  async log(limit = LOG_RECENT): Promise<WorldLogEntry[]> {
    const rows = (await this.db.query<EventRow>('select * from world_events order by id desc limit $1', [limit])).rows;
    return rows.map((r) => ({ key: r.id, id: r.event, side: sideOf(r.side), seed: r.seed, forced: r.forced, startedAt: r.started_at.getTime(), endsAt: r.ends_at.getTime() }));
  }

  // A big event ends any other big one, so two never overlap, and a street event any other street one, so two never
  // meet down there; the same event starts over.
  private async begin(id: EventId, side: EventSide, seed: number, forced: boolean, now: number): Promise<WorldRun> {
    for (const r of this.runs.filter((x) => clashes(id, x.id))) await this.cut(r.key, now);
    const seconds = EVENTS[id].seconds;
    const row = (
      await this.db.query<{ id: number }>('insert into world_events (event, side, seed, forced, started_at, ends_at) values ($1, $2, $3, $4, $5, $6) returning id', [id, side, seed, forced, new Date(now), new Date(now + seconds * 1000)])
    ).rows[0];
    const run: WorldRun = { key: row.id, id, side, seed, startedAt: now, seconds, forced };
    this.runs = [...this.runs, run];
    this.d.clock = Math.max(this.d.clock, clock(now));
    startRunning(this.d, run.key, id, seconds);
    return run;
  }

  private async cut(key: number, now: number) {
    await this.db.query('update world_events set ends_at = $2 where id = $1 and ends_at > $2', [key, new Date(now)]);
    this.runs = this.runs.filter((r) => r.key !== key);
    stopRunning(this.d, key);
  }

  private saveSchedule() {
    return this.db.query(
      'insert into world_schedule (key, state, next_at, updated_at) values ($1, $2, $3, now()) on conflict (key) do update set state = excluded.state, next_at = excluded.next_at, updated_at = now()',
      [SCHEDULE, this.d.state | 0, new Date(Math.round(this.d.nextAt * 1000))],
    );
  }

  private publish() {
    this.store.publish({ type: 'world', world: this.get() });
  }

  /** One change at a time: the ticks and the QA routes. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
