// Ping-pong's sounds, all synthesized and placed at the ball: the pock of a paddle, the table, the net and the floor, a
// smash's crack, and a point won. pongRunner.ts says when (through PongMatch.tsx, so the runner stays free of audio).
// Adapted from cubefarm client/src/world/toys/pongSounds.ts (MIT): the room's "ooh" at a long rally is cut, and the
// point's chime is new.

import type { V3 } from '../world/pongPhysics';
import { noise, tone } from './sfx';

/** What happened at the table: `level` is how hard (0-1); for a point, 1 when it won the game. */
export type PongSound = 'paddle' | 'smash' | 'table' | 'net' | 'floor' | 'point';

const G = 'room' as const;
const vary = (x: number, by = 0.05) => x * (1 - by + Math.random() * by * 2);

/** The ball off a paddle: a hard, woody "tock", sharper the harder it's hit (power 0-1). */
function paddlePock(pos: V3, power: number) {
  const name = 'pong:paddle';
  tone({ name, group: G, pos, freq: vary(1150 + power * 350), to: 820, type: 'triangle', dur: 0.045, peak: 0.08 + power * 0.06, attack: 0.001 });
  noise({ name, group: G, pos, dur: 0.03, peak: 0.05 + power * 0.05, filter: 'bandpass', freq: vary(2800 + power * 1800), q: 2.2, attack: 0.001 });
}

/** A smash: the paddle's crack on top of the pock. */
function smashCrack(pos: V3) {
  noise({ name: 'pong:smash', group: G, pos, dur: 0.09, peak: 0.12, filter: 'highpass', freq: 1800, q: 0.8, attack: 0.001 });
  tone({ name: 'pong:smash', group: G, pos, freq: vary(520), to: 300, type: 'square', dur: 0.06, peak: 0.03, attack: 0.001 });
}

/** The ball on the table: the hollow "pock" the game is named for (gain 0-1). */
function tablePock(pos: V3, gain: number) {
  const name = 'pong:table';
  tone({ name, group: G, pos, freq: vary(760), to: 610, type: 'sine', dur: 0.06, peak: 0.07 + gain * 0.07, attack: 0.001 });
  noise({ name, group: G, pos, dur: 0.035, peak: 0.04 + gain * 0.04, filter: 'bandpass', freq: vary(2200), q: 3, attack: 0.001 });
}

/** The ball into the net: a soft fabric brush. */
function netBrush(pos: V3) {
  noise({ name: 'pong:net', group: G, pos, dur: 0.14, peak: 0.05, filter: 'lowpass', freq: vary(900), to: 400, q: 0.7, attack: 0.004 });
}

/** The ball on the floor: a duller, lower tick (gain 0-1). */
function floorTick(pos: V3, gain: number) {
  const name = 'pong:floor';
  tone({ name, group: G, pos, freq: vary(520), to: 430, type: 'sine', dur: 0.05, peak: 0.03 + gain * 0.05, attack: 0.001 });
  noise({ name, group: G, pos, dur: 0.025, peak: 0.02 + gain * 0.03, filter: 'bandpass', freq: vary(1500), q: 2, attack: 0.001 });
}

/** A point scored: a soft rising two-note blip over the table, a three-note one when it wins the game. */
function pointChime(pos: V3, game: boolean) {
  const notes = game ? [659.25, 830.6, 987.8] : [784, 1046.5];
  notes.forEach((freq, i) => tone({ name: game ? 'pong:game' : 'pong:point', group: G, pos, freq, type: 'triangle', at: i * 0.1, dur: i === notes.length - 1 ? 0.35 : 0.14, peak: 0.045, attack: 0.008 }));
}

/** Plays what happened at the table, at `pos`. */
export function pongSound(kind: PongSound, pos: V3, level = 0) {
  if (kind === 'paddle') paddlePock(pos, level);
  else if (kind === 'smash') smashCrack(pos);
  else if (kind === 'table') tablePock(pos, level);
  else if (kind === 'net') netBrush(pos);
  else if (kind === 'floor') floorTick(pos, level);
  else pointChime(pos, level >= 1);
}
