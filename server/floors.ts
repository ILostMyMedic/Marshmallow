// Floors: connecting a repository as a floor of the building, and keeping its GitHub side (open issues, PRs) fresh.
// Adapted from cubefarm server/swarm.ts (MIT): connectRepo and syncRepo.
import type { Floor } from '../shared/types.ts';
import type { Backend, RepoMeta } from './backend/backend.ts';
import { HttpError } from './httpError.ts';
import type { Store } from './store.ts';

const FLOOR_COLORS = ['#ff8a5b', '#4fb3e8', '#8fd14f', '#c77dff', '#ffc93c', '#ff6fb5', '#2ec4b6', '#f25f5c'];
const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;

const oneLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split('\n')[0];

export class Floors {
  private syncing = new Map<string, Promise<Floor>>();
  private again = new Set<string>(); // floors asked to sync while a sync ran
  /** Hears each floor that synced (the pipeline: reconcile QA records, advance merges). */
  onSynced: ((floorId: string) => void) | null = null;

  constructor(
    private readonly store: Store,
    private readonly backend: Backend,
  ) {}

  /** Connects a repository as the next floor up. Its checkout is made and its issues fetched in the background. */
  async connect(fullName: string, opts: { autoAssign?: boolean } = {}): Promise<Floor> {
    const name = fullName.trim();
    if (!REPO_NAME.test(name)) throw new HttpError(400, `"${fullName}" isn't a repository name like owner/name`);
    this.notConnected(name);
    let meta: RepoMeta;
    try {
      meta = await this.backend.github.repoMeta(name);
    } catch (err) {
      throw new HttpError(400, `Couldn't open ${name} on GitHub: ${oneLine(err)}`);
    }
    this.notConnected(meta.nameWithOwner); // a second connect could have finished while this one waited
    const n = Math.max(0, ...this.store.floorList().map((f) => f.floor)) + 1;
    const floor: Floor = {
      id: meta.nameWithOwner,
      fullName: meta.nameWithOwner,
      description: meta.description,
      url: meta.url,
      defaultBranch: meta.defaultBranch,
      floor: n,
      color: FLOOR_COLORS[(n - 1) % FLOOR_COLORS.length],
      autoAssign: opts.autoAssign ?? false,
      browserTesting: true,
      mission: '',
      summary: '',
      qaBrief: '',
      teamSize: null,
      cloneStatus: 'cloning',
      cloneError: null,
      issues: [],
      pulls: [],
      lastSync: null,
      syncError: null,
    };
    this.store.putFloor(floor);
    void this.clone(floor.id);
    void this.sync(floor.id).catch(() => undefined);
    return floor;
  }

  /**
   * Fetches the floor's open issues and PRs. One sync per floor at a time: a second caller shares the running one, and
   * one more runs after it, since it may have begun before whatever the caller wants it to see.
   */
  sync(id: string): Promise<Floor> {
    const running = this.syncing.get(id);
    if (running) {
      this.again.add(id);
      return running;
    }
    // After a restart a floor's clone is unchecked: fetched if it's there, cloned if not.
    if (this.store.hasFloor(id) && this.store.floor(id).cloneStatus === 'pending') {
      this.store.patchFloor(id, { cloneStatus: 'cloning' });
      void this.clone(id);
    }
    const next = this.fetch(id).finally(() => {
      this.syncing.delete(id);
      if (this.again.delete(id) && this.store.hasFloor(id)) void this.sync(id).catch(() => undefined);
    });
    this.syncing.set(id, next);
    return next;
  }

  /** Syncs every floor: the timer's tick. A floor that fails says so on its own (syncError). */
  async syncAll(): Promise<void> {
    await Promise.all(this.store.floorList().map((f) => this.sync(f.id).catch(() => undefined)));
  }

  private notConnected(fullName: string) {
    if (this.store.floorList().some((f) => f.id.toLowerCase() === fullName.toLowerCase())) throw new HttpError(409, `${fullName} is already a floor`);
  }

  private async clone(id: string) {
    const { fullName } = this.store.floor(id);
    let patch: Partial<Floor>;
    try {
      await this.backend.ensureClone(fullName);
      patch = { cloneStatus: 'ready', cloneError: null };
    } catch (err) {
      patch = { cloneStatus: 'error', cloneError: oneLine(err) };
    }
    if (this.store.hasFloor(id)) this.store.patchFloor(id, patch);
  }

  private async fetch(id: string): Promise<Floor> {
    const { fullName } = this.store.floor(id);
    const at = Date.now();
    try {
      const [issues, pulls] = await Promise.all([this.backend.github.listIssues(fullName), this.backend.github.listPulls(fullName)]);
      const before = this.store.floor(id); // throws if the floor went while GitHub answered
      // Issues the last sync didn't have are new (the first sync after a start knows of none, so it reports none).
      const known = new Set(before.issues.map((i) => i.number));
      const filed = before.lastSync === null ? [] : issues.filter((i) => !known.has(i.number)).map((i) => i.number);
      const floor = this.store.patchFloor(id, { issues, pulls, lastSync: at, syncError: null });
      if (filed.length) this.store.moment({ type: 'issuesFiled', at, floorId: id, numbers: filed });
      this.onSynced?.(id);
      return floor;
    } catch (err) {
      if (err instanceof HttpError || !this.store.hasFloor(id)) throw err;
      return this.store.patchFloor(id, { syncError: oneLine(err) });
    }
  }
}
