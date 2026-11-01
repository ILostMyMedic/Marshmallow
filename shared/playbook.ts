// The playbook: the office's and each floor's agent docs, which every session on a floor gets without anything committed
// to its repository. Rules are markdown appended to the session's system prompt (paid on every turn); skills, subagents
// and commands go into a plugin the office writes for the session (--plugin-dir). Here: the types, the checks the server
// and the console share, the templates, what a floor gets, and a line diff for the CEO's proposed changes. New in
// Marshmallow (cubefarm has no playbook).

export const PLAYBOOK_KINDS = ['rules', 'skill', 'agent', 'command'] as const;
/** rules: appended to the system prompt; skill: a SKILL.md; agent: a subagent; command: a slash command. */
export type PlaybookKind = (typeof PLAYBOOK_KINDS)[number];
export type PluginKind = Exclude<PlaybookKind, 'rules'>;
export type PlaybookScope = 'office' | 'floor';

export interface PlaybookDoc {
  id: number;
  scope: PlaybookScope;
  floorId: string | null; // the floor's, for scope 'floor'; null for the office's
  kind: PlaybookKind;
  name: string; // lowercase-hyphen: the skill's, subagent's or command's name in Claude Code
  description: string; // when Claude should use it (skills, subagents, commands); for rules, a note to yourself
  body: string; // markdown; {workBranch}, {defaultBranch} and {repo} are filled per floor at launch
  tools: string; // a subagent's tools, comma-separated ('' = all of the session's)
  model: string; // a subagent's model ('' = the session's)
  enabled: boolean;
  updatedAt: number;
}

/** A doc as written, before the office gives it an id. */
export type PlaybookDraft = Pick<PlaybookDoc, 'scope' | 'floorId' | 'kind' | 'name' | 'description' | 'body' | 'tools' | 'model'>;

/** A change the CEO proposed in a chat or a discussion, as a card the manager approves (maybe edited) or declines. */
export interface PlaybookProposal {
  id: number;
  thread: { kind: 'chat' | 'discussion'; id: number };
  at: number;
  status: 'pending' | 'approved' | 'declined';
  draft: PlaybookDraft;
  docId: number | null; // the doc it changes; null: a new one
  before: { description: string; body: string } | null; // that doc when it was proposed, for the diff
  why: string;
  decidedAt: number | null;
}

/** Everything the console's Playbook tab and the desktop's cards show. */
export interface PlaybookView {
  docs: PlaybookDoc[]; // in the order they were made
  proposals: PlaybookProposal[]; // the latest, oldest first
}

export const EMPTY_PLAYBOOK: PlaybookView = { docs: [], proposals: [] };

export const KIND_NAMES: Record<PlaybookKind, { one: string; many: string; icon: string }> = {
  rules: { one: 'rules', many: 'Rules', icon: '📜' },
  skill: { one: 'skill', many: 'Skills', icon: '🧩' },
  agent: { one: 'subagent', many: 'Subagents', icon: '🤖' },
  command: { one: 'command', many: 'Commands', icon: '⌨️' },
};

// ---------- checks ----------

/** Claude Code's names for skills, subagents and commands: lowercase letters, digits and single hyphens. */
export const DOC_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DOC_LIMITS = { name: 64, description: 1024, body: 50_000, tools: 300, model: 80 } as const;
const TOOLS = /^[A-Za-z0-9_*().:/, -]*$/;
const MODEL = /^[A-Za-z0-9._[\]-]*$/;

export type DocField = 'name' | 'description' | 'body' | 'tools' | 'model';
type DocText = Pick<PlaybookDraft, 'kind' | 'name' | 'description' | 'body' | 'tools' | 'model'>;

export const isPlaybookKind = (k: unknown): k is PlaybookKind => PLAYBOOK_KINDS.includes(k as PlaybookKind);

