// Each floor's coins, kept in the office database. A floor earns from its merges, each paid once, from what the office
// already sees: the pipeline's moments (a PR opened, QA's verdicts, a merge) and the floor's syncs (PRs open on GitHub,
// merges made outside the office). Only PRs the office watched while they were open pay when they merge, so a floor's
// old history never does, though a merge the office made itself always pays its base. Nothing is paid when QA fails or
// a fix starts. The shop (shop.ts) spends the coins. One write at a time; tabs get the whole view after each change.
// Adapted from cubefarm server/ledger.ts (MIT).
import { EMPTY_COINS, type CoinEntry, type CoinReason, type CoinsView, type FloorCoins, type Moment, type PullInfo } from '../shared/types.ts';
import type { Db, Tx } from './db/db.ts';
import type { Store } from './store.ts';

/** What a merge pays: the base, plus one bonus at most (a clean first QA pass, or a fix after a failed round). */
export const COINS = { merge: 10, cleanQa: 5, fixed: 3 } as const;
/** Ledger lines the snapshot carries, newest first. */
export const RECENT_COINS = 30;
/** A track this new isn't dropped for missing from a sync's lists: that sync may have started before the PR existed. */
export const LISTED_GRACE_MS = 10 * 60_000;

/** A PR the office watched while it was open. */
export interface CoinTrack {
  floorId: string;
  prNumber: number;
  /** Its first QA verdict: pass or fail in round 1, late when first tested after round 1; null before any. */
  first: 'pass' | 'fail' | 'late' | null;
  /** QA failed it at some point. */
  failed: boolean;
  seenAt: number;
}

/** What a floor can earn for: everything but spending and the demo's gifts. */
export type EarnReason = Exclude<CoinReason, 'purchase' | 'grant'>;

/** A line a payout writes, paid once per key. */
export interface Payment {
  key: string;
  amount: number;
  reason: EarnReason;
  detail: string;
}

/**
 * What a merge pays: nothing for a PR the office never watched open, unless it merged it itself (the base only); else
 * the base, and the clean bonus for a first verdict that passed in round 1, or the smaller fix bonus once QA failed it.
 * A failed round turns the clean bonus into the fix one, so failing never earns more.
 */
export function payout(floorId: string, prNumber: number, track: Pick<CoinTrack, 'first' | 'failed'> | null, officeMerge: boolean): Payment[] {
  if (!track && !officeMerge) return [];
  const pr = `${floorId}#${prNumber}`;
  const out: Payment[] = [{ key: `merge:${pr}`, amount: COINS.merge, reason: 'merge', detail: `PR #${prNumber} merged` }];
  if (track?.failed) out.push({ key: `fixed:${pr}`, amount: COINS.fixed, reason: 'fixed', detail: 'fixed after failing QA' });
  else if (track?.first === 'pass') out.push({ key: `clean-qa:${pr}`, amount: COINS.cleanQa, reason: 'clean-qa', detail: 'clean QA pass' });
  return out;
}

/** A track after a QA verdict in `round`: the first verdict seen sets `first`, and a fail sets `failed`. */
export function afterVerdict(track: Pick<CoinTrack, 'first' | 'failed'> | null, pass: boolean, round: number): Pick<CoinTrack, 'first' | 'failed'> {
  const first = track?.first ?? (round === 1 ? (pass ? 'pass' : 'fail') : 'late');
  return { first, failed: (track?.failed ?? false) || !pass };
}

/**
 * What a floor's sync means for its tracks: open PRs not tracked yet get one (anyone's, not just the office's), tracked
 * ones that merged pay, and tracked ones closed unmerged, or missing from the lists (open and recently merged) past the
 * grace period, go.
 */
export function reconcile(tracks: readonly CoinTrack[], pulls: readonly PullInfo[], now: number): { open: number[]; merged: CoinTrack[]; dropped: number[] } {
  const tracked = new Set(tracks.map((t) => t.prNumber));
  const state = new Map(pulls.map((p) => [p.number, p.state]));
  return {
    open: pulls.filter((p) => p.state === 'OPEN' && !tracked.has(p.number)).map((p) => p.number),
    merged: tracks.filter((t) => state.get(t.prNumber) === 'MERGED'),
    dropped: tracks.filter((t) => state.get(t.prNumber) === 'CLOSED' || (!state.has(t.prNumber) && t.seenAt <= now - LISTED_GRACE_MS)).map((t) => t.prNumber),
  };
}

interface EntryRow {
  id: number;
  floor_id: string;
  amount: number;
  reason: CoinReason;
  detail: string;
  pr_number: number | null;
  at: Date;
}

interface TrackRow {
  floor_id: string;
  pr_number: number;
  first: CoinTrack['first'];
  failed: boolean;
  seen_at: Date;
}

