// The sound of being indoors (roomToneRules.ts decides how much): a soft air-conditioning rumble with a breath of air
// and the lights' faint hum, a light office murmur that grows with the people near you and those chatting, and now and
// then a small sound somewhere in the room (a door, a chair rolling, a distant phone, the printer). On the lobby, the
// office floors and the CEO's floor; none on the roof, fading out as you step onto a balcony. One fixed graph, built
// once; a timer (not the frame loop) follows you, silent behind a panel, while the elevator carries you or with the tab
// hidden, and cut off from the mixer once silent. window.__mmRoomTone reports it. New in Marshmallow.

import type { FloorKindOf } from '../world/floors';
import { bodies } from '../world/people';
import { chattingNow } from './peopleSounds';
import { crowdNear, indoorShare, murmurLevel, nextRoomSoundIn, pickRoomSound, roomSoundSpot, type RoomSound } from './roomToneRules';
import { listenerAt, noise, noiseBuffer, output, recordSfx, tone, type Vec3 } from './sfx';

const TICK_MS = 200;
/** Gains at full level, before the master volume: the air averages about 0.011 (-39 dBFS), the murmur up to 0.02. */
const GAIN = { air: 0.14, hiss: 0.03, hum: 0.006, murmur: 0.14 };
const UNHOOK_AFTER = 1.5;

interface Graph {
  ctx: BaseAudioContext;
  out: AudioNode;
  level: GainNode;
  murmur: GainNode;
  hooked: boolean;
  nodes: number;
}

let graph: Graph | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let kind: FloorKindOf = 'office';
let quiet = false;
let silentFor = 0;
let nextSound = 0;
const state = { indoor: 0, near: 0, chatting: 0, murmur: 0, sounds: 0, last: null as RoomSound | null };
const sent = { level: -1, murmur: -1 };

/** The floor you're on came into view (world/Sounds.tsx): the room starts following you there. */
export function startRoomTone(floorKind: FloorKindOf) {
  kind = floorKind;
  nextSound = performance.now() / 1000 + 6 + Math.random() * 10;
  if (!timer) timer = setInterval(tick, TICK_MS);
  recordSfx('room:tone', { group: 'room', peak: GAIN.air * 0.06, played: !!output() && kind !== 'roof' });
  tick();
}

/** The floor's gone: fade out and stop following. */
export function stopRoomTone() {
  if (timer) clearInterval(timer);
  timer = null;
  if (graph) glide(graph.level.gain, 0, 0.08);
  sent.level = 0;
  setTimeout(() => {
    if (!timer && graph) hook(graph, false);
  }, 600);
}

/** Quiet (a panel open, the elevator travelling): fades out, like the outside. */
export function setRoomToneQuiet(q: boolean) {
  if (q === quiet) return;
  quiet = q;
  if (timer) tick();
}

function tick() {
  const ear = listenerAt();
  const now = performance.now() / 1000;
  state.indoor = indoorShare(kind, ear.x, ear.z);
  state.near = crowdNear(distances(ear));
  state.chatting = chattingNow();
  state.murmur = murmurLevel(state.near, state.chatting);
  const silent = quiet || document.hidden;
  const level = silent ? 0 : state.indoor;
  const out = output();
  const g = out ? getGraph(out) : null;
  if (g) {
    silentFor = level > 0 ? 0 : silentFor + TICK_MS / 1000;
    hook(g, silentFor < UNHOOK_AFTER);
    if (Math.abs(level - sent.level) > 0.01) glide(g.level.gain, (sent.level = level), 0.4);
    const m = GAIN.murmur * state.murmur;
    if (Math.abs(m - sent.murmur) > 0.001) glide(g.murmur.gain, (sent.murmur = m), 1.5);
  }
  if (silent || state.indoor < 0.5) {
    nextSound = Math.max(nextSound, now + 3);
    return;
  }
  if (now >= nextSound) {
    nextSound = now + nextRoomSoundIn(Math.random(), state.near);
    const what = pickRoomSound(kind, Math.random());
    if (what) {
      const at = roomSoundSpot(ear, Math.random(), Math.random());
      ROOM_SOUNDS[what]({ x: at.x, y: 1, z: at.z });
      state.sounds++;
      state.last = what;
    }
  }
}

/** How far everyone drawn on this floor is from you (m). */
function* distances(ear: Readonly<Vec3>) {
  for (const b of bodies()) yield Math.hypot(b.x - ear.x, b.z - ear.z);
}

// ---------- the small sounds ----------

const r = () => Math.random();
const FAR = { group: 'room', reach: 'far' } as const;

