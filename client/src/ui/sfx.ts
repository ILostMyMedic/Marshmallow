// Every sound in the office, synthesized with WebAudio (no audio files). One shared AudioContext: every sound goes
// through the master gain (the volume, or 0 when muted), then a gentle compressor. Sounds placed in the world pan and
// fade with distance from the listener (world/Sounds.tsx keeps it where you are). Audio is optional: until the first
// click or key, or where it's blocked or missing (headless browsers), sounds don't play, but window.__mmSfx still
// records them. M mutes, except while typing in a field; the volume and mute are kept in this browser.
// Adapted from cubefarm client/src/ui/sfx.ts (MIT): the sound groups' sliders, the voice and its ducking, the mic, the
// room's reverb and the walls' muffling, the photo-mode tap, the captions, the event cues, the alarm, the phone's
// chirp, the toys' and the roomba's sounds and the fridge's hum are cut. Groups are labels for the probe only.

import { parseAudioPrefs, sliderGain, type AudioPrefs } from './audioPrefs';
import { audible, distance, distanceGain, DROP_NEW, MAX_DISTANCE, panOf, PLAY, REF_DISTANCE, ROLLOFF, type Vec3, voiceToDrop } from './sfxMix';

export type { Vec3 } from './sfxMix';

/** What a sound is, for the probe: the room's things, people (steps, typing, sips, cheers), or outside. */
export type SoundGroup = 'room' | 'people' | 'outside';

const PREFS_KEY = 'marshmallow:audio';

function loadPrefs(): AudioPrefs {
  try {
    return parseAudioPrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return parseAudioPrefs(null);
  }
}

let prefs = typeof window === 'undefined' ? parseAudioPrefs(null) : loadPrefs();
const listeners = new Set<() => void>();

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;

const COMPRESSOR_TRIM = 10 ** (-2.81 / 20);

const masterLevel = () => (prefs.muted ? 0 : sliderGain(prefs.volume));

/** The shared context and master gain, or null until the first user gesture / when audio is unavailable. */
export function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (!unlocked) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = masterLevel();
      // Gentle: it only touches the loudest moments (many sounds at once), so single sounds are unchanged.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.005;
      comp.release.value = 0.25;
      // The compressor adds its own makeup gain (+2.8 dB for these settings, measured in Chromium): take it back off.
      const trim = ctx.createGain();
      trim.gain.value = COMPRESSOR_TRIM;
      master.connect(comp).connect(trim).connect(ctx.destination);
      writeListener();
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    // Don't queue sounds on a stopped clock: they'd all fire at once when it starts.
    return ctx.state === 'running' && master ? { ctx, out: master } : null;
  } catch {
    return null;
  }
}

/** Start audio from a user gesture (any first click or key). */
export function unlockAudio() {
  unlocked = true;
  audio();
}

/** Whether the first click or key has happened (sounds may still be unavailable). */
export const audioUnlocked = () => unlocked;

/** Where every sound ends up (the master gain), for long-lived loops that build their own nodes; null while audio is off. */
export const output = (): AudioNode | null => audio()?.out ?? null;

// ---------- volume & mute ----------

export const getAudioPrefs = () => prefs;

