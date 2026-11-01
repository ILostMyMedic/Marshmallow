// The awards (E on the CEO's awards wall, the trophies panel's button, the front desk): how many are won and what
// they've paid, then the company's or a floor's (a tab each), every family a row with its tiers as chips (won: its date
// and coins; not yet: what it takes and pays) and a bar to the next one. awards.ts lays it out from the store's counts
// and trophies; nothing here is sent anywhere. New in Marshmallow.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { awardText } from '../../../../shared/awards';
import { useStore } from '../../store';
import { dateLabel } from '../../world/shipped';
import { useView } from '../../world/view';
import { FloorBadge } from '../console/fields';
import { showTab } from '../console/nav';
import { Panel } from '../Panel';
import { awardsView, unitOf, type ChipView, type GroupView, type RowView } from './awards';
import './awards.css';

/** The awards over the view (overlay { kind: 'awards' }), on a floor's tab or the company's. */
export function AwardsPanel({ floorId }: { floorId?: string }) {
  const close = useView((s) => s.closeOverlay);
  return (
    <Panel wide onClose={close} title="🏅 Awards">
      <AwardsBoard floorId={floorId} />
    </Panel>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function AwardsBoard({ floorId }: { floorId?: string }) {
  const stats = useStore((s) => s.awards);
  const trophies = useStore((s) => s.records.trophies);
  const floors = useStore((s) => s.floors);
  const view = useMemo(() => awardsView(stats, trophies, floors), [stats, trophies, floors]);
  const [tab, setTab] = useState(floorId ?? 'company');
  useEffect(() => setTab(floorId ?? 'company'), [floorId]);
  const groups = [view.company, ...view.floors];
  const group = groups.find((g) => g.key === tab) ?? view.company;
  return (
    <div className="awards">
      <div className="awards-sum">
        <span className="awards-won">
          <b>{view.won}</b> of {view.total} won
        </span>
        <span className="awards-paid">
          Awards have paid 🪙 <b>{view.paid.floors}</b> to the floors for their own, and 🪙 <b>{view.paid.everyFloor}</b> to every floor for the company's.
        </span>
      </div>
      <div className="awards-tabs" role="tablist" aria-label="Whose awards">
        {groups.map((g) => (
          <button key={g.key} role="tab" aria-selected={g.key === group.key} className={`awards-tab${g.key === group.key ? ' on' : ''}`} style={{ '--tab': g.color } as CSSProperties} onClick={() => setTab(g.key)}>
            {g.floor === null ? <span className="awards-tab-icon">🏢</span> : <FloorBadge floor={g.floor} color={g.color} />}
            {g.name}
            <span className="awards-tab-count">
              {g.won}/{g.total}
            </span>
          </button>
        ))}
      </div>
      <Group group={group} />
      {view.floors.length === 0 && (
        <p className="awards-note">
          🏗 No floors yet: each floor wins awards of its own.{' '}
          <button className="link" onClick={() => showTab('floors')}>
            Connect a repository
          </button>
        </p>
      )}
    </div>
  );
}

function Group({ group }: { group: GroupView }) {
  const company = group.floor === null;
  return (
    <section className="awards-group" style={{ '--floor': group.color } as CSSProperties}>
      <p className="awards-note">
        {company
          ? `The company's awards pay every floor: 🪙 ${group.paid} each so far.`
          : `${group.name}'s awards pay ${group.name}: 🪙 ${group.paid} so far. Awards found in its history before the office watched it are kept, but paid nothing.`}
      </p>
      <ul className="awards-rows">
        {group.rows.map((r) => (
          <Row key={r.family.id} row={r} floorName={company ? '' : group.name} />
        ))}
      </ul>
    </section>
  );
}

function Row({ row, floorName }: { row: RowView; floorName: string }) {
  const pct = Math.round(row.fraction * 100);
  return (
    <li className="awards-row">
      <span className={`awards-icon${row.won ? '' : ' none'}`} aria-hidden>
        {row.icon}
      </span>
      <div className="awards-what">
        <strong>{row.family.name}</strong>
        <small>{capital(row.family.counts)}</small>
      </div>
      <div className="awards-track">
        <ol className="awards-chips">
          {row.chips.map((c) => (
            <Chip key={c.id} chip={c} unit={unitOf(row.family.stat, c.tier.target)} floorName={floorName} />
          ))}
        </ol>
        <div className={`awards-bar${row.next ? '' : ' done'}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${row.family.name}: ${row.progress}`}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="awards-progress">{row.progress}</p>
      </div>
    </li>
  );
}

function Chip({ chip, unit, floorName }: { chip: ChipView; unit: string; floorName: string }) {
  const t = chip.trophy;
  const detail = awardText(chip.tier.detail, floorName || 'the floor');
  return (
    <li className={`awards-chip ${t ? 'won' : 'todo'}`} title={detail}>
      <span className="awards-chip-icon" aria-hidden>
        {chip.tier.icon}
      </span>
      <span className="awards-chip-text">
        <b>{chip.name}</b>
        <small>{t ? `${dateLabel(t.earnedAt)} · ${t.reward ? `+${t.reward} 🪙` : 'found in history'}` : `${chip.tier.target} ${unit} · +${chip.tier.reward} 🪙`}</small>
      </span>
    </li>
  );
}
