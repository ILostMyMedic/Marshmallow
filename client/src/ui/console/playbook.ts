// The console's Playbook tab as plain data: which scope it shows (the office or a floor), the docs there by kind, the
// editor's form and what its Save sends, the size readouts (rules are paid on every turn), the templates still to add,
// and the preview of what a worker's session gets. New in Marshmallow.
import {
  cleanDoc,
  docProblems,
  KIND_NAMES,
  PLAYBOOK_KINDS,
  playbookFor,
  RULES_LINES_WARN,
  sameDoc,
  TEMPLATES,
  textSize,
  type DocField,
  type PlaybookDoc,
  type PlaybookDraft,
  type PlaybookFloor,
  type PlaybookKind,
  type PlaybookScope,
  type PlaybookTemplate,
  type SessionPlaybook,
} from '../../../../shared/playbook';
import type { Floor } from '../../../../shared/types';

/** Where the tab is: the office's docs, or one floor's. */
export interface PlaybookPlace {
  scope: PlaybookScope;
  floorId: string | null;
}

/** The floor `floorId` names, else the office. */
export const placeOf = (floors: readonly Pick<Floor, 'id'>[], floorId: string | undefined): PlaybookPlace => (floorId && floors.some((f) => f.id === floorId) ? { scope: 'floor', floorId } : { scope: 'office', floorId: null });

const inPlace = (d: Pick<PlaybookDoc, 'scope' | 'floorId'>, p: PlaybookPlace) => d.scope === p.scope && (d.floorId ?? null) === p.floorId;

export interface KindGroup {
  kind: PlaybookKind;
  title: string;
  icon: string;
  hint: string;
  docs: PlaybookDoc[];
}

const KIND_HINTS: Record<PlaybookKind, string> = {
  rules: 'In every session’s system prompt',
  skill: 'Loaded when a task fits its description',
  agent: 'Helpers a worker can hand a job to',
  command: 'Slash commands, for the terminal',
};

/** The place's docs by kind, every kind listed (empty ones too), each in the order it was made. */
export function docGroups(docs: readonly PlaybookDoc[], place: PlaybookPlace): KindGroup[] {
  return PLAYBOOK_KINDS.map((kind) => ({ kind, title: KIND_NAMES[kind].many, icon: KIND_NAMES[kind].icon, hint: KIND_HINTS[kind], docs: docs.filter((d) => d.kind === kind && inPlace(d, place)) }));
}

// ---------- the editor ----------

export interface DocForm {
  name: string;
  description: string;
  body: string;
  tools: string;
  model: string;
}

const STARTERS: Record<PlaybookKind, Pick<DocForm, 'name' | 'body'>> = {
  rules: { name: '', body: '## \n- ' },
  skill: { name: '', body: '# \n\n1. ' },
  agent: { name: '', body: 'You ' },
  command: { name: '', body: '' },
};

export const blankForm = (kind: PlaybookKind): DocForm => ({ ...STARTERS[kind], description: '', tools: '', model: '' });
export const docForm = (d: PlaybookDoc): DocForm => ({ name: d.name, description: d.description, body: d.body, tools: d.tools, model: d.model });

/** The form as a doc for the place. */
export const formDraft = (f: DocForm, kind: PlaybookKind, place: PlaybookPlace): PlaybookDraft => cleanDoc({ ...place, kind, ...f });

/** What's wrong with the form, field by field, as the server would say. */
export const formProblems = (f: DocForm, kind: PlaybookKind): Partial<Record<DocField, string>> => docProblems(cleanDoc({ kind, ...f }));

/** What Save sends for a doc that exists: only the fields that changed, tidied as the office keeps them. */
export function formPatch(f: DocForm, d: PlaybookDoc): Partial<DocForm> {
  const next = cleanDoc({ kind: d.kind, ...f });
  const patch: Partial<DocForm> = {};
  for (const k of ['name', 'description', 'body', 'tools', 'model'] as const) if (next[k] !== d[k]) patch[k] = next[k];
  return patch;
}

/** A name another doc of the same kind in the place has. */
export const nameTaken = (docs: readonly PlaybookDoc[], kind: PlaybookKind, place: PlaybookPlace, name: string, self: number | null) =>
  docs.some((d) => d.id !== self && sameDoc(d, { ...place, kind, name: name.trim() }));

