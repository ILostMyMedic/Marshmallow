// Adapted from cubefarm client/src/world/lookLock.ts (MIT): the panel in view.ts is the only thing that covers the view.
import { useLookPrefs } from './look';
import { shouldGrabLook, viewUncovered } from './lookLockRules';
import { useView } from './view';

// Grabs the mouse again when a panel closes, so looking around needs no extra click. The store listener runs
// synchronously inside set(), which happens inside the closing click handler, so the browser still counts
// requestPointerLock as part of that user gesture (an Esc keydown doesn't count: the click hint covers that).

/**
 * Watches the open panel. On every close that uncovers the view it calls hush (so a double click's second half can't
 * act through the freshly locked canvas) and, if the setting is on, grab. Returns the unsubscribe function.
 */
export function watchLookLock(grab: () => void, hush: () => void): () => void {
  return useView.subscribe((s, p) => {
    if (s.overlay === p.overlay) return;
    const prev = { overlay: !!p.overlay, confirm: false };
    const next = { overlay: !!s.overlay, confirm: false };
    if (!viewUncovered(prev, next)) return;
    hush();
    if (s.mode === 'first' && shouldGrabLook(prev, next, { started: true, enabled: useLookPrefs.getState().grabOnClose })) grab();
  });
}
