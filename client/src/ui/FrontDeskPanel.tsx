// The front desk (E on it in the lobby): Mia says hello, shows today in numbers (world/tour.ts todayStatus), offers
// the tour (world/TourGuide.tsx), and lists every floor with what it's building and who's on it, each a ride away.
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { rideTo } from '../world/elevatorRide';
import { CEO_FLOOR, ROOF } from '../world/floors';
import { clip, names, todayStatus, tourStops } from '../world/tour';
import { useTour } from '../world/tourState';
import { useView } from '../world/view';
import { Panel } from './Panel';

export function FrontDeskPanel() {
  const company = useStore((s) => s.settings.companyName) || 'Marshmallow';
  const today = useStore(useShallow((s) => todayStatus(s, Date.now())));
  const floors = useStore((s) => s.floors);
  const workers = useStore((s) => s.workers);
  const qa = useStore((s) => s.qa);
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
        <button className="frontdesk-tour" onClick={tour}>
          🧭 Take the tour: every floor, the CEO's office and the roof
        </button>
        <h3>The floors</h3>
        <ul className="frontdesk-floors">
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
                      {f.issues.length} open issues · {inQa} in QA
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
              <p>{ceo ? `${ceo.name} plans the floors' work from up here.` : "Waiting for a CEO: hire one from the debug page."}</p>
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
