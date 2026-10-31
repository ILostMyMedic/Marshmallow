// World events' sounds (world/events/), all synthesized: an airliner's distant rumble, a helicopter's chop, a flock's
// wings and chirps, a balloon's burner, an airship's engines, a UFO's hum, beam and zip, a rubber duck's squeak, a
// rainbow's chime and whale song. Everything goes through one small bus into the master gain, muffled through the
// glass indoors and full on a balcony or the roof, panned towards where it happens and quieter with distance. Silent
// while quiet (a panel, the elevator ride) or hidden.
// Adapted from cubefarm client/src/ui/eventSfx.ts (MIT): the kaiju's, the fireworks' and the hurricane's sounds are cut
// with their events.

import { doorOpen } from '../world/doors';
import type { FloorKindOf } from '../world/floors';
import { SIDES, type Side } from '../world/layout';
import { birdCall, cutoffHz, outsideHearing, type OutsideHearing } from './outsideMix';
import { listenerAt, listenerFacing, noiseBuffer, output, recordSfx } from './sfx';
import { panOf } from './sfxMix';

/** Indoors the events are heard through the glass: at least this loud and this clear. */
const THROUGH_GLASS = { level: 0.55, clarity: 0.5 };
const TICK_MS = 100;

interface Bus {
  ctx: BaseAudioContext;
  out: AudioNode;
  input: GainNode;
  muffle: BiquadFilterNode;
  level: GainNode;
  hooked: boolean;
  noise: AudioBuffer;
}

let bus: Bus | null = null;
let kind: FloorKindOf = 'office';
let quiet = false;
let timer: ReturnType<typeof setInterval> | null = null;
let hearing: OutsideHearing = { level: 0, clarity: 0, from: null };
const open: Record<Side, number> = { west: 0, east: 0 };
const live = new Set<LoopImpl>();

// ---------- the floor, quiet, where you hear from ----------

/** Events are on (WorldEvents.tsx while any runs): follow the listener. */
export function eventSoundsOn(floorKind: FloorKindOf) {
  kind = floorKind;
  if (!timer) timer = setInterval(tick, TICK_MS);
  tick();
}

/** No events any more: everything fades and the bus lets go of the mixer. */
export function eventSoundsOff() {
  if (timer) clearInterval(timer);
  timer = null;
  for (const l of [...live]) l.stop(0.3);
  if (bus) glide(bus.level.gain, 0, 0.2);
  setTimeout(() => {
    if (!timer && bus) hook(bus, false);
  }, 1500);
}

export function setEventsQuiet(q: boolean) {
  quiet = q;
  if (timer) tick();
}

function tick() {
  const ear = listenerAt();
  for (const side of SIDES) open[side] = doorOpen(side);
  hearing = outsideHearing(kind, ear.x, ear.z, open);
  const b = getBus();
  if (!b) return;
  hook(b, true);
  const silent = quiet || document.hidden;
  glide(b.level.gain, silent ? 0 : Math.max(hearing.level, THROUGH_GLASS.level), 0.25);
  glide(b.muffle.frequency, cutoffHz(Math.max(hearing.clarity, THROUGH_GLASS.clarity)), 0.25);
}

/**
 * How a sound at (x, y, z) in the listener's frame (metres from the floor you're on) pans, and how loud it is from that
 * far: everything outside is far away, so it fades gently (half as loud at `ref` metres). Allocates nothing.
 */
export function placeAt(x: number, y: number, z: number, ref = 120): { pan: number; gain: number } {
  const ear = listenerAt();
  const f = listenerFacing();
  spot.x = x;
  spot.y = y;
  spot.z = z;
  heard.pan = panOf(ear, f.fwd, f.up, spot) * 0.85;
  heard.gain = 1 / (1 + Math.hypot(x - ear.x, y - ear.y, z - ear.z) / ref);
  return heard;
}
const spot = { x: 0, y: 0, z: 0 };
const heard = { pan: 0, gain: 0 };

// ---------- loops ----------

