// The console's Issues tab: the workers' questions waiting for your answer, and a floor's board from the backlog to
// merged. Adapted from cubefarm client/src/ui/ManagerConsole.tsx (IssuesTab) (MIT). Cut: filing, assigning and closing
// issues from here (GitHub is where issues are written), and the CEO's team-change requests.
import { useState } from 'react';
import type { Question } from '../../../../shared/types';
import { useStore } from '../../store';
import { KanbanBoard } from '../KanbanView';
import { FloorBadge } from './fields';
import { showTab } from './nav';
import { run, useBusy } from './run';

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** One open question, with a box whose answer goes on the issue, as you. */
function Ask({ q }: { q: Question }) {
  const [text, setText] = useState('');
  const [busy, go] = useBusy();
  return (
    <li className="console-question">
      <p>
        <strong>{q.from}</strong> on {q.floorId} #{q.issueNumber} <span className="console-hint">· {time(q.askedAt)}</span>
        {q.url && (
          <>
            {' · '}
            <a href={q.url} target="_blank" rel="noreferrer">
              on GitHub
            </a>
          </>
        )}
      </p>
      <blockquote>{q.text}</blockquote>
      <form
        className="console-row"
        onSubmit={(e) => {
          e.preventDefault();
          void go(run('POST', `/api/questions/${q.id}/answer`, { text })).then((ok) => ok && setText(''));
        }}
      >
        <input className="console-grow" value={text} placeholder="Your answer (posted on the issue, as you)" aria-label={`Answer ${q.from}`} onChange={(e) => setText(e.target.value)} />
        <button className="console-btn good" disabled={!text.trim() || busy}>
          Answer
        </button>
      </form>
    </li>
  );
}

function Questions() {
  const questions = useStore((s) => s.questions);
  const open = questions.filter((q) => q.answer === null);
  const answered = questions.filter((q) => q.answer !== null);
  if (!questions.length) return null;
  return (
    <section className="console-card">
      <h3 className="console-h">❓ Questions for you {open.length > 0 && <span className="console-chip warn">{open.length}</span>}</h3>
      {open.length === 0 ? (
        <p className="console-hint">None waiting.</p>
      ) : (
        <ul className="console-questions">
          {open.map((q) => (
            <Ask key={q.id} q={q} />
          ))}
        </ul>
      )}
      {answered.length > 0 && (
        <details className="console-details">
          <summary>Answered ({answered.length})</summary>
          <ul className="console-answered">
            {answered.map((q) => (
              <li key={q.id}>
                <span className="console-hint">
                  {q.floorId} #{q.issueNumber}:
                </span>{' '}
                {q.from} asked “{q.text}” · you answered “{q.answer}”
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function IssuesTab({ floorId }: { floorId?: string }) {
  const floors = useStore((s) => s.floors);
  const demo = useStore((s) => s.demo);
  const floor = floors.find((f) => f.id === floorId) ?? floors[0];
  return (
    <div>
      <Questions />
      {!floor ? (
        <p className="console-hint">Connect a repository on the Floors tab: its issues and pull requests show here.</p>
      ) : (
        <section className="console-card">
          <div className="console-row wrap console-floor-picks" role="tablist" aria-label="Floor">
            {floors.map((f) => (
              <button key={f.id} role="tab" aria-selected={f.id === floor.id} className={`console-pick${f.id === floor.id ? ' on' : ''}`} style={{ borderColor: f.color }} onClick={() => showTab('issues', f.id)}>
                <FloorBadge floor={f.floor} color={f.color} /> {f.fullName}
              </button>
            ))}
            <span className="console-grow" />
            {!demo && floor.url && (
              <a className="console-hint" href={`${floor.url}/issues/new`} target="_blank" rel="noreferrer">
                New issue on GitHub ↗
              </a>
            )}
          </div>
          <KanbanBoard floorId={floor.id} />
        </section>
      )}
    </div>
  );
}
