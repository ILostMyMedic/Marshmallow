// A playbook change the CEO proposes in a chat or a discussion, as a card: what it changes (the office's or a floor's
// rules, skill, subagent or command), why, and the diff from the doc as it is (or the new text). While it's pending the
// manager can approve it, edit the text first, or decline it with a note for the CEO; then it says what became of it.
// New in Marshmallow.
import { useState, type KeyboardEvent } from 'react';
import { KIND_NAMES, lineDiff, type PlaybookProposal } from '../../../../shared/playbook';
import { command } from '../../api';
import { useStore } from '../../store';
import { showTab } from '../console/nav';
import { useCommand } from '../useCommand';
import { foldDiff, playbookApproveBody } from './desk';
import { when } from './parts';

const STATUS: Record<PlaybookProposal['status'], [string, string]> = {
  pending: ['Waiting for you', 'pending'],
  approved: ['In the playbook', 'started'],
  declined: ['Declined', 'off'],
};

/** Esc in a small form cancels it, and goes no further (it would close the desktop). */
const escapes = (cancel: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  cancel();
};

/** The change as lines kept, removed and added; a new doc's text as all added. */
function Diff({ before, after }: { before: string; after: string }) {
  const lines = foldDiff(lineDiff(before, after));
  return (
    <pre className="pbc-diff" aria-label="The change, line by line">
      {lines.map((l, i) =>
        l.op === 'skip' ? (
          <span key={i} className="pbc-skip">
            ⋯ {l.count} line{l.count === 1 ? '' : 's'} as they are
          </span>
        ) : (
          <span key={i} className={`pbc-${l.op}`}>
            <span className="pbc-mark" aria-hidden>
              {l.op === 'add' ? '+' : l.op === 'del' ? '−' : ' '}
            </span>
            {l.text || ' '}
          </span>
        ),
      )}
    </pre>
  );
}

/** Key it by `playbookCardKey`, so the manager's edits start over if the card changes. */
export const playbookCardKey = (p: PlaybookProposal) => `pb:${p.id}:${p.status}`;

export function PlaybookCard({ p }: { p: PlaybookProposal }) {
  const floor = useStore((s) => (p.draft.floorId ? s.floors.find((f) => f.id === p.draft.floorId) : undefined));
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({ description: p.draft.description, body: p.draft.body });
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const { busy, error, run } = useCommand();
  const pending = p.status === 'pending';
  const [label, tone] = STATUS[p.status];
  const kind = KIND_NAMES[p.draft.kind];
  const whose = p.draft.scope === 'office' ? 'The office’s' : floor ? `Floor ${floor.floor}’s` : `${p.draft.floorId}’s`;
  const after = editing ? edit.body : p.draft.body;
  const descChanged = p.before ? p.before.description !== p.draft.description : !!p.draft.description;

  const approve = () => run(() => command('POST', `/api/playbook/proposals/${p.id}/approve`, editing ? playbookApproveBody(p, edit) : {}));
  const decline = () =>
    run(() => command('POST', `/api/playbook/proposals/${p.id}/decline`, note.trim() ? { note: note.trim() } : {})).then((ok) => {
      if (ok) setDeclining(false);
    });

  return (
    <article className={`proj-card pbc-card proj-${tone}`} data-playbook-proposal={p.id} aria-label={`Playbook change: ${p.draft.name}`}>
      <header className="proj-head">
        <span className="proj-icon" aria-hidden>
          📘
        </span>
        <div className="dt-grow">
          <div className="proj-kicker">
            Playbook {p.docId !== null || p.before ? 'change' : 'addition'} · {whose} {kind.one}
          </div>
          <h3 className="pbc-name">
            {kind.icon} {p.draft.name}
          </h3>
        </div>
        <span className={`proj-pill proj-pill-${tone}`}>{label}</span>
      </header>

      {p.why && (
        <div className="proj-section">
          <h4>💬 Why</h4>
          <p className="proj-line pbc-why">{p.why}</p>
        </div>
      )}

      <div className="proj-section">
        <h4>
          {p.before ? '✏️ The change' : '🆕 The new text'}{' '}
          {p.draft.kind === 'rules' && <span className="dt-muted">· in every session’s system prompt</span>}
        </h4>
        {editing ? (
          <>
            {p.draft.kind !== 'rules' && (
              <label className="dt-field">
                <span className="dt-field-label">Description</span>
                <input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} onKeyDown={escapes(() => setEditing(false))} />
              </label>
            )}
            <label className="dt-field">
              <span className="dt-field-label">Text</span>
              <textarea className="pbc-text" rows={10} value={edit.body} spellCheck={false} onChange={(e) => setEdit({ ...edit, body: e.target.value })} onKeyDown={escapes(() => setEditing(false))} />
            </label>
            <span className="dt-muted">Your edits, against what the playbook says now:</span>
          </>
        ) : (
          descChanged && p.draft.description && <p className="proj-desc pbc-desc">Description: {p.draft.description}</p>
        )}
        <Diff before={p.before?.body ?? ''} after={after} />
      </div>

      {pending ? (
        <div className="proj-foot">
          {declining ? (
            <form
              className="proj-decline"
              onSubmit={(e) => {
                e.preventDefault();
                void decline();
              }}
            >
              <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={escapes(() => setDeclining(false))} placeholder="Why not? (optional: the CEO reads it)" aria-label="A note for the CEO" />
              <button className="dt-btn dt-btn-bad" disabled={busy}>
                Decline
              </button>
              <button type="button" className="dt-btn dt-btn-ghost" onClick={() => setDeclining(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <>
              <span className="dt-muted dt-grow">Nothing changes until you approve. Sessions starting after that get it.</span>
              <button type="button" className="dt-btn dt-btn-ghost" disabled={busy} onClick={() => setDeclining(true)}>
                Decline…
              </button>
              {editing ? (
                <button
                  type="button"
                  className="dt-btn dt-btn-ghost"
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setEdit({ description: p.draft.description, body: p.draft.body });
                  }}
                >
                  Undo edits
                </button>
              ) : (
                <button type="button" className="dt-btn" disabled={busy} onClick={() => setEditing(true)}>
                  ✏️ Edit
                </button>
              )}
              <button type="button" className="dt-btn dt-btn-go" disabled={busy || !edit.body.trim()} onClick={() => void approve()}>
                {busy ? 'Saving…' : editing ? 'Approve as edited' : 'Approve'}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className={`proj-foot ${p.status === 'approved' ? 'proj-foot-started' : 'proj-foot-off'}`}>
          <span className="dt-grow">
            {p.status === 'approved' ? 'In the playbook: sessions starting since get it' : 'You declined it'}
            {p.decidedAt ? ` · ${when(p.decidedAt)}` : ''}
          </span>
          {p.status === 'approved' && (
            <button type="button" className="dt-btn" onClick={() => showTab('playbook', p.draft.scope === 'floor' ? (p.draft.floorId ?? undefined) : undefined)}>
              Open the playbook →
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="dt-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
