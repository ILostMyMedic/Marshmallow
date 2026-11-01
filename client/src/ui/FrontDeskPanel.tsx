// The front desk (E on it in the lobby): Mia says hello, shows today in numbers (world/tour.ts todayStatus) and what
// the office has shipped and won (ui/TrophiesPanel.tsx, and a link to every award), offers the tour
// (world/TourGuide.tsx), lists every floor with what it's building and who's on it, each a ride away, and points the
// way to the manager's console.
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { act } from '../world/actions';
import { rideTo } from '../world/elevatorRide';
import { CEO_FLOOR, ROOF } from '../world/floors';
import { dateLabel, prs } from '../world/shipped';
import { clip, names, todayStatus, tourStops } from '../world/tour';
import { useTour } from '../world/tourState';
import { useView } from '../world/view';
import { wonOf } from './awards/awards';
import { showTab } from './console/nav';
import { Panel } from './Panel';
import { TrophyList } from './TrophiesPanel';

export function FrontDeskPanel() {
  const company = useStore((s) => s.settings.companyName) || 'Marshmallow';
  const today = useStore(useShallow((s) => todayStatus(s, Date.now())));
  const floors = useStore((s) => s.floors);
  const workers = useStore((s) => s.workers);
  const qa = useStore((s) => s.qa);
  const purses = useStore((s) => s.coins.floors);
  const records = useStore((s) => s.records);
  const newest = records.trophies.at(-1);
  const awards = wonOf(records.trophies, floors.map((f) => f.id));
  const close = useView((s) => s.closeOverlay);
  const go = (floor: number) => {
    close();
    rideTo(floor);
  };
  const tour = () => {
    close();
    const s = useStore.getState();
    useTour.getState().start(tourStops(s, Date.now()));
  };
  const ceo = Object.values(workers).find((w) => w.role === 'ceo');
  const tiles: [string, string, string][] = [
    ['🎉', String(today.merged), 'merged today'],
    ['🚀', String(today.opened), 'PRs opened'],
    ['📋', String(today.filed), 'issues filed'],
    ['🔍', String(today.inQa), 'in QA'],
    ['🧑‍💻', `${today.working}/${today.team}`, 'at work'],
  ];
  return (
    <Panel wide onClose={close} title="👋 Front desk">
      <div className="frontdesk">
        <p className="frontdesk-hello">
          Hi, I'm Mia! Welcome to <strong>{company}</strong>. Here's how today's going:
        </p>
        <div className="frontdesk-tiles">
          {tiles.map(([icon, n, label]) => (
            <div key={label} className="frontdesk-tile">
              <span>{icon}</span>
              <b>{n}</b>
              <small>{label}</small>
            </div>
          ))}
        </div>
        <p className="frontdesk-records">
          <span>
            🚢 <b>{prs(records.total)}</b> shipped in all
          </span>
          {newest ? (
            <span>
              🏆 Newest trophy: {newest.icon} <b>{newest.title}</b> · {dateLabel(newest.earnedAt)}
            </span>
          ) : (
            <span>🏆 The trophy cabinet is waiting for your first merge</span>
          )}
          <span>
            🏅 <b>{awards.won}</b> of {awards.total} awards won ·{' '}
            <button className="link" onClick={() => act({ kind: 'awards' })}>
              see every award
            </button>
          </span>
        </p>
        <details className="frontdesk-trophies">
          <summary>Every trophy, and what we shipped lately</summary>
          <TrophyList />
        </details>
        <button className="frontdesk-tour" onClick={tour}>
          🧭 Take the tour: every floor, the CEO's office and the roof
        </button>
        <button className="frontdesk-console" onClick={() => showTab('floors')}>
          🗂 The manager's console <kbd>O</kbd>: connect a repository, hire workers, change settings
        </button>
        <h3>The floors</h3>
        <ul className="frontdesk-floors">
          {floors.length === 0 && (
            <li style={{ borderColor: '#ff8a5b' }}>
              <span className="elevator-number" style={{ background: '#ff8a5b' }}>
                +
              </span>
              <div>
                <strong>No floors yet</strong>
                <p>Every GitHub repository you connect gets a floor of its own, with a team to build its issues.</p>
              </div>
              <button onClick={() => showTab('floors')}>Connect one</button>
            </li>
          )}
          {[...floors]
            .sort((a, b) => b.floor - a.floor)
            .map((f) => {
              const team = Object.values(workers).filter((w) => w.floorId === f.id && w.role !== 'ceo');
              const inQa = Object.values(qa).filter((q) => q.floorId === f.id && (q.status === 'queued' || q.status === 'testing')).length;
              return (
                <li key={f.id} style={{ borderColor: f.color }}>
                  <span className="elevator-number" style={{ background: f.color }}>
                    {f.floor}
                  </span>
                  <div>
                    <strong>{f.fullName}</strong>
                    <p>{clip(f.summary || f.description || f.mission || 'One of our projects.', 140)}</p>
                    <small>
                      {team.length ? `${names(team.map((w) => w.name), 4)} · ` : 'No team yet · '}
                      {f.issues.length} open issues · {inQa} in QA · 🪙 {purses[f.id]?.coins ?? 0}
                    </small>
                  </div>
                  <button onClick={() => go(f.floor)}>Take me there</button>
                </li>
              );
            })}
          <li style={{ borderColor: '#9b5de5' }}>
            <span className="elevator-number" style={{ background: '#9b5de5' }}>
              C
            </span>
            <div>
              <strong>The CEO's office</strong>
              <p>
                {ceo ? (
                  `${ceo.name} plans the floors' work from up here.`
                ) : (
                  <>
                    Waiting for a CEO:{' '}
                    <button className="link" onClick={() => showTab('team')}>
                      hire one in the manager's console
                    </button>
                    .
                  </>
                )}
              </p>
            </div>
            <button onClick={() => go(CEO_FLOOR)}>Take me there</button>
          </li>
          <li style={{ borderColor: '#2a9d8f' }}>
            <span className="elevator-number" style={{ background: '#2a9d8f' }}>
              R
            </span>
            <div>
              <strong>The roof terrace</strong>
              <p>The best view in town, a fireplace and deck chairs: where breaks happen.</p>
            </div>
            <button onClick={() => go(ROOF)}>Take me there</button>
          </li>
        </ul>
      </div>
    </Panel>
  );
}
