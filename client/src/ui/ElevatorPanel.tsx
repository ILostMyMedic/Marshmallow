// The elevator's buttons (E on its panel or the call button): the lobby and every floor, the one you're on lit. A
// press closes this and rides you there (world/elevatorRide.ts).
import { useStore } from '../store';
import { rideTo } from '../world/elevatorRide';
import { useView } from '../world/view';
import { Panel } from './Panel';

export function ElevatorPanel() {
  const floors = useStore((s) => s.floors);
  const workers = useStore((s) => s.workers);
  const here = useView((s) => s.floor);
  const close = useView((s) => s.closeOverlay);
  const go = (floor: number) => {
    close();
    rideTo(floor);
  };
  const stops = [{ floor: 0, name: 'Lobby', note: 'the CEO', color: '#ff8a5b' }, ...floors.map((f) => ({ floor: f.floor, name: f.fullName, note: `${Object.values(workers).filter((w) => w.floorId === f.id).length} on the team`, color: f.color }))].sort((a, b) => b.floor - a.floor);
  return (
    <Panel onClose={close} title="🛗 Going up?">
      <div className="elevator-buttons">
        {stops.map((s) => (
          <button key={s.floor} className={`elevator-button${s.floor === (here ?? -1) ? ' on' : ''}`} style={{ borderColor: s.color }} disabled={s.floor === here} onClick={() => go(s.floor)}>
            <span className="elevator-number" style={{ background: s.color }}>
              {s.floor === 0 ? 'L' : s.floor}
            </span>
            <span>
              <strong>{s.name}</strong>
              <span className="panel-sub"> · {s.floor === here ? "you're here" : s.note}</span>
            </span>
          </button>
        ))}
      </div>
    </Panel>
  );
}