export function subscribeAudio(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Glide a gain to a new level (a short ramp, so slider drags don't click). */
function glide(gain: GainNode, level: number) {
  if (!ctx) return;
  try {
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(level, ctx.currentTime, 0.015);
  } catch {
    // audio is optional
  }
}

export function setAudioPrefs(patch: Partial<AudioPrefs>) {
  prefs = parseAudioPrefs(JSON.stringify({ ...prefs, ...patch, volume: Math.max(0, Math.min(100, Number(patch.volume ?? prefs.volume))) }));
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage may be unavailable (private mode); the setting just won't be remembered
  }
  if (master) glide(master, masterLevel());
  for (const fn of listeners) fn();
}

export const toggleMute = () => setAudioPrefs({ muted: !prefs.muted });

/** M mutes and unmutes, except while typing (a field, the terminal's hidden textarea) or with a modifier held. */
function onKey(e: KeyboardEvent) {
  if (e.code !== 'KeyM' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  toggleMute();
}

if (typeof window !== 'undefined') {
  for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, unlockAudio, { once: true, capture: true });
  // A hot reload runs this file again: swap the old M handler for this one rather than adding a second.
  const w = window as unknown as Record<string, unknown>;
  const old = w.__mmSfxKey as ((e: KeyboardEvent) => void) | undefined;
  if (old) window.removeEventListener('keydown', old);
  w.__mmSfxKey = onKey;
  window.addEventListener('keydown', onKey);
}

// ---------- the listener (where you hear from) ----------

const ear = { x: 0, y: 1.65, z: 10 };
const earFwd = { x: 0, y: 0, z: -1 };
const earUp = { x: 0, y: 1, z: 0 };

function writeListener() {
  const l = ctx?.listener;
  if (!l) return;
  try {
    if (l.positionX) {
      l.positionX.value = ear.x;
      l.positionY.value = ear.y;
      l.positionZ.value = ear.z;
      l.forwardX.value = earFwd.x;
      l.forwardY.value = earFwd.y;
      l.forwardZ.value = earFwd.z;
      l.upX.value = earUp.x;
      l.upY.value = earUp.y;
      l.upZ.value = earUp.z;
    } else {
      // Older browsers (Firefox) only have the deprecated setters.
      l.setPosition(ear.x, ear.y, ear.z);
      l.setOrientation(earFwd.x, earFwd.y, earFwd.z, earUp.x, earUp.y, earUp.z);
    }
  } catch {
    // audio is optional
  }
}

/** Where the listener is and which way it faces (the floor's metres, unit vectors). Called every frame: allocates nothing. */
export function setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) {
  ear.x = px;
  ear.y = py;
  ear.z = pz;
  earFwd.x = fx;
  earFwd.y = fy;
  earFwd.z = fz;
  earUp.x = ux;
  earUp.y = uy;
  earUp.z = uz;
  if (ctx?.state === 'running') writeListener();
}

/** Where the listener is now (updated in place every frame). */
export const listenerAt = (): Readonly<Vec3> => ear;

const facing = { fwd: earFwd, up: earUp };

/** Which way the listener faces and what's up for them (unit vectors, updated in place every frame). */
export const listenerFacing = (): { readonly fwd: Readonly<Vec3>; readonly up: Readonly<Vec3> } => facing;

// ---------- the probe (window.__mmSfx) ----------

/** One sound that was asked for, as recorded for QA. */
export interface SfxRecord {
  name: string;
  group: SoundGroup | null;
  /** Where on the floor, or null for a sound without a place (your own steps, the outside). */
  at: Vec3 | null;
  /** Its peak after distance, before the master volume (0 when too far away to play). */
  gain: number;
  /** -1 (left) to 1 (right) from where the listener faces; a sound without a place has its own (default 0). */
  pan: number;
  /** Whether it was actually scheduled (false while locked, unavailable, muted by distance or over the voice cap). */
  played: boolean;
  /** performance.now() when it was asked for. */
  t: number;
}

const PROBE_SIZE = 50;
const probe: SfxRecord[] = [];
/** Typing has a log of its own (window.__mmSfx.typing): a busy floor would crowd everything else out of the main one. */
export const typingLog: SfxRecord[] = [];

/**
 * Records a sound in window.__mmSfx (the last 50). tone() and noise() call it themselves; long-lived loops call it
 * when they start. `peak` is the sound's level before distance; returns the record so `played` can be set later.
 */
export function recordSfx(name: string, { group, pos, pan = 0, peak, played }: { group?: SoundGroup; pos?: Vec3; pan?: number; peak: number; played?: boolean }, log: SfxRecord[] = probe) {
  const d = pos ? distance(ear, pos) : 0;
  const atDistance = !pos ? 1 : audible(d) ? distanceGain(d) : 0;
  const rec: SfxRecord = {
    name,
    group: group ?? null,
    at: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
    gain: peak * atDistance,
    pan: pos ? panOf(ear, earFwd, earUp, pos) : pan,
    played: played ?? false,
    t: performance.now(),
  };
  log.push(rec);
  if (log.length > PROBE_SIZE) log.splice(0, log.length - PROBE_SIZE);
  return rec;
}

