// The manager in the game: their look, kept in the office database so every browser shows the same one (one manager per
// office for now). The client checks the look's parts when it reads it (client/src/world/myLook.ts sanitizeLook).
import type { PlayerLook } from '../../shared/types.ts';
import { HttpError } from '../httpError.ts';
import type { Store } from '../store.ts';
import type { Db } from './db.ts';

const MANAGER = 'manager';
/** A look is a handful of short fields: anything much bigger isn't one. */
const MAX_LOOK_JSON = 4000;

export class Player {
  private look: PlayerLook | null = null;

  constructor(
    private readonly db: Db,
    private readonly store: Store,
  ) {}

  get(): PlayerLook | null {
    return this.look;
  }

  async load() {
    const rows = await this.db.query<{ look: PlayerLook | null }>('select look from player where key = $1', [MANAGER]);
    this.look = rows.rows[0]?.look ?? null;
  }

  async setLook(look: unknown): Promise<PlayerLook> {
    if (!look || typeof look !== 'object' || Array.isArray(look)) throw new HttpError(400, 'A look is an object of its parts');
    if (JSON.stringify(look).length > MAX_LOOK_JSON) throw new HttpError(400, 'That look is too big');
    const next = look as PlayerLook;
    await this.db.query('insert into player (key, look, updated_at) values ($1, $2, now()) on conflict (key) do update set look = excluded.look, updated_at = now()', [MANAGER, next]);
    this.look = next;
    this.store.publish({ type: 'look', look: next });
    return next;
  }
}
