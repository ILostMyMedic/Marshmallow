// Each floor's plan: what stands in its spots. Every floor starts with the kit every office floor has always had (the
// shop, in Phase 17, sells extras and upgrades into the free spots); a floor that leaves keeps its plan, for when it's
// connected again.
import type { FloorItem } from '../../shared/types.ts';
import type { Store } from '../store.ts';
import type { Db } from './db.ts';

/** What every office floor has from the start, by spot. */
export const DEFAULT_KIT: readonly { spot: string; item: string }[] = [
  { spot: 'kitchen', item: 'coffee-machine' },
  { spot: 'kitchen-fridge', item: 'fridge' },
  { spot: 'lounge', item: 'couch' },
  { spot: 'games', item: 'pingpong-table' },
  { spot: 'north-wall', item: 'whiteboard' },
  { spot: 'gong-corner', item: 'gong' },
];

interface ItemRow {
  floor_id: string;
  spot: string;
  item: string;
  tier: number;
  since: Date;
}

const itemOf = (r: ItemRow): FloorItem => ({ spot: r.spot, item: r.item, tier: r.tier, since: r.since.getTime() });

export class FloorPlans {
  private plans = new Map<string, FloorItem[]>();

  constructor(
    private readonly db: Db,
    private readonly store: Store,
  ) {}

  /** Every connected floor's plan, by floor id. */
  get(): Record<string, FloorItem[]> {
    const out: Record<string, FloorItem[]> = {};
    for (const f of this.store.floorList()) out[f.id] = this.plans.get(f.id) ?? [];
    return out;
  }

  async load() {
    const rows = (await this.db.query<ItemRow>('select * from floor_items order by floor_id, spot')).rows;
    this.plans.clear();
    for (const r of rows) this.plans.set(r.floor_id, [...(this.plans.get(r.floor_id) ?? []), itemOf(r)]);
  }

  /** Gives a floor the default kit if it has no plan yet; tabs hear of it. */
  async ensure(floorId: string) {
    if (this.plans.has(floorId)) return;
    await this.db.transaction(async (tx) => {
      for (const k of DEFAULT_KIT) await tx.query('insert into floor_items (floor_id, spot, item) values ($1, $2, $3) on conflict do nothing', [floorId, k.spot, k.item]);
    });
    const items = (await this.db.query<ItemRow>('select * from floor_items where floor_id = $1 order by spot', [floorId])).rows.map(itemOf);
    this.plans.set(floorId, items);
    this.store.publish({ type: 'floorPlan', floorId, items });
  }
}
