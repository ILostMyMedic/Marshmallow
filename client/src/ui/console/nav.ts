// Which tab the console shows lives in its overlay (view.ts), so anything can open it at a tab and a floor; the last
// one is remembered here for the next time it opens without one (O, the HUD's button).
import { act } from '../../world/actions';
import type { ConsoleTab } from '../../world/view';

let last: ConsoleTab = 'floors';

/** The tab the console opens on when it isn't told one. */
export const lastTab = () => last;

/** Remembers `tab` as the one to come back to. */
export const rememberTab = (tab: ConsoleTab) => {
  last = tab;
};

/** Shows the console at `tab`, on floor `floorId` where the tab has one (the Issues tab's board). */
export function showTab(tab: ConsoleTab, floorId?: string) {
  last = tab;
  act({ kind: 'console', tab, floorId });
}
