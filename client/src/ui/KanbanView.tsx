// A floor's board in 2D: its issues and PRs in columns from the backlog to merged (kanban.ts sorts them), each card
// linking to GitHub and to the worker on it, and a new task filed straight into the backlog (an issue on the floor's
// repository). The whiteboard opens it as a panel; the manager's console shows the board on its own. Adapted from
// cubefarm client/src/ui/KanbanView.tsx (MIT).
import { useMemo, useState } from 'react';
import { command, floorPath } from '../api';
import { kanbanFor, type KanbanCard, type KanbanColumns } from '../kanban';
import { useStore } from '../store';
import { useView } from '../world/view';
import { Panel } from './Panel';
import { useCommand } from './useCommand';

const COLUMNS: { key: keyof KanbanColumns; title: string }[] = [
  { key: 'backlog', title: '📋 Backlog' },
  { key: 'progress', title: '🔨 In progress' },
  { key: 'qa', title: '🔍 In QA' },
  { key: 'ready', title: '✅ Ready to merge' },
  { key: 'merged', title: '🎉 Merged' },
];

function Card({ card }: { card: KanbanCard }) {
  const open = useView((s) => s.openOverlay);
  return (
    <li className={`kanban-card${card.tone ? ` tone-${card.tone}` : ''}`}>
      <div>
        <strong>
          {card.prNumber ? 'PR ' : ''}#{card.number}
        </strong>{' '}
        {card.url ? (
          <a href={card.url} target="_blank" rel="noreferrer">
            {card.title}
          </a>
        ) : (
          card.title
        )}
      </div>
      <div className="kanban-meta">
        {card.worker && <span>{card.worker.name}</span>}
        {card.note && <span>{card.note}</span>}
        {card.worker && (
          <button className="link" onClick={() => open({ kind: 'terminal', workerId: card.worker!.id })}>
            Terminal
          </button>
        )}
      </div>
    </li>
  );
}

/** A new task for the backlog: a title, and details if you like. It goes up as an issue on the floor's repository. */
function NewTask({ floorId, onDone }: { floorId: string; onDone: () => void }) {
  const { busy, error, run } = useCommand();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const add = async () => {
    if (!title.trim()) return;
    if (await run(() => command('POST', `/api/floors/${floorPath(floorId)}/issues`, { title, body }))) onDone();
  };
  return (
    <form
      className="kanban-new"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
      // Esc cancels the form, not the panel round it
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onDone();
      }}
    >
      <input value={title} autoFocus maxLength={256} placeholder="What should be built?" aria-label="The task's title" onChange={(e) => setTitle(e.target.value)} />
      <textarea value={body} rows={3} placeholder="Details, if any: what done looks like" aria-label="The task's details" onChange={(e) => setBody(e.target.value)} />
      {error && <p className="kanban-error">{error}</p>}
      <div className="kanban-new-actions">
        <button type="button" className="link" onClick={onDone}>
          Cancel
        </button>
        <button className="kanban-add" disabled={busy || !title.trim()}>
          {busy ? 'Adding…' : 'Add task'}
        </button>
      </div>
    </form>
  );
}

/** Floor `floorId`'s board, columns only (the console's Issues tab, or inside the panel below). */
export function KanbanBoard({ floorId }: { floorId: string }) {
  const floor = useStore((s) => s.floors.find((f) => f.id === floorId));
  const workers = useStore((s) => s.workers);
  const qa = useStore((s) => s.qa);
  const usage = useStore((s) => s.usage);
  const [adding, setAdding] = useState(false);
  const cols = useMemo(() => (floor ? kanbanFor(floor, Object.values(workers), qa, usage) : null), [floor, workers, qa, usage]);
  if (!cols) return null;
  return (
    <div className="kanban">
      {COLUMNS.map((c) => (
        <section key={c.key} className="kanban-col">
          <h3>
            {c.title} <span className="panel-sub">{cols[c.key].length}</span>
            {c.key === 'backlog' && !adding && (
              <button className="kanban-plus" onClick={() => setAdding(true)} title="File a new task on this floor">
                + New task
              </button>
            )}
          </h3>
          {c.key === 'backlog' && adding && <NewTask floorId={floorId} onDone={() => setAdding(false)} />}
          <ul>
            {cols[c.key].map((card) => (
              <Card key={card.key} card={card} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The board as a panel over the view (the whiteboard's E). */
export function KanbanView({ floorId }: { floorId: string }) {
  const floor = useStore((s) => s.floors.find((f) => f.id === floorId));
  const close = useView((s) => s.closeOverlay);
  if (!floor) return null;
  return (
    <Panel wide onClose={close} title={<>📋 {floor.fullName}</>}>
      <KanbanBoard floorId={floorId} />
    </Panel>
  );
}