/** A doc tidied the way the office keeps it: one-line description, LF line ends, tools as "A, B", no agent fields on others. */
export function cleanDoc<T extends DocText>(d: T): T {
  const agent = d.kind === 'agent';
  return {
    ...d,
    name: d.name.trim(),
    description: d.description.replace(/\s+/g, ' ').trim(),
    body: d.body.replace(/\r\n?/g, '\n').replace(/\s+$/, ''),
    tools: agent
      ? d.tools
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .join(', ')
      : '',
    model: agent ? d.model.trim() : '',
  };
}

/** What's wrong with a doc, field by field (empty when it can be saved). Run it on a cleaned doc. */
export function docProblems(d: DocText): Partial<Record<DocField, string>> {
  const out: Partial<Record<DocField, string>> = {};
  if (!d.name) out.name = 'Give it a name';
  else if (d.name.length > DOC_LIMITS.name) out.name = `At most ${DOC_LIMITS.name} characters`;
  else if (!DOC_NAME.test(d.name)) out.name = 'Lowercase letters, digits and single hyphens, like work-branch-flow';
  if (d.kind !== 'rules' && !d.description) out.description = `Say when Claude should use this ${KIND_NAMES[d.kind].one}: it decides from this line`;
  else if (d.description.length > DOC_LIMITS.description) out.description = `At most ${DOC_LIMITS.description} characters`;
  if (!d.body.trim()) out.body = 'Write what it says';
  else if (d.body.length > DOC_LIMITS.body) out.body = `At most ${DOC_LIMITS.body.toLocaleString('en')} characters`;
  if (d.kind === 'agent') {
    if (d.tools.length > DOC_LIMITS.tools || !TOOLS.test(d.tools)) out.tools = 'Tool names separated by commas, like Read, Grep, Bash';
    if (d.model.length > DOC_LIMITS.model || !MODEL.test(d.model)) out.model = 'A model name, like sonnet or claude-opus-5-5, or empty for the session’s';
  }
  return out;
}

/** The first problem with a doc, for a refusal; null when there's none. */
export function docProblem(d: DocText): string | null {
  const [field, why] = Object.entries(docProblems(d))[0] ?? [];
  return field ? `${field}: ${why}` : null;
}

/** The same doc: same scope, floor, kind and name (names are unique within those). */
export const sameDoc = (a: Pick<PlaybookDraft, 'scope' | 'floorId' | 'kind' | 'name'>, b: Pick<PlaybookDraft, 'scope' | 'floorId' | 'kind' | 'name'>) =>
  a.scope === b.scope && (a.floorId ?? null) === (b.floorId ?? null) && a.kind === b.kind && a.name === b.name;

// ---------- placeholders ----------

/** A floor as the playbook fills it in: its work branch is where its work starts and merges (its default branch when unset). */
export interface PlaybookFloor {
  id: string;
  fullName: string;
  defaultBranch: string;
  workBranch?: string | null;
}

export const PLACEHOLDERS = ['workBranch', 'defaultBranch', 'repo'] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

/** What each placeholder becomes on a floor; without one (the CEO's, or the office's preview), plain words. */
export function placeholderValues(floor: PlaybookFloor | null): Record<Placeholder, string> {
  if (!floor) return { workBranch: "the floor's work branch", defaultBranch: 'the default branch', repo: 'the repository' };
  return { workBranch: floor.workBranch || floor.defaultBranch, defaultBranch: floor.defaultBranch, repo: floor.fullName };
}

/** `text` with {workBranch}, {defaultBranch} and {repo} filled in for `floor`. */
export function fill(text: string, floor: PlaybookFloor | null): string {
  const v = placeholderValues(floor);
  return text.replace(/\{(workBranch|defaultBranch|repo)\}/g, (_, k: Placeholder) => v[k]);
}

// ---------- sizes ----------

/** Rules are paid for on every turn of every session: past this many lines the console warns. */
export const RULES_LINES_WARN = 200;

export interface TextSize {
  lines: number;
  tokens: number; // about four characters a token: a guide, not a count
}

export function textSize(text: string): TextSize {
  const t = text.replace(/\s+$/, '');
  return { lines: t ? t.split('\n').length : 0, tokens: Math.ceil(t.length / 4) };
}

// ---------- what a session gets ----------