const copy = (log: SfxRecord[]) => log.map((r) => ({ ...r, at: r.at && { ...r.at } }));

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__mmSfx = {
    get muted() {
      return prefs.muted;
    },
    /** 0-100, as the slider shows it. */
    get volume() {
      return prefs.volume;
    },
    get unlocked() {
      return unlocked;
    },
    /** 'locked' before the first click or key, else the AudioContext's state ('running', 'suspended'…) or 'unavailable'. */
    get state() {
      return !unlocked ? 'locked' : (ctx?.state ?? 'unavailable');
    },
    /** The last 50 sounds asked for, oldest first: name, group, at, gain (after distance), pan, played, t (performance.now()). */
    get last() {
      return copy(probe);
    },
    get typing() {
      return copy(typingLog);
    },
    /** The sounds named `name` (or starting with it, e.g. 'coffee-') asked for in the last `ms` milliseconds. */
    since(name: string, ms = 10_000) {
      const from = performance.now() - ms;
      return copy(probe.filter((r) => r.t >= from && r.name.startsWith(name)));
    },
    clear() {
      probe.length = 0;
      typingLog.length = 0;
    },
    mute: (on = true) => setAudioPrefs({ muted: on }),
    setVolume: (v: number) => setAudioPrefs({ volume: v }),
    unlock: unlockAudio,
    /** A soft test blip at a spot on the floor, to hear (and see here) it pan and fade. */
    ping: (x: number, y: number, z: number) => tone({ name: 'ping', group: 'room', pos: { x, y, z }, freq: 880, type: 'triangle', dur: 0.3, peak: 0.12 }),
  };
}

// ---------- routing (exported for long-lived loops that manage their own nodes) ----------

/** A PannerNode with the office's distance model, placed at `pos`. Connect it to output(). */
export function createPanner(c: BaseAudioContext, pos: Vec3) {
  const p = c.createPanner();
  p.panningModel = 'equalpower';
  p.distanceModel = 'inverse';
  p.refDistance = REF_DISTANCE;
  p.rolloffFactor = ROLLOFF;
  p.maxDistance = MAX_DISTANCE;
  setPannerPosition(p, pos.x, pos.y, pos.z);
  return p;
}

/** Moves a panner (safe to call every frame: allocates nothing). */
export function setPannerPosition(p: PannerNode, x: number, y: number, z: number) {
  if (p.positionX) {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  } else p.setPosition(x, y, z);
}

// ---------- voices ----------

interface Voice {
  end: number; // context time it finishes
  loud: number;
  env: GainNode;
  src: AudioScheduledSourceNode;
}

const voices: Voice[] = [];

/** Options every building block takes. */
export interface PlaceOpts {
  /** For __mmSfx. */
  name?: string;
  group?: SoundGroup;
  /** Where on the floor (metres): the sound pans and fades with distance, and isn't played beyond ~16 m. */
  pos?: Vec3;
  /** A fixed stereo position, -1 (left) to 1 (right), for sounds without `pos` (your own feet). */
  pan?: number;
  /** Part of a sound already in __mmSfx (recordSfx): one entry for a sound made of several parts. */
  into?: SfxRecord;
}

