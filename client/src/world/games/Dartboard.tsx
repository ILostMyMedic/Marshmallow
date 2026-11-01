// The shop's dartboard, in a wall spot (decor/Decor.tsx hangs it there, its bull at the proper height): a painted board
// in a black surround with a little holder of darts beside it. E at it takes its three darts: aim with the crosshair,
// hold the mouse to wind up and let go to throw (games/darts.ts: too soft drops low, too hard flies high). Darts thud
// in where they land and the turn adds up after the third, then they come out for the next. Workers on the darts
// errand (gameErrands.ts) throw their turns from the oche too. Everything is drawn in the board's own frame (its middle,
// the room towards +z): darts in the air are carried over from the room.
// New in Marshmallow.
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { dartClatter, dartThock, throwWhoosh, turnChime } from '../../ui/gameSfx';
import { useCanvasTexture } from '../canvasTexture';
import { CUT_PLANES } from '../cutaway';
import { dartboardY, ITEM_SIZE, wallFoot } from '../decor/spots';
import { SANS } from '../draw';
import { useInteractable } from '../interact';
import { toon } from '../materials';
import { INK, Outlines } from '../Outlines';
import { useView } from '../view';
import { BOARD, landDart, normal, onBoard, scoreAt, SEGMENTS, throwDart, type BoardPlace, type DartLanding, type Vec3 } from './darts';
import { chargeNow, closeBoard, dartLanded, dartsThrown, heldGame, newTurn, openBoard, PLAYER, setToyHand, takeThrow, toyHand } from './gameState';

/** The board's face stands this far in front of the item's middle (the item is ITEM_SIZE.dartboard.d deep, its back on the wall). */
const FACE = BOARD.depth - ITEM_SIZE.dartboard.d / 2;
/** A dart: how long it is, how far its tip sinks into the board. */
const DART = { len: 0.15, sink: 0.018 };
const CUT = 'room' as const;

/** The board's colours: the singles black and cream by turns, the doubles and trebles red and green. */
const COLORS = { dark: '#1d1b1a', light: '#f1e3c4', red: '#d62828', green: '#1f7a3a', wire: '#c9ccd1', surround: '#121214' };

