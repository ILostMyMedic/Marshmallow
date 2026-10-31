// The office's keys that work anywhere (Player.tsx has the ones on foot): O the manager's console, P the phone, H the
// help screen, each opening its panel or closing it again. And the first-run setup, which opens by itself until it's
// finished or skipped. Adapted from cubefarm client/src/ui/keymap.ts's global actions (MIT): fixed keys, no rebinding.
import { useEffect } from 'react';
import { useStore } from '../store';
import { act } from '../world/actions';
import { useView, type Overlay } from '../world/view';

const KEYS: Record<string, Overlay> = { KeyO: { kind: 'console' }, KeyP: { kind: 'phone' }, KeyH: { kind: 'help' } };

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/** Opens panel `o`, or closes it when it's the one open. */
export function togglePanel(o: Overlay) {
  const view = useView.getState();
  if (view.overlay?.kind === o.kind) view.closeOverlay();
  else act(o);
}

export function OfficeKeys() {
  const loaded = useStore((s) => s.loaded);
  const setupDone = useStore((s) => s.settings.setupDone);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
      const o = KEYS[e.code];
      if (o && useView.getState().overlay?.kind !== 'setup') togglePanel(o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (loaded && !setupDone && !useView.getState().overlay) act({ kind: 'setup' });
  }, [loaded, setupDone]);
  return null;
}
