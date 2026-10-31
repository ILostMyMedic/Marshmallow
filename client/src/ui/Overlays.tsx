// The panel open over the 3D view (view.ts overlay): a worker's terminal, or a floor's board. Adapted from cubefarm
// client/src/ui/Overlays.tsx, TerminalView.tsx and KanbanView.tsx (MIT): read-only for now; the worker panel's message
// box and setup, and the board's actions, come with the manager UI.
import { useMemo } from 'react';
import type { Worker } from '../../../shared/types';
import { kanbanFor, type KanbanCard, type KanbanColumns } from '../kanban';
import { useStore } from '../store';
import { useView } from '../world/view';
import { LiveTerminal } from './LiveTerminal';
import { Panel } from './Panel';

/** What a worker is on, in a few words. */
function doing(w: Worker) {
  const t = w.task;
  if (!t || w.status === 'idle') return w.role === 'ceo' ? 'CEO · running the company' : 'free';
  const what = t.kind === 'qa' ? `testing PR #${t.prNumber}` : t.kind === 'fix' ? `fixing PR #${t.prNumber}` : `issue #${t.issueNumber}`;
  return `${what} · ${t.title}`;
}

function TerminalView({ workerId }: { workerId: string }) {
  const w = useStore((s) => s.workers[workerId]);
  const close = useView((s) => s.closeOverlay);
  if (!w) return null;
  return (
    <Panel
      wide
      onClose={close}
      title={
        <>
          {w.name} <span className="panel-sub">· {w.status} · {doing(w)}</span>
        </>
      }
    >
      {w.needsSignIn && <p className="panel-note">🔑 Their Claude Code in the cloud needs signing in: follow the steps in the terminal below.</p>}
      <div className="panel-terminal">
        <LiveTerminal workerId={w.id} />
      </div>
      <p className="panel-note">Type to talk to the CLI; Esc in the terminal interrupts Claude Code. Esc outside it closes this.</p>
    </Panel>
  );
}

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

function KanbanView({ floorId }: { floorId: string }) {
  const floor = useStore((s) => s.floors.find((f) => f.id === floorId));
  const workers = useStore((s) => s.workers);
  const qa = useStore((s) => s.qa);
  const usage = useStore((s) => s.usage);
  const close = useView((s) => s.closeOverlay);
  const cols = useMemo(() => (floor ? kanbanFor(floor, Object.values(workers), qa, usage) : null), [floor, workers, qa, usage]);
  if (!floor || !cols) return null;
  return (
    <Panel wide onClose={close} title={<>📋 {floor.fullName}</>}>
      <div className="kanban">
        {COLUMNS.map((c) => (
          <section key={c.key} className="kanban-col">
            <h3>
              {c.title} <span className="panel-sub">{cols[c.key].length}</span>
            </h3>
            <ul>
              {cols[c.key].map((card) => (
                <Card key={card.key} card={card} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Panel>
  );
}

export function Overlays() {
  const overlay = useView((s) => s.overlay);
  if (overlay?.kind === 'terminal') return <TerminalView workerId={overlay.workerId} />;
  if (overlay?.kind === 'kanban') return <KanbanView floorId={overlay.floorId} />;
  return null;
}
