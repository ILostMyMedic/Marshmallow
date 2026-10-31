// Playing ping-pong (a paddle in hand): the score chip at the top of the screen, what's happening, and the controls.
// Adapted from cubefarm client/src/ui/PongHud.tsx (MIT): the rebindable keys are cut.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useStore } from '../store';
import { PONG_PLAYER } from '../world/pong';
import type { PointWhy } from '../world/pongRules';
import { pongView, subscribePong, type PongView } from '../world/pongState';

/** What the one who lost the point did, as a phrase after their name. */
const LOST: Record<PointWhy, string> = {
  'serve-fault': 'served a fault',
  net: 'hit the net',
  'own-side': "didn't clear the net",
  out: 'hit it out',
  missed: 'missed it',
  'double-bounce': 'let it bounce twice',
};

/** The line under the score: who serves, who won the point and how, or how the game ended. */
export function pongStatus(v: PongView, name: (end: 'west' | 'east') => string, waited: number): string {
  const you = v.you;
  const other = you === 'west' ? 'east' : 'west';
  if (v.phase === 'waiting') {
    if (you && v[other]) return `${name(other)} is on the way…`;
    return waited > 20 ? "Nobody's free to play right now" : 'Waiting for someone free to come and play…';
  }
  if (v.phase === 'over' && v.last) {
    const w = v.last.winner;
    const score = `${v.score[w]}–${v.score[w === 'west' ? 'east' : 'west']}`;
    return `${w === you ? 'You win' : `${name(w)} wins`} ${score}!${you ? ' · Click for a rematch' : ''}`;
  }
  if (v.phase === 'point') {
    if (!v.last) return 'Let: serve again';
    if (v.last.why === 'game') return '';
    const loser = v.last.winner === 'west' ? 'east' : 'west';
    return `${loser === you ? 'You' : name(loser)} ${LOST[v.last.why]}${v.gamePoint ? ' · Game point' : ''}`;
  }
  if (v.phase === 'serve') {
    const lead = v.gamePoint ? 'Game point · ' : '';
    return v.server === you ? `${lead}Your serve: click to toss and hit` : `${lead}${name(v.server)} to serve`;
  }
  return v.rally >= 3 ? `Rally ${v.rally}` : '';
}

export function PongHud() {
  const v = useSyncExternalStore(subscribePong, pongView);
  const workers = useStore((s) => s.workers);
  const [waited, setWaited] = useState(0);
  const waiting = v?.phase === 'waiting';
  useEffect(() => {
    setWaited(0);
    if (!waiting) return;
    const t = setInterval(() => setWaited((w) => w + 1), 1000);
    return () => clearInterval(t);
  }, [waiting]);
  if (!v) return null;
  const name = (end: 'west' | 'east') => {
    const id = v[end];
    return !id ? '…' : id === PONG_PLAYER ? 'You' : (workers[id]?.name ?? '?');
  };
  const left = v.you ?? 'west';
  const right = left === 'west' ? 'east' : 'west';
  const status = pongStatus(v, name, waited);
  return (
    <>
      <div className="hud-pong" aria-live="polite">
        <div className="hud-pong-score">
          <span className={v.server === left && v.phase !== 'over' ? 'hud-pong-serving' : ''}>{name(left)}</span>
          <b>{v.score[left]}</b>
          <i>:</i>
          <b>{v.score[right]}</b>
          <span className={v.server === right && v.phase !== 'over' ? 'hud-pong-serving' : ''}>{name(right)}</span>
        </div>
        {status && <div className="hud-pong-status">{status}</div>}
      </div>
      <div className="hud-hint">Mouse: the paddle (up: towards the net), swing through for pace · Click: serve · G or Esc: leave the table</div>
    </>
  );
}