export type LoopKind = 'jet' | 'rotor' | 'hum' | 'flap' | 'engine';

export interface Loop {
  /** Its loudness (0-1 of its own full level) and pan; `pitch` bends it (1 = as built). Cheap: call it every frame. */
  set(gain: number, pan: number, pitch?: number): void;
  stop(fade?: number): void;
}

/** Each loop at full level, before the bus. */
const LOOP_GAIN: Record<LoopKind, number> = { jet: 0.16, rotor: 0.14, hum: 0.05, flap: 0.09, engine: 0.09 };

class LoopImpl implements Loop {
  private last = { gain: -1, pan: 2, pitch: -1 };
  private stopped = false;
  constructor(
    private c: BaseAudioContext,
    private gain: GainNode,
    private pan: StereoPannerNode | null,
    private tune: AudioParam[],
    private nodes: AudioScheduledSourceNode[],
    private max: number,
  ) {}
  set(gain: number, pan: number, pitch = 1) {
    if (this.stopped) return;
    const g = Math.max(0, Math.min(1, gain)) * this.max;
    if (Math.abs(g - this.last.gain) > 0.0005) glideOn(this.c, this.gain.gain, (this.last.gain = g), 0.12);
    if (this.pan && Math.abs(pan - this.last.pan) > 0.02) glideOn(this.c, this.pan.pan, (this.last.pan = pan), 0.12);
    if (Math.abs(pitch - this.last.pitch) > 0.005) {
      const was = this.last.pitch < 0 ? 1 : this.last.pitch;
      this.last.pitch = pitch;
      for (const p of this.tune) glideOn(this.c, p, (p.value / was) * pitch, 0.15);
    }
  }
  stop(fade = 0.6) {
    if (this.stopped) return;
    this.stopped = true;
    live.delete(this);
    const t = this.c.currentTime;
    try {
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setTargetAtTime(0, t, fade / 4);
      for (const n of this.nodes) n.stop(t + fade + 0.1);
    } catch {
      // audio is optional
    }
  }
}

const NONE: Loop = { set: () => undefined, stop: () => undefined };

/** A long sound for as long as the event wants it (an engine, a rotor); stop() it when done. Silent without audio. */
export function loop(k: LoopKind): Loop {
  const b = getBus();
  recordSfx(`event:${k}`, { group: 'outside', peak: LOOP_GAIN[k] * busLevel(), played: !!b });
  if (!b) return NONE;
  try {
    const c = b.ctx;
    const out = c.createGain();
    out.gain.value = 0;
    const pan = typeof c.createStereoPanner === 'function' ? c.createStereoPanner() : null;
    (pan ? out.connect(pan) : out).connect(b.input);
    const srcs: AudioScheduledSourceNode[] = [];
    const tune: AudioParam[] = [];
    const noise = () => {
      const s = c.createBufferSource();
      s.buffer = b.noise;
      s.loop = true;
      s.start(0, Math.random() * 1.5);
      srcs.push(s);
      return s;
    };
    const osc = (type: OscillatorType, hz: number) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = hz;
      o.start();
      srcs.push(o);
      return o;
    };
    const filter = (type: BiquadFilterType, hz: number, q = 0.7) => {
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = hz;
      f.Q.value = q;
      return f;
    };
    /** `src` through a gain swung by an LFO: base ± depth at `hz`. */
    const throb = (src: AudioNode, hz: number, base: number, depth: number, type: OscillatorType = 'sine') => {
      const g = c.createGain();
      g.gain.value = base;
      const d = c.createGain();
      d.gain.value = depth;
      osc(type, hz).connect(d).connect(g.gain);
      src.connect(g);
      return g;
    };
    switch (k) {
      case 'jet': {
        // a distant airliner: a deep roar with a little whine on top
        const lp = filter('lowpass', 260, 0.8);
        noise().connect(lp).connect(out);
        const whine = filter('bandpass', 900, 6);
        const w = c.createGain();
        w.gain.value = 0.25;
        noise().connect(whine).connect(w).connect(out);
        tune.push(lp.frequency, whine.frequency);
        break;
      }
      case 'rotor': {
        const bp = filter('bandpass', 150, 1.2);
        throb(noise().connect(bp), 12.5, 0.45, 0.55, 'square').connect(out);
        tune.push(bp.frequency);
        break;
      }
      case 'hum': {
        // a UFO: two close tones beating, and a wavering theremin above
        for (const hz of [178, 181]) osc('sine', hz).connect(out);
        const t = osc('triangle', 560);
        const vib = c.createGain();
        vib.gain.value = 30;
        osc('sine', 5.5).connect(vib).connect(t.frequency);
        const tg = c.createGain();
        tg.gain.value = 0.35;
        t.connect(tg).connect(out);
        tune.push(t.frequency);
        break;
      }
      case 'flap': {
        const bp = filter('bandpass', 1100, 0.9);
        throb(noise().connect(bp), 8.5, 0.35, 0.65, 'square').connect(out);
        break;
      }
      case 'engine': {
        // a propeller airship's engines: a low buzz, throbbing gently
        const saw = osc('sawtooth', 52);
        throb(saw.connect(filter('lowpass', 240, 0.9)), 7, 0.6, 0.4).connect(out);
        tune.push(saw.frequency);
        break;
      }
    }
    const l = new LoopImpl(c, out, pan, tune, srcs, LOOP_GAIN[k]);
    live.add(l);
    return l;
  } catch {
    return NONE;
  }
}

