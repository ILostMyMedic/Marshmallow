// World events' sounds (world/events/), all synthesized: an airliner's distant rumble, a helicopter's chop, a flock's
// wings and chirps, a balloon's burner, an airship's engines, a UFO's hum, beam and zip, a rubber duck's squeak, a
// rainbow's chime and whale song; and down on the street a rock band's riff and drums, a marching band, an ice cream
// truck's jingle, a fire engine's siren and horn, a truck's diesel and a griddle's sizzle; fireworks' whistles and booms
// (New Year's, seasons/Fireworks.tsx). Everything goes through one
// small bus into the master gain, muffled through the glass indoors and full on a balcony or the roof, panned towards
// where it happens and quieter with distance. Silent while quiet (a panel, the elevator ride) or hidden.
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
const live = new Set<Loop>();

// ---------- the floor, quiet, where you hear from ----------

let users = 0;

/** Events are on (WorldEvents.tsx while any runs, New Year's fireworks while they go up): follow the listener. */
export function eventSoundsOn(floorKind: FloorKindOf) {
  users++;
  kind = floorKind;
  if (!timer) timer = setInterval(tick, TICK_MS);
  tick();
}

/** No events any more (each eventSoundsOn's own off): everything fades and the bus lets go of the mixer. */
export function eventSoundsOff() {
  users = Math.max(0, users - 1);
  if (users > 0) return;
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

export type LoopKind = 'jet' | 'rotor' | 'hum' | 'flap' | 'engine' | 'diesel' | 'siren' | 'sizzle' | TuneKind;
/** The loops that are tunes, played note by note (TuneLoop). */
export type TuneKind = 'rock' | 'band' | 'jingle';

export interface Loop {
  /** Its loudness (0-1 of its own full level) and pan; `pitch` bends it (1 = as built). Cheap: call it every frame. */
  set(gain: number, pan: number, pitch?: number): void;
  stop(fade?: number): void;
}

/** Each loop at full level, before the bus. */
const LOOP_GAIN: Record<LoopKind, number> = { jet: 0.16, rotor: 0.14, hum: 0.05, flap: 0.09, engine: 0.09, diesel: 0.08, siren: 0.05, sizzle: 0.035, rock: 0.15, band: 0.13, jingle: 0.08 };

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

// ---------- tunes (the street's bands and jingles) ----------

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** One step of a pattern: a note (a MIDI number, or 1 for a drum hit) and how many steps it lasts; null for none. */
type Step = { note: number; steps: number } | null;

/** A pattern as steps: a MIDI note, `x` for a hit, `.` for nothing, `-` holding what came before; `|` between bars is ignored. */
function pattern(s: string): Step[] {
  const toks = s.split(/\s+/).filter((t) => t && t !== '|');
  return toks.map((t, i) => {
    if (t === '.' || t === '-') return null;
    let n = 1;
    while (toks[i + n] === '-') n++;
    return { note: t === 'x' ? 1 : Number(t), steps: n };
  });
}

/** What a tune plays its steps on (TuneLoop). Times are the context's. */
interface Voices {
  /** A distorted guitar's power chord on `midi`. */
  power(midi: number, at: number, dur: number): void;
  kick(at: number): void;
  snare(at: number, level?: number): void;
  hat(at: number, open?: boolean): void;
  crash(at: number, level?: number): void;
  brass(midi: number, at: number, dur: number, level?: number): void;
  tuba(midi: number, at: number, dur: number): void;
  /** A marching band's bass drum. */
  boom(at: number): void;
  /** A music box's note. */
  bell(midi: number, at: number, level?: number): void;
}

interface Tune {
  /** Seconds a step. */
  step: number;
  /** Plays step `i` (counted from the start, round and round) at `at`. */
  play(v: Voices, i: number, at: number): void;
}

// a garage band's riff in E: two bars of eighths at 140 bpm, a fill every fourth time round
const RIFF = pattern('40 40 . 40 43 . 45 - | 40 40 . 40 46 45 . 43');
const KICK = pattern('x . . . x x . . | x . . . x x . x');
const SNARE = pattern('. . x . . . x . | . . x . . . x x');
// a march in C at 116 bpm: eight bars of 2/4, its oom-pah under it and a roll at the end
const MARCH = pattern('67 - 72 - | 76 - 74 72 | 71 - 74 - | 79 - - . | 77 - 76 74 | 72 - 76 - | 74 - 71 - | 72 - - .');
const OOM = pattern('48 . 43 . | 48 . 43 . | 43 . 50 . | 43 . 47 . | 41 . 48 . | 48 . 43 . | 43 . 50 . | 48 . 48 .');
const BARS = [60, 60, 55, 55, 53, 60, 55, 60];
// an ice cream truck's music box, round and round at 160 bpm
const JINGLE = pattern('79 76 79 76 | 84 83 81 79 | 77 81 77 81 | 86 84 83 81 | 79 76 79 76 | 84 83 81 79 | 77 74 76 77 | 72 - - .');
const JINGLE_BASS = pattern('60 . 67 . | 60 . 67 . | 65 . 72 . | 67 . 74 . | 60 . 67 . | 60 . 67 . | 65 . 67 . | 60 . . .');

const TUNES: Record<TuneKind, Tune> = {
  rock: {
    step: 60 / 140 / 2,
    play(v, i, at) {
      const s = i % 16;
      const g = RIFF[s];
      if (g) v.power(g.note, at, g.steps * TUNES.rock.step * 0.85);
      if (KICK[s]) v.kick(at);
      if (SNARE[s] || i % 64 >= 60) v.snare(at, SNARE[s] ? 1 : 0.7);
      v.hat(at, s % 8 === 7);
      if (i % 64 === 0) v.crash(at);
    },
  },
  band: {
    step: 60 / 116 / 2,
    play(v, i, at) {
      const s = i % 32;
      const step = TUNES.band.step;
      const m = MARCH[s];
      if (m) v.brass(m.note, at, m.steps * step * 0.9);
      const o = OOM[s];
      if (o) v.tuba(o.note, at, step * 0.8);
      if (s % 2 === 1) {
        // the off-beat "pah": the bar's chord, a third and a fifth up
        const root = BARS[Math.floor(s / 4)];
        v.brass(root + 4, at, step * 0.5, 0.16);
        v.brass(root + 7, at, step * 0.5, 0.16);
      }
      if (s % 4 === 0) v.boom(at);
      if (s % 2 === 1 || s >= 28) v.snare(at, s >= 28 ? 0.8 : 0.5);
      if (s === 0 || s === 16) v.crash(at, 0.2);
    },
  },
  jingle: {
    step: 60 / 160 / 2,
    play(v, i, at) {
      const s = i % 32;
      const n = JINGLE[s];
      if (n) v.bell(n.note, at, 0.5);
      const b = JINGLE_BASS[s];
      if (b) v.bell(b.note - 12, at, 0.2);
    },
  },
};

let drive: Float32Array<ArrayBuffer> | null = null;
/** The guitar amp's soft clipping. */
const driveCurve = () => {
  if (drive) return drive;
  drive = new Float32Array(1024);
  for (let i = 0; i < drive.length; i++) drive[i] = Math.tanh(((i / (drive.length - 1)) * 2 - 1) * 3);
  return drive;
};

/** How far ahead a tune's notes are scheduled: set() comes every frame, so a quarter of a second is plenty. */
const AHEAD = 0.25;

/** A tune for as long as the event wants it: each set() (every frame) schedules its next notes, a step at a time. */
class TuneLoop implements Loop, Voices {
  private last = { gain: -1, pan: 2 };
  private stopped = false;
  private i = 0;
  private next: number;
  private amp: AudioNode | null = null;
  constructor(
    private c: BaseAudioContext,
    private out: GainNode,
    private pan: StereoPannerNode | null,
    private tune: Tune,
    private noiseBuf: AudioBuffer,
    private max: number,
  ) {
    this.next = c.currentTime + 0.05;
  }
  set(gain: number, pan: number) {
    if (this.stopped) return;
    const g = Math.max(0, Math.min(1, gain)) * this.max;
    if (Math.abs(g - this.last.gain) > 0.0005) glideOn(this.c, this.out.gain, (this.last.gain = g), 0.12);
    if (this.pan && Math.abs(pan - this.last.pan) > 0.02) glideOn(this.c, this.pan.pan, (this.last.pan = pan), 0.12);
    const now = this.c.currentTime;
    // behind (a hidden tab, a long frame): skip what was missed, keeping to the beat
    if (this.next < now) {
      const missed = Math.ceil((now - this.next) / this.tune.step);
      this.i += missed;
      this.next += missed * this.tune.step;
    }
    for (; this.next < now + AHEAD; this.i++, this.next += this.tune.step) {
      try {
        this.tune.play(this, this.i, this.next);
      } catch {
        // audio is optional
      }
    }
  }
  stop(fade = 0.6) {
    if (this.stopped) return;
    this.stopped = true;
    live.delete(this);
    try {
      this.out.gain.cancelScheduledValues(this.c.currentTime);
      this.out.gain.setTargetAtTime(0, this.c.currentTime, fade / 4);
    } catch {
      // audio is optional
    }
    setTimeout(() => {
      try {
        this.out.disconnect();
      } catch {
        // already gone
      }
    }, (fade + 1) * 1000);
  }

  // ---------- its instruments ----------

  private env(src: AudioNode, at: number, attack: number, hold: number, release: number, level: number, dest: AudioNode = this.out) {
    const g = this.c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + attack);
    g.gain.setValueAtTime(level, at + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
    src.connect(g).connect(dest);
  }
  private osc(type: OscillatorType, f: number, at: number, end: number, to?: number) {
    const o = this.c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, end);
    o.start(at);
    o.stop(end + 0.05);
    return o;
  }
  private hiss(at: number, end: number) {
    const s = this.c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.start(at, Math.random());
    s.stop(end + 0.05);
    return s;
  }
  private filter(type: BiquadFilterType, f: number, q = 0.7) {
    const b = this.c.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }
  /** The guitar amp: driven into soft clipping, then a speaker cabinet's band. */
  private ampIn(): AudioNode {
    if (this.amp) return this.amp;
    const pre = this.c.createGain();
    pre.gain.value = 7;
    const shaper = this.c.createWaveShaper();
    shaper.curve = driveCurve();
    const post = this.c.createGain();
    post.gain.value = 0.2;
    pre.connect(shaper).connect(this.filter('lowpass', 2800, 0.8)).connect(this.filter('highpass', 100)).connect(post).connect(this.out);
    return (this.amp = pre);
  }
  power(midi: number, at: number, dur: number) {
    const amp = this.ampIn();
    const end = at + dur;
    for (const [semi, type, level] of [
      [0, 'sawtooth', 0.5],
      [7, 'sawtooth', 0.4],
      [12, 'square', 0.22],
    ] as const)
      this.env(this.osc(type, hz(midi + semi) * (1 + (Math.random() - 0.5) * 0.004), at, end + 0.1), at, 0.005, Math.max(0.02, dur - 0.05), 0.08, level, amp);
  }
  kick(at: number) {
    this.env(this.osc('sine', 150, at, at + 0.3, 42), at, 0.002, 0.04, 0.26, 0.9);
    this.env(this.hiss(at, at + 0.03).connect(this.filter('lowpass', 2500)), at, 0.001, 0.005, 0.02, 0.2);
  }
  snare(at: number, level = 1) {
    this.env(this.hiss(at, at + 0.2).connect(this.filter('bandpass', 1900, 0.7)), at, 0.002, 0.02, 0.16, 0.55 * level);
    this.env(this.osc('triangle', 190, at, at + 0.1, 150), at, 0.002, 0.01, 0.08, 0.3 * level);
  }
  hat(at: number, open = false) {
    const d = open ? 0.28 : 0.045;
    this.env(this.hiss(at, at + d + 0.02).connect(this.filter('highpass', 7500)), at, 0.001, 0.005, d, open ? 0.14 : 0.1);
  }
  crash(at: number, level = 0.32) {
    this.env(this.hiss(at, at + 1.7).connect(this.filter('highpass', 4800, 0.6)), at, 0.002, 0.04, 1.6, level);
  }
  brass(midi: number, at: number, dur: number, level = 0.42) {
    const f = hz(midi);
    const end = at + dur;
    // the lips' blat: the filter opens bright on the attack and settles
    const lp = this.c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(500, at);
    lp.frequency.exponentialRampToValueAtTime(2600, at + 0.05);
    lp.frequency.exponentialRampToValueAtTime(1500, at + 0.2);
    this.osc('sawtooth', f, at, end + 0.1).connect(lp);
    this.osc('sawtooth', f * 1.004, at, end + 0.1).connect(lp);
    this.env(lp, at, 0.03, Math.max(0.03, dur - 0.08), 0.08, level);
  }
  tuba(midi: number, at: number, dur: number) {
    this.env(this.osc('sawtooth', hz(midi), at, at + dur + 0.1).connect(this.filter('lowpass', 650, 1)), at, 0.02, Math.max(0.03, dur - 0.1), 0.1, 0.55);
  }
  boom(at: number) {
    this.env(this.osc('sine', 100, at, at + 0.45, 48), at, 0.003, 0.05, 0.4, 0.85);
    this.env(this.hiss(at, at + 0.15).connect(this.filter('lowpass', 400)), at, 0.002, 0.02, 0.1, 0.3);
  }
  bell(midi: number, at: number, level = 0.5) {
    const f = hz(midi);
    for (const [k, l, d] of [
      [1, 1, 0.5],
      [2, 0.35, 0.3],
      [3, 0.12, 0.15],
    ])
      this.env(this.osc('sine', f * k, at, at + d + 0.05), at, 0.003, 0.01, d, l * level);
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
    if (k === 'rock' || k === 'band' || k === 'jingle') {
      const t = new TuneLoop(c, out, pan, TUNES[k], b.noise, LOOP_GAIN[k]);
      live.add(t);
      return t;
    }
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
      case 'diesel': {
        // a truck's diesel: a lumpy low rumble, its firing in the throb; pitch it up as it pulls away
        const saw = osc('sawtooth', 38);
        const lp = filter('lowpass', 210, 1.1);
        throb(saw.connect(lp), 9, 0.55, 0.45, 'square').connect(out);
        const g = c.createGain();
        g.gain.value = 0.45;
        noise().connect(filter('lowpass', 150, 0.7)).connect(g).connect(out);
        tune.push(saw.frequency, lp.frequency);
        break;
      }
      case 'siren': {
        // a fire engine's wail: a bright tone sweeping slowly up and down
        const lfo = osc('triangle', 0.3);
        const depth = c.createGain();
        depth.gain.value = 360;
        lfo.connect(depth);
        const lp = filter('lowpass', 2400, 0.7);
        for (const [type, level] of [['sawtooth', 0.55], ['square', 0.3]] as const) {
          const o = osc(type, 860 * (type === 'square' ? 1.004 : 1));
          depth.connect(o.frequency);
          const g = c.createGain();
          g.gain.value = level;
          o.connect(g).connect(lp);
          tune.push(o.frequency);
        }
        lp.connect(out);
        break;
      }
      case 'sizzle': {
        // a food truck's griddle: a hiss that sputters
        const hp = filter('highpass', 3200, 0.6);
        throb(throb(noise().connect(hp), 13, 0.5, 0.5, 'square'), 5.3, 0.6, 0.4, 'square').connect(out);
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

export type OneShot = 'zip' | 'beam' | 'squeak' | 'chime' | 'whale' | 'chirps' | 'burner' | 'horn' | 'bell' | 'crash' | 'whistle' | 'boom';

/** Each one-shot at full level, before the bus. */
const SHOT_GAIN: Record<OneShot, number> = { zip: 0.08, beam: 0.07, squeak: 0.1, chime: 0.07, whale: 0.12, chirps: 0.05, burner: 0.15, horn: 0.11, bell: 0.08, crash: 0.08, whistle: 0.025, boom: 0.3 };

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
      case 'horn':
        // a big vehicle's air horn: two brassy tones a third apart
        for (const hz of [233, 294]) env(osc('sawtooth', hz, hz * 0.98, t0, 0.75).connect(filter('lowpass', 1500, 1200, t0, 0.75, 0.9)), t0, 0.02, 0.55, 0.15, 0.7);
        break;
      case 'bell':
        // a serving bell's ding
        [1568, 2349, 3136].forEach((hz, i) => env(osc('sine', hz, hz, t0, 1.4), t0, 0.004, 0.02, 1.3 - i * 0.3, [1, 0.45, 0.2][i]));
        break;
      case 'crash':
        // a cymbal crash
        env(noise(t0, 1.9).connect(filter('highpass', 5200, 3800, t0, 1.8, 0.7)), t0, 0.003, 0.05, 1.7);
        break;
      case 'whistle':
        // a rocket going up: an airy rising hiss, not a tone
        env(noise(t0, 1.3).connect(filter('bandpass', 900, 3200, t0, 1.2, 6)), t0, 0.15, 0.8, 0.3);
        break;
      case 'boom':
        // the burst: a thump and its rumble, then a crackle of sparks
        env(noise(t0, 1.6).connect(filter('lowpass', 260, 70, t0, 1.4, 0.7)), t0, 0.004, 0.06, 1.4);
        env(osc('sine', 90, 38, t0, 0.6), t0, 0.004, 0.04, 0.5, 0.7);
        env(noise(t0 + 0.35, 1.2).connect(filter('highpass', 3500, 5000, t0 + 0.35, 1.1, 0.7)), t0 + 0.35, 0.05, 0.4, 0.7, 0.18);
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
