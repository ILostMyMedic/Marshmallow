// The awards (shared/awards.ts), won and paid: the counts behind them from the database and the office, looked at again
// whenever one may have moved (a merge recorded, coins paid for a PR, a hire, a purchase, the desk, a sync); each tier
// reached is kept as a trophy once, announced, and paid through the ledger: a floor's to that floor, the company's to
// every floor. A merge milestone pays only when the merge that reached it was the office's own, so the trophies a floor
// brings in with its old history are kept but not paid; the streaks and the night shift count only the office's merges.
// New: cubefarm's achievements pay nothing.
import { awardText, EMPTY_AWARD_STATS, reachedAwards, type AwardStat, type AwardStats, type Reached } from '../../shared/awards.ts';
import { spotOf } from '../../shared/shop.ts';
import type { Trophy } from '../../shared/types.ts';
import type { Ledger } from '../ledger.ts';
import type { Store } from '../store.ts';
import type { Db } from './db.ts';
import type { Desk } from './desk.ts';
import type { FloorPlans } from './floorPlans.ts';
import type { Records } from './records.ts';

const HOUR = 60 * 60_000;

/** Hat tricks in a floor's merges: three within an hour, no merge counted in two. */
export function hatTricks(times: readonly number[], windowMs = HOUR): number {
  let count = 0;
  let run: number[] = [];
  for (const t of [...times].sort((a, b) => a - b)) {
    run = run.filter((x) => t - x <= windowMs);
    run.push(t);
    if (run.length >= 3) {
      count++;
      run = [];
    }
  }
  return count;
}

/** The most merges on one day of the office's calendar (its local time). */
export function busiestDay(times: readonly number[]): number {
  const days = new Map<string, number>();
  for (const t of times) {
    const d = new Date(t).toDateString();
    days.set(d, (days.get(d) ?? 0) + 1);
  }
  return Math.max(0, ...days.values());
}

/** Merges between 22:00 and 05:00, the office's local time. */
export const nightMerges = (times: readonly number[]) =>
  times.filter((t) => {
    const h = new Date(t).getHours();
    return h >= 22 || h < 5;
  }).length;

/** Leaves out the counts at 0, so the snapshot stays small. */
function counted(counts: Partial<Record<AwardStat, number>>): Partial<Record<AwardStat, number>> {
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n)) as Partial<Record<AwardStat, number>>;
}

