// The office's side of the CEO's tools: what each one reads or changes. Floors are named by number, as the CEO sees
// them; workers by id or name.
// Adapted from cubefarm server/swarm.ts (MIT): the office tools section and companyStatus.
import { effectiveModel } from '../../../shared/models.ts';
import { isBusy, type Floor, type Worker } from '../../../shared/types.ts';
import type { Ctx } from '../../pipeline/context.ts';
import { readyIssues } from '../../pipeline/scheduler.ts';
import { floorCapacity } from '../autoscale.ts';
import { checkCloseIssue, planDependencies, type IssueCap } from './issueRules.ts';
import { askedFor, NOT_ASKED, type CeoJob } from './prompts.ts';
import type { OfficeHandlers } from './tools.ts';

/** Under every issue the CEO files. */
const FILED_BY = "\n\n_Filed by Marshmallow's CEO._";

export function officeHandlers(ctx: Ctx, job: CeoJob, cap: IssueCap, ceoName: string): OfficeHandlers {
  const { store, backend } = ctx;
  const gh = backend.github;
  const settings = () => store.getSettings();

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
  };
}
