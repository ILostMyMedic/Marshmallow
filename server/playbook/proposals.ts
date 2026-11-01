// The CEO's proposed playbook changes: propose_playbook_change's input as a doc, and what deciding on a card does
// besides changing the playbook: a line in the chat or discussion it came from, and a declined card's note to the CEO,
// who reworks the change. Nothing in the playbook changes before the manager approves.
import { KIND_NAMES, isPlaybookKind, type PlaybookDraft, type PlaybookProposal } from '../../shared/playbook.ts';
import type { Desk } from '../db/desk.ts';
import type { Ctx } from '../pipeline/context.ts';
import type { Playbook, ProposalEdits } from './playbook.ts';

/** propose_playbook_change's input, as the CEO's tool takes it (team/ceo/tools.ts). */
export interface ProposePlaybookInput {
  scope: 'office' | 'floor';
  floor?: number;
  kind: string;
  name: string;
  description?: string;
  body: string;
  why: string;
}

/** The input as a doc to propose; `floorOf` turns the CEO's floor number into the floor's id (throwing for none). */
export function playbookDraftFrom(a: ProposePlaybookInput, floorOf: (n: number | undefined) => string): PlaybookDraft {
  if (a.scope !== 'office' && a.scope !== 'floor') throw new Error('scope must be office or floor');
  if (!isPlaybookKind(a.kind)) throw new Error('kind must be rules, skill, agent or command');
  return {
    scope: a.scope,
    floorId: a.scope === 'floor' ? floorOf(a.floor) : null,
    kind: a.kind,
    name: String(a.name ?? ''),
    description: String(a.description ?? ''),
    body: String(a.body ?? ''),
    tools: '',
    model: '',
  };
}

/** "the office's rules "tests-first"", "acme/app's skill "write-tests"": what a card changes, in words. */
export function changeLabel(d: Pick<PlaybookDraft, 'scope' | 'floorId' | 'kind' | 'name'>): string {
  const whose = d.scope === 'office' ? "the office's" : `${d.floorId}'s`;
  return `${whose} ${KIND_NAMES[d.kind].one} "${d.name}"`;
}

/** Where a proposal's card is: the thread it came from, for the lines deciding on it adds. */
const post = (desk: Desk | null, p: PlaybookProposal, from: 'manager' | 'office', text: string) => desk?.post(p.thread.kind, p.thread.id, from, text).catch(() => undefined);

/** The manager approves a card (maybe edited): the playbook changes, and its thread says so. */
export async function approvePlaybookChange(ctx: Pick<Ctx, 'desk'>, playbook: Playbook, id: number, edits: ProposalEdits) {
  const existed = playbook.find(playbook.proposal(id).draft) !== null;
  const out = await playbook.approve(id, edits);
  const edited = edits.body !== undefined || edits.description !== undefined;
  await post(ctx.desk, out.proposal, 'office', `📘 Playbook: ${existed ? 'changed' : 'added'} ${changeLabel(out.proposal.draft)}${edited ? ', as you edited it' : ''}. Sessions starting from now get it.`);
  return out;
}

/**
 * The manager declines a card. With a note, the note goes to the CEO in the thread (as the manager's message, which
 * the CEO answers); without one, the thread just says so.
 */
export async function declinePlaybookChange(ctx: Pick<Ctx, 'desk' | 'ceo'>, playbook: Playbook, id: number, note: string): Promise<PlaybookProposal> {
  const p = await playbook.decline(id);
  const body = note.trim();
  const what = changeLabel(p.draft);
  if (body && ctx.ceo.worker) {
    const text = `Declined the playbook change to ${what}: ${body}`;
    await (p.thread.kind === 'chat' ? ctx.ceo.postToChat(p.thread.id, text) : ctx.ceo.postToDiscussion(p.thread.id, text)).catch(() => post(ctx.desk, p, 'manager', text));
  } else await post(ctx.desk, p, body ? 'manager' : 'office', body ? `Declined the playbook change to ${what}: ${body}` : `You declined the playbook change to ${what}.`);
  return p;
}
