// What the office has shipped and won, kept in its database: every merged PR, from the pipeline's merges as they happen
// (who built and tested it known then; marked as the office's own) and from each floor's sync (so merges made outside
// the office count too), and the trophies the awards (awards.ts) won. The latest stay in memory for the tabs' snapshot,
// and tabs get each change; after each write the awards look again.
import { EMPTY_RECORDS, type RecordsView, type ShippedWork, type Trophy } from '../../shared/types.ts';
import type { Store } from '../store.ts';
import type { Db } from './db.ts';
import { builderFromBranch } from './trophies.ts';

/** Merges the snapshot carries, newest first. */
export const RECENT = 30;

interface ShippedRow {
  floor_id: string;
  pr_number: number;
  title: string;
  url: string;
  built_by: string | null;
  tested_by: string | null;
  merged_at: Date;
}

export interface TrophyRow {
  id: string;
  floor_id: string | null;
  icon: string;
  title: string;
  detail: string;
  earned_at: Date;
  reward: number;
}

const shippedOf = (r: ShippedRow): ShippedWork => ({ floorId: r.floor_id, prNumber: r.pr_number, title: r.title, url: r.url, builtBy: r.built_by, testedBy: r.tested_by, mergedAt: r.merged_at.getTime() });
export const trophyOf = (r: TrophyRow): Trophy => ({ id: r.id, floorId: r.floor_id, icon: r.icon, title: r.title, detail: r.detail, earnedAt: r.earned_at.getTime(), reward: r.reward });
const keyOf = (floorId: string, prNumber: number) => `${floorId}#${prNumber}`;

export class Records {
  private view: RecordsView = EMPTY_RECORDS;
  private known = new Set<string>(); // every PR recorded, so a sync only writes the new ones
  private writing: Promise<unknown> = Promise.resolve();
  /** After each write: the awards look at what's changed (office.ts sets it). */
  onRecorded: () => void = () => {};

  constructor(
    private readonly db: Db,
    private readonly store: Store,
  ) {}

  get(): RecordsView {
    return this.view;
  }

  async load() {
    const rows = await this.db.query<{ floor_id: string; pr_number: number }>('select floor_id, pr_number from shipped');
    this.known = new Set(rows.rows.map((r) => keyOf(r.floor_id, r.pr_number)));
    this.view = await this.read();
  }

  /** A merge the office made (the pipeline's moment): it's recorded as the office's own, with who built and tested it. */
  merged(floorId: string, prNumber: number, devWorkerId: string | null, qaWorkerId: string | null = null): Promise<void> {
    if (!this.store.hasFloor(floorId)) return Promise.resolve();
    const floor = this.store.floor(floorId);
    const pr = floor.pulls.find((p) => p.number === prNumber);
    const qa = this.store.findQa(floorId, prNumber);
    const work: ShippedWork = {
      floorId,
      prNumber,
      title: pr?.title ?? `PR #${prNumber}`,
      url: pr?.url ?? `${floor.url}/pull/${prNumber}`,
      builtBy: this.nameOf(devWorkerId ?? qa?.devWorkerId ?? null) ?? builderFromBranch(pr?.headRefName),
      testedBy: this.nameOf(qaWorkerId ?? qa?.qaWorkerId ?? null),
      mergedAt: Date.now(),
    };
    return this.queue([work], true);
  }

  /** A floor synced: its merged PRs not recorded yet go in quietly. */
  synced(floorId: string): Promise<void> {
    if (!this.store.hasFloor(floorId)) return Promise.resolve();
    const floor = this.store.floor(floorId);
    const works = floor.pulls
      .filter((p) => p.state === 'MERGED' && !this.known.has(keyOf(floorId, p.number)))
      .map((p): ShippedWork => ({ floorId, prNumber: p.number, title: p.title, url: p.url, builtBy: builderFromBranch(p.headRefName), testedBy: null, mergedAt: p.mergedAt ? Date.parse(p.mergedAt) : Date.now() }));
    return works.length ? this.queue(works, false) : Promise.resolve();
  }

  // One write at a time: a merge's moment and the next sync can arrive together.
  private queue(works: ShippedWork[], byOffice: boolean): Promise<void> {
    const next = this.writing.then(() => this.record(works, byOffice));
    this.writing = next.catch(() => undefined);
    return next;
  }

  private async record(works: ShippedWork[], byOffice: boolean) {
    await this.db.transaction(async (tx) => {
      for (const w of works) {
        // A row the sync found first keeps its GitHub time and gains who built and tested it from the office's merge.
        await tx.query(
          `insert into shipped (floor_id, pr_number, title, url, built_by, tested_by, merged_at, by_office) values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (floor_id, pr_number) do update set title = excluded.title, url = excluded.url,
             built_by = coalesce(shipped.built_by, excluded.built_by), tested_by = coalesce(shipped.tested_by, excluded.tested_by),
             by_office = shipped.by_office or excluded.by_office`,
          [w.floorId, w.prNumber, w.title, w.url, w.builtBy, w.testedBy, new Date(w.mergedAt), byOffice],
        );
      }
    });
    for (const w of works) this.known.add(keyOf(w.floorId, w.prNumber));
    await this.refresh();
    this.onRecorded();
  }

  /** The demo's reset: everything shipped and won goes (the reseeded fake GitHub hands out the same PR numbers again). */
  clear(): Promise<void> {
    const next = this.writing.then(async () => {
      await this.db.transaction(async (tx) => {
        await tx.query('delete from shipped');
        await tx.query('delete from trophies');
      });
      this.known.clear();
      await this.refresh();
    });
    this.writing = next.catch(() => undefined);
    return next;
  }

  /** Once the writes queued so far are done (before the database closes). */
  idle(): Promise<void> {
    return this.writing.then(() => undefined);
  }

  /** Reads the view again (after a write here, or a trophy won) and sends it to the tabs. */
  async refresh() {
    this.view = await this.read();
    this.store.publish({ type: 'records', records: this.view });
  }

  private async read(): Promise<RecordsView> {
    const recent = (await this.db.query<ShippedRow>('select * from shipped order by merged_at desc limit $1', [RECENT])).rows.map(shippedOf);
    const counts = (await this.db.query<{ floor_id: string; n: number }>('select floor_id, count(*)::int as n from shipped group by floor_id')).rows;
    const trophies = (await this.db.query<TrophyRow>('select * from trophies order by earned_at asc, id asc')).rows.map(trophyOf);
    return { recent, totals: Object.fromEntries(counts.map((c) => [c.floor_id, c.n])), total: counts.reduce((sum, c) => sum + c.n, 0), trophies };
  }

  private nameOf(workerId: string | null): string | null {
    return workerId && this.store.hasWorker(workerId) ? this.store.worker(workerId).name : null;
  }
}