const ROOM_SOUNDS: Record<RoomSound, (pos: Vec3) => void> = {
  // a door swinging shut somewhere: a little creak, the thud, the latch
  door: (pos) => {
    const o = { ...FAR, pos, into: recordSfx('room:door', { ...FAR, pos, peak: 0.1 }) };
    tone({ ...o, freq: 280 + r() * 60, to: 400, type: 'sawtooth', dur: 0.35, peak: 0.012, attack: 0.08 });
    tone({ ...o, at: 0.38, freq: 95, to: 55, dur: 0.22, peak: 0.1, attack: 0.004 });
    noise({ ...o, at: 0.38, dur: 0.16, peak: 0.06, filter: 'lowpass', freq: 420, attack: 0.003 });
    noise({ ...o, at: 0.41, dur: 0.025, peak: 0.035, filter: 'bandpass', freq: 2600, q: 2, attack: 0.001 });
  },
  // a chair rolled back on its casters, and its creak
  chair: (pos) => {
    const o = { ...FAR, pos, into: recordSfx('room:chair', { ...FAR, pos, peak: 0.05 }) };
    noise({ ...o, dur: 0.5, peak: 0.05, freq: 330 + r() * 60, to: 170, q: 0.7, attack: 0.08 });
    [0.08, 0.22, 0.31].forEach((at) => noise({ ...o, at: at + r() * 0.04, dur: 0.025, peak: 0.012, filter: 'bandpass', freq: 2200 + r() * 600, q: 3, attack: 0.002 }));
    const f = 210 + r() * 60;
    tone({ ...o, at: 0.45, freq: f, to: f * 1.35, type: 'sawtooth', dur: 0.2, peak: 0.01, attack: 0.04 });
  },
  // a desk phone ringing twice across the room, then picked up
  phone: (pos) => {
    const o = { ...FAR, pos, into: recordSfx('room:phone', { ...FAR, pos, peak: 0.035 }) };
    for (const at of [0, 0.95]) {
      tone({ ...o, at, freq: 1046.5, type: 'triangle', dur: 0.6, peak: 0.035, attack: 0.01 });
      tone({ ...o, at, freq: 1318.5, type: 'triangle', dur: 0.6, peak: 0.022, attack: 0.01 });
    }
  },
  // the printer: its motor, a few lines feeding through, and the page out
  printer: (pos) => {
    const o = { ...FAR, pos, into: recordSfx('room:printer', { ...FAR, pos, peak: 0.035 }) };
    tone({ ...o, freq: 140, to: 150, type: 'sawtooth', dur: 1.7, peak: 0.01, attack: 0.25 });
    for (let i = 0; i < 4; i++) noise({ ...o, at: 0.2 + i * 0.32, dur: 0.18, peak: 0.035, filter: 'bandpass', freq: 1500 + r() * 300, q: 2, attack: 0.02 });
    noise({ ...o, at: 1.5, dur: 0.4, peak: 0.025, filter: 'highpass', freq: 2200, to: 3600, attack: 0.05 });
  },
};

// ---------- the graph ----------

function getGraph(out: AudioNode): Graph | null {
  if (graph?.ctx === out.context && graph.out === out) return graph;
  try {
    graph = build(out.context, out);
    sent.level = -1;
    sent.murmur = -1;
    return graph;
  } catch {
    return null;
  }
}

/** The air conditioning and the murmur, silent until mixed, into one level. */
function build(c: BaseAudioContext, out: AudioNode): Graph {
  let nodes = 0;
  const n = <T extends AudioNode>(node: T) => (nodes++, node);
  const gain = (v: number) => {
    const g = n(c.createGain());
    g.gain.value = v;
    return g;
  };
  const filter = (type: BiquadFilterType, hz: number, q: number) => {
    const f = n(c.createBiquadFilter());
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    return f;
  };
  const osc = (type: OscillatorType, hz: number) => {
    const o = n(c.createOscillator());
    o.type = type;
    o.frequency.value = hz;
    o.start();
    return o;
  };
  const source = (offset: number) => {
    const s = n(c.createBufferSource());
    s.buffer = noiseBuffer(c);
    s.loop = true;
    s.start(0, offset);
    return s;
  };
  const level = gain(0);

  // the air conditioning: a low rumble, a breath of air in the vents and the lights' 120 Hz hum
  const air = source(0.3);
  air.connect(filter('lowpass', 160, 0.7)).connect(gain(GAIN.air)).connect(level);
  air.connect(filter('bandpass', 1200, 0.5)).connect(gain(GAIN.hiss)).connect(level);
  osc('sine', 120).connect(gain(GAIN.hum)).connect(level);

  // the murmur: voice-band noise, fluttering at a syllable's pace and swelling slowly, so it reads as people talking
  const talk = source(1.1);
  const flutter = gain(0.5);
  talk.connect(filter('bandpass', 450, 1.2)).connect(flutter);
  talk.connect(filter('bandpass', 1300, 2)).connect(gain(0.7)).connect(flutter);
  for (const [hz, depth] of [
    [3.7, 0.22],
    [5.3, 0.14],
    [0.23, 0.18],
  ])
    osc('sine', hz).connect(gain(depth)).connect(flutter.gain);
  const murmur = gain(0);
  flutter.connect(murmur).connect(level);

  return { ctx: c, out, level, murmur, hooked: false, nodes };
}

function hook(g: Graph, on: boolean) {
  if (on === g.hooked) return;
  try {
    if (on) g.level.connect(g.out);
    else g.level.disconnect();
    g.hooked = on;
  } catch {
    // audio is optional
  }
}

function glide(p: AudioParam, v: number, tau: number) {
  try {
    const now = graph?.ctx.currentTime ?? 0;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(v, now, tau);
  } catch {
    // audio is optional
  }
}

// window.__mmRoomTone: what the room sounds like from here, for QA (a fresh snapshot per read).
if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__mmRoomTone', {
    get: () => ({
      running: timer !== null,
      quiet: quiet || document.hidden,
      kind,
      indoor: Math.round(state.indoor * 100) / 100,
      near: Math.round(state.near * 100) / 100,
      chatting: state.chatting,
      murmur: Math.round(state.murmur * 100) / 100,
      sounds: state.sounds,
      last: state.last,
      nextIn: Math.max(0, Math.round(nextSound - performance.now() / 1000)),
      nodes: graph?.nodes ?? 0,
      hooked: graph?.hooked ?? false,
    }),
    enumerable: false,
    configurable: true,
  });
}
