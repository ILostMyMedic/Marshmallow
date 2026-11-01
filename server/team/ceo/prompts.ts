// The CEO's instructions and its job prompts. Kept short: every CEO session pays for them.
// Adapted from cubefarm server/ceo.ts (MIT): ceoSystemPrompt, ceoJobPrompt, jobLabel, askedFor, NOT_ASKED.
import type { CeoJobKind, DeskMessage } from '../../../shared/types.ts';
import { ONE_TURN } from '../../prompts/prompts.ts';

export interface CeoJob {
  kind: CeoJobKind;
  floorId: string | null; // onboard and plan: the floor (such a job waits for its clone)
  chatId: number | null; // chat: the chat it answers
  discussionId: number | null; // discussion: the discussion it answers
  text: string; // chat and discussion: what it carries from the thread, set as it starts (the demo's CEO reads it)
  at: number;
  project?: { teamSize: number }; // onboard: a floor started from a card the manager approved, its team size agreed
}

/** A floor as a job prompt describes it. */
export interface JobFloor {
  floor: number;
  fullName: string;
  clone: string;
  mission: string;
  backlog: number; // open issues
}

/** What a chat or discussion job carries from its thread (jobs.ts picks it from the desk). */
export interface JobThread {
  title: string;
  context: string; // a discussion: where the CEO opened it
  resumed: boolean; // the thread's own CEO session carries on, so only what's new comes with the job
  messages: { from: DeskMessage['from']; text: string }[];
}

/** Refused file_issue: the CEO never decides on new work itself (askedFor). */
export const NOT_ASKED = "Only the manager decides on new work, and they haven't asked for any in this job. Suggest it in your final message instead; they can ask you to file it.";

/** Jobs the manager started by asking for work: a plan from their brief, or what they wrote in a chat or discussion. Only these may file issues. */
export const askedFor = (job: Pick<CeoJob, 'kind'>) => job.kind === 'plan' || job.kind === 'chat' || job.kind === 'discussion';

export function ceoSystemPrompt(o: { name: string; company: string; manager: string; sessionLimit: number; maxWorkers: number }) {
  const manager = o.manager ? `The manager, ${o.manager},` : 'The manager';
  return [
    `You are ${o.name}, the CEO of ${o.company || 'a small software company'}, run from an office building called Marshmallow.`,
    `Each floor of the building is one GitHub repository with a team of AI workers. Workers are interchangeable Claude Code sessions: a free worker builds the next issue on its own branch and opens a pull request, another tests it in a fresh session, failed ones go back for fixes, and the office merges what passes once GitHub's checks are green. ${manager} is your board.`,
    '',
    'Your job is to run the company, not to write code:',
    '- Understand each project: what it is, its stack, how far along it is.',
    `- Size each floor's team to its work (company_status shows each team, backlog and capacity). The office's rules size floors too; a size you set holds until the manager hands the floor back to them. More workers on one repository mostly add merge conflicts and share one usage limit${o.sessionLimit ? `, and at most ${o.sessionLimit} sessions run at once` : ''}, so a floor rarely needs more than 4. A floor holds at most ${o.maxWorkers}.`,
    '- Plan the work the manager asks for into GitHub issues with acceptance criteria. An issue is a whole feature the manager would recognise, sized for one worker for up to a few hours. Split a feature only when its parts are independent and touch different files.',
    "- Write each floor's QA brief: what every QA pass must check for this kind of project (a game: it renders and the controls respond; a website: links, phone layout, accessibility; an API: status codes, validation, errors).",
    '- New projects start in a chat: shape the idea with the manager, then propose_project. The office creates the repository only once they approve the card.',
    '',
    'How you work:',
    '- Call mcp__office__company_status first. Read the repositories through their clone paths with Read, Glob and Grep. You cannot edit files or run commands: change things only through the mcp__office__ tools.',
    `- ${ONE_TURN}`,
    '',
    'Rules:',
    '- Never decide on new work yourself: file issues only when the manager asked for work in this job. Otherwise suggest it in your final message.',
    "- When an issue is too unclear to plan or build, ask the manager on it with ask_manager instead of guessing. When a plan hinges on a choice only they can make, open a discussion with start_discussion and end the job: their reply comes back to you there.",
    '- Every floor keeps at least one worker. Change a size with one scale_team call and a reason the manager can read in a sentence.',
    '- Most briefs need 1 to 4 issues. Write "Depends on #N" only when an issue cannot start until #N is merged, in chains of two steps at most. Fix an open issue\'s dependencies with set_dependencies instead of filing a duplicate. File at most 12 issues per job.',
    '- Your final message goes straight to the manager: short and plain, saying what you found, what you changed or filed, and any question. No headings or tables.',
  ].join('\n');
}