export class Awards {
  private stats: AwardStats = EMPTY_AWARD_STATS;
  private writing: Promise<unknown> = Promise.resolve();
  private waiting: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly ledger: Ledger,
    private readonly plans: FloorPlans,
    private readonly desk: Desk,
    private readonly records: Records,
  ) {}

  /** The counts behind the awards, as the tabs last heard them. */
  get(): AwardStats {
    return this.stats;
  }

  /**
   * Looks again: what an award counts may have moved. One look at a time; calls while one waits to start share it.
   * Never await it inside the ledger's serial (it pays through it).
   */
  poke(): Promise<void> {
    if (this.waiting) return this.waiting;
    const next = this.writing.then(async () => {
      this.waiting = null;
      await this.check();
    });
    this.waiting = next;
    this.writing = next.catch(() => undefined);
    return next;
  }

  /** Runs `fn` between looks, none running while it does (the demo's reset). */
  between<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writing.then(fn);
    this.writing = next.catch(() => undefined);
    return next;
  }

  /** Once the looks queued so far are done (before the database closes). */
  idle(): Promise<void> {
    return this.writing.then(() => undefined);
  }

  private async check() {
    const stats = await this.count();
    if (JSON.stringify(stats) !== JSON.stringify(this.stats)) {
      this.stats = stats;
      this.store.publish({ type: 'awards', awards: stats });
    }
    const held = new Set((await this.db.query<{ id: string }>('select id from trophies')).rows.map((r) => r.id));
    const won: { reached: Reached; trophy: Trophy }[] = [];
    for (const reached of reachedAwards(stats)) {
      if (held.has(reached.id)) continue;
      const { at, paid } = await this.reaching(reached);
      const name = reached.floorId ? this.floorName(reached.floorId) : '';
      const trophy: Trophy = {
        id: reached.id,
        floorId: reached.floorId,
        icon: reached.tier.icon,
        title: awardText(reached.tier.title, name),
        detail: awardText(reached.tier.detail, name),
        earnedAt: at,
        reward: paid ? reached.tier.reward : 0,
      };
      const r = await this.db.query(
        'insert into trophies (id, floor_id, icon, title, detail, earned_at, reward) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing returning id',
        [trophy.id, trophy.floorId, trophy.icon, trophy.title, trophy.detail, new Date(trophy.earnedAt), trophy.reward],
      );
      if (r.rows.length) won.push({ reached, trophy });
    }
    if (!won.length) return;
    await this.records.refresh();
    // Found in old history: kept quietly, as before. Won now: news, and its coins.
    for (const { reached, trophy } of won) {
      if (!trophy.reward) continue;
      this.store.moment({ type: 'trophy', at: Date.now(), trophy });
      const floors = reached.floorId ? [reached.floorId] : this.store.floorList().map((f) => f.id);
      for (const floorId of floors) {
        if (!this.store.hasFloor(floorId)) continue;
        await this.ledger.earn(floorId, reached.floorId ? `award:${trophy.id}` : `award:${trophy.id}:${floorId}`, trophy.reward, 'award', trophy.title);
      }
    }
  }

  /** When a tier was reached, and whether it pays: a merge milestone by the merge that reached it, the rest now. */
  private async reaching(r: Reached): Promise<{ at: number; paid: boolean }> {
    if (r.family.stat !== 'merges') return { at: Date.now(), paid: true };
    const rows = r.floorId
      ? await this.db.query<{ merged_at: Date; by_office: boolean }>('select merged_at, by_office from shipped where floor_id = $1 order by merged_at asc, pr_number asc offset $2 limit 1', [
          r.floorId,
          r.tier.target - 1,
        ])
      : await this.db.query<{ merged_at: Date; by_office: boolean }>('select merged_at, by_office from shipped order by merged_at asc, floor_id asc, pr_number asc offset $1 limit 1', [r.tier.target - 1]);
    const row = rows.rows[0];
    return { at: row?.merged_at.getTime() ?? Date.now(), paid: row?.by_office ?? false };
  }

  /** Every count, the company's and each connected floor's. */
  private async count(): Promise<AwardStats> {
    const floors = this.store.floorList();
    const merges = new Map((await this.db.query<{ floor_id: string; n: number }>('select floor_id, count(*)::int as n from shipped group by floor_id')).rows.map((r) => [r.floor_id, r.n]));
    const own = (await this.db.query<{ floor_id: string; merged_at: Date }>('select floor_id, merged_at from shipped where by_office')).rows;
    const lines = (
      await this.db.query<{ floor_id: string; reason: string; n: number }>(
        "select floor_id, reason, count(*)::int as n from coin_entries where reason in ('clean-qa', 'fixed', 'purchase') group by floor_id, reason",
      )
    ).rows;
    const line = (floorId: string, reason: string) => lines.find((l) => l.floor_id === floorId && l.reason === reason)?.n ?? 0;
    const desk = this.desk.get();
    const ownTimes = own.map((r) => r.merged_at.getTime());
    const company = counted({
      merges: [...merges.values()].reduce((sum, n) => sum + n, 0),
      busyDay: busiestDay(ownTimes),
      nightOwl: nightMerges(ownTimes),
      floors: floors.length,
      projects: desk.proposals.filter((p) => p.status === 'started').length,
      discussions: desk.discussions.filter((d) => d.status === 'resolved').length,
    });
    const workers = this.store.workerList();
    const perFloor: AwardStats['floors'] = {};
    for (const f of floors) {
      const plan = this.plans.of(f.id);
      perFloor[f.id] = counted({
        merges: merges.get(f.id) ?? 0,
        cleanQa: line(f.id, 'clean-qa'),
        fixed: line(f.id, 'fixed'),
        purchases: line(f.id, 'purchase'),
        hatTrick: hatTricks(own.filter((r) => r.floor_id === f.id).map((r) => r.merged_at.getTime())),
        team: workers.filter((w) => w.floorId === f.id && w.role === 'worker').length,
        furnished: plan.filter((i) => spotOf(i.spot)?.kind !== 'kit').length,
        upgrades: plan.filter((i) => spotOf(i.spot)?.kind === 'kit' && i.tier > 1).length,
      });
    }
    return { company, floors: perFloor };
  }

  private floorName(floorId: string): string {
    return this.store.hasFloor(floorId) ? this.store.floor(floorId).fullName.split('/').pop()! : floorId;
  }
}
