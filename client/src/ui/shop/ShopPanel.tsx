// The shop: a floor's coins and what they buy. The lobby's kiosk and the HUD's coin chip open it as a panel; the
// console's Shop tab and the debug page show the same view without the panel. Floor tabs with each floor's purse, the
// catalogue by group with each entry's price and whether it can be bought (shop.ts has the words), a spot picker for
// extras, what stands on the floor with a move for what was bought, and the floor's latest ledger lines. A purchase or a
// move goes over REST; the coins and the floor plan come back over /ws, so only a refusal needs showing, beside what
// was clicked. Adapted from cubefarm client/src/ui/Catalogue.tsx (MIT): bought things go straight into their spots,
// with no decor box to carry them from.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { spotOf, type ShopEntry } from '../../../../shared/shop';
import type { Floor, FloorCoins, FloorItem } from '../../../../shared/types';
import { command, floorPath } from '../../api';
import { useStore } from '../../store';
import { useView } from '../../world/view';
import { FloorBadge } from '../console/fields';
import { showTab } from '../console/nav';
import { cue } from '../notifySfx';
import { Panel } from '../Panel';
import { catalogue, chosenSpot, entryView, ledgerLines, onFloor, placedNote, shopFloor, stateLabel, type EntryView, type PlacedView } from './shop';
import './shop.css';

const NO_COINS: FloorCoins = { coins: 0, earned: 0 };
const NO_ITEMS: FloorItem[] = [];
/** How long a purchase's note stays (ms). */
const NOTE_MS = 8000;

const shortName = (f: Floor) => f.fullName.split('/').pop() ?? f.fullName;

/** The shop over the view (overlay { kind: 'shop' }), on `floorId` or the floor you're on. */
export function ShopPanel({ floorId }: { floorId?: string }) {
  const close = useView((s) => s.closeOverlay);
  return (
    <Panel wide onClose={close} title="🪙 Shop">
      <ShopView floorId={floorId} />
    </Panel>
  );
}

/**
 * The shop itself, on `floorId` (else the floor you're on, else the first). `onPick` hears a floor tab picked (the
 * console keeps it in its overlay); `tabs={false}` leaves the tabs out where the floor is given (the debug page).
 */
export function ShopView({ floorId, onPick, tabs = true }: { floorId?: string; onPick?: (floorId: string) => void; tabs?: boolean }) {
  const floors = useStore((s) => s.floors);
  const purses = useStore((s) => s.coins.floors);
  const here = useView((s) => s.floor);
  const [picked, setPicked] = useState(floorId);
  useEffect(() => setPicked(floorId), [floorId]);
  const floor = shopFloor(floors, picked, here);
  if (!floor)
    return (
      <div className="shop shop-empty">
        <p>🏗 No floors yet. Each floor earns its own coins as its pull requests merge, and spends them here.</p>
        <button className="console-btn good" onClick={() => showTab('floors')}>
          Connect a repository
        </button>
      </div>
    );
  const pick = (id: string) => {
    setPicked(id);
    onPick?.(id);
  };
  return (
    <div className="shop" style={{ '--floor': floor.color } as CSSProperties}>
      {tabs && (
        <div className="shop-tabs" role="tablist" aria-label="Floor">
          {floors.map((f) => (
            <button key={f.id} role="tab" aria-selected={f.id === floor.id} className={`shop-tab${f.id === floor.id ? ' on' : ''}`} style={{ '--tab': f.color } as CSSProperties} onClick={() => pick(f.id)}>
              <FloorBadge floor={f.floor} color={f.color} />
              {shortName(f)}
              <span className="shop-tab-coins">🪙 {purses[f.id]?.coins ?? 0}</span>
            </button>
          ))}
        </div>
      )}
      <ShopFloor key={floor.id} floor={floor} />
    </div>
  );
}

/** The clock, ticking every `ms`, for the ledger's "5 min ago". */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** What the last click came to, shown beside it: a refusal, or what went where. */
interface Note {
  at: string;
  text: string;
  ok: boolean;
}

