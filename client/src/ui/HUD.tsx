// What sits on top of the 3D view: in first person the crosshair, what E does with what it's on, what you can do with
// what you hold, and how to look round; in the overview, how to get about; either way a passing note (view.ts toast)
// and the office's buttons (the console, the desktop with a count of what's new on it, help).
// Adapted from cubefarm client/src/ui/HUD.tsx (MIT).
import { useEffect, useState } from 'react';
import { toggleWalk } from '../world/Player';
import { sipLabel } from '../world/sip';
import { newsLine } from './desktop/desk';
import { useDesktopNews } from './desktop/seen';
import { togglePanel } from './OfficeKeys';
import { PongHud } from './PongHud';
import { TourCard } from './TourCard';
import { useView, type Held } from '../world/view';

const TOAST_MS = 2600;

/** What you can do with what's in your hands. */
function heldHint(h: Exclude<Held, { kind: 'paddle' }>) {
  if (h.kind === 'mug' && h.sips === 0) return 'Empty: refill it at the machine · G: put it down';
  return `E: ${sipLabel(h)} · G: put it down`;
}

function Toast() {
  const toast = useView((s) => s.toast);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, TOAST_MS - (performance.now() - toast.at)) + 20);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || performance.now() - toast.at > TOAST_MS) return null;
  return <div className="hud-toast">{toast.text}</div>;
}

/**
 * The office's buttons, top right under the sound: the manager's console, the desktop and help, each with its key.
 * Always up, even while you look round, so the desktop's badge (threads waiting on you, chats with new replies,
 * notices) is never out of sight; it pulses when something new comes in.
 */
function OfficeBar() {
  const news = useDesktopNews();
  return (
    <nav className="office-bar">
      <button onClick={() => togglePanel({ kind: 'console' })} title="The manager's console (O)">
        🗂 Office <kbd>O</kbd>
      </button>
      <button className={news.total ? 'office-news' : undefined} onClick={() => togglePanel({ kind: 'desktop' })} title={newsLine(news)}>
        🖥 Desktop <kbd>P</kbd>
        {news.total > 0 && (
          <span key={news.total} className="office-badge">
            {news.total}
          </span>
        )}
      </button>
      <button onClick={() => togglePanel({ kind: 'help' })} title="Help (H)">
        ❔ Help <kbd>H</kbd>
      </button>
    </nav>
  );
}

export function HUD() {
  const mode = useView((s) => s.mode);
  const focus = useView((s) => s.focus);
  const locked = useView((s) => s.locked);
  const overlay = useView((s) => s.overlay);
  const held = useView((s) => s.held);
  const hover = useView((s) => s.hover);
  if (overlay) return null;
  if (mode === 'overview')
    return (
      <>
        <Toast />
        <TourCard />
        <OfficeBar />
        <button className="hud-walk" onClick={toggleWalk}>
          🚶 Walk the floor <kbd>Tab</kbd>
        </button>
        <div className="hud-hint">{hover ? `Click: ${hover.label}` : 'Drag to turn · wheel to zoom · right-drag or WASD to move · click a person or a desk · M: sound'}</div>
      </>
    );
  const playing = held?.kind === 'paddle';
  return (
    <>
      <Toast />
      <TourCard />
      <OfficeBar />
      {locked && !playing && <div className={`crosshair${focus ? ' on' : ''}`} />}
      {focus && locked && !playing && <div className="hud-use">E / Click: {focus.label}</div>}
      {playing && <PongHud />}
      {locked && held && held.kind !== 'paddle' && <div className="hud-hint">{heldHint(held)}</div>}
      {!locked && <div className="hud-hint">Click to look around · WASD to walk, Shift to run · V: 1st / 3rd person · C: your look · Tab: overview · M: sound</div>}
    </>
  );
}
