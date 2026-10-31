// What E does: a panel opens over the view, or something happens in the room. The things in the room register for
// their own actions here (the coffee machine for 'coffee', the table for 'paddle'…), so the player needn't know them
// all; and whatever you hold gets first go at E (a sip of the coffee in your hand), before the crosshair's target.
import { isPanel, useView, type Action, type Overlay } from './view';

type RoomAction = Exclude<Action, Overlay>;
type Handler<K extends RoomAction['kind']> = (a: Extract<RoomAction, { kind: K }>) => void;

const handlers = new Map<string, (a: RoomAction) => void>();
let heldUse: ((focusKind: Action['kind'] | null) => boolean) | null = null;

/** Handles `kind`'s actions until the returned function is called. */
export function onAction<K extends RoomAction['kind']>(kind: K, fn: Handler<K>) {
  const h = fn as (a: RoomAction) => void;
  handlers.set(kind, h);
  return () => {
    if (handlers.get(kind) === h) handlers.delete(kind);
  };
}

/**
 * Does the action: a panel opens (and takes the mouse back from looking round, or clicks would go to the locked
 * canvas), or its handler runs. False when nothing handles it (its thing isn't on screen).
 */
export function act(a: Action): boolean {
  if (isPanel(a)) {
    if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock();
    useView.getState().openOverlay(a);
    return true;
  }
  const h = handlers.get(a.kind);
  h?.(a);
  return !!h;
}

/** What you hold uses E first: `fn` gets the crosshair target's kind and says whether it used E. */
export function onUseHeld(fn: (focusKind: Action['kind'] | null) => boolean) {
  heldUse = fn;
  return () => {
    if (heldUse === fn) heldUse = null;
  };
}

/** E with something in your hands: true when what you hold took it (a sip), so the target doesn't. */
export const heldTakesE = (focusKind: Action['kind'] | null) => (useView.getState().held && heldUse ? heldUse(focusKind) : false);
