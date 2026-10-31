// Drinking and eating: the sounds sip.ts's cues are named for (a sip's slurp and "mm", the last gulp and "ahh", a bite's
// chomp and munch) and the snacks' own (fridge.ts says which: a can's pssht, a cap's twist, a wrapper's rustle…).
// Your own come from your mouth, without a place (world/sipping.ts); a worker's from their hands (the errands).
// Adapted from cubefarm client/src/world/toys/sipping.ts (MIT): the sounds only; the dropped mug's clunk is cut.

import type { SnackCue } from '../world/fridge';
import type { SipCue } from '../world/sip';
import { noise, tone, type Vec3 } from './sfx';

const P = { group: 'people' } as const;

const sounds: Record<Exclude<SipCue, 'drink' | 'drop'>, (pos?: Vec3) => void> = {
  slurp: (pos) => {
    noise({ ...P, pos, name: 'sip:slurp', dur: 0.2, peak: 0.05, filter: 'bandpass', freq: 900, to: 2600, q: 3, attack: 0.03 });
    tone({ ...P, pos, name: 'sip:slurp', freq: 320, to: 540, type: 'triangle', dur: 0.16, peak: 0.02, attack: 0.02 });
  },
  mm: (pos) => {
    tone({ ...P, pos, name: 'sip:mm', freq: 196, to: 175, dur: 0.34, peak: 0.07, attack: 0.04 });
    tone({ ...P, pos, name: 'sip:mm', freq: 392, to: 350, type: 'triangle', dur: 0.3, peak: 0.012, attack: 0.04 });
  },
  gulp: (pos) => {
    for (let i = 0; i < 3; i++) tone({ ...P, pos, name: 'sip:gulp', freq: 280 - i * 30, to: 110, at: i * 0.24, dur: 0.15, peak: 0.09, attack: 0.01 });
    noise({ ...P, pos, name: 'sip:gulp', dur: 0.7, peak: 0.025, filter: 'lowpass', freq: 500, attack: 0.08 });
  },
  ahh: (pos) => {
    noise({ ...P, pos, name: 'sip:ahh', dur: 0.65, peak: 0.07, filter: 'bandpass', freq: 1200, to: 700, q: 1.3, attack: 0.05 });
    tone({ ...P, pos, name: 'sip:ahh', freq: 230, to: 165, type: 'triangle', dur: 0.6, peak: 0.035, attack: 0.06 });
  },
  chomp: (pos) => {
    noise({ ...P, pos, name: 'bite:chomp', dur: 0.09, peak: 0.08, filter: 'bandpass', freq: 2400, to: 1100, q: 1.4, attack: 0.003 });
    tone({ ...P, pos, name: 'bite:chomp', freq: 150, to: 90, dur: 0.08, peak: 0.05, attack: 0.004 });
  },
  munch: (pos) => {
    for (let i = 0; i < 3; i++) noise({ ...P, pos, name: 'bite:munch', at: i * 0.16, dur: 0.1, peak: 0.035, filter: 'lowpass', freq: 900, attack: 0.01 });
  },
  // ---- snacks from the fridge (fridge.ts says which of these each one makes) ----
  // a can's tab: a click and a burst of escaping fizz
  pssht: (pos) => {
    tone({ ...P, pos, name: 'snack:pssht', freq: 2600, to: 1900, type: 'triangle', dur: 0.025, peak: 0.03, attack: 0.002 });
    noise({ ...P, pos, name: 'snack:pssht', at: 0.02, dur: 0.38, peak: 0.07, filter: 'highpass', freq: 3200, to: 6500, q: 0.7, attack: 0.008 });
  },
  // a bottle's cap: two plastic clicks and a short hiss
  twist: (pos) => {
    for (const at of [0, 0.09]) noise({ ...P, pos, name: 'snack:twist', at, dur: 0.03, peak: 0.05, filter: 'bandpass', freq: 3200, q: 3, attack: 0.002 });
    noise({ ...P, pos, name: 'snack:twist', at: 0.12, dur: 0.18, peak: 0.025, filter: 'highpass', freq: 4000, attack: 0.01 });
  },
  // a wrapper: a few crinkly bursts
  rustle: (pos) => {
    for (const at of [0, 0.07, 0.15, 0.26]) noise({ ...P, pos, name: 'snack:rustle', at, dur: 0.06, peak: 0.04, filter: 'bandpass', freq: 4200 - at * 3000, q: 0.9, attack: 0.004 });
  },
  // string cheese pulled out of its film: a rising tear
  peel: (pos) => {
    noise({ ...P, pos, name: 'snack:peel', dur: 0.26, peak: 0.035, filter: 'bandpass', freq: 1800, to: 5200, q: 2, attack: 0.02 });
  },
  // a square of chocolate breaking off: a crisp crack
  snap: (pos) => {
    noise({ ...P, pos, name: 'snack:snap', dur: 0.04, peak: 0.08, filter: 'highpass', freq: 2500, attack: 0.002 });
    tone({ ...P, pos, name: 'snack:snap', freq: 900, to: 600, type: 'triangle', dur: 0.035, peak: 0.03, attack: 0.002 });
  },
  // a soft bite (the cheese)
  nom: (pos) => {
    tone({ ...P, pos, name: 'snack:nom', freq: 260, to: 180, dur: 0.1, peak: 0.05, attack: 0.01 });
    noise({ ...P, pos, name: 'snack:nom', dur: 0.08, peak: 0.03, filter: 'lowpass', freq: 650, attack: 0.008 });
  },
  // a dense, chewy bar
  chew: (pos) => {
    for (let i = 0; i < 4; i++) noise({ ...P, pos, name: 'snack:chew', at: i * 0.17, dur: 0.12, peak: 0.03, filter: 'lowpass', freq: 520, attack: 0.02 });
    tone({ ...P, pos, name: 'snack:chew', freq: 130, to: 110, dur: 0.6, peak: 0.015, attack: 0.05 });
  },
  // bubbles on the tongue
  fizz: (pos) => {
    noise({ ...P, pos, name: 'snack:fizz', dur: 0.6, peak: 0.022, filter: 'highpass', freq: 5200, attack: 0.04 });
  },
  // the last of a bottle: hollow glugs
  glug: (pos) => {
    for (let i = 0; i < 3; i++) {
      tone({ ...P, pos, name: 'snack:glug', freq: 250 - i * 25, to: 130, type: 'triangle', at: i * 0.22, dur: 0.14, peak: 0.08, attack: 0.01 });
      noise({ ...P, pos, name: 'snack:glug', at: i * 0.22, dur: 0.12, peak: 0.02, filter: 'bandpass', freq: 700, q: 4, attack: 0.01 });
    }
  },
  // the empty can squashed in your hand
  crunch: (pos) => {
    for (const at of [0, 0.06, 0.13]) noise({ ...P, pos, name: 'snack:crunch', at, dur: 0.09, peak: 0.07, filter: 'bandpass', freq: 1900 + at * 4000, q: 0.8, attack: 0.003 });
    tone({ ...P, pos, name: 'snack:crunch', freq: 2100, to: 1500, type: 'square', dur: 0.12, peak: 0.01, attack: 0.003 });
  },
};

/** One of a sip's (or a bite's, or a snack's) cues, from your own mouth, or from someone's hands at `pos`. 'drink' and 'drop' are silent. */
export function sipSound(cue: SipCue | SnackCue, pos?: Vec3) {
  if (cue === 'drink' || cue === 'drop') return;
  sounds[cue](pos);
}
