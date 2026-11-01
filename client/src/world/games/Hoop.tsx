// The shop's basketball hoop, in a big spot (decor/Decor.tsx draws it there): a backboard on the wall with its painted
// square, an orange rim and a white net that stretches after a basket, a scoreboard over it, and a rack of balls on the
// floor under it. E at it takes a ball: it sits low in front of you, a held mouse winds up and letting go shoots (an
// arcade shot through games/hoopPhysics.ts that drops a well-judged throw in), and a new ball comes to hand a moment later.
// Workers on the hoops errand (gameErrands.ts) take a ball from the rack and shoot too; their shots aren't your score.
// The balls fly on hoopPhysics.ts's little simulation, stepped here at its own rate whatever the frame rate. Everything is in
// the hoop's frame: the wall at z 0, the room towards +z.
// Adapted from cubefarm client/src/world/toys/Hoop.tsx and toys/balls.tsx (MIT): the board, the net, the confetti, the
// scoreboard and the basketball's look; Rapier, the colliders and the per-floor best in browser storage are cut.
import { memo, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store';
import { ballBounce, ballGrab, boardThud, netSwish, rimClank, throwWhoosh } from '../../ui/gameSfx';
import { parseBodyStyle } from '../bodyStyle';
import { useCanvasTexture } from '../canvasTexture';
import { ITEM_SIZE, wallFoot } from '../decor/spots';
import { roundRect, SANS } from '../draw';
import { useInteractable } from '../interact';
import { HALF_D, HALF_W } from '../layout';
import { toon } from '../materials';
import { INK, Outlines } from '../Outlines';
import { bodyState } from '../people';
import { playerAt } from '../rig';
import { useView } from '../view';
import './probe';
import { chargeNow, closeCourt, countShot, gamesChanged, heldGame, hoopTally, makeLine, openCourt, PLAYER, setToyHand, styleTall, takeThrow } from './gameState';
import {
  BALL_STEP,
  courtIn,
  dirToLocal,
  HOLD,
  holdPoint,
  HOOP,
  hoopRim,
  hoopShot,
  hoopSquare,
  idealPower,
  newBall,
  npcHoldPoint,
  RIM_OUT,
  stepBall,
  throwVelocity,
  toLocal,
  toWorld,
  type Ball,
  type BallHit,
  type HoopPlace,
  type Vec3,
} from './hoopPhysics';

const RIM_COLOR = '#ff7b00';
const SQUARE_COLOR = '#e63946';
/** A new ball comes to the player's hands this long (ms) after a shot. */
const RELOAD_MS = 900;
/** Balls in the air at once; a shot past that takes the oldest. */
const POOL = 4;
/** The rack under the hoop: its size and its shelf's height. */
const RACK = { w: 0.8, d: 0.4, h: 0.5 };

/** The basketball: orange with black seams. */
export function BasketballLook({ r }: { r: number }) {
  const seam = toon(INK);
  const tube = r * 0.05;
  return (
    <group>
      <mesh castShadow material={toon('#f3722c')}>
        <sphereGeometry args={[r, 24, 16]} />
        <Outlines thickness={0.012} color={INK} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={seam}>
        <torusGeometry args={[r * 1.004, tube, 6, 40]} />
      </mesh>
      <mesh material={seam}>
        <torusGeometry args={[r * 1.004, tube, 6, 40]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * r * 0.6, 0, 0]} rotation={[0, Math.PI / 2, 0]} material={seam}>
          <torusGeometry args={[r * 0.8 * 1.006, tube, 6, 32]} />
        </mesh>
      ))}
    </group>
  );
}

let netMat: THREE.MeshBasicMaterial | null = null;
/** A white diamond mesh on a transparent canvas, wrapped round an open cone. */
function netMaterial() {
  if (netMat) return netMat;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(64, 64);
  ctx.moveTo(64, 0);
  ctx.lineTo(0, 64);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 3);
  netMat = new THREE.MeshBasicMaterial({ map: tex, color: '#f1f3f5', alphaTest: 0.5, side: THREE.DoubleSide });
  return netMat;
}

/** Seconds since the last basket (from performance.now()), or Infinity before the first. */
const since = (burst: RefObject<number>) => (burst.current < 0 ? Infinity : (performance.now() - burst.current) / 1000);

