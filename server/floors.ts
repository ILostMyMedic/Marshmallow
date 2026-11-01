// Floors: connecting a repository as a floor of the building, keeping its GitHub side (open issues, PRs) fresh, and
// its work branch (shared/branches.ts), which must exist on GitHub.
// Adapted from cubefarm server/swarm.ts (MIT): connectRepo and syncRepo.
import { branchProblem } from '../shared/branches.ts';
import type { Floor } from '../shared/types.ts';
import type { Backend, RepoMeta } from './backend/backend.ts';
import { HttpError } from './httpError.ts';
import type { Store } from './store.ts';

const FLOOR_COLORS = ['#ff8a5b', '#4fb3e8', '#8fd14f', '#c77dff', '#ffc93c', '#ff6fb5', '#2ec4b6', '#f25f5c'];
const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;
/** How often a sync also asks GitHub for the floor's languages (one more gh call, so not every sync). */
export const LANGUAGES_EVERY_MS = 60 * 60_000;

const oneLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split('\n')[0];

export class Floors {
  private syncing = new Map<string, Promise<Floor>>();
  private again = new Set<string>(); // floors asked to sync while a sync ran
  private languagesAt = new Map<string, number>(); // when each floor's languages were last asked for (a start asks again)
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
      workBranch: null,
      floor: n,
      color: FLOOR_COLORS[(n - 1) % FLOOR_COLORS.length],
      autoAssign: opts.autoAssign ?? false,
      browserTesting: true,
      mission: '',
      summary: '',
      qaBrief: '',
      teamSize: null,
      held: [],
      languages: meta.languages,
      cloneStatus: 'cloning',
      cloneError: null,
      issues: [],
      pulls: [],
      lastSync: null,
      syncError: null,
    };
    this.store.putFloor(floor);
    this.languagesAt.set(floor.id, Date.now());
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

  /**
   * Files a task the manager wrote as an issue on floor `id`'s repository (a plain issue, so auto-assign takes it like
   * any other), then syncs the floor so its board shows it at once.
   */
  async fileIssue(id: string, title: string, body: string): Promise<{ number: number }> {
    const floor = this.store.floor(id);
    const t = title.trim();
    if (!t) throw new HttpError(400, 'A task needs a title');
    if (t.length > 256) throw new HttpError(400, 'Keep the title under 256 characters; the rest can go in the details');
    const number = await this.backend.github.createIssue(floor.fullName, t, body.trim());
    await this.sync(id).catch(() => undefined); // filed either way: the next sync shows it if this one fails
    return { number };
  }

  /** Floor `id`'s branches on GitHub, for the work branch picker. */
  async branches(id: string): Promise<{ branches: string[]; defaultBranch: string; workBranch: string | null }> {
    const floor = this.store.floor(id);
    let branches: string[];
    try {
      branches = await this.backend.github.listBranches(floor.fullName);
    } catch (err) {
      throw new HttpError(400, `Couldn't list ${floor.fullName}'s branches on GitHub: ${oneLine(err)}`);
    }
    return { branches: [...branches].sort((a, b) => a.localeCompare(b)), defaultBranch: floor.defaultBranch, workBranch: floor.workBranch };
  }

  /**
   * Sets the branch floor `id`'s work starts from and merges into; empty (or its default branch) hands it back to the
   * default branch. A branch GitHub doesn't have is refused (409), or with `create` made from the default branch's head.
   */
  async setWorkBranch(id: string, raw: string | null, create = false): Promise<Floor> {
    const floor = this.store.floor(id);
    const name = (raw ?? '').trim();
    if (!name || name === floor.defaultBranch) return this.store.patchFloor(id, { workBranch: null });
    const problem = branchProblem(name);
    if (problem) throw new HttpError(400, problem);
    const { branches } = await this.branches(id);
    if (!branches.includes(name)) {
      if (!create) throw new HttpError(409, `${floor.fullName} has no ${name} branch on GitHub. Create it from ${floor.defaultBranch} first, or pick one it has.`);
      try {
        await this.backend.github.createBranch(floor.fullName, name, floor.defaultBranch);
      } catch (err) {
        throw new HttpError(400, `Couldn't create ${name} on ${floor.fullName}: ${oneLine(err)}`);
      }
    }
    return this.store.patchFloor(id, { workBranch: name });
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

  /** The floor's languages, asked for again when they're an hour old; tabs hear only of a change. A failure waits its hour. */
  private async refreshLanguages(id: string, now: number) {
    if (now - (this.languagesAt.get(id) ?? -Infinity) < LANGUAGES_EVERY_MS) return;
    this.languagesAt.set(id, now);
    try {
      const { languages } = await this.backend.github.repoMeta(this.store.floor(id).fullName);
      if (this.store.hasFloor(id) && JSON.stringify(languages) !== JSON.stringify(this.store.floor(id).languages)) this.store.patchFloor(id, { languages });
    } catch {
      // the next hour's sync tries again
    }
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
      void this.refreshLanguages(id, at);
      return floor;
    } catch (err) {
      if (err instanceof HttpError || !this.store.hasFloor(id)) throw err;
      return this.store.patchFloor(id, { syncError: oneLine(err) });
    }
  }
}
