// The CEO's office tools, served to its CLI over MCP. Everything the CEO changes goes through these, so the office
// stays the one source of truth; a refusal goes back to the CEO as "Refused: …".
// Adapted from cubefarm server/ceo.ts (MIT): createOfficeTools.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { EffortLevel } from '../../../shared/types.ts';
import type { ProposeInput } from '../../desk/proposals.ts';
import type { OfficeTools } from '../../sessions/session.ts';

/** What the tools do, implemented by the office (office.ts). */
export interface OfficeHandlers {
  companyStatus(): string;
  workerDetail(a: { worker_id: string }): string;
  setFloorProfile(a: { floor: number; summary?: string; qa_brief?: string }): string;
  scaleTeam(a: { floor: number; size: number; reason: string; model?: string; effort?: EffortLevel }): string;
  configureWorker(a: { worker_id: string; model?: string; effort?: EffortLevel | '' }): string;
  fileIssue(a: { floor: number; title: string; body: string }): Promise<string>;
  setDependencies(a: { floor: number; number: number; depends_on: number[] }): Promise<string>;
  closeIssue(a: { floor: number; number: number; reason: string }): Promise<string>;
  askManager(a: { floor: number; number: number; question: string }): Promise<string>;
  startDiscussion(a: { title: string; message: string; floor?: number }): Promise<string>;
  resolveDiscussion(a: { outcome: string }): Promise<string>;
  proposeProject(a: ProposeInput): Promise<string>;
}

const EFFORT = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);

