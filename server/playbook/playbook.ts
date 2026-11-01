// The playbook, kept in the office database: the office's and each floor's agent docs, and the changes the CEO proposed.
// All of it stays in memory as the tabs' PlaybookView; every change is written through first, then the whole playbook
// goes to every tab. What a session gets from it is shared/playbook.ts's playbookFor. New in Marshmallow.
import {
  cleanDoc,
  docProblem,
  EMPTY_PLAYBOOK,
  KIND_NAMES,
  playbookFor,
  sameDoc,
  TEMPLATES,
  templateDraft,
  type PlaybookDoc,
  type PlaybookDraft,
  type PlaybookFloor,
  type PlaybookProposal,
  type PlaybookScope,
  type PlaybookView,
  type SessionPlaybook,
} from '../../shared/playbook.ts';
import type { Db, Tx } from '../db/db.ts';
import { HttpError } from '../httpError.ts';
import type { Store } from '../store.ts';

/** The CEO's proposals the view keeps: the latest. */
export const PROPOSALS_KEPT = 50;

/** What the manager can change on a doc (its scope, floor and kind stay). */
export type DocPatch = Partial<Pick<PlaybookDoc, 'name' | 'description' | 'body' | 'tools' | 'model' | 'enabled'>>;

/** The manager's edits when approving a proposal. */
export type ProposalEdits = Partial<Pick<PlaybookDraft, 'description' | 'body'>>;

interface DocRow {
  id: number;
  scope: PlaybookScope;
  floor_id: string | null;
  kind: PlaybookDoc['kind'];
  name: string;
  description: string;
  body: string;
  tools: string;
  model: string;
  enabled: boolean;
  updated_at: Date;
}

interface ProposalRow {
  id: number;
  thread_kind: 'chat' | 'discussion';
  thread_id: number;
  at: Date;
  status: PlaybookProposal['status'];
  draft: PlaybookDraft;
  doc_id: number | null;
  before: PlaybookProposal['before'];
  why: string;
  decided_at: Date | null;
}

const docOf = (r: DocRow): PlaybookDoc => ({
  id: r.id,
  scope: r.scope,
  floorId: r.floor_id,
  kind: r.kind,
  name: r.name,
  description: r.description,
  body: r.body,
  tools: r.tools,
  model: r.model,
  enabled: r.enabled,
  updatedAt: r.updated_at.getTime(),
});

const proposalOf = (r: ProposalRow): PlaybookProposal => ({
  id: r.id,
  thread: { kind: r.thread_kind, id: r.thread_id },
  at: r.at.getTime(),
  status: r.status,
  draft: r.draft,
  docId: r.doc_id,
  before: r.before,
  why: r.why,
  decidedAt: r.decided_at?.getTime() ?? null,
});

const notFound = (what: string, id: number) => new HttpError(404, `No ${what} ${id}`);

