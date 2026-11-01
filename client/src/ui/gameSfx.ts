// The games' sounds, all synthesized and placed where they happen: the basketball's bounce, the rim's clank, the
// board's thud and the net's swish; a throw's whoosh, a dart thudding into the board or clattering off the wall, and a
// big turn's chime. The hoop and the dartboard (world/games/Hoop.tsx, Dartboard.tsx) say when; they mute with M.
// Adapted from cubefarm client/src/world/toys/ballSounds.ts and client/src/ui/sfx.ts swish (MIT): the basketball's
// bounce, the rim, the backboard and the swish; the darts' sounds are new.

import { noise, tone, type Vec3 } from './sfx';

const G = 'room' as const;
/** A little random spread, so repeated sounds don't sound machine-made. */
const vary = (x: number, by = 0.06) => x * (1 - by + Math.random() * by * 2);
/** How loud an impact `speed` m/s hard is (0 to 1) and how bright. */
const level = (speed: number) => ({ gain: Math.min(1, speed / 7), bright: Math.min(1, speed / 10) });

/** The basketball on the floor or a wall: a firm thud with a little ring from the ball's skin. */
export function ballBounce(pos: Vec3, speed: number) {
  const { gain, bright } = level(speed);
  const name = 'hoop:bounce';
  tone({ name, group: G, pos, freq: vary(150), to: 105, dur: 0.12, peak: 0.13 * gain, attack: 0.003 });
  noise({ name, group: G, pos, dur: 0.05, peak: 0.06 * gain, filter: 'bandpass', freq: vary(700 + bright * 1300), q: 1.4, attack: 0.002 });
  tone({ name, group: G, pos, freq: vary(560, 0.03), to: 540, type: 'triangle', dur: 0.22, peak: 0.025 * gain * (0.4 + bright * 0.6), attack: 0.004 });
}

/** The ball off the rim: a metallic clank, a few inharmonic partials ringing out. */
export function rimClank(pos: Vec3, speed: number) {
  const { gain, bright } = level(Math.max(2, speed));
  const name = 'hoop:rim';
  const f = vary(620, 0.04);
  [1, 1.48, 2.37].forEach((m, i) => tone({ name, group: G, pos, freq: f * m, type: i ? 'triangle' : 'square', dur: 0.32 - i * 0.07, peak: (i ? 0.06 : 0.04) * gain, attack: 0.002 }));
  noise({ name, group: G, pos, dur: 0.04, peak: 0.07 * gain, filter: 'highpass', freq: 2200 + bright * 2000, q: 0.7, attack: 0.001 });
}

/** The ball off the backboard: a hollow board thud. */
export function boardThud(pos: Vec3, speed: number) {
  const { gain, bright } = level(speed);
  const name = 'hoop:board';
  tone({ name, group: G, pos, freq: vary(92), to: 74, dur: 0.22, peak: 0.13 * gain, attack: 0.004 });
  tone({ name, group: G, pos, freq: vary(230), to: 205, type: 'triangle', dur: 0.14, peak: 0.04 * gain, attack: 0.004 });
  noise({ name, group: G, pos, dur: 0.07, peak: 0.06 * gain, filter: 'bandpass', freq: 450 + bright * 500, q: 1.3, attack: 0.002 });
}

/** Through the net: its swish, and (`clean`: nothing touched) a bright little three-note flourish. */
export function netSwish(pos: Vec3, clean: boolean) {
  const name = 'hoop:swish';
  noise({ name, group: G, pos, dur: 0.3, peak: 0.12, filter: 'bandpass', freq: 5200, to: 2600, q: 0.8, attack: 0.03 });
  noise({ name, group: G, pos, at: 0.18, dur: 0.7, peak: 0.04, filter: 'bandpass', freq: 900, to: 1500, q: 0.5, attack: 0.2 });
  if (clean) [784, 988, 1318.5].forEach((freq, i) => tone({ name, group: G, pos, freq, type: 'triangle', at: 0.2 + i * 0.08, dur: 0.3, peak: 0.05 }));
}

/** Picking the ball up: a soft pat of hands on it. */
export function ballGrab(pos: Vec3) {
  noise({ name: 'hoop:grab', group: G, pos, dur: 0.07, peak: 0.035, filter: 'bandpass', freq: vary(1100), q: 1.2, attack: 0.006 });
}

/** Something thrown (a ball, a dart): a whoosh rising higher and sharper the harder it went (power 0-1). */
export function throwWhoosh(pos: Vec3, power: number, light = false) {
  const spread = 0.94 + Math.random() * 0.12;
  const k = light ? 1.8 : 1;
  noise({ name: 'game:throw', group: G, pos, dur: (0.14 + power * 0.08) / k, peak: (0.03 + power * 0.05) / k, filter: 'bandpass', freq: 500 * spread * k, to: (1500 + power * 900) * spread * k, q: 0.9 + power * 0.5 });
}

/** A dart into the board: a short, dull "thock" of steel into sisal. */
export function dartThock(pos: Vec3) {
  const name = 'darts:hit';
  tone({ name, group: G, pos, freq: vary(240), to: 170, type: 'triangle', dur: 0.06, peak: 0.08, attack: 0.001 });
  noise({ name, group: G, pos, dur: 0.035, peak: 0.07, filter: 'bandpass', freq: vary(1700), q: 1.6, attack: 0.001 });
}

/** A dart off the wall and onto the floor: a tick and a little clatter. */
export function dartClatter(pos: Vec3) {
  const name = 'darts:miss';
  noise({ name, group: G, pos, dur: 0.03, peak: 0.05, filter: 'highpass', freq: vary(3200), q: 0.8, attack: 0.001 });
  [0.12, 0.2, 0.26].forEach((at, i) => tone({ name, group: G, pos, freq: vary(2400 - i * 300), type: 'triangle', at, dur: 0.04, peak: 0.025 - i * 0.006, attack: 0.001 }));
}

/** A turn added up: a soft chime, rising higher the better it was (a hundred and more gets a third note, 180 a fourth). */
export function turnChime(pos: Vec3, points: number) {
  const notes = points >= 180 ? [659.25, 830.6, 987.8, 1318.5] : points >= 100 ? [659.25, 830.6, 987.8] : points >= 40 ? [784, 1046.5] : [523.25];
  notes.forEach((freq, i) => tone({ name: 'darts:turn', group: G, pos, freq, type: 'triangle', at: i * 0.1, dur: i === notes.length - 1 ? 0.35 : 0.14, peak: 0.045, attack: 0.008 }));
}