// Keep every schema to plain objects, strings, numbers, booleans and arrays, with flat fields rather than unions: one
// the SDK can't turn into JSON Schema (z.record did this in cubefarm) empties tools/list, and the CEO silently loses
// every tool. ceo.test.ts lists them.
export function createOfficeTools(h: OfficeHandlers): OfficeTools {
  const run = async (fn: () => string | Promise<string>) => {
    try {
      return { content: [{ type: 'text' as const, text: await fn() }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Refused: ${(err as Error).message}` }], isError: true };
    }
  };
  const defs = [
    tool(
      'company_status',
      'Everything about the company now: settings, and every floor (repo, clone path, brief, profile, QA brief), its team, capacity, backlog, pull requests and open questions. Call this first.',
      {},
      () => run(() => h.companyStatus()),
    ),
    tool('worker_detail', 'One worker in full: status, current task, model and effort.', { worker_id: z.string().describe('An id (or name) from company_status') }, (a) => run(() => h.workerDetail(a))),
    tool(
      'set_floor_profile',
      "Record your read of a floor's project: a one-line summary (kind of project and stack), and the QA brief that tells workers what to check when they test a pull request for it.",
      {
        floor: z.number().int().describe('Floor number'),
        summary: z.string().max(140).optional().describe('e.g. "3D browser game · Three.js + Vite + TypeScript"'),
        qa_brief: z.string().max(2500).optional().describe('What QA must check on every PR for this project, as short bullet points'),
      },
      (a) => run(() => h.setFloorProfile(a)),
    ),
    tool(
      'scale_team',
      'Set how many workers a floor has; the floor then holds that size. Every worker builds issues, tests pull requests and fixes them, whichever is next. Shrinking: idle workers leave first; a busy one leaves when its task ends.',
      {
        floor: z.number().int(),
        size: z.number().int().min(1).max(15).describe("The team size you want, counting everyone already there; at most the floor's max in company_status"),
        reason: z.string().min(1).max(600).describe('Why, from the work waiting. The manager reads this.'),
        model: z.string().optional().describe("New workers' model; leave out for the office default"),
        effort: EFFORT.optional().describe("New workers' reasoning effort; leave out for the default"),
      },
      (a) => run(() => h.scaleTeam(a)),
    ),
    tool(
      'configure_worker',
      "Change a worker's model or reasoning effort, from their next task.",
      {
        worker_id: z.string(),
        model: z.string().optional().describe('"" for the office default'),
        effort: z.union([EFFORT, z.literal('')]).optional().describe('"" for the office default'),
      },
      (a) => run(() => h.configureWorker(a)),
    ),
    tool(
      'file_issue',
      'File a GitHub issue on a floor, only for work the manager asked for in this job (a plan, or their message); anything else is refused. Write "Depends on #N" in the body only when it cannot start until #N is merged.',
      {
        floor: z.number().int(),
        title: z.string().max(120),
        body: z.string().max(6000).describe('Context, what to build, acceptance criteria'),
      },
      (a) => run(() => h.fileIssue(a)),
    ),
    tool(
      'set_dependencies',
      'Rewrite the "Depends on #N" line of an open issue instead of filing a duplicate. The rest of the body stays. Not for an issue in progress.',
      {
        floor: z.number().int(),
        number: z.number().int().positive().describe('The issue number'),
        depends_on: z.array(z.number().int().positive()).max(10).describe('Issues it waits for; [] for none'),
      },
      (a) => run(() => h.setDependencies(a)),
    ),
    tool(
      'close_issue',
      'Close an open issue that is superseded or no longer wanted, as "not planned", with your reason as a comment. Not while an open pull request closes it.',
      {
        floor: z.number().int(),
        number: z.number().int().positive().describe('The issue number'),
        reason: z.string().min(1).max(1000).describe('Posted as a comment, e.g. "Superseded by #152."'),
      },
      (a) => run(() => h.closeIssue(a)),
    ),
    tool(
      'ask_manager',
      "Ask the manager about an issue that's too unclear to plan or build, as a comment on it. The issue waits for their answer, which goes into its next prompt.",
      {
        floor: z.number().int(),
        number: z.number().int().positive().describe('The issue number'),
        question: z.string().min(1).max(1000).describe('One clear question, with the options you see'),
      },
      (a) => run(() => h.askManager(a)),
    ),
    tool(
      'start_discussion',
      "Open a discussion with the manager to settle something before you plan or act: a choice only they can make. At most 2 per job. Then end the job: their reply comes back to you in that discussion.",
      {
        title: z.string().min(1).max(80).describe('What it settles, e.g. "Sign-in: email links or passwords?"'),
        message: z.string().min(1).max(3000).describe('Your opening message: the question, the options you see, and what you would pick'),
        floor: z.number().int().optional().describe("The floor it's about; leave out for the company, or this job's floor"),
      },
      (a) => run(() => h.startDiscussion(a)),
    ),
    tool(
      'resolve_discussion',
      'Mark the discussion this job answers as settled, with the outcome, once you and the manager agree. Then carry on with the work it was holding up.',
      { outcome: z.string().min(1).max(1000).describe('What was decided, in a sentence or two') },
      (a) => run(() => h.resolveDiscussion(a)),
    ),
    tool(
      'propose_project',
      'Put a new project on a card in this chat for the manager to approve: its repository (a new one, or an existing one), brief, team size and starting tasks. Only in a chat, once the plan is ready and the manager agrees. Nothing is created until they approve; a new proposal replaces your pending one.',
      {
        new_repo_name: z.string().optional().describe('A new repository: its name (letters, digits, ".", "-", "_")'),
        new_repo_owner: z.string().optional().describe("Who owns the new repository: the manager's login (the default) or one of their organisations (company_status lists them)"),
        description: z.string().max(350).optional().describe("The new repository's one-line description"),
        private: z.boolean().optional().describe('A private repository (the default), or false for a public one'),
        existing_repo: z.string().optional().describe('"owner/name" of an existing repository to use instead of a new one'),
        brief: z.string().min(1).max(4000).describe("What the project is, who it's for and what the first milestone delivers. It becomes the floor's brief"),
        team_size: z.number().int().min(1).describe("Workers to start with; at most the floor's max in company_status"),
        tasks: z
          .array(
            z.object({
              title: z.string().min(1).max(256),
              body: z.string().max(6000).describe('Context, what to build, acceptance criteria'),
              depends_on: z.array(z.number().int().min(0)).optional().describe('Indices (from 0) of earlier tasks it waits for'),
            }),
          )
          .min(1)
          .max(12)
          .describe('The starting tasks, filed as issues in this order: one per whole feature'),
      },
      (a) => run(() => h.proposeProject(a)),
    ),
  ];
  return {
    serve: () => createSdkMcpServer({ name: 'office', version: '1.0.0', tools: defs }).instance,
    async call(name, args) {
      const def = defs.find((d) => d.name === name);
      if (!def) throw new Error(`No office tool ${name}`);
      const res = (await def.handler(args as never, undefined)) as { content: { text?: string }[] };
      return res.content.map((c) => c.text ?? '').join('\n');
    },
  };
}
