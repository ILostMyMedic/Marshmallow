// Starting a project the manager approved on the CEO's card: its repository created on GitHub (or an existing one
// checked), connected as a floor with the brief and the agreed team, and the card's tasks filed as its first issues.
// Each step shows on the card; a failure says what was done already, and approving the card again carries on from there.
// Nothing here runs before the manager approves.
import type { IssueInfo, ProjectProposal } from '../../shared/types.ts';
import type { Desk } from '../db/desk.ts';
import { HttpError } from '../httpError.ts';
import { oneLine, type Ctx } from '../pipeline/context.ts';
import { checkRepo, checkTeamSize, issueList, keepTasks, repoFromBody, repoName, taskBody } from './proposals.ts';

/** Where new repositories can go: the desk's list from startup, fetched again if gh couldn't say then. */
export async function repoOwners(ctx: Pick<Ctx, 'desk' | 'backend'>): Promise<string[]> {
  const known = ctx.desk?.get().owners ?? [];
  if (known.length) return [...known];
  const owners = await ctx.backend.github.owners().catch(() => []);
  ctx.desk?.setOwners(owners);
  return owners;
}

/** The manager's edits on approval (POST /api/proposals/:id/approve): each left out keeps the card's. */
export interface ApproveBody {
  repo?: unknown; // a ProposalRepo
  teamSize?: unknown;
  tasks?: unknown; // the indices of the tasks to keep
}

const sentence = (s: string) => s.trim().replace(/[.\s]+$/, '');

export class Projects {
  private runs = new Map<number, Promise<void>>();
  private claimed = new Set<number>(); // approved or declined just now, its card not yet changed: a second click waits its turn

  constructor(
    private readonly ctx: Ctx,
    private readonly desk: Desk,
  ) {}

  /**
   * The manager approves a card, maybe edited: checked now, then started in the background (it comes back as
   * 'starting'). A card that failed can be approved again: it carries on from what was done.
   */
  async approve(id: number, body: ApproveBody = {}): Promise<ProjectProposal> {
    const p = await this.claim(id);
    try {
      const started = await this.approved(p, body);
      const run = this.start(started).finally(() => {
        this.runs.delete(id);
        this.claimed.delete(id);
      });
      this.runs.set(id, run);
      return started;
    } catch (err) {
      this.claimed.delete(id);
      throw err;
    }
  }

  /** The manager declines a card: their note goes back to its chat, and to the CEO to rework the plan. */
  async decline(id: number, note = ''): Promise<ProjectProposal> {
    const p = await this.claim(id);
    try {
      const declined = await this.desk.patchProposal(id, { status: 'declined', step: null, decidedAt: Date.now() });
      await this.ctx.ceo.declined(p.chatId, note);
      return declined;
    } finally {
      this.claimed.delete(id);
    }
  }

  /** Waits for the projects starting now (tests, shutdown). */
  async settle(): Promise<void> {
    await Promise.all(this.runs.values());
  }

  /** A card the manager may decide on: pending, or failed (to try again); nobody else deciding on it right now. */
  private async claim(id: number): Promise<ProjectProposal> {
    const p = await this.desk.proposal(id);
    if (this.claimed.has(id)) throw new HttpError(409, 'That project is starting already');
    if (p.status !== 'pending' && p.status !== 'failed') throw new HttpError(409, `That project is ${p.status} already`);
    this.claimed.add(id);
    return p;
  }

  /** The card as approved: the manager's edits checked against the proposal rules, and it marked as starting. */
  private async approved(p: ProjectProposal, body: ApproveBody): Promise<ProjectProposal> {
    const { store } = this.ctx;
    // A retry after its floor connected keeps the floor, and the tasks it filed keep their order.
    const onFloor = p.status === 'failed' && p.floorId !== null && store.hasFloor(p.floorId) ? store.floor(p.floorId) : null;
    if (onFloor && body.repo !== undefined) throw new HttpError(409, `It's floor ${onFloor.floor} already, so its repository stays ${onFloor.fullName}`);
    if (onFloor && p.issueNumbers.length && body.tasks !== undefined) throw new HttpError(409, 'Some of its tasks are filed already, so the list stays as it is');
    const floors = store.floorList().map((f) => f.fullName);
    const repo = onFloor ? p.repo : checkRepo(body.repo !== undefined ? repoFromBody(body.repo) : p.repo, { owners: await repoOwners(this.ctx), floors });
    const max = store.getSettings().maxWorkers;
    const teamSize = body.teamSize !== undefined ? checkTeamSize(body.teamSize, max) : Math.min(p.teamSize, max);
    const tasks = body.tasks !== undefined ? keepTasks(p.tasks, body.tasks) : p.tasks;
    return this.desk.patchProposal(p.id, {
      status: 'starting',
      repo,
      teamSize,
      tasks,
      step: onFloor ? 'Carrying on…' : repo.kind === 'new' ? `Creating ${repoName(repo)} on GitHub…` : `Opening ${repo.fullName}…`,
      error: null,
      decidedAt: Date.now(),
      ...(!onFloor && { floorId: null, issueNumbers: [] }),
    });
  }