/** Records a sound for the probe and decides whether it plays: where to connect it and its loudness for the voice cap, or null. */
function place(kind: string, { name, group, pos, pan, into }: PlaceOpts, peak: number): { a: { ctx: AudioContext; out: GainNode }; dest: AudioNode; loud: number } | null {
  const rec = into ?? recordSfx(name ?? kind, { group, pos, pan, peak });
  const d = pos ? distance(ear, pos) : 0;
  if (pos && !audible(d)) return null;
  const loud = peak * (pos ? distanceGain(d) : 1);
  const a = audio();
  if (!a) return null;

  const now = a.ctx.currentTime;
  for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end <= now) voices.splice(i, 1);
  const drop = voiceToDrop(voices, loud);
  if (drop === DROP_NEW) return null;
  if (drop !== PLAY) {
    const v = voices[drop];
    voices.splice(drop, 1);
    try {
      v.env.gain.cancelScheduledValues(now);
      v.env.gain.setTargetAtTime(0, now, 0.01);
      v.src.stop(now + 0.06);
    } catch {
      // already stopped
    }
  }

  let dest: AudioNode = a.out;
  try {
    if (pos) {
      const p = createPanner(a.ctx, pos);
      p.connect(dest);
      dest = p;
    } else if (pan && a.ctx.createStereoPanner) {
      const p = a.ctx.createStereoPanner();
      p.pan.value = pan;
      p.connect(dest);
      dest = p;
    }
  } catch {
    return null;
  }
  rec.played = true;
  return { a, dest, loud };
}

// ---------- building blocks ----------

export interface ToneOpts extends PlaceOpts {
  freq: number;
  to?: number; // glide to this frequency by the end
  type?: OscillatorType;
  at?: number; // seconds from now
  dur: number;
  peak: number; // 0-1, before the master volume
  attack?: number;
}

