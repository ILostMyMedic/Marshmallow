// The indoor room tone's decisions, pure (no WebAudio, so they're tested): how much of the room you hear where you
// stand (all of it inside, less in the elevator cabin, none out on a balcony or on the roof), how loud the office's
// murmur is for the people near you and those chatting, and when the next small room sound comes (a door, a chair, a
// distant phone, the printer), which one and from where. roomTone.ts plays them. New in Marshmallow.

import type { FloorKindOf } from '../world/floors';
import { ELEVATOR, HALF_D, HALF_W, WALL_T } from '../world/layout';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/** In the elevator cabin the room is through its doorway: this much of it. */
export const CABIN_SHARE = 0.6;

/** How much of the room you hear at (x, z) on a floor of `kind` (0-1): it fades as you step out onto a balcony. */
export function indoorShare(kind: FloorKindOf, x: number, z: number): number {
  if (kind === 'roof') return 0;
  if (z > HALF_D && Math.abs(x) <= ELEVATOR.cabinHalf + WALL_T) return CABIN_SHARE;
  return 1 - smoothstep(HALF_W, HALF_W + WALL_T + 0.6, Math.abs(x));
}

/** People this far away (m) or more don't add to the murmur. */
export const CROWD_RADIUS = 12;

/** The people near you, each counting less the farther they are: 1 right beside you, nothing past CROWD_RADIUS. */
export function crowdNear(distances: Iterable<number>): number {
  let n = 0;
  for (const d of distances) n += clamp01(1 - d / CROWD_RADIUS);
  return n;
}

/** The murmur's level (0-1): a light one with anyone about, growing with the people near you and those chatting. */
export const MURMUR = { base: 0.15, perPerson: 0.09, perChatter: 0.12 };

export function murmurLevel(near: number, chatting: number): number {
  if (near <= 0 && chatting <= 0) return 0;
  return clamp01(MURMUR.base + MURMUR.perPerson * near + MURMUR.perChatter * chatting);
}

/** Seconds until the next small room sound, for a roll in [0, 1): every 14-42 s, a little sooner on a busy floor. */
export const nextRoomSoundIn = (roll: number, near: number) => (14 + 28 * clamp01(roll)) / (1 + 0.06 * Math.min(near, 10));

export type RoomSound = 'door' | 'chair' | 'phone' | 'printer';

/** What each floor's small sounds can be: the office has them all, the lobby its doors and the front desk's phone. */
const SOUNDS: Record<Exclude<FloorKindOf, 'roof'>, readonly RoomSound[]> = {
  office: ['door', 'chair', 'chair', 'phone', 'printer'],
  lobby: ['door', 'door', 'phone'],
  ceo: ['door', 'chair', 'phone'],
};

/** Which small sound comes next, for a roll in [0, 1); none on the roof. */
export function pickRoomSound(kind: FloorKindOf, roll: number): RoomSound | null {
  if (kind === 'roof') return null;
  const list = SOUNDS[kind];
  return list[Math.min(list.length - 1, Math.floor(clamp01(roll) * list.length))];
}

/** Where it comes from: somewhere in the room 5-12 m from you (`a` and `b` are rolls in [0, 1)), inside its walls. */
export function roomSoundSpot(ear: { x: number; z: number }, a: number, b: number): { x: number; z: number } {
  const angle = a * Math.PI * 2;
  const d = 5 + 7 * clamp01(b);
  return {
    x: Math.max(-HALF_W + 1, Math.min(HALF_W - 1, ear.x + Math.cos(angle) * d)),
    z: Math.max(-HALF_D + 1, Math.min(HALF_D - 1, ear.z + Math.sin(angle) * d)),
  };
}
