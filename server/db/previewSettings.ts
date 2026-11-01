// What the manager set for each floor's preview (server/previews.ts): the command that runs its app and its port, or
// null for the office's choice. Kept in the office database; a floor that leaves keeps its settings for when it's back.
import type { PreviewConfig } from '../../shared/types.ts';
import type { Db } from './db.ts';

export const DEFAULT_PREVIEW_CONFIG: PreviewConfig = { command: null, port: null };

interface SettingsRow {
  floor_id: string;
  command: string | null;
  port: number | null;
}

export class PreviewSettings {
  private configs = new Map<string, PreviewConfig>();

  constructor(private readonly db: Db) {}

  async load() {
    const rows = (await this.db.query<SettingsRow>('select floor_id, command, port from preview_settings')).rows;
    this.configs.clear();
    for (const r of rows) this.configs.set(r.floor_id, { command: r.command, port: r.port });
  }

  get(floorId: string): PreviewConfig {
    return this.configs.get(floorId) ?? DEFAULT_PREVIEW_CONFIG;
  }

  /** Saves a floor's settings; both null hands everything back to the office, so the row goes. */
  async set(floorId: string, config: PreviewConfig): Promise<PreviewConfig> {
    if (config.command === null && config.port === null) {
      await this.db.query('delete from preview_settings where floor_id = $1', [floorId]);
      this.configs.delete(floorId);
      return DEFAULT_PREVIEW_CONFIG;
    }
    await this.db.query(
      'insert into preview_settings (floor_id, command, port, updated_at) values ($1, $2, $3, now()) on conflict (floor_id) do update set command = excluded.command, port = excluded.port, updated_at = now()',
      [floorId, config.command, config.port],
    );
    const saved = { command: config.command, port: config.port };
    this.configs.set(floorId, saved);
    return saved;
  }
}
