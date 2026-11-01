// Each floor's plan: what stands in its spots. Every floor starts with the kit every office floor has always had; the
// shop (server/shop.ts) sells extras into the free spots and upgrades the kit. A floor that leaves keeps its plan, for
// when it's connected again. Tabs see only what the catalogue still knows (shared/shop.ts knownItems): a row an older
// catalogue wrote stays in the database but is left out, and a purchase or a move into its spot replaces it. An item the
// catalogue now sells for another kind of spot (the beanbags, grown big) is moved to one as the office opens, or paid
// back when there's no room for it (resettle).
import { knownItems, resettle, shopEntry } from '../../shared/shop.ts';
import type { FloorItem } from '../../shared/types.ts';
import type { Ledger } from '../ledger.ts';
import type { Store } from '../store.ts';
import type { Db, Tx } from './db.ts';

/**
 * What a floor paid for the `item` standing in `spot`: its place among the floor's rows of that item by age matches its
 * place among the purchase lines named `name` (the catalogue's name, which a purchase writes), in order, since nothing is
 * ever sold back. 0 when there's no line for it.
 */
export function paidFor(rows: readonly FloorItem[], lines: readonly { detail: string; amount: number }[], spot: string, item: string, name: string): number {
  const nth = rows
    .filter((r) => r.item === item)
    .sort((a, b) => a.since - b.since)
    .findIndex((r) => r.spot === spot);
  const line = lines.filter((l) => l.detail === name)[nth];
  return nth >= 0 && line ? Math.max(0, -line.amount) : 0;
}

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
  private plans = new Map<string, FloorItem[]>(); // every row, known to the catalogue or not

  constructor(
    private readonly db: Db,
    private readonly store: Store,
  ) {}

  /** Every connected floor's plan, by floor id. */
  get(): Record<string, FloorItem[]> {
    const out: Record<string, FloorItem[]> = {};
    for (const f of this.store.floorList()) out[f.id] = this.of(f.id);
    return out;
  }

  /** One floor's plan ([] before it has one). */
  of(floorId: string): FloorItem[] {
    return knownItems(this.plans.get(floorId) ?? []);
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
    await this.reload(floorId);
  }

  /** Puts `item` at `tier` in a spot, in a purchase's transaction: whatever stood there (an older row) is replaced. */
  async put(tx: Tx, floorId: string, spot: string, item: string, tier: number) {
    await tx.query(
      `insert into floor_items (floor_id, spot, item, tier, since) values ($1, $2, $3, $4, now())
       on conflict (floor_id, spot) do update set item = excluded.item, tier = excluded.tier, since = excluded.since`,
      [floorId, spot, item, tier],
    );
  }

  /** Moves what stands in `from` to `to` (checked by shared/shop.ts checkMove first); then tabs hear of it. */
  async move(floorId: string, from: string, to: string): Promise<FloorItem[]> {
    await this.db.transaction(async (tx) => {
      await tx.query('delete from floor_items where floor_id = $1 and spot = $2', [floorId, to]); // a row the catalogue forgot
      await tx.query('update floor_items set spot = $3 where floor_id = $1 and spot = $2', [floorId, from, to]);
    });
    return this.reload(floorId);
  }

  /**
   * Puts what the catalogue now sells for another kind of spot where it goes now (shared/shop.ts resettle): into a free
   * spot of its kind, or, with none free, out of the plan with what it cost paid back. Runs once as the office opens, in
   * the ledger's line of writes; returns the floors it changed.
   */
  async resettle(ledger: Ledger): Promise<string[]> {
    const changed: string[] = [];
    for (const [floorId, rows] of [...this.plans]) {
      const r = resettle(rows);
      if (!r.moves.length && !r.refunds.length) continue;
      const lines = r.refunds.length
        ? (await this.db.query<{ detail: string; amount: number }>("select detail, amount from coin_entries where floor_id = $1 and reason = 'purchase' order by at, id", [floorId])).rows
        : [];
      await this.db.transaction(async (tx) => {
        for (const m of r.moves) {
          await tx.query('delete from floor_items where floor_id = $1 and spot = $2', [floorId, m.to]); // a row the catalogue forgot
          await tx.query('update floor_items set spot = $3 where floor_id = $1 and spot = $2', [floorId, m.from, m.to]);
        }
        for (const f of r.refunds) {
          const name = shopEntry(f.item)?.name ?? f.item;
          const amount = paidFor(rows, lines, f.spot, f.item, name);
          await tx.query('delete from floor_items where floor_id = $1 and spot = $2', [floorId, f.spot]);
          if (amount > 0) await ledger.refund(tx, floorId, amount, `${name} paid back: no room for them now`);
        }
      });
      for (const m of r.moves) console.log(`  ${floorId}: the ${m.item} moved from ${m.from} to ${m.to} (the shop sells them for that kind of spot now)`);
      for (const f of r.refunds) console.log(`  ${floorId}: the ${f.item} in ${f.spot} went back to the shop, paid back (no free spot of their kind)`);
      changed.push(floorId);
      await this.reload(floorId);
    }
    if (changed.length) await ledger.refresh();
    return changed;
  }

  /** Reads a floor's plan again after a write, and sends it to the tabs. */
  async reload(floorId: string): Promise<FloorItem[]> {
    const rows = (await this.db.query<ItemRow>('select * from floor_items where floor_id = $1 order by spot', [floorId])).rows.map(itemOf);
    this.plans.set(floorId, rows);
    const items = this.of(floorId);
    this.store.publish({ type: 'floorPlan', floorId, items });
    return items;
  }

  /** The demo's reset: every plan goes (floors get the kit again when they're connected). */
  async clear() {
    await this.db.query('delete from floor_items');
    this.plans.clear();
  }
}
