// The office database and what it keeps, together: opened at startup, its part of the snapshot attached to the store,
// the pipeline's moments and the floors' syncs fed in, the awards looking again whenever what they count may have moved,
// closed on the way out.
import { Ledger } from '../ledger.ts';
import { Shop } from '../shop.ts';
import type { Store } from '../store.ts';
import { Awards } from './awards.ts';
import { openDb, type Db } from './db.ts';
import { Desk } from './desk.ts';
import { FloorPlans } from './floorPlans.ts';
import { Player } from './player.ts';
import { PreviewSettings } from './previewSettings.ts';
import { Records } from './records.ts';
import { World } from './world.ts';

export interface OfficeDb {
  db: Db;
  records: Records;
  player: Player;
  plans: FloorPlans;
  world: World;
  /** The manager's settings for each floor's preview (server/previews.ts runs them). */
  previewSettings: PreviewSettings;
  /** The desktop's chats with the CEO, its project proposals and discussions. */
  desk: Desk;
  /** Each floor's coins (server/ledger.ts), and the shop that spends them. */
  ledger: Ledger;
  shop: Shop;
  /** The awards: won as trophies, paid in coins. */
  awards: Awards;
  /** A floor synced (Floors.onSynced): its merged PRs recorded and paid, its plan made if it has none. */
  synced(floorId: string): void;
  /** The demo's reset: what was shipped and won, coins and floor plans go too, since the reseeded fake GitHub hands out the same PR numbers again. */
  demoReset(): Promise<void>;
  close(): Promise<void>;
}

const warn = (what: string) => (err: unknown) => console.warn(`  the office database couldn't ${what}: ${(err as Error).message}`);

/** Opens the office database in `dir` (in memory when null) and hooks it to the store. */
export async function openOffice(dir: string | null, store: Store): Promise<OfficeDb> {
  const db = await openDb(dir);
  const records = new Records(db, store);
  const player = new Player(db, store);
  const plans = new FloorPlans(db, store);
  const world = new World(db, store);
  const previewSettings = new PreviewSettings(db);
  const desk = new Desk(db, store);
  const ledger = new Ledger(db, store);
  const shop = new Shop(db, store, ledger, plans);
  const awards = new Awards(db, store, ledger, plans, desk, records);
  await Promise.all([records.load(), player.load(), plans.load(), world.load(), previewSettings.load(), desk.load(), ledger.load()]);
  // what the catalogue now sells for another kind of spot goes where it fits, or is paid back
  await ledger.serial(() => plans.resettle(ledger));
  await desk.importPhone(store.snapshot().messages);
  store.attachDb(() => ({ records: records.get(), look: player.get(), floorPlans: plans.get(), coins: ledger.get(), awards: awards.get(), world: world.get(), desk: desk.get() }));
  const look = () => void awards.poke().catch(warn('look at the awards'));
  records.onRecorded = look;
  store.onMoment((m) => {
    if (m.type === 'merged') void records.merged(m.floorId, m.prNumber, m.devWorkerId, m.qaWorkerId ?? null).catch(warn(`record PR #${m.prNumber}`));
    void ledger.moment(m).catch(warn(`count the coins of a ${m.type} moment`));
    // a hire grows a team; a PR's coins mean its clean pass or fix counts now (an award's own coins change nothing)
    if (m.type === 'hired' || (m.type === 'earned' && !m.award)) look();
  });
  store.onPublish((ev) => {
    if (ev.type === 'floorPlan' || ev.type === 'desk') look();
  });
  for (const f of store.floorList()) await plans.ensure(f.id);
  look();
  return {
    db,
    records,
    player,
    plans,
    world,
    previewSettings,
    desk,
    ledger,
    shop,
    awards,
    synced(floorId) {
      void records.synced(floorId).catch(warn(`record ${floorId}'s merges`));
      void ledger.synced(floorId).catch(warn(`count ${floorId}'s coins`));
      void plans.ensure(floorId).catch(warn(`set up ${floorId}'s plan`));
      look();
    },
    async demoReset() {
      // between the awards' looks, so none pays for what's being cleared
      await awards.between(async () => {
        await ledger.serial(() => plans.clear());
        await ledger.clear();
        await records.clear();
      });
      await awards.poke();
    },
    async close() {
      await world.stop();
      // what's being written finishes first: the records, the awards they set off, and the coins those pay
      await records.idle();
      await awards.idle();
      await ledger.serial(async () => undefined).catch(() => undefined);
      await db.close();
    },
  };
}
