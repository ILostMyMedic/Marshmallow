// The rules for a project the CEO proposes: propose_project's input checked, the manager's edits on approval checked
// against the same rules, and the tasks as issues (their "Depends on #N" with the numbers they were filed as). Pure;
// projects.ts starts what passes.
import { setDependsOn } from '../../shared/issues.ts';
import type { ProposalRepo, ProposalTask } from '../../shared/types.ts';
import type { ProposalDraft } from '../db/desk.ts';
import { HttpError } from '../httpError.ts';

export const MAX_TASKS = 12;
const MAX_CHAIN = 2;
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const FULL_NAME = /^[\w.-]+\/[\w.-]+$/;
/** Under every issue filed from an approved card. */
export const PLAN_FOOTER = "\n\n_Filed by Marshmallow's CEO from the plan you approved._";

/** propose_project's input, as the CEO's tool takes it (tools.ts). */
export interface ProposeInput {
  new_repo_name?: string;
  new_repo_owner?: string;
  description?: string;
  private?: boolean;
  existing_repo?: string;
  brief: string;
  team_size: number;
  tasks: { title: string; body: string; depends_on?: number[] }[];
}

/** What a proposal is checked against: where repositories can go, the floor limit, and the floors there are. */
export interface ProposalRules {
  owners: readonly string[]; // the gh login first
  maxWorkers: number;
  floors: readonly string[]; // connected floors' owner/name
}

const bad = (message: string) => new HttpError(400, message);
const listOf = (xs: readonly string[], word = 'or') => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${word} ${xs.at(-1)}`);

function notAFloor(fullName: string, floors: readonly string[]) {
  if (floors.some((f) => f.toLowerCase() === fullName.toLowerCase())) throw new HttpError(409, `${fullName} is a floor already`);
}

/** Where the project lives, checked: a new repository's name and owner, or an existing one that isn't a floor yet. */
export function checkRepo(repo: ProposalRepo, r: Pick<ProposalRules, 'owners' | 'floors'>): ProposalRepo {
  if (repo.kind === 'existing') {
    const fullName = repo.fullName.trim();
    if (!FULL_NAME.test(fullName)) throw bad(`"${repo.fullName}" isn't a repository name like owner/name`);
    notAFloor(fullName, r.floors);
    return { kind: 'existing', fullName };
  }
  const name = repo.name.trim();
  if (!REPO_NAME.test(name) || name === '.' || name === '..') throw bad(`"${repo.name}" can't be a repository name: use 1 to 100 letters, digits, ".", "-" or "_"`);
  if (!r.owners.length) throw bad("The office couldn't read your GitHub login yet, so it doesn't know where a new repository can go. Try again in a minute");
  const owner = r.owners.find((o) => o.toLowerCase() === repo.owner.trim().toLowerCase());
  if (!owner) throw bad(`A new repository can go under ${listOf(r.owners)}, not "${repo.owner}"`);
  notAFloor(`${owner}/${name}`, r.floors);
  const description = repo.description.trim().replace(/\s+/g, ' ');
  if (description.length > 350) throw bad('Keep the description to 350 characters');
  return { kind: 'new', owner, name, description, private: repo.private };
}

export function checkTeamSize(size: unknown, maxWorkers: number): number {
  if (!Number.isInteger(size) || (size as number) < 1 || (size as number) > maxWorkers) throw bad(`The team size must be a whole number from 1 to ${maxWorkers} (the most a floor holds)`);
  return size as number;
}

/**
 * The starting tasks, checked: 1 to 12, each with a title, waiting only on tasks before it (indices from 0), in chains
 * of two steps at most (the CEO's rule for dependencies everywhere).
 */
