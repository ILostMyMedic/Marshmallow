// The elevator's buttons (E on its panel, the call button or the lobby's directory): the roof terrace, the CEO's office,
// every repo floor and the lobby, top first, the one you're on lit. A press closes this and rides you there
// (world/elevatorRide.ts).
import { useStore } from '../store';
import { rideTo } from '../world/elevatorRide';
import { kindOf, stops } from '../world/floors';
import { useView } from '../world/view';
import { Panel } from './Panel';

/** A stop's colour chip: a repo floor's own colour, else one for the game's floors. */
const CHIPS = { lobby: '#ff8a5b', ceo: '#9b5de5', roof: '#2a9d8f' } as const;

export function ElevatorPanel() {
  const floors = useStore((s) => s.floors);
  const workers = useStore((s) => s.workers);
  const here = useView((s) => s.floor);
  const close = useView((s) => s.closeOverlay);
  const go = (floor: number) => {
    close();
    rideTo(floor);
  };
  return (
    <Panel onClose={close} title="🛗 Going up?">
      <div className="elevator-buttons">
        {stops(floors).map((s) => {
          const f = floors.find((x) => x.floor === s.floor);
          const kind = kindOf(s.floor);
          const color = f?.color ?? CHIPS[kind === 'office' ? 'lobby' : kind];
          const note = f ? `${Object.values(workers).filter((w) => w.floorId === f.id).length} on the team` : kind === 'ceo' ? 'the CEO' : kind === 'roof' ? 'fireplace, deck chairs, the view' : 'front desk';
          const isHere = s.floor === here;
          return (
            <button key={s.floor} className={`elevator-button${isHere ? ' on' : ''}`} style={{ borderColor: color }} disabled={isHere} onClick={() => go(s.floor)}>
              <span className="elevator-number" style={{ background: color }}>
                {s.key}
              </span>
              <span>
                <strong>{s.name}</strong>
                <span className="panel-sub"> · {isHere ? "you're here" : note}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
