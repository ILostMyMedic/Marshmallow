// What the office has shipped and won (E on the lobby's trophy cabinet or its shipped wall): every trophy with its date
// and what it was for, the company's first and then each floor's, and the latest merges, each a link to its PR.
import { useStore } from '../store';
import { byLine, dateLabel, prs, whenLabel } from '../world/shipped';
import { floorName, GONE_COLOR, trophyGroups } from '../world/trophyShelf';
import { useView, type Overlay } from '../world/view';
import { Panel } from './Panel';

/** What E on the cabinet or the wall opens. */
export const TROPHIES_OVERLAY: Overlay = { kind: 'trophies' };

/** Shipped lately, as the panel lists them. */
const RECENT = 12;

/** The trophies and the latest merges, for the panel and the front desk. */
export function TrophyList() {
  const records = useStore((s) => s.records);
  const floors = useStore((s) => s.floors);
  const groups = trophyGroups(records, floors);
  const now = Date.now();
  const n = records.trophies.length;
  return (
    <div className="trophies">
      <p className="trophies-sum">
        🚢 <b>{prs(records.total)}</b> shipped in all · 🏆 <b>{n}</b> troph{n === 1 ? 'y' : 'ies'}
      </p>
      {n === 0 && <p className="trophies-empty">No trophies yet: the first merge puts one in the lobby's cabinet.</p>}
      {groups.map((g) => (
        <section key={g.key}>
          <h4>
            <span className="trophies-chip" style={{ background: g.color }} />
            {g.name} <small>{prs(g.total)} shipped</small>
          </h4>
          <ul className="trophies-list">
            {g.trophies.map((t) => (
              <li key={t.id}>
                <span className="trophies-icon">{t.icon}</span>
                <div>
                  <strong>{t.title}</strong>
                  <p>{t.detail}</p>
                </div>
                <time dateTime={new Date(t.earnedAt).toISOString()}>{dateLabel(t.earnedAt)}</time>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {records.recent.length > 0 && (
        <section>
          <h4>🚢 Shipped lately</h4>
          <ul className="trophies-shipped">
            {records.recent.slice(0, RECENT).map((w) => (
              <li key={`${w.floorId}#${w.prNumber}`}>
                <span className="trophies-chip" style={{ background: floors.find((f) => f.id === w.floorId)?.color ?? GONE_COLOR }} />
                <div>
                  {w.url ? (
                    <a href={w.url} target="_blank" rel="noreferrer">
                      #{w.prNumber} {w.title}
                    </a>
                  ) : (
                    `#${w.prNumber} ${w.title}`
                  )}
                  <small>
                    {floorName(floors, w.floorId)} · {byLine(w)}
                  </small>
                </div>
                <time dateTime={new Date(w.mergedAt).toISOString()}>{whenLabel(w.mergedAt, now)}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function TrophiesPanel() {
  const close = useView((s) => s.closeOverlay);
  return (
    <Panel onClose={close} title="🏆 Trophies and shipped work">
      <TrophyList />
    </Panel>
  );
}