  private async start(p: ProjectProposal) {
    const { store, floors, team, ceo, backend } = this.ctx;
    const gh = backend.github;
    const done: string[] = [];
    const filed = [...p.issueNumbers];
    let fullName = repoName(p.repo);
    let created = false;
    let floorId = p.floorId;
    const step = (text: string) => this.desk.patchProposal(p.id, { step: text });
    try {
      if (floorId === null) {
        if (p.repo.kind === 'new') {
          // gh repo create --add-readme: origin has a first commit, so workers' desks have a default branch to start from.
          fullName = await gh.createRepo(p.repo.owner, p.repo.name, { description: p.repo.description, private: p.repo.private });
          created = true;
          done.push(`created ${fullName} on GitHub`);
        } else {
          const meta = await gh.repoMeta(fullName).catch((err: unknown) => {
            throw new Error(`Couldn't open ${fullName} on GitHub: ${oneLine(err)}`);
          });
          if (meta.empty) throw new Error(`${meta.nameWithOwner} is empty. Workers start from its default branch, so it needs a first commit (a README will do)`);
          fullName = meta.nameWithOwner;
        }
        await step('Connecting it as a floor…');
        const floor = await floors.connect(fullName, { autoAssign: true });
        floorId = floor.id;
        store.patchFloor(floorId, { mission: p.brief });
        await this.desk.patchProposal(p.id, { floorId });
        done.push(`connected it as floor ${floor.floor}`);
        // The CEO studies it but plans nothing: the card's tasks are its plan, and the team size was agreed.
        ceo.onboardProject(floorId, p.teamSize);
      }
      team.resize(floorId, p.teamSize, 'The size you agreed on the project card.', 'manager');
      const floor = store.floor(floorId);
      const fresh: IssueInfo[] = [];
      for (let i = filed.length; i < p.tasks.length; i++) {
        await step(`Filing task ${i + 1} of ${p.tasks.length}…`);
        const body = taskBody(p.tasks[i], filed);
        const number = await gh.createIssue(floor.fullName, p.tasks[i].title, body);
        filed.push(number);
        fresh.push({ number, title: p.tasks[i].title, body, url: `${floor.url}/issues/${number}`, labels: [], createdAt: new Date().toISOString() });
        await this.desk.patchProposal(p.id, { issueNumbers: [...filed] });
      }
      if (fresh.length && store.hasFloor(floorId)) {
        // On the board at once; the sync that follows then knows them, so the moment comes once.
        const known = store.floor(floorId).issues.filter((i) => !fresh.some((f) => f.number === i.number));
        store.patchFloor(floorId, { issues: [...known, ...fresh].sort((a, b) => a.number - b.number) });
        store.moment({ type: 'issuesFiled', at: Date.now(), floorId, numbers: fresh.map((i) => i.number) });
      }
      void floors.sync(floorId).catch(() => undefined);
      await this.desk.patchProposal(p.id, { status: 'started', step: null, error: null, floorId, issueNumbers: filed });
      const issues = filed.length ? `, issues ${issueList(filed)}` : '';
      // A fine-grained token only reaches the repositories it was given.
      const token = store.snapshot().cloud.github.source === 'token' ? ` Box workers use your saved GitHub token: if it's a fine-grained one, give it access to ${floor.fullName} too.` : '';
      await this.desk.post('chat', p.chatId, 'office', `🚀 Started floor ${floor.floor}: ${floor.fullName} (${floor.url}), a team of ${p.teamSize}${issues}.${token}`).catch(() => undefined);
    } catch (err) {
      const why = sentence(oneLine(err));
      const fresh = filed.slice(p.issueNumbers.length);
      if (fresh.length) done.push(`filed ${issueList(fresh)}`);
      // Approving again links what was made rather than making it twice.
      const repo = created ? { kind: 'existing' as const, fullName } : p.repo;
      await this.desk.patchProposal(p.id, { status: 'failed', step: null, error: why, repo, floorId, issueNumbers: filed }).catch(() => undefined);
      const already = done.length ? ` Already done: ${done.join('; ')}.` : '';
      await this.desk.post('chat', p.chatId, 'office', `⚠ Couldn't start ${fullName}: ${why}.${already} Change the card if need be and approve it again: it carries on from there.`).catch(() => undefined);
    }
  }
}