/** The net hangs from the rim and stretches and sways after a basket. */
function Net({ burst }: { burst: RefObject<number> }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    const grp = g.current;
    if (!grp) return;
    const t = since(burst);
    if (t > 2.5) {
      if (grp.scale.y !== 1) {
        grp.scale.set(1, 1, 1);
        grp.rotation.set(0, 0, 0);
      }
      return;
    }
    const s = Math.exp(-3 * t);
    const pull = Math.sin(t * 12) * s;
    grp.scale.set(1 - 0.16 * pull, 1 + 0.4 * pull, 1 - 0.16 * pull);
    grp.rotation.set(0.2 * s * Math.sin(t * 9), 0, 0.12 * s * Math.sin(t * 7));
  });
  const { h, bottomR } = HOOP.net;
  return (
    <group ref={g} position={[0, HOOP.rim.y, RIM_OUT]}>
      <mesh position={[0, -h / 2, 0]} material={netMaterial()}>
        <cylinderGeometry args={[HOOP.rim.r, bottomR, h, 24, 1, true]} />
      </mesh>
    </group>
  );
}

const CONFETTI = 42;
const CONFETTI_S = 1.8;
const CONFETTI_COLORS = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#ff9f1c', '#9b5de5'];

/** A small burst of paper bits from the rim after a basket. */
function Confetti({ burst }: { burst: RefObject<number> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const bits = useMemo(() => Array.from({ length: CONFETTI }, () => ({ v: new THREE.Vector3(), spin: new THREE.Vector3() })), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const started = useRef(-1);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new THREE.Color();
    for (let i = 0; i < CONFETTI; i++) m.setColorAt(i, c.set(CONFETTI_COLORS[i % CONFETTI_COLORS.length]));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const t = since(burst);
    if (t > CONFETTI_S) {
      if (m.visible) m.visible = false;
      return;
    }
    if (started.current !== burst.current) {
      started.current = burst.current;
      for (const b of bits) {
        const a = Math.random() * Math.PI * 2;
        const out = 0.6 + Math.random() * 1.6;
        b.v.set(Math.cos(a) * out, 1.2 + Math.random() * 2, Math.sin(a) * out + 0.8);
        b.spin.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
      }
    }
    m.visible = true;
    const fade = Math.min(1, (CONFETTI_S - t) / 0.4);
    for (let i = 0; i < CONFETTI; i++) {
      const b = bits[i];
      // paper drifts, so a light gravity and no bounce; it stops at the floor
      dummy.position.set(b.v.x * t, Math.max(0.02 - HOOP.rim.y, b.v.y * t - 2.2 * t * t), b.v.z * t);
      dummy.rotation.set(b.spin.x * t, b.spin.y * t, b.spin.z * t);
      dummy.scale.setScalar(fade);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, CONFETTI]} position={[0, HOOP.rim.y - 0.05, RIM_OUT]} visible={false} frustumCulled={false}>
      <planeGeometry args={[0.06, 0.035]} />
      <meshBasicMaterial side={THREE.DoubleSide} toneMapped={false} />
    </instancedMesh>
  );
}

