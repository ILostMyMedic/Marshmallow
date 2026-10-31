// While Mia gives you the tour (world/TourGuide.tsx): where you are, what's here (world/tour.ts's card), and the way on:
// N (or the button) for the next stop, X to end the tour.
import { useEffect } from 'react';
import { useTour } from '../world/tourState';
import { useView } from '../world/view';

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export function TourCard() {
  const active = useTour((s) => s.active);
  const stops = useTour((s) => s.stops);
  const at = useTour((s) => s.at);
  const next = useTour((s) => s.next);
  const end = useTour((s) => s.end);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || typing(e) || useView.getState().overlay) return;
      if (e.code === 'KeyN') next();
      if (e.code === 'KeyX') end();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, next, end]);
  const stop = active ? stops[at] : null;
  if (!stop) return null;
  const after = stops[at + 1];
  return (
    <aside className="tour-card" aria-live="polite">
      <div className="tour-card-head">
        <span>
          🧭 Tour · {at + 1}/{stops.length}
        </span>
        <strong>{stop.title}</strong>
      </div>
      {stop.card.map((line) => (
        <p key={line}>{line}</p>
      ))}
      <div className="tour-card-keys">
        {after ? (
          <button onClick={next}>
            <kbd>N</kbd> Next: {after.title}
          </button>
        ) : (
          <button onClick={end}>
            <kbd>N</kbd> Finish
          </button>
        )}
        <button onClick={end}>
          <kbd>X</kbd> End the tour
        </button>
      </div>
    </aside>
  );
}
