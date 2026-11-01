// The playbook's REST: the office's and each floor's docs (made, changed, switched on or off, deleted), templates added
// to the office or a floor, and the CEO's proposed changes approved (maybe edited) or declined. Every change also
// reaches the tabs as the whole playbook (the 'playbook' event); each route answers with what it changed. Out of shape is
// a 400, an unknown doc, floor, template or proposal a 404, a name taken in its scope or a decided card a 409.
import express from 'express';
import { isPlaybookKind, type PlaybookDraft, type PlaybookScope } from '../shared/playbook.ts';
import { HttpError } from './httpError.ts';
import type { Ctx } from './pipeline/context.ts';
import type { DocPatch, Playbook, ProposalEdits } from './playbook/playbook.ts';
import { approvePlaybookChange, declinePlaybookChange } from './playbook/proposals.ts';
import { route } from './route.ts';

type Body = Record<string, unknown>;

const bodyOf = (raw: unknown): Body => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Body) : {});

/** An id from the path; one that can't be an id names nothing (404). */
const idOf = (raw: unknown, what: string) => {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(404, `No ${what} ${String(raw)}`);
  return n;
};

/** A text field: left out it's undefined, anything but text a 400. */
function text(b: Body, key: string): string | undefined {
  if (b[key] === undefined) return undefined;
  if (typeof b[key] !== 'string') throw new HttpError(400, `${key} must be text`);
  return b[key] as string;
}

function scopeOf(b: Body): { scope: PlaybookScope; floorId: string | null } {
  if (b.scope !== 'office' && b.scope !== 'floor') throw new HttpError(400, 'scope must be office or floor');
  const floorId = (b.floorId === null ? undefined : text(b, 'floorId'))?.trim() ?? '';
  if (b.scope === 'floor' && !floorId) throw new HttpError(400, "A floor's doc needs floorId");
  return { scope: b.scope, floorId: b.scope === 'floor' ? floorId : null };
}

/** POST /api/playbook/docs's body as a doc; the playbook checks the rest. */
export function draftFrom(raw: unknown): PlaybookDraft {
  const b = bodyOf(raw);
  if (!isPlaybookKind(b.kind)) throw new HttpError(400, 'kind must be rules, skill, agent or command');
  return { ...scopeOf(b), kind: b.kind, name: text(b, 'name') ?? '', description: text(b, 'description') ?? '', body: text(b, 'body') ?? '', tools: text(b, 'tools') ?? '', model: text(b, 'model') ?? '' };
}

/** PATCH /api/playbook/docs/:id's body: only what it names changes. */
export function patchFrom(raw: unknown): DocPatch {
  const b = bodyOf(raw);
  const patch: DocPatch = {};
  for (const key of ['name', 'description', 'body', 'tools', 'model'] as const) {
    const v = text(b, key);
    if (v !== undefined) patch[key] = v;
  }
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') throw new HttpError(400, 'enabled must be true or false');
    patch.enabled = b.enabled;
  }
  if (b.scope !== undefined || b.floorId !== undefined || b.kind !== undefined) throw new HttpError(400, "A doc's scope, floor and kind stay as they are: make a new one instead");
  return patch;
}

function editsFrom(raw: unknown): ProposalEdits {
  const b = bodyOf(raw);
  const edits: ProposalEdits = {};
  const body = text(b, 'body');
  const description = text(b, 'description');
  if (body !== undefined) edits.body = body;
  if (description !== undefined) edits.description = description;
  return edits;
}

export function playbookRoutes(ctx: Pick<Ctx, 'desk' | 'ceo'>, playbook: Playbook) {
  const r = express.Router();

  // { scope: 'office' | 'floor', floorId?, kind, name, description?, body, tools?, model?, enabled? } → PlaybookDoc
  r.post(
    '/playbook/docs',
    route((req) => {
      const b = bodyOf(req.body);
      if (b.enabled !== undefined && typeof b.enabled !== 'boolean') throw new HttpError(400, 'enabled must be true or false');
      return playbook.create(draftFrom(b), b.enabled !== false);
    }),
  );
  // { name?, description?, body?, tools?, model?, enabled? } → PlaybookDoc
  r.patch('/playbook/docs/:id', route((req) => playbook.update(idOf(req.params.id, 'playbook doc'), patchFrom(req.body))));
  // { enabled } → PlaybookDoc: switched on or off for sessions starting from now
  r.post(
    '/playbook/docs/:id/enable',
    route((req) => {
      const enabled = bodyOf(req.body).enabled;
      if (typeof enabled !== 'boolean') throw new HttpError(400, 'enabled must be true or false');
      return playbook.update(idOf(req.params.id, 'playbook doc'), { enabled });
    }),
  );
  // → { ok: true }
  r.delete(
    '/playbook/docs/:id',
    route(async (req) => {
      await playbook.remove(idOf(req.params.id, 'playbook doc'));
    }),
  );
  // { scope, floorId? } → PlaybookDoc: the template as a doc, its placeholders kept for each floor to fill
  r.post(
    '/playbook/templates/:id/apply',
    route((req) => {
      const { scope, floorId } = scopeOf(bodyOf(req.body));
      return playbook.applyTemplate(String(req.params.id), scope, floorId);
    }),
  );

  // { body?, description? } → { proposal, doc }: the CEO's change, as the manager may have edited it, is in the playbook
  r.post('/playbook/proposals/:id/approve', route((req) => approvePlaybookChange(ctx, playbook, idOf(req.params.id, 'playbook proposal'), editsFrom(req.body))));
  // { note? } → PlaybookProposal: a note goes to the CEO in the card's thread
  r.post('/playbook/proposals/:id/decline', route((req) => declinePlaybookChange(ctx, playbook, idOf(req.params.id, 'playbook proposal'), text(bodyOf(req.body), 'note') ?? '')));

  return r;
}