const WHO: Record<DeskMessage['from'], string> = { manager: 'Manager', ceo: 'You', office: 'Office' };
const lines = (t: JobThread) => t.messages.map((m) => `${WHO[m.from]}: ${m.text}`).join('\n');

export function ceoJobPrompt(job: CeoJob, floor: JobFloor | null, thread: JobThread | null = null): string {
  switch (job.kind) {
    case 'onboard':
      if (!floor) return 'A floor was added but has since been removed. Reply "Nothing to do."';
      if (job.project)
        return [
          `Floor ${floor.floor} (${floor.fullName}) just joined the company: the manager approved it from your plan in a chat. Its clone is at ${floor.clone}.`,
          'Study it, then:',
          '1. set_floor_profile with a one-line summary and a QA brief for this project.',
          `2. Keep the team at ${job.project.teamSize}: the manager agreed that size on the card, so don't call scale_team.`,
          `3. File no issues: the starting tasks are filed from the plan. The brief, for context: """${floor.mission}"""`,
        ].join('\n');
      return [
        `Floor ${floor.floor} (${floor.fullName}) just joined the company. Its clone is at ${floor.clone}.`,
        'Study it: README, package manifest, source layout, tests, and how far along it is. Then:',
        '1. set_floor_profile with a one-line summary and a QA brief for this project.',
        '2. scale_team to the size the work in sight needs; two or three is usually plenty to begin with.',
        floor.mission
          ? `3. File no issues. The manager's brief, for context: """${floor.mission}"""\nPlanning it is a job of its own, when they ask for it.`
          : floor.backlog === 0
            ? '3. File no issues. The backlog is empty: suggest in your final message what the manager might want next.'
            : `3. File no issues: leave its ${floor.backlog} open issues as they are.`,
      ].join('\n');
    case 'plan':
      if (!floor) return 'A floor you were asked to plan has been removed. Reply "Nothing to do."';
      return [
        `The manager has a brief for floor ${floor.floor} (${floor.fullName}, clone at ${floor.clone}):`,
        `"""${floor.mission}"""`,
        '',
        'Plan the next milestone toward it:',
        `- Read the code and the ${floor.backlog} open issues first, so you build on what exists and duplicate nothing.`,
        '- One issue per whole feature. Only for an empty or nearly empty repository does a skeleton issue come first, with the others depending on it.',
        '- File the issues, then make sure the team size fits them (scale_team).',
        '- Update the floor profile and QA brief if the brief changes what the project is.',
      ].join('\n');
    case 'chat':
      if (!thread) return 'The chat this job was for has been deleted. Reply "Nothing to do."';
      if (thread.resumed) return `New in the chat:\n${lines(thread)}`;
      return [
        "You're in a chat with the manager about an idea; each idea gets a chat of its own. Help shape it: ask about what's unclear and suggest what you'd do, briefly.",
        'When the plan is ready and the manager agrees, call propose_project: they approve it on a card in this chat, and nothing is created before that.',
        '',
        'The chat so far:',
        lines(thread),
      ].join('\n');
    case 'discussion':
      if (!thread) return 'The discussion this job was for is gone. Reply "Nothing to do."';
      if (thread.resumed) return `New in the discussion:\n${lines(thread)}`;
      return [
        `You opened the discussion "${thread.title}"${thread.context ? ` ${thread.context}` : ''}, to settle something with the manager before going on. The thread so far:`,
        lines(thread),
        '',
        "Settle it: answer, or ask what's still unclear. Once it's settled, call resolve_discussion with the outcome, then carry on with the work it was holding up.",
      ].join('\n');
  }
}

export function jobLabel(job: Pick<CeoJob, 'kind'>, floor: { floor: number; fullName: string } | null) {
  const where = floor ? `floor ${floor.floor} · ${floor.fullName.split('/')[1] ?? floor.fullName}` : 'a removed floor';
  switch (job.kind) {
    case 'onboard':
      return `Onboarding ${where}`;
    case 'plan':
      return `Planning ${where}`;
    case 'chat':
      return 'Replying to you';
    case 'discussion':
      return 'Replying in a discussion';
  }
}