// ---------- one-shots ----------

export type OneShot = 'zip' | 'beam' | 'squeak' | 'chime' | 'whale' | 'chirps' | 'burner';

/** Each one-shot at full level, before the bus. */
const SHOT_GAIN: Record<OneShot, number> = { zip: 0.08, beam: 0.07, squeak: 0.1, chime: 0.07, whale: 0.12, chirps: 0.05, burner: 0.15 };

/** A one-off sound `delay` seconds from now, at `gain` (0-1 of its full level, distance included) from `pan`. */
export function play(k: OneShot, { gain = 1, pan = 0, delay = 0, pitch = 1 }: { gain?: number; pan?: number; delay?: number; pitch?: number } = {}) {
  const b = getBus();
  const peak = SHOT_GAIN[k] * Math.max(0, Math.min(1, gain));
  recordSfx(`event:${k}`, { group: 'outside', peak: peak * busLevel(), pan, played: !!b && !quiet });
  if (!b || quiet || peak < 1e-4) return;
  try {
    const c = b.ctx;
    const t0 = c.currentTime + 0.02 + Math.max(0, delay);
    const pn = typeof c.createStereoPanner === 'function' ? c.createStereoPanner() : null;
    if (pn) pn.pan.value = Math.max(-1, Math.min(1, pan));
    const dest: AudioNode = pn ?? b.input;
    if (pn) pn.connect(b.input);
    const env = (node: AudioNode, at: number, attack: number, hold: number, release: number, level = 1) => {
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak * level, at + attack);
      g.gain.setValueAtTime(peak * level, at + attack + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
      node.connect(g).connect(dest);
      return at + attack + hold + release;
    };
    const osc = (type: OscillatorType, from: number, to: number, at: number, dur: number) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(from * pitch, at);
      if (to !== from) o.frequency.exponentialRampToValueAtTime(to * pitch, at + dur);
      o.start(at);
      o.stop(at + dur + 0.05);
      return o;
    };
    const noise = (at: number, dur: number) => {
      const s = c.createBufferSource();
      s.buffer = b.noise;
      s.loop = true;
      s.start(at, Math.random());
      s.stop(at + dur + 0.05);
      return s;
    };
    const filter = (type: BiquadFilterType, from: number, to: number, at: number, dur: number, q = 0.8) => {
      const f = c.createBiquadFilter();
      f.type = type;
      f.Q.value = q;
      f.frequency.setValueAtTime(from, at);
      if (to !== from) f.frequency.exponentialRampToValueAtTime(to, at + dur);
      return f;
    };
    switch (k) {
      case 'zip':
        env(osc('sine', 280, 2600, t0, 0.4), t0, 0.01, 0.25, 0.15);
        env(osc('triangle', 560, 3900, t0, 0.4), t0, 0.01, 0.2, 0.15, 0.4);
        break;
      case 'beam': {
        const o = osc('sine', 220, 760, t0, 1.6);
        const vib = c.createGain();
        vib.gain.value = 18;
        osc('sine', 9, 9, t0, 1.6).connect(vib).connect(o.frequency);
        env(o, t0, 0.2, 1.1, 0.3);
        env(noise(t0, 1.6).connect(filter('bandpass', 2500, 4000, t0, 1.6, 3)), t0, 0.3, 0.9, 0.4, 0.4);
        break;
      }
      case 'squeak':
        for (let i = 0; i < 2; i++) {
          const at = t0 + i * 0.22;
          env(osc('square', 950, 1350, at, 0.16).connect(filter('bandpass', 1500, 1500, at, 0.16, 3)), at, 0.01, 0.08, 0.08);
        }
        break;
      case 'chime':
        [1046.5, 1318.5, 1568, 2093, 2637].forEach((hz, i) => env(osc('sine', hz, hz, t0 + i * 0.14, 1.8), t0 + i * 0.14, 0.01, 0.05, 1.6, 0.8 - i * 0.08));
        break;
      case 'whale': {
        // a slow, sliding moan with an overtone
        const dur = 2.8;
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(170 * pitch, t0);
        o.frequency.exponentialRampToValueAtTime(330 * pitch, t0 + dur * 0.45);
        o.frequency.exponentialRampToValueAtTime(140 * pitch, t0 + dur);
        o.start(t0);
        o.stop(t0 + dur + 0.1);
        env(o, t0, 0.5, dur - 1.1, 0.6);
        env(osc('sine', 340, 600, t0, dur), t0, 0.6, dur - 1.3, 0.6, 0.25);
        break;
      }
      case 'chirps':
        for (const n of birdCall(Math.random)) {
          const at = t0 + n.at;
          env(osc('sine', n.from, n.to, at, n.dur), at, Math.min(0.01, n.dur / 3), n.dur * 0.3, n.dur * 0.6, n.peak);
        }
        break;
      case 'burner':
        env(noise(t0, 1.4).connect(filter('lowpass', 420, 650, t0, 1.2, 0.6)), t0, 0.08, 0.9, 0.4);
        break;
    }
  } catch {
    // audio is optional
  }
}