export const PLUGIN_NAME = 'marshmallow';
const RULES_HEAD = "# The manager's rules (Marshmallow's playbook)";

export interface PluginEntry {
  kind: PluginKind;
  name: string;
  scope: PlaybookScope; // a floor's doc replaces the office's of the same kind and name
  path: string; // inside the plugin, with forward slashes
}

export interface PluginFile {
  path: string; // inside the plugin, with forward slashes
  content: string;
}

export interface SessionPlaybook {
  /** Appended to the session's system prompt ('' with no rules): the office's first, then the floor's. */
  rules: string;
  size: TextSize & { heavy: boolean };
  rulesDocs: { name: string; scope: PlaybookScope }[];
  entries: PluginEntry[];
  /** The plugin's files, the manifest first; none when there are no skills, subagents or commands. */
  files: PluginFile[];
}

export const NO_PLAYBOOK: SessionPlaybook = { rules: '', size: { lines: 0, tokens: 0, heavy: false }, rulesDocs: [], entries: [], files: [] };

// A JSON string is a YAML double-quoted scalar: whatever the line holds (colons, quotes, #), it reads back as written.
const yaml = (s: string) => JSON.stringify(s.replace(/\s+/g, ' ').trim());

function frontmatter(fields: [string, string][]): string {
  return ['---', ...fields.filter(([, v]) => v).map(([k, v]) => `${k}: ${k === 'name' ? v : yaml(v)}`), '---', ''].join('\n');
}

const KIND_ORDER: Record<PluginKind, number> = { skill: 0, agent: 1, command: 2 };

const entryPath = (kind: PluginKind, name: string) => (kind === 'skill' ? `skills/${name}/SKILL.md` : kind === 'agent' ? `agents/${name}.md` : `commands/${name}.md`);

/** A skill, subagent or command as its file in the plugin, filled in for `floor`. */
export function pluginFile(d: Pick<PlaybookDoc, 'kind' | 'name' | 'description' | 'body' | 'tools' | 'model'>, floor: PlaybookFloor | null): PluginFile {
  const kind = d.kind as PluginKind;
  const description = fill(d.description, floor);
  const body = `${fill(d.body, floor).replace(/\s+$/, '')}\n`;
  const head =
    kind === 'skill'
      ? frontmatter([
          ['name', d.name],
          ['description', description],
        ])
      : kind === 'agent'
        ? frontmatter([
            ['name', d.name],
            ['description', description],
            ['tools', d.tools],
            ['model', d.model],
          ])
        : frontmatter([['description', description]]);
  return { path: entryPath(kind, d.name), content: `${head}\n${body}` };
}

/** The plugin's manifest. */
export function pluginManifest(floor: PlaybookFloor | null): PluginFile {
  const manifest = { name: PLUGIN_NAME, description: `The manager's skills, subagents and commands from Marshmallow's playbook${floor ? `, for ${floor.fullName}` : ''}.`, version: '1.0.0', author: { name: 'Marshmallow' } };
  return { path: '.claude-plugin/plugin.json', content: `${JSON.stringify(manifest, null, 2)}\n` };
}

/**
 * What a session gets from the playbook: on a floor, the enabled office and floor rules (the office's first) and every
 * enabled skill, subagent and command as a plugin, a floor's replacing the office's of the same kind and name, all
 * filled in for the floor. Without a floor (the CEO), the office's rules only.
 */
