// The desktop's Notices app: the office's feed, newest first: its own notices (a PR that needs you, a merge GitHub
// refused, Claude's usage warnings) and the CEO's job reports, each labelled by who sent it. Reading it marks it read.
// Adapted from cubefarm client/src/ui/Phone.tsx's notices (MIT).
import { useEffect, useState } from 'react';
import type { OfficeMessage } from '../../../../shared/types';
import { useStore } from '../../store';
import { newestNotice, noticeFeed } from './desk';
import { Empty, useCeo, useFloorLabel, when } from './parts';
import { useDeskSeen } from './seen';

type Filter = 'all' | OfficeMessage['from'];

export function NoticesApp() {
  const messages = useStore((s) => s.messages);
  const ceo = useCeo();
  const floorLabel = useFloorLabel();
  const markNotices = useDeskSeen((s) => s.markNotices);
  // What was new when you opened it keeps its mark while you read.
  const [since] = useState(() => useDeskSeen.getState().seen.notices);
  const [filter, setFilter] = useState<Filter>('all');
  const newest = newestNotice(messages);
  useEffect(() => markNotices(newest), [newest, markNotices]);
  const feed = noticeFeed(messages).filter((m) => filter === 'all' || m.from === filter);
  const filters: [Filter, string][] = [
    ['all', 'All'],
    ['office', '🏢 The office'],
    ['ceo', `🧑‍💼 ${ceo?.name ?? 'The CEO'}`],
  ];
  return (
    <div className="dt-notices">
      <div className="dt-notices-bar">
        <div className="dt-seg" role="radiogroup" aria-label="Show">
          {filters.map(([k, label]) => (
            <button key={k} role="radio" aria-checked={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {feed.length === 0 ? (
        <Empty icon="🔔" title="All quiet">
          PRs that need you, merges GitHub refuses, Claude's usage warnings and the CEO's reports on its jobs come here.
        </Empty>
      ) : (
        <ul className="dt-feed">
          {feed.map((m) => (
            <li key={m.id} className={`dt-feed-item dt-feed-${m.from}${m.at > since ? ' new' : ''}`}>
              <span className="dt-feed-icon" aria-hidden>
                {m.from === 'ceo' ? '🧑‍💼' : '🏢'}
              </span>
              <div className="dt-grow">
                <div className="dt-feed-head">
                  <b>{m.from === 'ceo' ? `${ceo?.name ?? 'The CEO'} · CEO` : 'The office'}</b>
                  {m.floorId && <span className="dt-chip">{floorLabel(m.floorId)}</span>}
                  {m.at > since && <span className="dt-chip dt-chip-new">new</span>}
                  <time>{when(m.at)}</time>
                </div>
                <div className="dt-text">{m.text}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
