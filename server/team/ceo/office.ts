// The office's side of the CEO's tools: what each one reads or changes. Floors are named by number, as the CEO sees
// them; workers by id or name. Discussions and project cards go on the desk (server/db/desk.ts), proposed playbook
// changes into the playbook (server/playbook/), each a card in its thread.
// Adapted from cubefarm server/swarm.ts (MIT): the office tools section and companyStatus.
import { workBranchOf } from '../../../shared/branches.ts';
import { effectiveModel } from '../../../shared/models.ts';
import { isBusy, type Floor, type Worker } from '../../../shared/types.ts';
import type { Desk } from '../../db/desk.ts';
import { repoOwners } from '../../desk/projects.ts';
import { proposalFrom, repoName } from '../../desk/proposals.ts';
import { changeLabel, playbookDraftFrom } from '../../playbook/proposals.ts';
import type { Ctx } from '../../pipeline/context.ts';
import { readyIssues } from '../../pipeline/scheduler.ts';
import { floorCapacity } from '../autoscale.ts';
import { checkCloseIssue, planDependencies, type IssueCap } from './issueRules.ts';
import { askedFor, NOT_ASKED, type CeoJob } from './prompts.ts';
import type { OfficeHandlers } from './tools.ts';

/** Under every issue the CEO files. */
const FILED_BY = "\n\n_Filed by Marshmallow's CEO._";
/** Discussions the CEO may open in one job. */
export const DISCUSSIONS_PER_JOB = 2;

/** What a job put on the desk: the project card it proposed (its final message goes with it), the discussions it opened. */
export interface JobMade {
  proposalId: number | null;
  discussions: number;
}

