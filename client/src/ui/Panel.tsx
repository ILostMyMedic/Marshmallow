// A panel over the 3D view: a title, a close button, and what it shows. Esc or a click outside closes it.
// Adapted from cubefarm client/src/ui/Panel.tsx (MIT).
import { useEffect, type ReactNode } from 'react';

export function Panel({ title, onClose, wide = false, children }: { title: ReactNode; onClose: () => void; wide?: boolean; children: ReactNode }) {
  useEffect(() => {
    // Marked handled, so the Esc that closes a panel isn't also taken as "leave the overview" (Player.tsx skips it),
    // whichever listener runs first; what keeps Esc for itself inside (the terminal, a form) stops it on the way up
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="panel-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={`panel${wide ? ' panel-wide' : ''}`} role="dialog" aria-modal="true">
        <header className="panel-head">
          <h2>{title}</h2>
          <button className="panel-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="panel-body">{children}</div>
      </section>
    </div>
  );
}