function ShopFloor({ floor }: { floor: Floor }) {
  const purse = useStore((s) => s.coins.floors[floor.id]) ?? NO_COINS;
  const plan = useStore((s) => s.floorPlans[floor.id]) ?? NO_ITEMS;
  const recent = useStore((s) => s.coins.recent);
  const now = useNow(30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [spots, setSpots] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!note?.ok) return;
    const t = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(t);
  }, [note]);

  /** Sends a purchase or a move; a refusal shows at `at`, the success note at `doneAt`. */
  const send = async (at: string, doneAt: string, verb: 'buy' | 'move', body: object, done: string) => {
    setBusy(at);
    setNote(null);
    try {
      await command('POST', `/api/floors/${floorPath(floor.id)}/shop/${verb}`, body);
      if (verb === 'buy') cue('coins');
      setNote({ at: doneAt, text: done, ok: true });
    } catch (err) {
      setNote({ at, text: err instanceof Error ? err.message : String(err), ok: false });
    } finally {
      setBusy(null);
    }
  };
  const buy = (v: EntryView) => {
    const e = v.entry;
    const spot = e.type === 'extra' ? chosenSpot(v.spots, spots[e.id]) : plan.find((i) => i.item === e.item)?.spot;
    const label = (spot && spotOf(spot)?.label) || '';
    void send(e.id, e.id, 'buy', e.type === 'extra' ? { item: e.id, spot } : { item: e.id }, placedNote(e, label));
  };
  const move = (p: PlacedView, to: string) => {
    const label = p.moves.find((s) => s.id === to)?.label ?? to;
    void send(`move:${p.spot.id}`, `move:${to}`, 'move', { from: p.spot.id, to }, placedNote(p, label, true));
  };
  const noteAt = (at: string): ReactNode =>
    note?.at === at && (
      <p className={note.ok ? 'shop-done' : 'shop-bad'} role={note.ok ? 'status' : 'alert'}>
        {note.text}
      </p>
    );

  const placed = onFloor(plan);
  const lines = ledgerLines(recent, floor.id, now);
  return (
    <div className="shop-body">
      <div className="shop-main">
        <div className="shop-purse">
          <span className="shop-coins" aria-label={`${purse.coins} coins to spend`}>
            🪙 {purse.coins}
          </span>
          <div>
            <strong>{shortName(floor)}'s coins to spend</strong>
            <div className="console-hint">
              {purse.earned} earned in all. Every merge on this floor pays coins, and a bit more when QA passed it first time or it was fixed after failing.
            </div>
          </div>
        </div>
        {catalogue().map((g) => (
          <section key={g.id} className="shop-group">
            <h3 className="shop-h">
              {g.title} <span className="console-hint">· {g.hint}</span>
            </h3>
            <div className="shop-grid">
              {g.entries.map((e) => (
                <EntryCard
                  key={e.id}
                  v={entryView(e, plan, purse.coins)}
                  spot={spots[e.id]}
                  onSpot={(id) => setSpots({ ...spots, [e.id]: id })}
                  onBuy={buy}
                  busy={busy}
                  note={noteAt(e.id)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      <aside className="shop-side">
        <section className="shop-card">
          <h3 className="shop-h">🏠 On this floor</h3>
          <ul className="shop-placed">
            {placed.map((p) => (
              <li key={p.spot.id}>
                <div className="shop-placed-row">
                  <span className="shop-icon small">{p.icon}</span>
                  <div className="console-grow">
                    <strong>{p.name}</strong> {p.kit && <span className={`console-chip${p.item.tier > 1 ? ' shop-up' : ''}`}>{p.item.tier > 1 ? '✨ upgraded' : 'kit'}</span>}
                    <div className="console-hint">{p.spot.label}</div>
                    {p.moves.length > 0 && (
                      <select className="shop-select shop-move" value="" disabled={busy !== null} aria-label={`Move the ${p.name.toLowerCase()}`} onChange={(e) => e.target.value && move(p, e.target.value)}>
                        <option value="">{busy === `move:${p.spot.id}` ? 'Moving…' : 'Move to…'}</option>
                        {p.moves.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
                {noteAt(`move:${p.spot.id}`)}
              </li>
            ))}
          </ul>
          {placed.every((p) => p.kit) && <p className="console-hint">Only the kit so far: what you buy shows up here, in its spot.</p>}
        </section>
        <section className="shop-card">
          <h3 className="shop-h">🧾 Ledger</h3>
          {lines.length === 0 ? (
            <p className="console-hint">No coins in or out yet. The floor's first merge brings some.</p>
          ) : (
            <ul className="shop-ledger">
              {lines.map((l) => (
                <li key={l.id}>
                  <span aria-hidden>{l.icon}</span>
                  <b className={l.earned ? 'in' : 'out'}>{l.amount}</b>
                  <span className="console-grow">{l.text}</span>
                  <small>{l.when}</small>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}

/** One thing the shop sells: its price for this floor, and Buy (with a spot for an extra) or why not. */
function EntryCard({ v, spot, onSpot, onBuy, busy, note }: { v: EntryView; spot: string | undefined; onSpot: (id: string) => void; onBuy: (v: EntryView) => void; busy: string | null; note: ReactNode }) {
  const e: ShopEntry = v.entry;
  const can = v.state.kind === 'buy';
  const chosen = chosenSpot(v.spots, spot);
  return (
    <article className={`shop-item shop-item-${v.state.kind}`}>
      <div className="shop-item-head">
        <span className="shop-icon">{e.icon}</span>
        <div className="console-grow">
          <strong>{e.name}</strong>
          {e.type === 'extra' && v.owned > 0 && <span className="console-chip">{v.owned} here</span>}
        </div>
        {v.state.kind !== 'owned' && <span className="shop-price">🪙 {v.price}</span>}
      </div>
      <p className="shop-blurb">{e.blurb}</p>
      <div className="shop-item-foot">
        {can && e.type === 'extra' && (
          <select className="shop-select" value={chosen} disabled={busy !== null} aria-label={`Where the ${e.name.toLowerCase()} goes`} title="Where it goes" onChange={(ev) => onSpot(ev.target.value)}>
            {v.spots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        {can ? (
          <button className="console-btn good" disabled={busy !== null} onClick={() => onBuy(v)}>
            {busy === e.id ? 'Buying…' : 'Buy'}
          </button>
        ) : (
          <span className={`shop-state shop-state-${v.state.kind}`}>
            {v.state.kind === 'owned' ? '✓ ' : ''}
            {stateLabel(v.state)}
          </span>
        )}
      </div>
      {note}
    </article>
  );
}
