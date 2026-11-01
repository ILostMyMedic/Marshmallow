// A project the CEO proposes in a chat, as a card: the repository (new or existing), the brief, the team size and the
// starting tasks. While it's pending the manager can change the repository, the team size and which tasks go in, then
// approve it (the office creates the repo, the floor, the team and the issues) or decline it with a note. Then it shows
// the step it's on, the floor it started and the issues filed, or what went wrong. New in Marshmallow.
import { useState, type KeyboardEvent } from 'react';
import type { ProjectProposal, ProposalRepo } from '../../../../shared/types';
import { command } from '../../api';
import { useStore } from '../../store';
import { rideTo } from '../../world/elevatorRide';
import { useView } from '../../world/view';
import { useCommand } from '../useCommand';
import { approveBody, droppedDependencies, editProblems, proposalEdit, repoFullName, type ProposalEdit } from './desk';
import { when } from './parts';

const STATUS: Record<ProjectProposal['status'], [string, string]> = {
  pending: ['Waiting for you', 'pending'],
  starting: ['Starting…', 'starting'],
  started: ['Started', 'started'],
  declined: ['Declined', 'off'],
  failed: ['Failed', 'failed'],
  replaced: ['Replaced by a newer plan', 'off'],
};

/** Esc in a small form cancels it, and goes no further (it would close the desktop). */
const escapes = (cancel: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  cancel();
};