export function playbookFor(docs: readonly PlaybookDoc[], floor: PlaybookFloor | null): SessionPlaybook {
  const live = docs.filter((d) => d.enabled && (d.scope === 'office' || (floor !== null && d.scope === 'floor' && d.floorId === floor.id)));
  const byId = (a: PlaybookDoc, b: PlaybookDoc) => Number(b.scope === 'office') - Number(a.scope === 'office') || a.id - b.id;
  const rulesDocs = live.filter((d) => d.kind === 'rules').sort(byId);
  const rules = rulesDocs.length ? [RULES_HEAD, ...rulesDocs.map((d) => fill(d.body, floor).trim())].join('\n\n') : '';
  const size = textSize(rules);
  const picked = new Map<string, PlaybookDoc>();
  if (floor) {
    for (const d of live.filter((x) => x.kind !== 'rules').sort(byId)) {
      const key = `${d.kind}:${d.name}`;
      const had = picked.get(key);
      if (!had || (had.scope === 'office' && d.scope === 'floor')) picked.set(key, d);
    }
  }
  const plugin = [...picked.values()].sort((a, b) => KIND_ORDER[a.kind as PluginKind] - KIND_ORDER[b.kind as PluginKind] || a.name.localeCompare(b.name));
  const entries = plugin.map((d): PluginEntry => ({ kind: d.kind as PluginKind, name: d.name, scope: d.scope, path: entryPath(d.kind as PluginKind, d.name) }));
  return {
    rules,
    size: { ...size, heavy: size.lines > RULES_LINES_WARN },
    rulesDocs: rulesDocs.map((d) => ({ name: d.name, scope: d.scope })),
    entries,
    files: plugin.length ? [pluginManifest(floor), ...plugin.map((d) => pluginFile(d, floor))] : [],
  };
}

/** The office's instructions for a task with the playbook's rules after them. */
export const withRules = (systemAppend: string, rules: string) => (rules ? `${systemAppend.replace(/\s+$/, '')}\n\n${rules}\n` : systemAppend);

// ---------- templates ----------

export interface PlaybookTemplate {
  id: string;
  title: string;
  blurb: string; // what it's for, in the gallery
  kind: PlaybookKind;
  name: string;
  description: string;
  body: string;
  tools?: string;
}