// ---------- sizes ----------

const n = (k: number) => k.toLocaleString('en');

export interface Readout {
  text: string;
  heavy: boolean;
}

/** One doc's size, and when it's paid for: rules on every turn; the rest when used, their description always. */
export function docReadout(kind: PlaybookKind, f: Pick<DocForm, 'body' | 'description'>): Readout {
  const body = textSize(f.body);
  const lines = `${n(body.lines)} line${body.lines === 1 ? '' : 's'}`;
  if (kind === 'rules') return { text: `${lines} · about ${n(body.tokens)} tokens on every turn of every session`, heavy: body.lines > RULES_LINES_WARN };
  const when = kind === 'skill' ? 'when a worker uses it' : kind === 'agent' ? 'when a worker hands it a job' : 'when someone runs it';
  return { text: `${lines} · about ${n(body.tokens)} tokens ${when}; its description (about ${n(textSize(f.description).tokens)}) is always loaded`, heavy: false };
}

/** All the rules a session gets, with a warning past RULES_LINES_WARN lines. */
export function rulesReadout(pb: SessionPlaybook): Readout {
  if (!pb.rules) return { text: 'No rules yet: sessions get the office’s instructions only.', heavy: false };
  const base = `${n(pb.size.lines)} lines of rules, about ${n(pb.size.tokens)} tokens on every turn`;
  return pb.size.heavy ? { text: `${base}. That’s a lot to pay for each turn: try to keep them under ${RULES_LINES_WARN} lines.`, heavy: true } : { text: base, heavy: false };
}

// ---------- templates ----------

export interface TemplateCard {
  template: PlaybookTemplate;
  added: boolean; // the place has a doc of its kind and name
  fromOffice: boolean; // on a floor: the office has it, so the floor gets it already
}

export function templateCards(docs: readonly PlaybookDoc[], place: PlaybookPlace): TemplateCard[] {
  const has = (p: PlaybookPlace, t: PlaybookTemplate) => docs.some((d) => sameDoc(d, { ...p, kind: t.kind, name: t.name }));
  return TEMPLATES.map((t) => ({ template: t, added: has(place, t), fromOffice: place.scope === 'floor' && has({ scope: 'office', floorId: null }, t) }));
}

// ---------- what a worker gets ----------

/** A floor that fills each placeholder with itself: the office's preview shows them as written. */
const AS_WRITTEN: PlaybookFloor = { id: '\u0000office', fullName: '{repo}', defaultBranch: '{defaultBranch}', workBranch: '{workBranch}' };

/** What a worker's session in the place gets: on a floor, filled in for it; for the office, what every floor gets from it. */
export function preview(docs: readonly PlaybookDoc[], floors: readonly Floor[], place: PlaybookPlace): SessionPlaybook {
  const floor = place.floorId ? floors.find((f) => f.id === place.floorId) : undefined;
  return playbookFor(docs, floor ? { id: floor.id, fullName: floor.fullName, defaultBranch: floor.defaultBranch, workBranch: floor.workBranch } : AS_WRITTEN);
}

/** How a worker reaches a plugin entry: skills and subagents by name, commands as a slash command. */
export function entryUse(e: { kind: PlaybookKind; name: string }): string {
  if (e.kind === 'command') return `/marshmallow:${e.name}`;
  return `marshmallow:${e.name}`;
}

/** Each placeholder and what it becomes in the place ('as written' for the office). */
export function placeholderHints(floors: readonly Floor[], place: PlaybookPlace): { key: string; value: string }[] {
  const floor = place.floorId ? floors.find((f) => f.id === place.floorId) : undefined;
  if (!floor) return [{ key: '{workBranch}', value: "each floor's work branch" }, { key: '{defaultBranch}', value: 'its default branch' }, { key: '{repo}', value: 'owner/name' }];
  return [
    { key: '{workBranch}', value: floor.workBranch || floor.defaultBranch },
    { key: '{defaultBranch}', value: floor.defaultBranch },
    { key: '{repo}', value: floor.fullName },
  ];
}