export class Playbook {
  private docs = new Map<number, PlaybookDoc>();
  private proposals = new Map<number, PlaybookProposal>();
  private view: PlaybookView = EMPTY_PLAYBOOK;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly now: () => number = Date.now,
  ) {}

  get(): PlaybookView {
    return this.view;
  }

  async load() {
    this.docs = new Map((await this.db.query<DocRow>('select * from playbook_docs order by id')).rows.map((r) => [r.id, docOf(r)]));
    const rows = (await this.db.query<ProposalRow>('select * from (select * from playbook_proposals order by id desc limit $1) p order by id', [PROPOSALS_KEPT])).rows;
    this.proposals = new Map(rows.map((r) => [r.id, proposalOf(r)]));
    this.view = this.build();
  }

  /** What a session on `floor` gets (null: the CEO, who gets the office's rules only). */
  forSession(floor: PlaybookFloor | null): SessionPlaybook {
    return playbookFor(this.view.docs, floor);
  }

  /** A doc; 404 when there's none. */
  doc(id: number): PlaybookDoc {
    const d = this.docs.get(id);
    if (!d) throw notFound('playbook doc', id);
    return d;
  }

  /** The doc a draft would change (same scope, floor, kind and name), if there is one. */
  find(draft: Pick<PlaybookDraft, 'scope' | 'floorId' | 'kind' | 'name'>): PlaybookDoc | null {
    return [...this.docs.values()].find((d) => sameDoc(d, draft)) ?? null;
  }

  // ---------- docs ----------

  /** A new doc, checked: 400 out of shape, 404 for a floor that isn't connected, 409 for a name taken in its scope. */
  create(draft: PlaybookDraft, enabled = true): Promise<PlaybookDoc> {
    return this.serial(async () => {
      const d = this.checked(draft);
      if (this.find(d)) throw this.taken(d);
      const doc = await this.insert(this.db, d, enabled);
      this.docs.set(doc.id, doc);
      this.changed();
      return doc;
    });
  }

  /** Changes a doc's text, name or whether it's on; its scope, floor and kind stay. */
  update(id: number, patch: DocPatch): Promise<PlaybookDoc> {
    return this.serial(async () => {
      const before = this.doc(id);
      const next = { ...before, ...this.checked({ ...before, ...patch }, false), enabled: patch.enabled ?? before.enabled };
      const clash = this.find(next);
      if (clash && clash.id !== id) throw this.taken(next);
      const doc = await this.write(this.db, id, next);
      this.docs.set(id, doc);
      this.changed();
      return doc;
    });
  }

  remove(id: number): Promise<void> {
    return this.serial(async () => {
      this.doc(id);
      await this.db.query('delete from playbook_docs where id = $1', [id]);
      this.docs.delete(id);
      this.changed();
    });
  }

  /** A template added to the office or a floor, its placeholders kept for each floor to fill at launch; 409 if it's there already. */
  applyTemplate(templateId: string, scope: PlaybookScope, floorId: string | null): Promise<PlaybookDoc> {
    const t = TEMPLATES.find((x) => x.id === templateId);
    if (!t) return Promise.reject(new HttpError(404, `No playbook template ${templateId}`));
    return this.create(templateDraft(t, scope, floorId));
  }

  // ---------- the CEO's proposals ----------

  /** A change the CEO proposes in a thread: checked like any doc, it waits on a card until the manager decides. */
  propose(thread: PlaybookProposal['thread'], draft: PlaybookDraft, why: string): Promise<PlaybookProposal> {
    return this.serial(async () => {
      const checked = this.checked(draft);
      const doc = this.find(checked);
      // The CEO writes text only: a subagent it changes keeps its tools and model.
      const d = doc ? { ...checked, tools: checked.tools || doc.tools, model: checked.model || doc.model } : checked;
      const before = doc && { description: doc.description, body: doc.body };
      if (doc && doc.body === d.body && doc.description === d.description && doc.tools === d.tools && doc.model === d.model && doc.enabled) throw new HttpError(409, `The ${KIND_NAMES[d.kind].one} "${d.name}" already says exactly that`);
      const row = (
        await this.db.query<ProposalRow>('insert into playbook_proposals (thread_kind, thread_id, at, status, draft, doc_id, before, why) values ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8) returning *', [
          thread.kind,
          thread.id,
          new Date(this.now()),
          'pending',
          JSON.stringify(d),
          doc?.id ?? null,
          before ? JSON.stringify(before) : null,
          why.trim(),
        ])
      ).rows[0];
      const p = proposalOf(row);
      this.proposals.set(p.id, p);
      this.changed();
      return p;
    });
  }

  /** A proposal; 404 when there's none (or it's too old to be kept). */
  proposal(id: number): PlaybookProposal {
    const p = this.proposals.get(id);
    if (!p) throw notFound('playbook proposal', id);
    return p;
  }

  /**
   * The manager approves a proposal, maybe with its text edited: the doc it names is written (made, or changed and
   * switched on). 409 once it's decided, 404 when its floor has gone.
   */
  approve(id: number, edits: ProposalEdits = {}): Promise<{ proposal: PlaybookProposal; doc: PlaybookDoc }> {
    return this.serial(async () => {
      const p = this.pending(id);
      const d = this.checked({ ...p.draft, ...edits });
      const at = this.now();
      const existing = this.find(d);
      const doc = await this.db.transaction(async (tx) => {
        const written = existing ? await this.write(tx, existing.id, { ...existing, ...d, enabled: true }) : await this.insert(tx, d, true);
        await tx.query('update playbook_proposals set status = $2, doc_id = $3, draft = $4::jsonb, decided_at = $5 where id = $1', [id, 'approved', written.id, JSON.stringify(d), new Date(at)]);
        return written;
      });
      const proposal: PlaybookProposal = { ...p, status: 'approved', docId: doc.id, draft: d, decidedAt: at };
      this.docs.set(doc.id, doc);
      this.proposals.set(id, proposal);
      this.changed();
      return { proposal, doc };
    });
  }

  /** The manager declines a proposal; 409 once it's decided. */
  decline(id: number): Promise<PlaybookProposal> {
    return this.serial(async () => {
      const p = this.pending(id);
      const at = this.now();
      await this.db.query('update playbook_proposals set status = $2, decided_at = $3 where id = $1', [id, 'declined', new Date(at)]);
      const proposal: PlaybookProposal = { ...p, status: 'declined', decidedAt: at };
      this.proposals.set(id, proposal);
      this.changed();
      return proposal;
    });
  }

  // ---------- inside ----------

  private pending(id: number): PlaybookProposal {
    const p = this.proposal(id);
    if (p.status !== 'pending') throw new HttpError(409, `That change was ${p.status} already`);
    return p;
  }

  /** A draft tidied and checked: its fields (400), and its floor (404 when it isn't connected, unless it's an edit). */
  private checked(draft: PlaybookDraft, newDoc = true): PlaybookDraft {
    const d = cleanDoc({ ...draft, floorId: draft.scope === 'floor' ? draft.floorId : null });
    const why = docProblem(d);
    if (why) throw new HttpError(400, why);
    if (newDoc && d.scope === 'floor' && (!d.floorId || !this.store.hasFloor(d.floorId))) throw new HttpError(404, `No floor ${d.floorId ?? ''}`.trim());
    return d;
  }

  private taken(d: PlaybookDraft) {
    const where = d.scope === 'office' ? 'the office' : (d.floorId ?? 'this floor');
    return new HttpError(409, `${where} already has ${d.kind === 'rules' ? 'rules' : `a ${KIND_NAMES[d.kind].one}`} named "${d.name}"`);
  }

  private async insert(q: Db | Tx, d: PlaybookDraft, enabled: boolean): Promise<PlaybookDoc> {
    const at = new Date(this.now());
    const row = (
      await q.query<DocRow>('insert into playbook_docs (scope, floor_id, kind, name, description, body, tools, model, enabled, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) returning *', [
        d.scope,
        d.floorId,
        d.kind,
        d.name,
        d.description,
        d.body,
        d.tools,
        d.model,
        enabled,
        at,
      ])
    ).rows[0];
    return docOf(row);
  }

  private async write(q: Db | Tx, id: number, d: PlaybookDoc | (PlaybookDraft & { enabled: boolean })): Promise<PlaybookDoc> {
    const row = (
      await q.query<DocRow>('update playbook_docs set name = $2, description = $3, body = $4, tools = $5, model = $6, enabled = $7, updated_at = $8 where id = $1 returning *', [
        id,
        d.name,
        d.description,
        d.body,
        d.tools,
        d.model,
        d.enabled,
        new Date(this.now()),
      ])
    ).rows[0];
    return docOf(row);
  }

  /** Memory back to its limits, the view rebuilt, and every tab told. */
  private changed() {
    for (const p of [...this.proposals.values()].sort((a, b) => b.id - a.id).slice(PROPOSALS_KEPT)) this.proposals.delete(p.id);
    this.view = this.build();
    this.store.publish({ type: 'playbook', playbook: this.view });
  }

  private build(): PlaybookView {
    return { docs: [...this.docs.values()].sort((a, b) => a.id - b.id), proposals: [...this.proposals.values()].sort((a, b) => a.id - b.id) };
  }

  /** One change at a time, so a name is checked against what the database holds. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