export function officeHandlers(ctx: Ctx, job: CeoJob, cap: IssueCap, ceoName: string, made: JobMade = { proposalId: null, discussions: 0 }): OfficeHandlers {
  const { store, backend } = ctx;
  const gh = backend.github;
  const settings = () => store.getSettings();
  const desk = (): Desk => {
    if (!ctx.desk) throw new Error("The office database isn't open, so there's no desk to put that on.");
    return ctx.desk;
  };
  const floorOf = (id: string | null) => (id && store.hasFloor(id) ? store.floor(id) : null);
  /** Where the job is, for a discussion it opens: its first job carries this. */
  const jobContext = (): string => {
    const floor = floorOf(job.floorId);
    const where = floor ? `floor ${floor.floor} (${floor.fullName}, clone at ${backend.mainDir(floor.fullName)})` : 'a floor that has since gone';
    switch (job.kind) {
      case 'onboard':
        return `while onboarding ${where}`;
      case 'plan':
        return `while planning ${where} from the manager's brief: """${floor?.mission ?? ''}"""`;
      case 'chat':
        return `in the chat "${(job.chatId !== null && ctx.desk?.thread('chat', job.chatId)?.title) || 'with the manager'}"`;
      case 'discussion':
        return `in the discussion "${(job.discussionId !== null && ctx.desk?.thread('discussion', job.discussionId)?.title) || 'with the manager'}"`;
    }
  };

  const floorNo = (n: number): Floor => {
    const floor = store.floorList().find((f) => f.floor === n);
    if (!floor) throw new Error(`There is no floor ${n}. company_status lists them.`);
    return floor;
  };
  const findWorker = (idOrName: string): Worker => {
    const key = idOrName.trim().toLowerCase();
    const w = store.workerList().find((x) => x.role === 'worker' && (x.id === idOrName.trim() || x.name.toLowerCase() === key));
    if (!w) throw new Error(`There is no worker "${idOrName}". company_status lists them.`);
    return w;
  };
  const workerView = (w: Worker) => ({
    id: w.id,
    name: w.name,
    status: w.status,
    task: w.task && { kind: w.task.kind, issue: w.task.issueNumber, pr: w.task.prNumber, title: w.task.title },
    model: effectiveModel(w.model, settings().defaultModel),
    effort: w.effort || settings().defaultEffort,
    ...(w.leaving && { leaving: true }),
  });
  const inProgress = (floor: Floor) => {
    const taken = new Set(store.workerList().flatMap((w) => (w.floorId === floor.id && w.task?.issueNumber != null && isBusy(w.status) ? [w.task.issueNumber] : [])));
    return (n: number) => taken.has(n);
  };

  return {
    companyStatus() {
      const s = settings();
      const now = Date.now();
      return JSON.stringify({
        company: { name: s.companyName, manager: s.managerName, maxWorkersPerFloor: s.maxWorkers, sessionLimit: s.sessionLimit || null, rulesSizeFloors: s.autoscale, usage: store.snapshot().usage.state },
        floors: store.floorList().map((f) => {
          const open = f.pulls.filter((p) => p.state === 'OPEN');
          const qa = store.qaList(f.id);
          return {
            floor: f.floor,
            repo: f.fullName,
            clone: f.cloneStatus === 'ready' ? backend.mainDir(f.fullName) : `not ready (${f.cloneStatus})`,
            // Where the floor's work starts and its PRs merge (the clone is checked out on the default branch)
            workBranch: workBranchOf(f),
            brief: f.mission || null,
            summary: f.summary || null,
            qaBrief: f.qaBrief || null,
            autoAssign: f.autoAssign,
            sizedBy: f.teamSize === null ? 'the rules' : `held at ${f.teamSize}`,
            team: store.workerList().filter((w) => w.floorId === f.id && w.role === 'worker').map(workerView),
            capacity: {
              issuesReadyToStart: f.autoAssign ? readyIssues(f, store.workerList(), (n) => ctx.build.failedTooOften(f.id, n), now).length : 0,
              ...floorCapacity({ issues: f.issues, inProgress: inProgress(f), openPrs: open.map((p) => p.number), qa }),
            },
            issues: f.issues.slice(0, 40).map((i) => ({ number: i.number, title: i.title, labels: i.labels })),
            pulls: open.map((p) => ({ number: p.number, title: p.title, qa: qa.find((q) => q.prNumber === p.number)?.status ?? null })),
            questions: store.questionList(f.id).filter((q) => !q.answer).map((q) => ({ issue: q.issueNumber, from: q.from, text: q.text })),
          };
        }),
        openDiscussions: (ctx.desk?.get().discussions ?? [])
          .filter((d) => d.status === 'open')
          .map((d) => ({ title: d.title, floor: floorOf(d.floorId)?.floor ?? null, waitingFor: d.messages.at(-1)?.from === 'manager' ? 'you' : 'the manager' })),
        newRepositoriesCanGoUnder: ctx.desk?.get().owners ?? [],
        // what every worker session gets; change it with propose_playbook_change
        playbook: (ctx.playbook?.get().docs ?? []).map((d) => ({
          scope: d.scope === 'office' ? 'office' : `floor ${floorOf(d.floorId)?.floor ?? `${d.floorId} (gone)`}`,
          kind: d.kind,
          name: d.name,
          ...(d.description && { description: d.description }),
          ...(!d.enabled && { enabled: false }),
          body: d.body.length > 2000 ? `${d.body.slice(0, 2000)}…` : d.body,
        })),
      });
    },

    workerDetail: (a) => JSON.stringify(workerView(findWorker(a.worker_id))),

    setFloorProfile(a) {
      const floor = floorNo(a.floor);
      store.patchFloor(floor.id, { ...(a.summary !== undefined && { summary: a.summary.trim() }), ...(a.qa_brief !== undefined && { qaBrief: a.qa_brief.trim() }) });
      return `Saved floor ${a.floor}'s profile.`;
    },

    scaleTeam(a) {
      const floor = floorNo(a.floor);
      const before = store.workerList().filter((w) => w.floorId === floor.id && w.role === 'worker' && !w.leaving).length;
      const plan = ctx.team.resize(floor.id, a.size, a.reason, 'ceo', { model: a.model, effort: a.effort });
      const busy = plan.letGo.filter((id) => store.hasWorker(id)).length;
      return `Floor ${a.floor}: ${before} → ${plan.size} workers, held at ${plan.size}.${busy ? ` ${busy} busy worker${busy === 1 ? '' : 's'} leave${busy === 1 ? 's' : ''} when their task ends.` : ''}`;
    },

    configureWorker(a) {
      const w = findWorker(a.worker_id);
      store.patchWorker(w.id, { ...(a.model !== undefined && { model: a.model.trim() }), ...(a.effort !== undefined && { effort: a.effort }) });
      return `${w.name} now runs ${effectiveModel(store.worker(w.id).model, settings().defaultModel)}, from their next task.`;
    },

    async fileIssue(a) {
      if (!askedFor(job)) throw new Error(NOT_ASKED);
      cap.check();
      const floor = floorNo(a.floor);
      const n = await gh.createIssue(floor.fullName, a.title.trim(), `${a.body.trim()}${FILED_BY}`);
      cap.record(floor.id);
      return `Filed #${n} on floor ${a.floor}.`;
    },

    async setDependencies(a) {
      const floor = floorNo(a.floor);
      const plan = planDependencies({ floor: a.floor, number: a.number, dependsOn: a.depends_on, issues: floor.issues, closed: () => false, inProgress: inProgress(floor)(a.number) });
      if (plan.body !== null) {
        await gh.editIssue(floor.fullName, a.number, { body: plan.body });
        cap.floors.add(floor.id);
      }
      return plan.summary;
    },

    async closeIssue(a) {
      const floor = floorNo(a.floor);
      checkCloseIssue({ floor: a.floor, number: a.number, state: await gh.issueState(floor.fullName, a.number), pulls: floor.pulls });
      await gh.closeIssue(floor.fullName, a.number, a.reason.trim(), 'not planned');
      ctx.closures.issueClosed(floor.id, a.number); // whoever was building it stops
      cap.floors.add(floor.id);
      return `Closed #${a.number} on floor ${a.floor} as not planned.`;
    },

    async askManager(a) {
      const floor = floorNo(a.floor);
      await ctx.questions.ask(floor.id, a.number, a.question.trim(), ceoName, 'ceo');
      return `Asked on #${a.number}. The issue waits for the manager's answer.`;
    },

    async startDiscussion(a) {
      if (made.discussions >= DISCUSSIONS_PER_JOB) throw new Error(`You already opened ${DISCUSSIONS_PER_JOB} discussions in this job. End it now: the manager's replies come back in them.`);
      const floor = a.floor !== undefined ? floorNo(a.floor) : floorOf(job.floorId);
      const title = a.title.trim().replace(/\s+/g, ' ');
      if (!title || !a.message.trim()) throw new Error('A discussion needs a title and an opening message.');
      const d = await desk().openDiscussion({ title, floorId: floor?.id ?? null, context: jobContext(), message: a.message.trim() });
      made.discussions++;
      return `Opened the discussion "${d.title}". End this job now, saying in your final message what you're waiting on: the manager's reply comes back to you in that discussion, where you carry on.`;
    },

    async resolveDiscussion(a) {
      if (job.kind !== 'discussion' || job.discussionId === null) throw new Error('Only a job in a discussion can resolve it, and this job is not one.');
      const outcome = a.outcome.trim();
      if (!outcome) throw new Error('Say what was decided.');
      await desk().resolveDiscussion(job.discussionId, outcome);
      return 'Settled. Now carry on with the work it was holding up, if any; your final message goes to the manager in this discussion.';
    },

    async proposeProject(a) {
      if (job.kind !== 'chat' || job.chatId === null) throw new Error('Projects are proposed in a chat with the manager, and this job is not one. Suggest it in your final message.');
      const draft = proposalFrom(a, { owners: await repoOwners(ctx), maxWorkers: settings().maxWorkers, floors: store.floorList().map((f) => f.fullName) });
      const p = await desk().propose(job.chatId, draft);
      made.proposalId = p.id;
      const where = draft.repo.kind === 'new' ? `a new ${draft.repo.private ? 'private' : 'public'} repository, ${repoName(draft.repo)}` : `the existing ${draft.repo.fullName}`;
      return `Proposed ${where}, a team of ${draft.teamSize} and ${draft.tasks.length} starting task${draft.tasks.length === 1 ? '' : 's'}. The manager sees it as a card in this chat and approves or declines it there; nothing is created until then. Tell them about it briefly in your final message.`;
    },

    async proposePlaybookChange(a) {
      const thread = job.kind === 'chat' && job.chatId !== null ? { kind: 'chat' as const, id: job.chatId } : job.kind === 'discussion' && job.discussionId !== null ? { kind: 'discussion' as const, id: job.discussionId } : null;
      if (!thread) throw new Error('Playbook changes are proposed in a chat or a discussion with the manager, and this job is neither. Suggest it in your final message.');
      if (!ctx.playbook) throw new Error("The office database isn't open, so there's no playbook to change.");
      const draft = playbookDraftFrom(a, (n) => {
        const floor = n !== undefined ? floorNo(n) : floorOf(job.floorId ?? (thread.kind === 'discussion' ? (ctx.desk?.thread('discussion', thread.id)?.floorId ?? null) : null));
        if (!floor) throw new Error("Say which floor: a floor's change needs floor.");
        return floor.id;
      });
      const p = await ctx.playbook.propose(thread, draft, a.why);
      return `Proposed ${p.docId !== null ? 'a change to' : 'new'} ${changeLabel(p.draft)}. The manager sees it as a card in this ${thread.kind} and approves, edits or declines it there; nothing changes until then. Mention it briefly in your final message.`;
    },
  };
}
