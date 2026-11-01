// The office database and what it keeps, together: opened at startup, its part of the snapshot attached to the store,
// the pipeline's merges and the floors' syncs fed in, closed on the way out.
import type { Store } from '../store.ts';
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
  /** A floor synced (Floors.onSynced): its merged PRs recorded, its plan made if it has none. */
  synced(floorId: string): void;
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
  await Promise.all([records.load(), player.load(), plans.load(), world.load(), previewSettings.load(), desk.load()]);
  await desk.importPhone(store.snapshot().messages);
  store.attachDb(() => ({ records: records.get(), look: player.get(), floorPlans: plans.get(), world: world.get(), desk: desk.get() }));
  store.onMoment((m) => {
    if (m.type === 'merged') void records.merged(m.floorId, m.prNumber, m.devWorkerId, m.qaWorkerId ?? null).catch(warn(`record PR #${m.prNumber}`));
  });
  for (const f of store.floorList()) await plans.ensure(f.id);
  return {
    db,
    records,
    player,
    plans,
    world,
    previewSettings,
    desk,
    synced(floorId) {
      void records.synced(floorId).catch(warn(`record ${floorId}'s merges`));
      void plans.ensure(floorId).catch(warn(`set up ${floorId}'s plan`));
    },
    async close() {
      await world.stop();
      await db.close();
    },
  };
}