/** Paints a regulation board onto a square canvas `px` across: `px / 2` is the surround's radius. */
function paintBoard(ctx: CanvasRenderingContext2D, px: number) {
  const c = px / 2;
  const k = c / BOARD.surround; // px per metre
  ctx.fillStyle = COLORS.surround;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();
  const wedge = (r0: number, r1: number, i: number, color: string) => {
    const a0 = ((i * 18 - 9 - 90) * Math.PI) / 180;
    const a1 = ((i * 18 + 9 - 90) * Math.PI) / 180;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(c, c, r1 * k, a0, a1);
    ctx.arc(c, c, r0 * k, a1, a0, true);
    ctx.closePath();
    ctx.fill();
  };
  for (let i = 0; i < 20; i++) {
    const single = i % 2 === 0 ? COLORS.dark : COLORS.light;
    const ring = i % 2 === 0 ? COLORS.red : COLORS.green;
    wedge(BOARD.outerBull, BOARD.treble.inner, i, single);
    wedge(BOARD.treble.inner, BOARD.treble.outer, i, ring);
    wedge(BOARD.treble.outer, BOARD.double.inner, i, single);
    wedge(BOARD.double.inner, BOARD.double.outer, i, ring);
  }
  ctx.fillStyle = COLORS.green;
  ctx.beginPath();
  ctx.arc(c, c, BOARD.outerBull * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.red;
  ctx.beginPath();
  ctx.arc(c, c, BOARD.bull * k, 0, Math.PI * 2);
  ctx.fill();
  // the wires: the rings and the spokes
  ctx.strokeStyle = COLORS.wire;
  ctx.lineWidth = Math.max(1, px / 512);
  for (const r of [BOARD.bull, BOARD.outerBull, BOARD.treble.inner, BOARD.treble.outer, BOARD.double.inner, BOARD.double.outer]) {
    ctx.beginPath();
    ctx.arc(c, c, r * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 20; i++) {
    const a = ((i * 18 - 9 - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * BOARD.outerBull * k, c + Math.sin(a) * BOARD.outerBull * k);
    ctx.lineTo(c + Math.cos(a) * BOARD.double.outer * k, c + Math.sin(a) * BOARD.double.outer * k);
    ctx.stroke();
  }
  // the numbers on their ring, upright
  ctx.fillStyle = '#f8f9fa';
  ctx.font = `700 ${Math.round(px * 0.06)}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const rn = ((BOARD.double.outer + BOARD.numbers) / 2) * k;
  SEGMENTS.forEach((n, i) => {
    const a = ((i * 18 - 90) * Math.PI) / 180;
    ctx.fillText(String(n), c + Math.cos(a) * rn, c + Math.sin(a) * rn);
  });
}

/** One dart, its tip forward along -z (stuck, the tip is in the board), its flights in the floor's colour. */
function DartLook({ color }: { color: string }) {
  const half = DART.len / 2;
  return (
    <group>
      <mesh position={[0, 0, -half + 0.012]} rotation={[-Math.PI / 2, 0, 0]} material={toon('#ced4da')}>
        <coneGeometry args={[0.0028, 0.024, 6]} />
      </mesh>
      <mesh position={[0, 0, -half + 0.045]} rotation={[Math.PI / 2, 0, 0]} material={toon('#b08d57')}>
        <cylinderGeometry args={[0.0052, 0.0045, 0.045, 8]} />
      </mesh>
      <mesh position={[0, 0, half - 0.05]} rotation={[Math.PI / 2, 0, 0]} material={toon('#343a40')}>
        <cylinderGeometry args={[0.0025, 0.0025, 0.05, 6]} />
      </mesh>
      {[0, Math.PI / 2].map((turn) => (
        <mesh key={turn} position={[0, 0, half - 0.018]} rotation={[0, 0, turn]} material={toon(color)}>
          <boxGeometry args={[0.034, 0.0015, 0.036]} />
        </mesh>
      ))}
    </group>
  );
}

/** A dart thrown: who threw it, from where, how fast, where it lands, and how long it has flown. */
interface InFlight {
  who: string;
  from: Vec3;
  v: Vec3;
  landing: DartLanding;
  t: number;
  /** Dropping from the wall after a miss: when it hit (s into its flight). */
  fell: boolean;
}

/** A stuck dart's place on the face, and a little tilt so no two sit alike. */
interface Stuck {
  u: number;
  v: number;
  /** The way it was flying as it went in (the board's frame): it stays pointing that way. */
  dir: THREE.Vector3;
}

const MAX_SHOWN = 4;
const g = 9.81;
const q = new THREE.Quaternion();
const fwd = new THREE.Vector3(0, 0, -1);
const dir = new THREE.Vector3();

/** The dartboard in wall spot `spot`, its darts' flights in `color`. */
export const Dartboard = memo(function Dartboard({ spot, color }: { spot: string; color: string }) {
  const place = useMemo<BoardPlace>(() => ({ ...(wallFoot(spot) ?? { x: 0, z: 0, rotY: 0 }), y: dartboardY(spot) }), [spot]);
  const board = useMemo(() => openBoard(spot, place), [spot, place]);
  useLayoutEffect(() => {
    openBoard(spot, place, board);
    return () => closeBoard(spot);
  }, [spot, place, board]);
  const mine = useView((s) => s.held?.kind === 'game' && s.held.game === 'darts' && s.held.spot === spot);
  const target = useInteractable<THREE.Group>(mine ? null : { id: `darts:${spot}`, label: 'Play darts', action: { kind: 'darts', spot } }, 4);
  const face = useCanvasTexture(1024, 1024, (ctx) => paintBoard(ctx, 1024), []);
  const flying = useRef<(THREE.Group | null)[]>([]);
  const stuck = useRef<(THREE.Group | null)[]>([]);
  const inHand = useRef<THREE.Group>(null);
  const spares = useRef<THREE.Group>(null);
  const sim = useMemo(() => ({ air: [] as InFlight[], stuck: [] as Stuck[], turnOf: '' }), []);

  /** A point in the room in the board's frame (what's drawn here sits in it). */
  const local = (p: Vec3, out: THREE.Vector3) => {
    const b = onBoard(place, p);
    return out.set(b.u, b.v, b.w + FACE);
  };
  /** A direction in the room, turned into the board's frame. */
  const localDir = (d: Vec3, out: THREE.Vector3) => {
    const c = Math.cos(place.rotY);
    const s = Math.sin(place.rotY);
    return out.set(d.x * c - d.z * s, d.y, d.x * s + d.z * c);
  };

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.05);
    const now = performance.now();
    const view = useView.getState();
    const yours = heldGame(view.held)?.spot === spot && heldGame(view.held)?.game === 'darts';
    const turn = board.turn;

    // a finished turn's darts come out of the board, and the one throwing goes again
    if (turn && turn.darts.length >= 3 && board.clearAt > 0 && now >= board.clearAt && board.flying === 0) {
      sim.stuck.length = 0;
      if (board.holder) newTurn(board, board.holder);
      else board.turn = null;
    }
    if (turn?.who !== sim.turnOf) {
      sim.turnOf = turn?.who ?? '';
      if (!turn || turn.darts.length === 0) sim.stuck.length = 0;
    }

    // ---------- the player's dart in hand, and their throw ----------
    let hand: Vec3 | null = null;
    let handDir: Vec3 | null = null;
    if (yours) {
      const yaw = camera.rotation.y;
      const pitch = camera.rotation.x;
      const look = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
      const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
      const pull = (chargeNow(now) ?? 0) * 0.12;
      const third = view.person === 'third';
      // first person: low on the right, in view; following behind you: at your shoulder, from your body
      const at = third ? { x: camera.position.x - Math.sin(yaw) * 3, y: 1.45, z: camera.position.z - Math.cos(yaw) * 3 } : camera.position;
      const ahead = (third ? 0.25 : 0.42) - pull;
      hand = { x: at.x + look.x * ahead + right.x * 0.17, y: at.y + look.y * ahead - (third ? 0 : 0.17) + pull * 0.4, z: at.z + look.z * ahead + right.z * 0.17 };
      handDir = look;
      const power = takeThrow('darts', spot, now);
      const can = dartsThrown(board) < 3 || (turn !== null && turn.darts.length >= 3 && board.clearAt <= now);
      if (power !== null && can) {
        if (turn && turn.darts.length >= 3) {
          sim.stuck.length = 0;
          newTurn(board, PLAYER);
        }
        // where the crosshair meets the board's wall, or far along it when it doesn't
        const eye = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
        const e = onBoard(place, eye);
        const closing = look.x * Math.sin(place.rotY) + look.z * Math.cos(place.rotY);
        const t = closing < -0.05 ? -e.w / closing : 8;
        const aim = { x: eye.x + look.x * t, y: eye.y + look.y * t, z: eye.z + look.z * t };
        const v = throwDart(hand, aim, power, [normal(Math.random(), Math.random()), normal(Math.random(), Math.random())], { x: 0, y: 0, z: 0 });
        sim.air.push({ who: PLAYER, from: { ...hand }, v, landing: landDart(place, hand, v), t: 0, fell: false });
        board.flying++;
        throwWhoosh(hand, power, true);
      }
      setToyHand(PLAYER, third ? hand : null); // in your eyes the dart floats in view on its own
    }
    // a worker's dart in hand (the errand puts their hand where it is) and the darts they've let go
    if (board.holder && board.holder !== PLAYER) {
      hand = toyHand(board.holder);
      handDir = hand ? { x: -Math.sin(place.rotY), y: 0.1, z: -Math.cos(place.rotY) } : null;
    }
    for (const t of board.throws.splice(0)) {
      sim.air.push({ who: t.who, from: t.from, v: t.v, landing: landDart(place, t.from, t.v), t: 0, fell: false });
      throwWhoosh(t.from, 0.5, true);
    }
    const holding = hand && dartsThrown(board) < 3;

    // ---------- the darts in the air ----------
    for (let i = sim.air.length - 1; i >= 0; i--) {
      const d = sim.air[i];
      d.t += dt;
      const L = d.landing;
      if (d.t < L.t) continue;
      if (L.stuck) {
        const t = L.t;
        const into = localDir({ x: d.v.x, y: d.v.y - g * t, z: d.v.z }, new THREE.Vector3()).normalize();
        // a little wobble as it bites, so no two sit quite alike
        into.x += (Math.random() - 0.5) * 0.12;
        into.y += (Math.random() - 0.5) * 0.12;
        sim.stuck.push({ u: L.u, v: L.v, dir: into.normalize() });
        dartThock(L.at);
        landed(d.who, L.score);
        sim.air.splice(i, 1);
      } else if (d.t > L.t + 0.55 || !L.at) {
        dartClatter(L.at ?? d.from);
        landed(d.who, scoreAt(1, 1));
        sim.air.splice(i, 1);
      } else d.fell = true;
    }

    /** A dart down (in the board or not): the turn adds it, and a finished turn is told. */
    function landed(who: string, score: ReturnType<typeof scoreAt>) {
      const done = dartLanded(board, who, score, now);
      if (!done) return;
      const bull = { x: place.x, y: place.y ?? BOARD.y, z: place.z };
      turnChime(bull, done.points);
      if (who === PLAYER) useView.getState().showToast(`🎯 ${done.line}`);
    }

    // ---------- drawing them ----------
    const p = new THREE.Vector3();
    flying.current.forEach((m, i) => {
      if (!m) return;
      const d = sim.air[i];
      m.visible = !!d;
      if (!d) return;
      const L = d.landing;
      let pos: Vec3;
      let vel: Vec3;
      if (d.fell && L.at) {
        // off the wall, tumbling down it
        const s = d.t - L.t;
        pos = { x: L.at.x, y: L.at.y - (g * s * s) / 2, z: L.at.z };
        vel = { x: 0.3, y: -1, z: 0.2 };
      } else {
        pos = { x: d.from.x + d.v.x * d.t, y: d.from.y + d.v.y * d.t - (g * d.t * d.t) / 2, z: d.from.z + d.v.z * d.t };
        vel = { x: d.v.x, y: d.v.y - g * d.t, z: d.v.z };
      }
      m.position.copy(local(pos, p));
      m.quaternion.copy(q.setFromUnitVectors(fwd, localDir(vel, dir).normalize()));
    });
    stuck.current.forEach((m, i) => {
      if (!m) return;
      const s = sim.stuck[i];
      m.visible = !!s;
      if (!s) return;
      // the tip in the board, the rest out along the way it came
      const back = DART.len / 2 - DART.sink;
      m.position.set(s.u - s.dir.x * back, s.v - s.dir.y * back, FACE - s.dir.z * back);
      m.quaternion.copy(q.setFromUnitVectors(fwd, s.dir));
    });
    if (spares.current) spares.current.visible = !board.holder;
    if (inHand.current) {
      inHand.current.visible = !!holding;
      if (holding && hand && handDir) {
        inHand.current.position.copy(local(hand, p));
        inHand.current.quaternion.copy(q.setFromUnitVectors(fwd, localDir(handDir, dir).normalize()));
      }
    }
  });

  const r = BOARD.surround;
  const accent = color;
  return (
    <group>
      <group ref={target}>
        {/* the board in its round black surround, back on the wall */}
        <mesh position={[0, 0, FACE - 0.025]} rotation={[Math.PI / 2, 0, 0]} material={toon(COLORS.surround, { cut: CUT })} castShadow>
          <cylinderGeometry args={[r + 0.012, r + 0.012, 0.05, 40]} />
          <Outlines thickness={0.01} color={INK} cut={CUT} />
        </mesh>
        <mesh position={[0, 0, FACE + 0.001]}>
          <circleGeometry args={[r, 64]} />
          <meshToonMaterial map={face} clippingPlanes={CUT_PLANES[CUT]} />
        </mesh>
        {/* the darts' holder beside it, its three darts in it while nobody has them */}
        <group position={[r + 0.12, -0.12, -ITEM_SIZE.dartboard.d / 2 + 0.03]}>
          <mesh material={toon('#495057', { cut: CUT })}>
            <boxGeometry args={[0.07, 0.12, 0.05]} />
            <Outlines thickness={0.006} color={INK} cut={CUT} />
          </mesh>
          <group ref={spares}>
            {[-0.018, 0, 0.018].map((x) => (
              <group key={x} position={[x, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]} scale={0.8}>
                <DartLook color={accent} />
              </group>
            ))}
          </group>
        </group>
      </group>
      {Array.from({ length: MAX_SHOWN }, (_, i) => (
        <group
          key={`f${i}`}
          ref={(m) => {
            flying.current[i] = m;
          }}
          visible={false}
        >
          <DartLook color={accent} />
        </group>
      ))}
      {Array.from({ length: 3 }, (_, i) => (
        <group
          key={`s${i}`}
          ref={(m) => {
            stuck.current[i] = m;
          }}
          visible={false}
        >
          <DartLook color={accent} />
        </group>
      ))}
      <group ref={inHand} visible={false}>
        <DartLook color={accent} />
      </group>
    </group>
  );
});