// ---------- the bus ----------

const busLevel = () => (quiet ? 0 : Math.max(hearing.level, THROUGH_GLASS.level));

function getBus(): Bus | null {
  const out = output();
  if (!out) return null;
  if (bus?.ctx === out.context && bus.out === out) return bus;
  try {
    const c = out.context;
    const input = c.createGain();
    const muffle = c.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.Q.value = 0.5;
    muffle.frequency.value = cutoffHz(THROUGH_GLASS.clarity);
    const level = c.createGain();
    level.gain.value = 0;
    input.connect(muffle).connect(level);
    bus = { ctx: c, out, input, muffle, level, hooked: false, noise: noiseBuffer(c) };
    return bus;
  } catch {
    return null;
  }
}

function hook(b: Bus, on: boolean) {
  if (on === b.hooked) return;
  try {
    if (on) b.level.connect(b.out);
    else b.level.disconnect();
    b.hooked = on;
  } catch {
    // audio is optional
  }
}

function glideOn(c: BaseAudioContext, p: AudioParam, v: number, tau: number) {
  try {
    p.cancelScheduledValues(c.currentTime);
    p.setTargetAtTime(v, c.currentTime, tau);
  } catch {
    // audio is optional
  }
}

const glide = (p: AudioParam, v: number, tau: number) => bus && glideOn(bus.ctx, p, v, tau);