const entryOf = (r: EntryRow): CoinEntry => ({ id: r.id, floorId: r.floor_id, amount: r.amount, reason: r.reason, detail: r.detail, prNumber: r.pr_number, at: r.at.getTime() });
const trackOf = (r: TrackRow): CoinTrack => ({ floorId: r.floor_id, prNumber: r.pr_number, first: r.first, failed: r.failed, seenAt: r.seen_at.getTime() });
const prKey = (floorId: string, prNumber: number) => `${floorId}#${prNumber}`;
const NONE: FloorCoins = { coins: 0, earned: 0 };

export class Ledger {
  private view: CoinsView = EMPTY_COINS;
  private tracks = new Map<string, CoinTrack>(); // by floor#pr, as in coin_tracks
  private writing: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly store: Store,
  ) {}

  /** Every floor's purse (connected floors with nothing yet at 0) and the latest lines. */
  get(): CoinsView {
    const floors = { ...this.view.floors };
    for (const f of this.store.floorList()) floors[f.id] ??= NONE;
    return { floors, recent: this.view.recent };
  }

  balance(floorId: string): FloorCoins {
    return this.view.floors[floorId] ?? NONE;
  }

  /** The PR's track, if the office is watching it. */
  track(floorId: string, prNumber: number): CoinTrack | null {
    return this.tracks.get(prKey(floorId, prNumber)) ?? null;
  }

  async load() {
    const rows = (await this.db.query<TrackRow>('select * from coin_tracks')).rows;
    this.tracks = new Map(rows.map((r) => [prKey(r.floor_id, r.pr_number), trackOf(r)]));
    this.view = await this.read();
  }

  /** Runs `fn` after every write before it and before any after it: payouts, grants and the shop's purchases. */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writing.then(fn);
    this.writing = next.catch(() => undefined);
    return next;
  }

  /** The pipeline's moments: a PR opened is watched, QA's verdicts noted on its track, a merge the office made paid. */
  moment(m: Moment): Promise<void> {
    switch (m.type) {
      case 'prOpened':
        return this.serial(() => this.watch(m.floorId, [m.prNumber]));
      case 'qaPassed':
      case 'qaFailed':
        return this.serial(() => this.verdict(m.floorId, m.prNumber, m.type === 'qaPassed', m.round));
      case 'merged':
        return this.serial(() => this.pay(m.floorId, m.prNumber, true, m.devWorkerId));
      default:
        return Promise.resolve();
    }
  }

  /** A floor synced: its open PRs are watched, tracked merges paid (who built them, if the office knows), gone ones dropped. */
  synced(floorId: string): Promise<void> {
    if (!this.store.hasFloor(floorId)) return Promise.resolve();
    // What this sync saw, and who built its merges, as of now: by this write's turn the office may have merged one of its
    // open PRs (the merge's moment pays that, with its builder) or cleared the QA record of one it saw merged.
    const pulls = this.store.floor(floorId).pulls;
    const builders = new Map(pulls.flatMap((p) => (p.state === 'MERGED' ? [[p.number, this.builderOf(floorId, p.number)] as const] : [])));
    return this.serial(async () => {
      if (!this.store.hasFloor(floorId)) return;
      const tracks = [...this.tracks.values()].filter((t) => t.floorId === floorId);
      const r = reconcile(tracks, pulls, Date.now());
      const mergedSince = new Set(this.store.floor(floorId).pulls.filter((p) => p.state === 'MERGED').map((p) => p.number));
      const open = r.open.filter((n) => !mergedSince.has(n));
      if (open.length) await this.watch(floorId, open);
      for (const t of r.merged) await this.pay(floorId, t.prNumber, false, builders.get(t.prNumber) ?? null);
      if (r.dropped.length) await this.drop(floorId, r.dropped);
    });
  }

  /**
   * Pays a floor `amount` once for `key` (an award, say), announced as coins earned. False when that key was paid
   * before. `detail` is the line's text and the moment's reason, e.g. "First merge".
   */
  earn(floorId: string, key: string, amount: number, reason: EarnReason, detail: string, prNumber: number | null = null): Promise<boolean> {
    if (!key) throw new Error('An earning needs a key');
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`Earnings are a whole number of coins above 0, not ${amount}`);
    return this.serial(async () => (await this.credit(floorId, [{ key, amount, reason, detail }], prNumber, null)).length > 0);
  }

  /** The demo's gift of coins to spend: a floor's purse grows, what it has earned doesn't. */
  grant(floorId: string, amount: number): Promise<FloorCoins> {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`A grant is a whole number of coins above 0, not ${amount}`);
    return this.serial(async () => {
      await this.db.query('insert into coin_entries (floor_id, amount, reason, detail) values ($1, $2, $3, $4)', [floorId, amount, 'grant', 'A gift']);
      await this.refresh();
      return this.balance(floorId);
    });
  }

  /** A purchase's line, written in the shop's transaction (which checked the balance, inside serial). */
  async spend(tx: Tx, floorId: string, amount: number, detail: string) {
    await tx.query('insert into coin_entries (floor_id, amount, reason, detail) values ($1, $2, $3, $4)', [floorId, -amount, 'purchase', detail]);
  }

  /** Reads the view again after a write, and sends it to the tabs. */
  async refresh() {
    this.view = await this.read();
    this.store.publish({ type: 'coins', coins: this.get() });
  }

  /** The demo's reset: every coin and track goes (the reseeded fake GitHub hands out the same PR numbers again). */
  clear(): Promise<void> {
    return this.serial(async () => {
      await this.db.transaction(async (tx) => {
        await tx.query('delete from coin_entries');
        await tx.query('delete from coin_tracks');
      });
      this.tracks.clear();
      await this.refresh();
    });
  }

  // ---------- inside: each runs in serial ----------

  private async watch(floorId: string, numbers: number[]) {
    const fresh = numbers.filter((n) => !this.tracks.has(prKey(floorId, n)));
    if (!fresh.length) return;
    const now = Date.now();
    await this.db.transaction(async (tx) => {
      for (const n of fresh) await tx.query('insert into coin_tracks (floor_id, pr_number, seen_at) values ($1, $2, $3) on conflict do nothing', [floorId, n, new Date(now)]);
    });
    for (const n of fresh) this.tracks.set(prKey(floorId, n), { floorId, prNumber: n, first: null, failed: false, seenAt: now });
  }

  private async verdict(floorId: string, prNumber: number, pass: boolean, round: number) {
    const before = this.track(floorId, prNumber);
    const next: CoinTrack = { floorId, prNumber, seenAt: before?.seenAt ?? Date.now(), ...afterVerdict(before, pass, round) };
    if (before && before.first === next.first && before.failed === next.failed) return;
    await this.db.query(
      `insert into coin_tracks (floor_id, pr_number, first, failed, seen_at) values ($1, $2, $3, $4, $5)
       on conflict (floor_id, pr_number) do update set first = excluded.first, failed = excluded.failed`,
      [floorId, prNumber, next.first, next.failed, new Date(next.seenAt)],
    );
    this.tracks.set(prKey(floorId, prNumber), next);
  }

  /** Pays a merge (what the track earned, or the base for the office's own merge) and lets go of its track. */
  private async pay(floorId: string, prNumber: number, officeMerge: boolean, workerId: string | null) {
    const track = this.track(floorId, prNumber);
    await this.credit(floorId, payout(floorId, prNumber, track, officeMerge), prNumber, workerId, async (tx) => {
      if (track) await tx.query('delete from coin_tracks where floor_id = $1 and pr_number = $2', [floorId, prNumber]);
    });
    this.tracks.delete(prKey(floorId, prNumber));
  }

  private async drop(floorId: string, numbers: number[]) {
    await this.db.transaction(async (tx) => {
      for (const n of numbers) await tx.query('delete from coin_tracks where floor_id = $1 and pr_number = $2', [floorId, n]);
    });
    for (const n of numbers) this.tracks.delete(prKey(floorId, n));
  }

  /**
   * Writes the payments not paid before (with `also`, in the same transaction); then tabs get the view, and what was
   * paid is announced as one earned moment. Returns what was paid.
   */
  private async credit(floorId: string, payments: Payment[], prNumber: number | null, workerId: string | null, also?: (tx: Tx) => Promise<void>): Promise<Payment[]> {
    const paid: Payment[] = [];
    await this.db.transaction(async (tx) => {
      for (const p of payments) {
        const r = await tx.query<{ id: number }>(
          'insert into coin_entries (floor_id, key, amount, reason, detail, pr_number) values ($1, $2, $3, $4, $5, $6) on conflict (key) do nothing returning id',
          [floorId, p.key, p.amount, p.reason, p.detail, prNumber],
        );
        if (r.rows.length) paid.push(p);
      }
      await also?.(tx);
    });
    if (!paid.length) return paid;
    await this.refresh();
    const amount = paid.reduce((sum, p) => sum + p.amount, 0);
    this.store.moment({ type: 'earned', at: Date.now(), floorId, amount, reasons: paid.map((p) => p.detail), prNumber, workerId, ...(paid.some((p) => p.reason === 'award') ? { award: true } : {}) });
    return paid;
  }

  /** Who built a PR, as far as the office knows: its QA record's developer, or the worker on it. */
  private builderOf(floorId: string, prNumber: number): string | null {
    const qa = this.store.findQa(floorId, prNumber);
    if (qa?.devWorkerId) return qa.devWorkerId;
    return this.store.workerList().find((w) => w.floorId === floorId && w.task?.prNumber === prNumber && w.task.kind !== 'qa')?.id ?? null;
  }

  private async read(): Promise<CoinsView> {
    const sums = (
      await this.db.query<{ floor_id: string; coins: number; earned: number }>(
        `select floor_id, sum(amount)::int as coins, coalesce(sum(amount) filter (where amount > 0 and reason <> 'grant'), 0)::int as earned
         from coin_entries group by floor_id`,
      )
    ).rows;
    const recent = (await this.db.query<EntryRow>('select * from coin_entries order by at desc, id desc limit $1', [RECENT_COINS])).rows.map(entryOf);
    return { floors: Object.fromEntries(sums.map((s) => [s.floor_id, { coins: s.coins, earned: s.earned }])), recent };
  }
}