/** The scoreboard over the board: who shot last and how they're doing, in amber on black. */
function Scoreboard({ text }: { text: string }) {
  const { w, h, bottom } = HOOP.score;
  const tex = useCanvasTexture(
    640,
    164,
    (ctx) => {
      roundRect(ctx, 0, 0, 640, 164, 22);
      ctx.fillStyle = '#15151f';
      ctx.fill();
      let size = 80;
      ctx.font = `700 ${size}px ${SANS}`;
      while (size > 30 && ctx.measureText(text).width > 640 - 48) ctx.font = `700 ${(size -= 4)}px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd166';
      ctx.fillText(text, 320, 86);
    },
    [text],
  );
  return (
    <group position={[0, bottom + h / 2, HOOP.standoff + HOOP.board.t / 2]}>
      <mesh material={toon('#2b2d42')}>
        <boxGeometry args={[w, h, 0.06]} />
        <Outlines thickness={0.015} color={INK} />
      </mesh>
      <mesh position={[0, 0, 0.031]}>
        <planeGeometry args={[w - 0.05, h - 0.05]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** The board on its brackets, its painted border and square, and the rim on its plate. */
const Board = memo(function Board() {
  const { standoff, board, square, rim } = HOOP;
  const face = standoff + board.t + 0.003;
  const bar = 0.035;
  const sq = { cy: rim.y + square.h / 2, w: square.w, h: square.h };
  return (
    <group>
      {/* wall brackets */}
      {[-0.4, 0.4].flatMap((x) =>
        [2.72, 3.05].map((y) => (
          <mesh key={`${x}${y}`} position={[x, y, standoff / 2]} material={toon('#8d99ae')}>
            <boxGeometry args={[0.05, 0.05, standoff]} />
          </mesh>
        )),
      )}
      <mesh position={[0, board.bottom + board.h / 2, standoff + board.t / 2]} material={toon('#fdfdfd')} castShadow>
        <boxGeometry args={[board.w, board.h, board.t]} />
        <Outlines thickness={0.015} color={INK} />
      </mesh>
      {[
        [0, board.bottom + board.h - bar / 2, board.w - 0.04, bar],
        [0, board.bottom + bar / 2, board.w - 0.04, bar],
        [-(board.w / 2 - 0.02 - bar / 2), board.bottom + board.h / 2, bar, board.h - 0.04],
        [board.w / 2 - 0.02 - bar / 2, board.bottom + board.h / 2, bar, board.h - 0.04],
        [0, sq.cy + sq.h / 2 - bar / 2, sq.w, bar],
        [0, sq.cy - sq.h / 2 + bar / 2, sq.w, bar],
        [-(sq.w / 2 - bar / 2), sq.cy, bar, sq.h],
        [sq.w / 2 - bar / 2, sq.cy, bar, sq.h],
      ].map(([x, y, w, h], i) => (
        <mesh key={i} position={[x, y, face]} material={toon(SQUARE_COLOR)}>
          <boxGeometry args={[w, h, 0.004]} />
        </mesh>
      ))}
      <mesh position={[0, rim.y, standoff + board.t + rim.gap / 2]} material={toon(RIM_COLOR)}>
        <boxGeometry args={[0.14, 0.025, rim.gap + 0.02]} />
      </mesh>
      <mesh position={[0, rim.y, RIM_OUT]} rotation={[Math.PI / 2, 0, 0]} material={toon(RIM_COLOR)} castShadow>
        <torusGeometry args={[rim.r, rim.tube, 8, 40]} />
        <Outlines thickness={0.008} color={INK} />
      </mesh>
    </group>
  );
});

/** The rack of balls under the hoop: a little steel cart in the floor's colour with two balls on it (one fewer while one's in use). */
function Rack({ color, inUse }: { color: string; inUse: RefObject<THREE.Group | null> }) {
  const legs: [number, number][] = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  const r = HOOP.ball.r;
  return (
    <group position={[0, 0, ITEM_SIZE.hoop.d / 2]}>
      {legs.map(([sx, sz]) => (
        <mesh key={`${sx}${sz}`} position={[sx * (RACK.w / 2 - 0.03), RACK.h / 2, sz * (RACK.d / 2 - 0.03)]} material={toon('#adb5bd')}>
          <cylinderGeometry args={[0.018, 0.018, RACK.h, 8]} />
        </mesh>
      ))}
      <mesh position={[0, RACK.h, 0]} material={toon(color)} castShadow>
        <boxGeometry args={[RACK.w, 0.04, RACK.d]} />
        <Outlines thickness={0.01} color={INK} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, RACK.h + 0.06, s * (RACK.d / 2 - 0.02)]} material={toon('#adb5bd')}>
          <boxGeometry args={[RACK.w, 0.025, 0.02]} />
        </mesh>
      ))}
      <group position={[-0.19, RACK.h + 0.02 + r, 0]}>
        <BasketballLook r={r} />
      </group>
      <group ref={inUse} position={[0.19, RACK.h + 0.02 + r, 0]}>
        <BasketballLook r={r} />
      </group>
    </group>
  );
}

/** A ball in the air, whose it is, and whether its shot has been told yet. */
interface Flying {
  ball: Ball;
  who: string;
  told: boolean;
}

const v3 = (): Vec3 => ({ x: 0, y: 0, z: 0 });

/** The hoop in big spot `spot` of floor `floorId`, its rack in the floor's colour `color`. */
export const Hoop = memo(function Hoop({ spot, floorId, color }: { spot: string; floorId: string; color: string }) {
  const place = useMemo<HoopPlace>(() => wallFoot(spot) ?? { x: 0, z: 0, rotY: 0 }, [spot]);
  const court = useMemo(() => openCourt(spot, place), [spot, place]);
  useLayoutEffect(() => {
    openCourt(spot, place, court); // this one, back again after a remount
    return () => closeCourt(spot);
  }, [spot, place, court]);
  const mine = useView((s) => s.held?.kind === 'game' && s.held.game === 'hoop' && s.held.spot === spot);
  // E anywhere on the hoop or its rack takes a ball, from as far as the free-throw spot
  const target = useInteractable<THREE.Group>(mine ? null : { id: `hoop:${spot}`, label: 'Shoot hoops', action: { kind: 'hoop', spot } }, 4.6);
  const burst = useRef(-1);
  const rackBall = useRef<THREE.Group>(null);
  const held = useRef<THREE.Group>(null);
  const pool = useRef<(THREE.Group | null)[]>([]);
  const [board, setBoard] = useState('SHOOT HOOPS');
  const sim = useMemo(
    () => ({
      flying: [] as Flying[],
      acc: 0,
      court: courtIn(place, HALF_W, HALF_D),
      rim: hoopRim(place),
      aim: { rim: hoopRim(place), square: hoopSquare(place) },
      hits: [] as BallHit[],
      // a worker's shots this visit, for the scoreboard
      npc: new Map<string, { shots: number; makes: number }>(),
      hand: v3(),
      local: v3(),
      world: v3(),
      v: v3(),
    }),
    [place],
  );

  /** What the scoreboard says after a shot by `who`. */
  const tell = (who: string, made: boolean, swish: boolean) => {
    court.last = { who, made, swish, at: performance.now() };
    if (who === PLAYER) {
      const t = countShot(floorId, spot, made);
      if (made) useView.getState().showToast(makeLine(t, swish));
      setBoard(`YOU ${t.makes}/${t.shots}  ·  BEST ${t.best}`);
    } else {
      const n = sim.npc.get(who) ?? { shots: 0, makes: 0 };
      n.shots++;
      if (made) n.makes++;
      sim.npc.set(who, n);
      const name = (useStore.getState().workers[who]?.name ?? 'Them').toUpperCase();
      setBoard(`${name} ${n.makes}/${n.shots}`);
    }
    gamesChanged();
  };

  const launch = (who: string, from: Vec3, v: Vec3) => {
    if (sim.flying.length >= POOL) sim.flying.shift();
    sim.flying.push({ ball: newBall(toLocal(place, from, v3()), dirToLocal(place, v, v3())), who, told: false });
    throwWhoosh(from, Math.min(1, Math.hypot(v.x, v.y, v.z) / HOOP.ball.throwSpeed));
  };

  useFrame(({ camera }, delta) => {
    const now = performance.now();
    const view = useView.getState();
    const tall = styleTall(parseBodyStyle(useStore.getState().settings.bodyStyle));
    const g = heldGame(view.held);
    const yours = g?.game === 'hoop' && g.spot === spot;
    let show: Vec3 | null = null;

    // ---------- the ball in someone's hands ----------
    if (yours) {
      court.holder = PLAYER;
      const yaw = camera.rotation.y;
      const pitch = camera.rotation.x;
      const power = chargeNow(now) ?? 0;
      if (view.person === 'third') {
        // following behind you: held in front of your middle, dipping a little as you wind up
        npcHoldPoint({ x: playerAt.x, z: playerAt.z, heading: yaw }, 'carry', tall, power * 0.15, sim.hand);
      } else {
        holdPoint({ eye: camera.position, yaw, pitch }, HOOP.ball.r, power * HOLD.windUp, sim.hand);
      }
      court.ideal = idealPower(sim.hand, sim.rim);
      const shot = takeThrow('hoop', spot, now);
      if (shot !== null && court.reloadUntil <= now) {
        // aimed along the crosshair, from the camera wherever it is; thrown from where the ball is held
        const look = { eye: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, yaw, pitch };
        if (!hoopShot(look, sim.hand, shot, HOOP.ball.throwSpeed, sim.aim, sim.v)) throwVelocity(look, sim.hand, shot, HOOP.ball.throwSpeed, sim.v);
        launch(PLAYER, sim.hand, sim.v);
        court.reloadUntil = now + RELOAD_MS;
        gamesChanged();
      }
      if (court.reloadUntil <= now) show = sim.hand;
      // following behind you, your hand on it (in your eyes, the ball floats in view on its own: the arm is behind you)
      setToyHand(PLAYER, show && view.person === 'third' ? { x: show.x + Math.cos(yaw) * HOOP.ball.r * 0.8, y: show.y - HOOP.ball.r * 0.3, z: show.z - Math.sin(yaw) * HOOP.ball.r * 0.8 } : null);
    } else if (court.holder === PLAYER) court.holder = null;
    if (court.holder && court.holder !== PLAYER) {
      const s = bodyState(court.holder);
      if (!s || s.stage !== 'up') {
        setToyHand(court.holder, null);
        court.holder = null;
      } else {
        npcHoldPoint({ x: s.x, z: s.z, heading: s.heading }, court.pose, tall, court.dip, sim.hand);
        show = sim.hand;
        // the right hand under and behind the ball's right side
        setToyHand(court.holder, { x: sim.hand.x + Math.cos(s.heading) * HOOP.ball.r * 0.85, y: sim.hand.y - HOOP.ball.r * 0.2, z: sim.hand.z - Math.sin(s.heading) * HOOP.ball.r * 0.85 });
      }
    }
    for (const t of court.throws.splice(0)) launch(t.who, t.from, t.v);

    // ---------- the balls in the air ----------
    sim.acc = Math.min(sim.acc + Math.min(delta, 0.1), 0.1);
    while (sim.acc >= BALL_STEP) {
      sim.acc -= BALL_STEP;
      for (let i = sim.flying.length - 1; i >= 0; i--) {
        const f = sim.flying[i];
        sim.hits.length = 0;
        const done = stepBall(f.ball, BALL_STEP, sim.court, sim.hits);
        for (const h of sim.hits) {
          toWorld(place, f.ball.p, sim.world);
          const at = { ...sim.world };
          if (h.what === 'basket') {
            burst.current = now;
            netSwish(at, !f.ball.touched);
            if (!f.told) tell(f.who, true, !f.ball.touched);
            f.told = true;
          } else if (h.what === 'rim') rimClank(at, h.speed);
          else if (h.what === 'board') boardThud(at, h.speed);
          else {
            ballBounce(at, h.speed);
            // down on the floor without going in: a miss
            if (h.what === 'floor' && !f.told) {
              tell(f.who, false, false);
              f.told = true;
            }
          }
        }
        if (done) {
          if (!f.told) tell(f.who, f.ball.scored, f.ball.scored && !f.ball.touched);
          sim.flying.splice(i, 1);
        }
      }
    }

    // ---------- drawing them ----------
    if (held.current) {
      held.current.visible = !!show;
      if (show) held.current.position.copy(toLocal(place, show, sim.local));
    }
    if (rackBall.current) rackBall.current.visible = !court.holder;
    pool.current.forEach((m, i) => {
      if (!m) return;
      const f = sim.flying[i];
      m.visible = !!f;
      if (!f) return;
      m.position.set(f.ball.p.x, f.ball.p.y, f.ball.p.z);
      m.rotation.x -= Math.hypot(f.ball.v.x, f.ball.v.z) * Math.min(delta, 0.05) * 4;
    });
  });

  // the scoreboard starts with the player's own tally, if they've shot here before this visit
  useLayoutEffect(() => {
    const t = hoopTally(floorId, spot);
    if (t.shots) setBoard(`YOU ${t.makes}/${t.shots}  ·  BEST ${t.best}`);
  }, [floorId, spot]);
  // a ball taken off the rack sounds a pat of hands
  const holder = useRef<string | null>(null);
  useFrame(() => {
    if (court.holder && court.holder !== holder.current) ballGrab(toWorld(place, { x: 0.19, y: RACK.h, z: ITEM_SIZE.hoop.d / 2 }, v3()));
    holder.current = court.holder;
  });

  return (
    <group position={[0, 0, -ITEM_SIZE.hoop.d / 2]}>
      <group ref={target}>
        <Board />
        <Rack color={color} inUse={rackBall} />
        {/* a roomy box round the board and the rack, for E: the rim alone is a small target */}
        <mesh position={[0, 1.6, 0.5]}>
          <boxGeometry args={[1.3, 3.2, 1.0]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      </group>
      <Net burst={burst} />
      <Confetti burst={burst} />
      <Scoreboard text={board} />
      <group ref={held} visible={false}>
        <BasketballLook r={HOOP.ball.r} />
      </group>
      {Array.from({ length: POOL }, (_, i) => (
        <group
          key={i}
          ref={(m) => {
            pool.current[i] = m;
          }}
          visible={false}
        >
          <BasketballLook r={HOOP.ball.r} />
        </group>
      ))}
    </group>
  );
});
