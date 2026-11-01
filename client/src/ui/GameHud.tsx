// A game in hand (a hoop's ball or a dartboard's darts): the score chip at the top of the screen (makes, the streak and
// the best; or this turn's darts and the best turn), the wind-up meter while the mouse is held (its sweet spot marked:
// for the hoop, the charge that drops it in from where you stand), and the controls. New in Marshmallow, after
// PongHud.tsx.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { DART_THROW } from '../world/games/darts';
import { boardAt, chargeNow, courtAt, dartsTally, gamesVersion, hoopTally, subscribeGames, turnLabels } from '../world/games/gameState';
import { useStore } from '../store';
import { useView, type Held } from '../world/view';

/** How wide the meter's sweet spot is drawn either side of the ideal charge. */
const SWEET = 0.05;

/** The wind-up meter: how far wound up, and where the sweet spot is. */
function Meter({ ideal }: { ideal: number }) {
  const [power, setPower] = useState<number | null>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setPower(chargeNow());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  if (power === null) return null;
  const from = Math.max(0, ideal - SWEET);
  const to = Math.min(1, ideal + SWEET);
  const sweet = power >= from && power <= to;
  return (
    <div className="hud-meter" aria-hidden>
      <div className="hud-meter-sweet" style={{ left: `${from * 100}%`, width: `${(to - from) * 100}%` }} />
      <div className={`hud-meter-fill${sweet ? ' on' : ''}`} style={{ width: `${power * 100}%` }} />
    </div>
  );
}

export function GameHud({ held }: { held: Extract<Held, { kind: 'game' }> }) {
  useSyncExternalStore(subscribeGames, gamesVersion);
  const here = useView((s) => s.floor);
  const floorId = useStore((s) => s.floors.find((f) => f.floor === here)?.id ?? '');
  if (held.game === 'hoop') {
    const t = hoopTally(floorId, held.spot);
    const court = courtAt(held.spot);
    return (
      <>
        <div className="hud-pong" aria-live="polite">
          <div className="hud-pong-score">
            🏀 <b>{t.makes}</b>
            <i>/</i>
            <span>{t.shots}</span>
            {t.streak >= 2 && <span>🔥 {t.streak}</span>}
            {t.best > 0 && <span className="hud-game-best">best streak {t.best}</span>}
          </div>
        </div>
        <Meter ideal={court?.ideal ?? 0.5} />
        <div className="hud-hint">Aim at the square · hold the mouse to wind up, let go to shoot · G: put the ball back</div>
      </>
    );
  }
  const labels = turnLabels(boardAt(held.spot));
  const d = dartsTally();
  return (
    <>
      <div className="hud-pong" aria-live="polite">
        <div className="hud-pong-score">
          🎯
          {[0, 1, 2].map((i) => (
            <span key={i} className="hud-game-dart">
              {labels[i] ?? '·'}
            </span>
          ))}
          {d.best > 0 && <span className="hud-game-best">best turn {d.best}</span>}
        </div>
        {d.last !== null && labels.length === 0 && <div className="hud-pong-status">Last turn: {d.last}</div>}
      </div>
      <Meter ideal={DART_THROW.ideal} />
      <div className="hud-hint">Aim with the crosshair · hold the mouse to wind up, let go to throw · G: put the darts back</div>
    </>
  );
}
