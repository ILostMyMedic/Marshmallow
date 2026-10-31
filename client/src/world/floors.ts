// The building's floors as the game sees them: the lobby at the bottom (0), a floor per repo (1 and up, the server's
// numbers), the CEO's floor above them and the roof terrace on top. The last two are the game's own, always above the
// highest repo floor, so they get fixed ids rather than numbers that would move each time a repo floor is added: view.ts
// holds an id, and storeyOf turns it into how high up it is.
import { FLOOR_HEIGHT } from './layout';

export const LOBBY = 0;
export const CEO_FLOOR = -2;
export const ROOF = -1;

/** What's on a floor, for picking its scene: the lobby, a repo's office, the CEO's floor or the roof. */
export type FloorKindOf = 'lobby' | 'office' | 'ceo' | 'roof';

export const kindOf = (floor: number): FloorKindOf => (floor === ROOF ? 'roof' : floor === CEO_FLOOR ? 'ceo' : floor === LOBBY ? 'lobby' : 'office');

/** How many storeys up `floor` is (the lobby is 0), in a building whose highest repo floor is `top`. */
export function storeyOf(floor: number, top: number): number {
  if (floor === CEO_FLOOR) return top + 1;
  if (floor === ROOF) return top + 2;
  return Math.max(0, floor);
}

/** How high (m) a floor's ground stands. */
export const elevationOf = (floor: number, top: number) => storeyOf(floor, top) * FLOOR_HEIGHT;

/** The highest storey with walls round it: the CEO's floor (the roof terrace is open above it). */
export const topStorey = (top: number) => top + 1;

export interface Stop {
  floor: number;
  /** What the elevator's button says: R, C, L or the floor's number. */
  key: string;
  name: string;
}

/** The elevator's stops, top first: the roof, the CEO's floor, the repo floors downwards, the lobby. */
export function stops(floors: readonly { floor: number; fullName: string }[]): Stop[] {
  const repos = [...floors].sort((a, b) => b.floor - a.floor).map((f) => ({ floor: f.floor, key: String(f.floor), name: f.fullName }));
  return [{ floor: ROOF, key: 'R', name: 'Roof terrace' }, { floor: CEO_FLOOR, key: 'C', name: "CEO's office" }, ...repos, { floor: LOBBY, key: 'L', name: 'Lobby' }];
}

/** A floor as the elevator's sign shows it ("R · Roof terrace", "2 · pixel-todo"). */
export function floorLabel(floor: number, floors: readonly { floor: number; fullName: string }[]): string {
  const s = stops(floors).find((x) => x.floor === floor);
  if (!s) return '';
  return `${s.key} · ${kindOf(floor) === 'office' ? (s.name.split('/').pop() ?? s.name) : s.name}`;
}

/** Whether `floor` is somewhere you can be in this building (a repo floor that still exists, or one of the game's own). */
export const isFloor = (floor: number, floors: readonly { floor: number }[]) => floor === LOBBY || floor === ROOF || floor === CEO_FLOOR || floors.some((f) => f.floor === floor);
