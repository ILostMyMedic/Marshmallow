// What the office has shipped and won, kept in its database: every merged PR, from the pipeline's merges as they happen
// (who built and tested it known then) and from each floor's sync (so merges made outside the office count too), and
// the milestones they reach (trophies.ts). The latest stay in memory for the tabs' snapshot; tabs get each change, and
// a trophy won by a merge just made is announced (one found in old history isn't news).
import { EMPTY_RECORDS, type RecordsView, type ShippedWork, type Trophy } from '../../shared/types.ts';
import type { Store } from '../store.ts';
import type { Db } from './db.ts';
import { builderFromBranch, milestones, type Milestone } from './trophies.ts';

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

interface TrophyRow {
  id: string;
  floor_id: string | null;
  icon: string;
  title: string;
  detail: string;
  earned_at: Date;
}

const shippedOf = (r: ShippedRow): ShippedWork => ({ floorId: r.floor_id, prNumber: r.pr_number, title: r.title, url: r.url, builtBy: r.built_by, testedBy: r.tested_by, mergedAt: r.merged_at.getTime() });
const trophyOf = (r: TrophyRow): Trophy => ({ id: r.id, floorId: r.floor_id, icon: r.icon, title: r.title, detail: r.detail, earnedAt: r.earned_at.getTime() });
const keyOf = (floorId: string, prNumber: number) => `${floorId}#${prNumber}`;

export class Records {
  private view: RecordsView = EMPTY_RECORDS;
  private known = new Set<string>(); // every PR recorded, so a sync only writes the new ones
  private writing: Promise<unknown> = Promise.resolve();

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

  /** A merge the office made (the pipeline's moment): it's recorded with who built and tested it, and its trophies announced. */
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
  private queue(works: ShippedWork[], announce: boolean): Promise<void> {
    const next = this.writing.then(() => this.record(works, announce));
    this.writing = next.catch(() => undefined);
    return next;
  }

  private async record(works: ShippedWork[], announce: boolean) {
    await this.db.transaction(async (tx) => {
      for (const w of works) {
        // A row the sync found first keeps its GitHub time and gains who built and tested it from the office's merge.
        await tx.query(
          `insert into shipped (floor_id, pr_number, title, url, built_by, tested_by, merged_at) values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (floor_id, pr_number) do update set title = excluded.title, url = excluded.url,
             built_by = coalesce(shipped.built_by, excluded.built_by), tested_by = coalesce(shipped.tested_by, excluded.tested_by)`,
          [w.floorId, w.prNumber, w.title, w.url, w.builtBy, w.testedBy, new Date(w.mergedAt)],
        );
      }
    });
    for (const w of works) this.known.add(keyOf(w.floorId, w.prNumber));
    const won = await this.award();
    this.view = await this.read();
    this.store.publish({ type: 'records', records: this.view });
    if (announce) for (const trophy of won) this.store.moment({ type: 'trophy', at: Date.now(), trophy });
  }

  /** Awards the milestones reached and not yet held, each dated by the merge that reached it. */
  private async award(): Promise<Trophy[]> {
    const counts = (await this.db.query<{ floor_id: string; n: number }>('select floor_id, count(*)::int as n from shipped group by floor_id')).rows;
    const perFloor = Object.fromEntries(counts.map((c) => [c.floor_id, c.n]));
    const total = counts.reduce((sum, c) => sum + c.n, 0);
    const held = new Set((await this.db.query<{ id: string }>('select id from trophies')).rows.map((r) => r.id));
    const won: Trophy[] = [];
    for (const m of milestones(total, perFloor, (id) => this.floorName(id))) {
      if (held.has(m.id)) continue;
      const earnedAt = await this.reachedAt(m);
      await this.db.query('insert into trophies (id, floor_id, icon, title, detail, earned_at) values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing', [m.id, m.floorId, m.icon, m.title, m.detail, earnedAt]);
      won.push({ id: m.id, floorId: m.floorId, icon: m.icon, title: m.title, detail: m.detail, earnedAt: earnedAt.getTime() });
    }
    return won;
  }

  private async reachedAt(m: Milestone): Promise<Date> {
    const rows = m.floorId
      ? await this.db.query<{ merged_at: Date }>('select merged_at from shipped where floor_id = $1 order by merged_at asc offset $2 limit 1', [m.floorId, m.count - 1])
      : await this.db.query<{ merged_at: Date }>('select merged_at from shipped order by merged_at asc offset $1 limit 1', [m.count - 1]);
    return rows.rows[0]?.merged_at ?? new Date();
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

  private floorName(floorId: string): string {
    return this.store.hasFloor(floorId) ? this.store.floor(floorId).fullName.split('/').pop()! : floorId;
  }
}