/** One enveloped oscillator note. */
export function tone(opts: ToneOpts) {
  const { freq, to, type = 'sine', at = 0, dur, peak, attack = 0.015 } = opts;
  const p = place('tone', opts, peak);
  if (!p) return;
  const a = p.a;
  try {
    const t0 = a.ctx.currentTime + at;
    const osc = a.ctx.createOscillator();
    const gain = a.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(p.dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    voices.push({ end: t0 + dur + 0.05, loud: p.loud, env: gain, src: osc });
  } catch {
    // audio is optional
  }
}

export interface NoiseOpts extends PlaceOpts {
  at?: number;
  dur: number;
  peak: number;
  filter?: BiquadFilterType;
  freq: number; // filter frequency
  to?: number; // sweep the filter to this frequency by the end
  q?: number;
  attack?: number;
}

let noiseBuf: AudioBuffer | null = null;

/** Two seconds of white noise, made once per context, shared by every noise burst and loop. */
export function noiseBuffer(c: BaseAudioContext): AudioBuffer {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** A burst of filtered white noise: footsteps, whooshes, pops. */
export function noise(opts: NoiseOpts) {
  const { at = 0, dur, peak, filter = 'lowpass', freq, to, q = 1, attack = 0.005 } = opts;
  const p = place('noise', opts, peak);
  if (!p) return;
  const a = p.a;
  try {
    const t0 = a.ctx.currentTime + at;
    const src = a.ctx.createBufferSource();
    src.buffer = noiseBuffer(a.ctx);
    const bq = a.ctx.createBiquadFilter();
    bq.type = filter;
    bq.Q.value = q;
    bq.frequency.setValueAtTime(freq, t0);
    if (to) bq.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const gain = a.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bq).connect(gain).connect(p.dest);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
    voices.push({ end: t0 + dur + 0.05, loud: p.loud, env: gain, src });
  } catch {
    // audio is optional
  }
}

// ---------- the elevator and the side doors ----------

let lastDing = -Infinity;

/** The elevator "ding": two soft sine tones, from the doors at `pos` (someone arriving), or all round (your own ride). */
export function ding(pos?: Vec3) {
  if (performance.now() - lastDing < 700) return; // a ride's arrival and the doors opening on it ding once
  lastDing = performance.now();
  [880, 1318.5].forEach((freq, i) => tone({ name: 'elevator:ding', group: 'room', pos, freq, at: i * 0.16, dur: 1.1, peak: 0.18, attack: 0.02 }));
}

/** Air rushing past the elevator car while it travels, rising then settling. */
export function whoosh(dur = 0.75) {
  noise({ name: 'elevator:ride', group: 'room', dur, peak: 0.1, filter: 'bandpass', freq: 220, to: 900, q: 0.8, attack: dur * 0.45 });
  tone({ name: 'elevator:ride', group: 'room', freq: 70, to: 55, dur, peak: 0.05, attack: dur * 0.4 });
}

/** The elevator's doors sliding open or shut: a heavier rumble than a side door, and a soft thud as they meet. */
export function elevatorDoors(pos: Vec3, opening: boolean) {
  const name = opening ? 'elevator:open' : 'elevator:close';
  noise({ name, group: 'room', pos, dur: 0.75, peak: 0.05, filter: 'bandpass', freq: opening ? 240 : 700, to: opening ? 700 : 220, q: 0.8, attack: 0.2 });
  tone({ name, group: 'room', pos, freq: 62, to: 55, dur: 0.7, peak: 0.025, attack: 0.15 });
  if (!opening) tone({ name, group: 'room', pos, at: 0.7, freq: 120, to: 70, dur: 0.14, peak: 0.05, attack: 0.005 });
}

/** A side door sliding open (a rising whoosh) or shut (a falling one, with a soft bump at the end), from the doorway. */
export function doorSlide(pos: Vec3, opening: boolean) {
  const name = opening ? 'door:open' : 'door:close';
  noise({ name, group: 'room', pos, dur: 0.45, peak: 0.07, filter: 'bandpass', freq: opening ? 300 : 1100, to: opening ? 1300 : 280, q: 0.9, attack: 0.15 });
  if (!opening) tone({ name, group: 'room', pos, at: 0.4, freq: 110, to: 70, dur: 0.12, peak: 0.05, attack: 0.005 });
}

// ---------- the gong and the merge party ----------

let lastGong = -Infinity;

// A gong's inharmonic partials over its ~92 Hz fundamental: [ratio, peak, seconds to fade out]. The low ones ring
// longest; the ratios are off whole numbers, which is what makes it a gong rather than a bell or a chord.
const GONG_F0 = 92;
const GONG_PARTIALS: [number, number, number][] = [
  [1.52, 0.09, 5],
  [2.03, 0.08, 4.6],
  [2.74, 0.065, 4],
  [3.43, 0.05, 3.4],
  [4.18, 0.04, 2.9],
  [5.4, 0.028, 2.3],
  [6.79, 0.02, 1.9],
];

/**
 * The merge gong: a soft mallet thud, a long low boom with a slow beat, inharmonic partials and a shimmer that swells
 * in after the hit and rings for ~6 s. The loudest sound in the office (its peaks add up to under 1, and the
 * compressor catches the rest). Without a place, so it carries across the floor. At most one a second.
 */
export function gong() {
  if (performance.now() - lastGong < 1000) return;
  lastGong = performance.now();
  const o = { name: 'gong', group: 'room' } as const;
  // the padded mallet: a low thud and a dull puff, no click
  tone({ ...o, freq: 150, to: 62, dur: 0.35, peak: 0.12, attack: 0.004 });
  noise({ ...o, dur: 0.14, peak: 0.07, filter: 'lowpass', freq: 900, to: 180, attack: 0.003 });
  // the boom: the fundamental (a triangle, so small speakers still hear its overtones) and a near twin that beats with it
  tone({ ...o, freq: GONG_F0, type: 'triangle', dur: 6.5, peak: 0.2, attack: 0.02 });
  tone({ ...o, freq: GONG_F0 * 1.008, dur: 6, peak: 0.08, attack: 0.04 });
  for (const [ratio, peak, dur] of GONG_PARTIALS) tone({ ...o, freq: GONG_F0 * ratio, dur, peak, attack: 0.015 });
  // the shimmer: bright partials and a hiss that bloom in after the hit, the way a struck gong swells
  tone({ ...o, freq: GONG_F0 * 8.9, type: 'triangle', at: 0.05, dur: 4, peak: 0.016, attack: 0.9 });
  tone({ ...o, freq: GONG_F0 * 11.7, at: 0.05, dur: 3.5, peak: 0.012, attack: 1.1 });
  noise({ ...o, at: 0.05, dur: 4.5, peak: 0.028, filter: 'bandpass', freq: 1800, to: 3200, q: 1.5, attack: 1.2 });
}

/** A burst of confetti at `pos`: a party popper's pop and the paper fluttering down. New in Marshmallow. */
export function confettiPop(pos: Vec3) {
  const o = { name: 'confetti', group: 'room', pos } as const;
  noise({ ...o, dur: 0.06, peak: 0.1, filter: 'bandpass', freq: 1500, q: 1.1, attack: 0.002 });
  tone({ ...o, freq: 420, to: 160, dur: 0.07, peak: 0.05, attack: 0.002 });
  noise({ ...o, at: 0.08, dur: 1.4, peak: 0.018, filter: 'highpass', freq: 4200, to: 6000, q: 0.7, attack: 0.15 });
  for (let i = 0; i < 4; i++) noise({ ...o, at: 0.12 + i * 0.13 + Math.random() * 0.06, dur: 0.05, peak: 0.012, filter: 'bandpass', freq: 3000 + Math.random() * 2500, q: 2, attack: 0.004 });
}

// ---------- the kitchenette fridge (world/fridgeState.ts) ----------

/** The fridge door coming open: the seal letting go (a soft suck and pop), then the bottles in the door clinking. */
export function fridgeOpen(pos: Vec3) {
  const o = { name: 'fridge:open', group: 'room', pos } as const;
  noise({ ...o, dur: 0.12, peak: 0.06, filter: 'lowpass', freq: 700, to: 2200, attack: 0.01 });
  tone({ ...o, freq: 170, to: 330, dur: 0.07, peak: 0.05, attack: 0.004 });
  tone({ ...o, freq: 3100, type: 'triangle', at: 0.13, dur: 0.05, peak: 0.012, attack: 0.002 });
  tone({ ...o, freq: 3500, type: 'triangle', at: 0.19, dur: 0.05, peak: 0.009, attack: 0.002 });
}

/** The fridge door shutting: a soft, padded thunk. */
export function fridgeClose(pos: Vec3) {
  const o = { name: 'fridge:close', group: 'room', pos } as const;
  tone({ ...o, freq: 95, to: 58, dur: 0.16, peak: 0.08, attack: 0.004 });
  noise({ ...o, dur: 0.1, peak: 0.05, filter: 'lowpass', freq: 420, attack: 0.003 });
  tone({ ...o, freq: 2600, type: 'triangle', at: 0.05, dur: 0.04, peak: 0.008, attack: 0.002 });
}

/** The fridge left open: its three thin "close me" beeps. */
export function fridgeBeep(pos: Vec3) {
  for (const at of [0, 0.17, 0.34]) tone({ name: 'fridge:beep', group: 'room', pos, freq: 2093, type: 'triangle', at, dur: 0.09, peak: 0.035, attack: 0.005 });
}

/** A snack lifted off the shelf: a cold glass-and-wire clink and a little scrape. New in Marshmallow. */
export function fridgeTake(pos: Vec3) {
  const o = { name: 'fridge:take', group: 'room', pos } as const;
  tone({ ...o, freq: 2750, type: 'triangle', dur: 0.06, peak: 0.02, attack: 0.002 });
  tone({ ...o, freq: 3900, type: 'triangle', at: 0.05, dur: 0.05, peak: 0.01, attack: 0.002 });
  noise({ ...o, dur: 0.12, peak: 0.02, filter: 'bandpass', freq: 1800, to: 900, q: 1.2, attack: 0.01 });
}

/** Reaching for a snack that's run out: a dull little thud on the empty shelf. */
export function fridgeEmpty(pos: Vec3) {
  tone({ name: 'fridge:none', group: 'room', pos, freq: 240, to: 180, type: 'triangle', dur: 0.12, peak: 0.03 });
}