export const TEMPLATES: readonly PlaybookTemplate[] = [
  {
    id: 'work-branch-flow',
    title: 'Work branch flow',
    blurb: "Work happens on the floor's work branch (dev, say): PRs go there, a task is done once merged there, and the default branch is left alone. For a floor whose work branch isn't its default branch.",
    kind: 'rules',
    name: 'work-branch-flow',
    description: 'Where branches start and pull requests go',
    body: [
      '## Branches and pull requests',
      '- Start your branch from `{workBranch}`, and open your pull request into `{workBranch}`.',
      "- You're done once your pull request is merged into `{workBranch}`: nothing more is needed on `{defaultBranch}`.",
      '- Never push to `{defaultBranch}` or open a pull request into it: the manager moves work there.',
    ].join('\n'),
  },
  {
    id: 'default-branch-live',
    title: 'The default branch runs live',
    blurb: 'The default branch is what runs on the manager’s computer: only the manager merges into it, and the live app is left alone.',
    kind: 'rules',
    name: 'default-branch-live',
    description: 'The default branch is the live one',
    body: [
      '## `{defaultBranch}` runs live',
      "- `{defaultBranch}` runs live on the manager's computer. Only the manager merges into it.",
      "- Don't push to `{defaultBranch}`, rewrite its history, or open pull requests into it.",
      "- Leave the live app alone: its ports, data and config. Test with your own copy, on your own port.",
    ].join('\n'),
  },
  {
    id: 'commits-and-prs',
    title: 'Commits and PRs',
    blurb: 'Small pull requests with clear titles, and a description that says what was tested.',
    kind: 'rules',
    name: 'commits-and-prs',
    description: 'How commits and pull requests read',
    body: [
      '## Commits and pull requests',
      '- Keep a pull request small: one issue, one concern. Note anything unrelated you spot instead of fixing it.',
      '- Commit messages and PR titles say what changed, in the imperative: "Add a dark mode toggle".',
      '- The PR description says what changed, why, and how you tested it: the commands you ran and what you checked by hand.',
      "- Don't reformat or rename code you didn't need to touch.",
    ].join('\n'),
  },
  {
    id: 'tests-first',
    title: 'Tests first',
    blurb: 'Run the tests before opening a pull request, and never weaken one to get green.',
    kind: 'rules',
    name: 'tests-first',
    description: 'Tests before a pull request',
    body: [
      '## Tests',
      '- Run the tests (and the typecheck and lint, if the project has them) before you open a pull request, and fix what fails.',
      '- Add or update tests for what you change.',
      '- Never skip, delete or weaken a test to make it pass.',
    ].join('\n'),
  },
  {
    id: 'write-tests',
    title: 'Skill: write tests',
    blurb: 'A skill workers load when a change needs tests: find the project’s style, cover the change, run the suite.',
    kind: 'skill',
    name: 'write-tests',
    description: 'Write focused tests for a change in this repository. Use when adding a feature or fixing a bug that has no test yet.',
    body: [
      '# Writing tests',
      '',
      '1. Find how the project tests: its runner and config, and an existing test near the code you changed.',
      '2. Match that style: the same folders, naming and helpers.',
      "3. Cover the change: the main case, an edge case, and for a fix the bug's own case (it fails without the fix).",
      '4. Keep tests fast and independent: no network, no real clock, nothing shared between tests.',
      '5. Run the new tests, then the whole suite. Both pass before you finish.',
    ].join('\n'),
  },
  {
    id: 'release-notes',
    title: 'Skill: release notes',
    blurb: 'A skill for drafting release notes from what merged into the work branch.',
    kind: 'skill',
    name: 'release-notes',
    description: 'Draft release notes from the pull requests merged into {workBranch}. Use when asked for release notes or a changelog entry.',
    body: [
      '# Release notes',
      '',
      '1. List what merged since the last release: `gh pr list --repo {repo} --state merged --base {workBranch} --limit 50`, or `git log --oneline <last tag>..origin/{workBranch}`.',
      "2. Group the changes: Added, Changed, Fixed. Leave out chores users won't notice.",
      '3. One line per change, in plain words, ending with its PR number (#12).',
      '4. Put the draft where you were asked (CHANGELOG.md, or your final message). Never publish a release yourself.',
    ].join('\n'),
  },
  {
    id: 'reviewer',
    title: 'Subagent: reviewer',
    blurb: 'A subagent that reads the diff for bugs, missing tests and leftovers before a pull request.',
    kind: 'agent',
    name: 'reviewer',
    description: 'Reviews the current change for bugs, missing tests and leftovers. Use before opening a pull request.',
    tools: 'Read, Grep, Glob, Bash',
    body: [
      'You review a change before it becomes a pull request on {repo}.',
      '',
      '1. Read the diff: `git diff origin/{workBranch}...HEAD`.',
      '2. Look for bugs, unhandled cases, missing or weak tests, debugging leftovers, and changes outside the task.',
      '3. Report a short list, most serious first, each with its file and line. Say "Looks good" when there is nothing.',
      "Don't edit anything: report only.",
    ].join('\n'),
  },
];

/** A template as a doc for the office or a floor; its placeholders stay, to be filled per floor at launch. */
export function templateDraft(t: PlaybookTemplate, scope: PlaybookScope, floorId: string | null): PlaybookDraft {
  return { scope, floorId: scope === 'floor' ? floorId : null, kind: t.kind, name: t.name, description: t.description, body: t.body, tools: t.tools ?? '', model: '' };
}

// ---------- a line diff, for the CEO's proposals ----------

export interface DiffLine {
  op: 'same' | 'add' | 'del';
  text: string;
}

/** Past this many line pairs the diff gives up on matching: the old text out, the new in. */
const DIFF_CELLS = 250_000;

/** The lines from `before` to `after`: kept, removed and added, in order (a longest common subsequence). */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before ? before.replace(/\r\n?/g, '\n').split('\n') : [];
  const b = after ? after.replace(/\r\n?/g, '\n').split('\n') : [];
  if (a.length * b.length > DIFF_CELLS) return [...a.map((text): DiffLine => ({ op: 'del', text })), ...b.map((text): DiffLine => ({ op: 'add', text }))];
  // lcs[i][j]: the longest common run of a[i..] and b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ op: 'del', text: a[i++] });
    else out.push({ op: 'add', text: b[j++] });
  }
  while (i < a.length) out.push({ op: 'del', text: a[i++] });
  while (j < b.length) out.push({ op: 'add', text: b[j++] });
  return out;
}