function RepoFields({ repo, onChange, problems, owners }: { repo: ProposalRepo; onChange: (r: ProposalRepo) => void; problems: ReturnType<typeof editProblems>; owners: string[] }) {
  if (repo.kind === 'existing')
    return (
      <label className="dt-field">
        <span className="dt-field-label">Existing repository</span>
        <input value={repo.fullName} onChange={(e) => onChange({ kind: 'existing', fullName: e.target.value })} aria-invalid={!!problems.fullName} spellCheck={false} />
        {problems.fullName && <small className="dt-bad">{problems.fullName}</small>}
      </label>
    );
  const choices = owners.includes(repo.owner) || !repo.owner ? owners : [repo.owner, ...owners];
  return (
    <>
      <div className="proj-repo-row">
        <label className="dt-field">
          <span className="dt-field-label">Owner</span>
          {choices.length ? (
            <select value={repo.owner} onChange={(e) => onChange({ ...repo, owner: e.target.value })} aria-invalid={!!problems.owner}>
              {!repo.owner && <option value="">Pick one…</option>}
              {choices.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input value={repo.owner} onChange={(e) => onChange({ ...repo, owner: e.target.value })} aria-invalid={!!problems.owner} spellCheck={false} placeholder="your login" />
          )}
        </label>
        <span className="proj-slash" aria-hidden>
          /
        </span>
        <label className="dt-field dt-grow">
          <span className="dt-field-label">Name</span>
          <input value={repo.name} onChange={(e) => onChange({ ...repo, name: e.target.value })} aria-invalid={!!problems.name} spellCheck={false} maxLength={100} />
        </label>
        <div className="dt-seg" role="radiogroup" aria-label="Visibility">
          {(
            [
              [true, '🔒 Private'],
              [false, '🌍 Public'],
            ] as const
          ).map(([priv, label]) => (
            <button key={label} type="button" role="radio" aria-checked={repo.private === priv} className={repo.private === priv ? 'on' : ''} onClick={() => onChange({ ...repo, private: priv })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {(problems.owner || problems.name) && <small className="dt-bad">{problems.owner ?? problems.name}</small>}
      <label className="dt-field">
        <span className="dt-field-label">Description</span>
        <input value={repo.description} onChange={(e) => onChange({ ...repo, description: e.target.value })} placeholder="One line for GitHub (optional)" />
      </label>
    </>
  );
}

function RepoSummary({ repo }: { repo: ProposalRepo }) {
  if (repo.kind === 'existing')
    return (
      <p className="proj-repo">
        📁 <b>{repo.fullName}</b> <span className="dt-chip">existing</span>
      </p>
    );
  return (
    <>
      <p className="proj-repo">
        🆕 <b>{repoFullName(repo)}</b> <span className="dt-chip">{repo.private ? '🔒 private' : '🌍 public'}</span> <span className="dt-chip">new</span>
      </p>
      {repo.description && <p className="proj-desc">{repo.description}</p>}
    </>
  );
}

/** The brief, folded when it's long. */
function Brief({ text }: { text: string }) {
  const long = text.length > 420 || text.split('\n').length > 8;
  const [open, setOpen] = useState(!long);
  return (
    <div className="proj-section">
      <h4>📝 The brief</h4>
      <div className={`proj-brief${open ? '' : ' folded'}`}>{text || 'No brief.'}</div>
      {long && (
        <button type="button" className="dt-link" onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show it all'}
        </button>
      )}
    </div>
  );
}

function Outcome({ p }: { p: ProjectProposal }) {
  const floor = useStore((s) => (p.floorId ? s.floors.find((f) => f.id === p.floorId) : undefined));
  const close = useView((s) => s.closeOverlay);
  const here = useView((s) => s.floor);
  if (p.status === 'starting')
    return (
      <div className="proj-foot proj-foot-starting" role="status">
        <span className="dt-spinner" aria-hidden /> {p.step ?? 'Getting started…'}
      </div>
    );
  if (p.status === 'failed')
    return (
      <div className="proj-foot proj-foot-failed" role="alert">
        ⚠️ {p.error ?? 'It stopped part way.'}
      </div>
    );
  if (p.status === 'declined' || p.status === 'replaced')
    return (
      <div className="proj-foot proj-foot-off">
        {p.status === 'declined' ? 'You declined it' : 'The CEO proposed again further down'}
        {p.decidedAt ? ` · ${when(p.decidedAt)}` : ''}
      </div>
    );
  if (p.status !== 'started') return null;
  const issueUrl = (n: number) => (floor ? `${floor.url}/issues/${n}` : null);
  return (
    <div className="proj-foot proj-foot-started">
      <div className="dt-grow">
        🚀 <b>{floor ? `Floor ${floor.floor}: ${floor.fullName}` : (p.floorId ?? repoFullName(p.repo))}</b> is up and running
        {p.issueNumbers.length > 0 && (
          <div className="proj-issues">
            Filed{' '}
            {p.issueNumbers.map((n) => {
              const url = issueUrl(n);
              return url ? (
                <a key={n} href={url} target="_blank" rel="noreferrer">
                  #{n}
                </a>
              ) : (
                <span key={n}>#{n}</span>
              );
            })}
          </div>
        )}
      </div>
      {floor && (
        <button
          type="button"
          className="dt-btn"
          disabled={here === floor.floor}
          title={here === floor.floor ? "You're on it" : `Ride the elevator to floor ${floor.floor}`}
          onClick={() => {
            close();
            rideTo(floor.floor);
          }}
        >
          {here === floor.floor ? 'You’re there' : `Go to floor ${floor.floor} →`}
        </button>
      )}
    </div>
  );
}

/** Key it by `proposalKey`, so the manager's edits start over if the CEO revises the card. */
export const proposalKey = (p: ProjectProposal) => `${p.id}:${p.at}`;

export function ProjectCard({ p }: { p: ProjectProposal }) {
  const owners = useStore((s) => s.desk.owners);
  const maxWorkers = useStore((s) => s.settings.maxWorkers);
  const [edit, setEdit] = useState<ProposalEdit>(() => proposalEdit(p));
  const [declining, setDeclining] = useState(false);
  // Plans that went nowhere fold away to their header and what became of them.
  const [folded, setFolded] = useState(p.status === 'declined' || p.status === 'replaced');
  const [note, setNote] = useState('');
  const { busy, error, run } = useCommand();
  const pending = p.status === 'pending';
  const problems = pending ? editProblems(edit, Math.max(1, maxWorkers)) : {};
  const blocked = Object.keys(problems).length > 0;
  const dropped = pending ? droppedDependencies(p, edit.keep) : [];
  const [label, tone] = STATUS[p.status];
  const kept = edit.keep.filter(Boolean).length;

  const approve = () => run(() => command('POST', `/api/proposals/${p.id}/approve`, approveBody(p, edit)));
  const decline = () =>
    run(() => command('POST', `/api/proposals/${p.id}/decline`, note.trim() ? { note: note.trim() } : {})).then((ok) => {
      if (ok) setDeclining(false);
    });

  const plan = (
    <>
      <div className="proj-section">
        <h4>📦 Repository</h4>
        {pending ? <RepoFields repo={edit.repo} onChange={(repo) => setEdit({ ...edit, repo })} problems={problems} owners={owners} /> : <RepoSummary repo={p.repo} />}
      </div>

      <Brief text={p.brief} />

      <div className="proj-section">
        <h4>👥 The team</h4>
        {pending ? (
          <div className="proj-team">
            <button type="button" className="dt-btn dt-btn-round" aria-label="One fewer" disabled={edit.teamSize <= 1} onClick={() => setEdit({ ...edit, teamSize: Math.max(1, edit.teamSize - 1) })}>
              −
            </button>
            <input
              type="number"
              min={1}
              max={maxWorkers}
              value={Number.isFinite(edit.teamSize) ? edit.teamSize : ''}
              onChange={(e) => setEdit({ ...edit, teamSize: e.target.valueAsNumber })}
              aria-label="Team size"
              aria-invalid={!!problems.teamSize}
            />
            <button type="button" className="dt-btn dt-btn-round" aria-label="One more" disabled={edit.teamSize >= maxWorkers} onClick={() => setEdit({ ...edit, teamSize: Math.min(maxWorkers, (edit.teamSize || 0) + 1) })}>
              +
            </button>
            <span className="dt-muted">{problems.teamSize ? <span className="dt-bad">{problems.teamSize}</span> : `worker${edit.teamSize === 1 ? '' : 's'} (up to ${maxWorkers} on a floor)`}</span>
          </div>
        ) : (
          <p className="proj-line">
            {p.teamSize} worker{p.teamSize === 1 ? '' : 's'}
          </p>
        )}
      </div>

      <div className="proj-section">
        <h4>
          ✅ Starting tasks{' '}
          <span className="dt-muted">
            {pending && kept !== p.tasks.length ? `${kept} of ${p.tasks.length}` : p.tasks.length}
            {p.status === 'started' && p.issueNumbers.length ? ' · filed' : ''}
          </span>
        </h4>
        <ol className="proj-tasks">
          {p.tasks.map((t, i) => {
            const filed = p.status === 'started' ? p.issueNumbers[i] : undefined;
            const off = pending && !edit.keep[i];
            return (
              <li key={i} className={off ? 'off' : ''}>
                {pending ? (
                  <input
                    type="checkbox"
                    checked={edit.keep[i]}
                    onChange={(e) => setEdit({ ...edit, keep: edit.keep.map((k, j) => (j === i ? e.target.checked : k)) })}
                    aria-label={`Keep task ${i + 1}: ${t.title}`}
                  />
                ) : null}
                <span className="proj-n">{i + 1}</span>
                <details className="proj-task">
                  <summary>
                    <span className="proj-task-title">{t.title}</span>
                    {t.dependsOn.length > 0 && <span className="dt-chip">after {t.dependsOn.map((d) => d + 1).join(', ')}</span>}
                    {filed !== undefined && <span className="dt-chip dt-chip-good">#{filed}</span>}
                  </summary>
                  {t.body && <div className="proj-task-body">{t.body}</div>}
                </details>
              </li>
            );
          })}
        </ol>
        {problems.tasks && <small className="dt-bad">{problems.tasks}</small>}
        {dropped.length > 0 && (
          <small className="dt-warn">
            {dropped.map(([t, d]) => `Task ${t + 1} waits on task ${d + 1}`).join('; ')}, which you left out: {dropped.length === 1 ? 'it' : 'they'}’ll start without it.
          </small>
        )}
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
              <span className="dt-muted dt-grow">Nothing touches GitHub until you approve.</span>
              <button type="button" className="dt-btn dt-btn-ghost" disabled={busy} onClick={() => setDeclining(true)}>
                Decline…
              </button>
              <button type="button" className="dt-btn dt-btn-go" disabled={busy || blocked} title={blocked ? 'Fix the marked fields first' : undefined} onClick={() => void approve()}>
                {busy ? 'Starting…' : 'Approve & start'}
              </button>
            </>
          )}
        </div>
      ) : (
        <Outcome p={p} />
      )}
    </>
  );

  return (
    <article className={`proj-card proj-${tone}`} data-proposal={p.id} aria-label={`Project proposal: ${repoFullName(p.repo)}`}>
      <header className="proj-head">
        <span className="proj-icon" aria-hidden>
          🚀
        </span>
        <div className="dt-grow">
          <div className="proj-kicker">Project proposal</div>
          <h3>{repoFullName(p.repo)}</h3>
        </div>
        <span className={`proj-pill proj-pill-${tone}`}>{label}</span>
      </header>
      {folded ? (
        <div className="proj-foot proj-foot-off">
          <span className="dt-grow">
            {p.status === 'declined' ? 'You declined it' : 'The CEO proposed again further down'}
            {p.decidedAt ? ` · ${when(p.decidedAt)}` : ''}
          </span>
          <button type="button" className="dt-link" onClick={() => setFolded(false)}>
            Show the plan
          </button>
        </div>
      ) : (
        plan
      )}
      {error && (
        <p className="dt-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
