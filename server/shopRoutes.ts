// The shop's REST, per floor (`:floor` is the URL-encoded owner/name): buying and moving what was bought, and the demo's
// gift of coins. Every change also reaches the tabs ('coins', 'floorPlan'). An unknown floor is a 404, a bad body a 400,
// a purchase or move the shop refuses a 409 with its reason, and a grant outside the demo a 403.
import express from 'express';
import { HttpError } from './httpError.ts';
import type { Ledger } from './ledger.ts';
import { route } from './route.ts';
import type { Shop } from './shop.ts';
import type { Store } from './store.ts';

/** The most coins the demo grants at once. */
export const MAX_GRANT = 10_000;

/** A body field that must be a non-empty string. */
const text = (v: unknown, what: string) => {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${what} must be a non-empty string`);
  return v.trim();
};

export function shopRoutes(store: Store, shop: Shop, ledger: Ledger, demo: boolean) {
  const r = express.Router();
  const floorOf = (raw: unknown) => store.floor(String(raw)).id; // 404 before the body is looked at

  // { item, spot? } → { coins: FloorCoins, items: FloorItem[] }
  r.post(
    '/floors/:floor/shop/buy',
    route((req) => {
      const floorId = floorOf(req.params.floor);
      const spot = req.body?.spot;
      if (spot !== undefined && spot !== null && typeof spot !== 'string') throw new HttpError(400, 'spot must be a spot id, or left out');
      return shop.buy(floorId, text(req.body?.item, 'item'), spot || null);
    }),
  );
  // { from, to } → { items: FloorItem[] }
  r.post(
    '/floors/:floor/shop/move',
    route((req) => {
      const floorId = floorOf(req.params.floor);
      return shop.move(floorId, text(req.body?.from, 'from'), text(req.body?.to, 'to'));
    }),
  );
  // { amount } → { coins: FloorCoins }: the demo only
  r.post(
    '/floors/:floor/coins/grant',
    route(async (req) => {
      if (!demo) throw new HttpError(403, 'Coins are only granted in the demo');
      const floorId = floorOf(req.params.floor);
      const amount = req.body?.amount;
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount > MAX_GRANT) throw new HttpError(400, `amount must be a whole number from 1 to ${MAX_GRANT}`);
      return { coins: await ledger.grant(floorId, amount) };
    }),
  );

  return r;
}