export function checkTasks(tasks: readonly { title: string; body: string; depends_on?: readonly number[] }[]): ProposalTask[] {
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > MAX_TASKS) throw bad(`Propose 1 to ${MAX_TASKS} starting tasks`);
  const depth: number[] = [];
  return tasks.map((t, i) => {
    const title = String(t?.title ?? '').trim();
    if (!title) throw bad(`tasks[${i}] needs a title`);
    if (title.length > 256) throw bad(`Keep tasks[${i}]'s title under 256 characters; the rest can go in its body`);
    const body = String(t?.body ?? '').trim();
    if (body.length > 6000) throw bad(`Keep tasks[${i}]'s body to 6000 characters`);
    const deps = [...new Set<number>(t?.depends_on ?? [])].sort((a, b) => a - b);
    for (const d of deps) {
      if (!Number.isInteger(d) || d < 0 || d >= i) throw bad(`tasks[${i}] can only depend on tasks before it (indices 0 to ${i - 1}), not ${d}`);
    }
    depth[i] = Math.max(0, ...deps.map((d) => depth[d] + 1));
    if (depth[i] > MAX_CHAIN) throw bad(`tasks[${i}] makes a dependency chain ${depth[i]} steps deep. Keep chains to ${MAX_CHAIN} steps at most: fold the dependent pieces into one task`);
    return { title, body, dependsOn: deps };
  });
}

/** propose_project's input as a proposal, or why it can't be one. A new repository's owner defaults to the gh login. */
export function proposalFrom(input: ProposeInput, r: ProposalRules): ProposalDraft {
  const name = input.new_repo_name?.trim() ?? '';
  const existing = input.existing_repo?.trim() ?? '';
  if (!!name === !!existing) throw bad('Give either new_repo_name (a new repository) or existing_repo (owner/name), not both');
  const repo: ProposalRepo = existing
    ? { kind: 'existing', fullName: existing }
    : { kind: 'new', owner: input.new_repo_owner?.trim() || (r.owners[0] ?? ''), name, description: input.description ?? '', private: input.private ?? true };
  const brief = String(input.brief ?? '').trim();
  if (!brief) throw bad('The project needs a brief');
  if (brief.length > 4000) throw bad('Keep the brief to 4000 characters');
  return { repo: checkRepo(repo, r), brief, teamSize: checkTeamSize(input.team_size, r.maxWorkers), tasks: checkTasks(input.tasks) };
}

/** A repository from the manager's edited card (the REST body's `repo`), in shape; checkRepo checks the rest. */
export function repoFromBody(raw: unknown): ProposalRepo {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (b.kind === 'existing' && typeof b.fullName === 'string') return { kind: 'existing', fullName: b.fullName };
  if (b.kind === 'new' && typeof b.owner === 'string' && typeof b.name === 'string') {
    if (b.description !== undefined && typeof b.description !== 'string') throw bad('repo.description must be text');
    if (b.private !== undefined && typeof b.private !== 'boolean') throw bad('repo.private must be true or false');
    return { kind: 'new', owner: b.owner, name: b.name, description: (b.description as string | undefined) ?? '', private: (b.private as boolean | undefined) ?? true };
  }
  throw bad('repo must be { kind: "new", owner, name, description, private } or { kind: "existing", fullName }');
}

/** The tasks the manager kept (indices into `tasks`), in their order, with dependencies on dropped ones gone. */
export function keepTasks(tasks: readonly ProposalTask[], keep: unknown): ProposalTask[] {
  if (!Array.isArray(keep) || keep.some((i) => !Number.isInteger(i) || i < 0 || i >= tasks.length)) throw bad(`tasks must be a list of task indices, 0 to ${tasks.length - 1}`);
  const kept = [...new Set(keep as number[])].sort((a, b) => a - b);
  const at = new Map(kept.map((old, i) => [old, i]));
  return kept.map((old) => ({ ...tasks[old], dependsOn: tasks[old].dependsOn.flatMap((d) => (at.has(d) ? [at.get(d)!] : [])) }));
}

/** A task as its issue's body: "Depends on #N" with the numbers its earlier tasks were filed as, and the footer. */
export function taskBody(task: ProposalTask, filed: readonly number[]): string {
  const deps = task.dependsOn.flatMap((i) => (filed[i] !== undefined ? [filed[i]] : []));
  return `${setDependsOn(task.body, deps)}${PLAN_FOOTER}`;
}

/** Issue numbers for a sentence: "#4–#8" when they run in a row, else "#4, #6 and #9". */
export function issueList(numbers: readonly number[]): string {
  if (numbers.length > 2 && numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1)) return `#${numbers[0]}–#${numbers.at(-1)}`;
  return listOf(
    numbers.map((n) => `#${n}`),
    'and',
  );
}

/** owner/name of where a proposal lives. */
export const repoName = (repo: ProposalRepo) => (repo.kind === 'new' ? `${repo.owner}/${repo.name}` : repo.fullName);
