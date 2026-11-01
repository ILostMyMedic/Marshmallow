// The shop: a floor buys from the catalogue with its coins, and moves what it bought between spots. shared/shop.ts checks
// each by the same rules the browser shows. A purchase is one transaction (the coins go and the item stands in its spot,
// or neither), and it runs in the ledger's line of writes, so two quick clicks can't spend the same coins twice.
import { checkMove, checkPurchase } from '../shared/shop.ts';
import type { FloorCoins, FloorItem } from '../shared/types.ts';
import type { Db } from './db/db.ts';
import type { FloorPlans } from './db/floorPlans.ts';
import { HttpError } from './httpError.ts';
import type { Ledger } from './ledger.ts';
import type { Store } from './store.ts';

export class Shop {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly ledger: Ledger,
    private readonly plans: FloorPlans,
  ) {}

  /**
   * Buys catalogue entry `entryId` for a floor: an extra into `spot` (the first free one of its kind without), an
   * upgrade in its kit item's spot. Tabs get the coins and the plan; the floor's purse and plan come back. A refusal
   * (too poor, no room, not for sale…) is a 409 with the reason.
   */
  async buy(floorId: string, entryId: string, spot?: string | null): Promise<{ coins: FloorCoins; items: FloorItem[] }> {
    this.store.floor(floorId); // 404 for a floor that isn't connected
    return this.ledger.serial(async () => {
      await this.plans.ensure(floorId); // the kit first, so a purchase never stands in for it
      const p = checkPurchase(this.plans.of(floorId), this.ledger.balance(floorId).coins, entryId, spot);
      if (!p.ok) throw new HttpError(409, p.error);
      await this.db.transaction(async (tx) => {
        await this.ledger.spend(tx, floorId, p.price, p.entry.name);
        await this.plans.put(tx, floorId, p.spot, p.item, p.tier);
      });
      await this.ledger.refresh();
      const items = await this.plans.reload(floorId);
      return { coins: this.ledger.balance(floorId), items };
    });
  }

  /** Moves what stands in spot `from` to the empty spot `to` of the same kind (409 with the reason otherwise). */
  async move(floorId: string, from: string, to: string): Promise<{ items: FloorItem[] }> {
    this.store.floor(floorId);
    return this.ledger.serial(async () => {
      const why = checkMove(this.plans.of(floorId), from, to);
      if (why) throw new HttpError(409, why);
      return { items: await this.plans.move(floorId, from, to) };
    });
  }
}
