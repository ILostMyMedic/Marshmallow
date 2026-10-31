// Adapted from cubefarm client/src/world/Desk.tsx (MIT): the desk, its monitor showing the worker's live terminal, the
// keyboard, the mug, the chair, the worker and their name tag. Hiring at a vacant desk and approvals are cut.
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { Worker } from '../../../shared/types';
import { useStore } from '../store';
import { ActivityIcon } from './ActivityIcon';
import { seededAppearance } from './appearance';
import { look, Part } from './Batched';
import { useCanvasTexture } from './canvasTexture';
import { Character } from './Character';
import { greetPick } from './Chatter';
import { drawSign, drawTag, drawTerminal, tagIcon } from './draw';
import { useInteractable } from './interact';
import { shade } from './materials';
import { MUG_SIZE, MugLook, mugColor } from './mugLook';
import { deskMug, subscribeMugs } from './people';
import { Ball, Box, Cyl } from './Toon';
import { useView } from './view';

const SCREEN = { w: 1.0, h: 0.6, px: 640, py: 384 };
const WOOD = '#f1d19b';

/**
 * The live terminal texture for one worker's monitor, painted on the main thread from their log: when it changes, or
 * every 200 ms while they work, at most every 120 ms; further than 8 m only every 900 ms, and past 16 m not at all.
 */
function useTerminalTexture(worker: Worker, anchor: RefObject<THREE.Object3D | null>) {
  const camera = useThree((s) => s.camera);
  const made = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = SCREEN.px;
    canvas.height = SCREEN.py;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { ctx: canvas.getContext('2d')!, texture };
  }, []);
  useEffect(() => () => made.texture.dispose(), [made]);
  const dirty = useRef(true);
  const lastPaint = useRef(0);
  const latest = useRef(worker);
  latest.current = worker;
  useEffect(() => {
    dirty.current = true;
  }, [worker]);
  useEffect(() => useStore.subscribe((s, prev) => void (s.logs[worker.id] !== prev.logs[worker.id] && (dirty.current = true))), [worker.id]);
  useEffect(() => void document.fonts?.ready.then(() => (dirty.current = true)), []);

  const at = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const now = performance.now();
    const w = latest.current;
    const logs = useStore.getState().logs[w.id] ?? [];
    const animating = w.status === 'working' || w.status === 'preparing' || logs.length <= 1;
    if (!dirty.current && !(animating && now - lastPaint.current > 200)) return;
    if (anchor.current) {
      anchor.current.getWorldPosition(at);
      const dist = at.distanceTo(camera.position);
      if (dist > 16 && lastPaint.current !== 0) return;
      if (dist > 8 && now - lastPaint.current < 900) return;
    }
    if (now - lastPaint.current < 120) return;
    lastPaint.current = now;
    dirty.current = false;
    drawTerminal(made.ctx, SCREEN.px, SCREEN.py, w, logs, Date.now());
    made.texture.needsUpdate = true;
  });
  return made.texture;
}

/** A worker's name tag, always facing the camera; the overview has their status chip instead (OverviewChips.tsx). */
export function NameTag({ worker, color }: { worker: Worker; color: string }) {
  const task = worker.task;
  const tex = useCanvasTexture(512, 96, (ctx) => drawTag(ctx, 512, 96, worker, color), [worker.name, worker.status, worker.role, task?.kind, task?.issueNumber, task?.prNumber, tagIcon(worker), color]);
  const tag = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (tag.current) tag.current.visible = useView.getState().mode !== 'overview';
  });
  return (
    <Billboard>
      <mesh ref={tag}>
        <planeGeometry args={[1.15, 0.216]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </Billboard>
  );
}

const MONITOR = { y: 1.31, z: -0.3, tilt: -0.06 };
const BEZEL = '#2b2d42';
const STAND = '#3d4152';
// Shapes every desk shares.
const LOGO = look(new THREE.CircleGeometry(0.06, 24), { shading: 'glow' });
const LED = look(new THREE.CircleGeometry(0.008, 10), { shading: 'glow' });
const PAD = look(new THREE.PlaneGeometry(0.24, 0.2));
const MOUSE = look(new THREE.SphereGeometry(0.05, 14, 10), { castShadow: true });

/** Desktop monitor on a slim stand, set back on the desk so it stays readable over the worker's head. */
function Monitor({ accent, children }: { accent: string; children: ReactNode }) {
  return (
    <group>
      <Cyl r={0.17} rTop={0.15} h={0.025} position={[0, 0.782, MONITOR.z - 0.04]} color={STAND} outline />
      <Box size={[0.07, 0.36, 0.05]} position={[0, 0.95, MONITOR.z - 0.07]} color={STAND} outline />
      <group position={[0, MONITOR.y, MONITOR.z]} rotation={[MONITOR.tilt, 0, 0]}>
        <Box size={[SCREEN.w + 0.07, SCREEN.h + 0.07, 0.05]} color={BEZEL} outline />
        <Box size={[0.6, 0.36, 0.07]} position={[0, 0, -0.055]} color={STAND} />
        {children}
        <Part look={LOGO} color={accent} position={[0, 0, -0.091]} rotation={[0, Math.PI, 0]} />
        <Part look={LED} color="#7CFFB2" position={[SCREEN.w / 2 - 0.02, -SCREEN.h / 2 - 0.018, 0.026]} />
      </group>
    </group>
  );
}

/** A little cloud on a Box worker's monitor: their machine is an Upstash Box, not this desk's. */
function CloudPuff() {
  const x = SCREEN.w / 2 - 0.08;
  const y = MONITOR.y + SCREEN.h / 2 + 0.07;
  return (
    <group position={[x, y, MONITOR.z]}>
      <Ball r={0.045} position={[-0.045, 0, 0]} color="#ffffff" outline />
      <Ball r={0.06} position={[0.01, 0.025, 0]} color="#ffffff" outline />
      <Ball r={0.042} position={[0.065, -0.003, 0]} color="#eaf3ff" outline />
    </group>
  );
}

/** A Box worker whose Claude Code waits to be signed in: a sticky note on their monitor's corner. */
function SignInNote() {
  const note = useCanvasTexture(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = '#ffe066';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#f5c400';
      ctx.fillRect(0, 0, 256, 34); // the sticky strip
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '84px sans-serif';
      ctx.fillText('🔑', 128, 104);
      ctx.fillStyle = '#1f1d2b';
      ctx.font = 'bold 34px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('Sign me in!', 128, 184);
    },
    [],
  );
  return (
    <group position={[0, MONITOR.y, MONITOR.z]} rotation={[MONITOR.tilt, 0, 0]}>
      <mesh position={[SCREEN.w / 2 - 0.14, SCREEN.h / 2 - 0.12, 0.034]} rotation={[0, 0, -0.1]}>
        <planeGeometry args={[0.22, 0.22]} />
        <meshBasicMaterial map={note} toneMapped={false} />
      </mesh>
    </group>
  );
}

function LiveMonitor({ worker, accent }: { worker: Worker; accent: string }) {
  const screen = useRef<THREE.Mesh>(null);
  const tex = useTerminalTexture(worker, screen);
  return (
    <Monitor accent={accent}>
      <mesh ref={screen} position={[0, 0, 0.026]}>
        <planeGeometry args={[SCREEN.w, SCREEN.h]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </Monitor>
  );
}

/** An empty desk's screen. */
function VacantMonitor({ accent }: { accent: string }) {
  const tex = useCanvasTexture(
    640,
    384,
    (ctx) => {
      ctx.fillStyle = '#151621';
      ctx.fillRect(0, 0, 640, 384);
      drawSign(
        ctx,
        640,
        384,
        [
          { text: '🪑', size: 70 },
          { text: 'VACANT', size: 70, color: '#ffd6a5' },
        ],
        'rgba(0,0,0,0)',
      );
    },
    [],
  );
  return (
    <Monitor accent={accent}>
      <mesh position={[0, 0, 0.026]}>
        <planeGeometry args={[SCREEN.w, SCREEN.h]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </Monitor>
  );
}

// Every keyboard is the same picture: painted once, on one material all of them share.
let keys: THREE.Material | null = null;
function keyboardKeys() {
  if (keys) return keys;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 176;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#d7dbe3';
  ctx.fillRect(0, 0, 512, 176);
  [14, 13, 12, 11].forEach((n, r) => {
    const kw = (496 - (n - 1) * 5) / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = r === 0 && (i === 0 || i === n - 1) ? '#ffb4a2' : '#ffffff';
      ctx.beginPath();
      ctx.roundRect(8 + i * (kw + 5), 8 + r * 34, kw, 28, 6);
      ctx.fill();
    }
  });
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(130, 144, 252, 26, 6);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  keys = new THREE.MeshToonMaterial({ map: tex });
  return keys;
}
const KEYS_GEOMETRY = new THREE.PlaneGeometry(0.5, 0.17);

function Keyboard() {
  return (
    <group position={[0, 0.77, 0.27]}>
      <Box size={[0.52, 0.03, 0.18]} position={[0, 0.015, 0]} color="#c3c8d3" outline />
      <mesh geometry={KEYS_GEOMETRY} material={keyboardKeys()} position={[0, 0.031, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      {/* mouse + pad */}
      <Part look={PAD} color="#3d4152" position={[0.46, 0.002, 0.02]} rotation={[-Math.PI / 2, 0, 0]} />
      <Part look={MOUSE} color="#f4f4f8" position={[0.46, 0.022, 0.02]} scale={[0.75, 0.5, 1]} />
    </group>
  );
}

/** The mug on the desk; for a while after a coffee run, the coffee they brought back, full and steaming. */
function DeskMug({ workerId, color }: { workerId: string; color: string }) {
  const coffee = useSyncExternalStore(subscribeMugs, () => deskMug(workerId));
  const [, expire] = useState(0);
  useEffect(() => {
    if (!coffee) return;
    const t = setTimeout(() => expire((n) => n + 1), Math.max(0, coffee.until - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [coffee]);
  const fresh = coffee && coffee.until > Date.now() ? coffee : null;
  if (!fresh) return <Cyl r={0.045} h={0.1} color={color} outline />;
  return (
    // the parent group sits at the plain mug's centre, 0.82 (desk top 0.77 plus half its height)
    <group position={[0, MUG_SIZE.h / 2 - 0.05, 0]} rotation={[0, Math.PI / 2, 0]}>
      <MugLook color={mugColor(fresh.id)} sips={fresh.sips} />
    </group>
  );
}

// ---------- the CEO's desk and chair ----------

const WALNUT = '#6b4226';
const BRASS = '#d4a017';
const LEATHER = '#3b2a24';

/** The CEO's desk: a wide walnut top on solid pedestals, brass trim along its front, a banker's lamp and a nameplate. */
function ExecDesk() {
  return (
    <group>
      <Box size={[2.8, 0.06, 1.2]} position={[0, 0.74, 0]} color={WALNUT} outline />
      <Box size={[2.82, 0.025, 0.02]} position={[0, 0.735, -0.61]} color={BRASS} shadow={false} />
      {[-1.18, 1.18].map((x) => (
        <Box key={x} size={[0.42, 0.71, 1.1]} position={[x, 0.355, 0]} color={shade(WALNUT, -0.12)} outline />
      ))}
      {/* the front panel, facing whoever comes in, with a brass inlay */}
      <Box size={[1.94, 0.55, 0.04]} position={[0, 0.42, -0.53]} color={shade(WALNUT, -0.06)} outline />
      <Box size={[1.2, 0.03, 0.01]} position={[0, 0.5, -0.555]} color={BRASS} shadow={false} />
      {/* the banker's lamp: brass stem, green glass shade */}
      <group position={[-1.05, 0.77, -0.25]}>
        <Cyl r={0.08} h={0.03} position={[0, 0.015, 0]} color={BRASS} outline />
        <Cyl r={0.012} h={0.3} position={[0, 0.17, 0]} color={BRASS} />
        <Box size={[0.36, 0.08, 0.14]} position={[0, 0.33, 0.04]} rotation={[0.25, 0, 0]} color="#1b7f4b" outline />
      </group>
      {/* the nameplate at the desk's front edge, and a pen pot */}
      <Box size={[0.42, 0.07, 0.08]} position={[0.55, 0.805, -0.48]} rotation={[-0.35, 0, 0]} color={BRASS} outline />
      <Cyl r={0.04} h={0.11} position={[1.1, 0.825, -0.3]} color="#2b2d42" outline />
    </group>
  );
}

/** The CEO's chair: a high back in dark leather with a headrest and arms, on a chrome star. */
function ExecChair() {
  return (
    <group>
      <Box size={[0.62, 0.12, 0.58]} position={[0, 0.46, 0]} color={LEATHER} outline />
      <Box size={[0.6, 0.86, 0.12]} position={[0, 0.94, 0.3]} rotation={[-0.08, 0, 0]} color={LEATHER} outline />
      <Box size={[0.42, 0.18, 0.14]} position={[0, 1.43, 0.34]} rotation={[-0.08, 0, 0]} color={shade(LEATHER, 0.08)} outline />
      {[-0.34, 0.34].map((x) => (
        <Box key={x} size={[0.08, 0.06, 0.48]} position={[x, 0.66, 0.02]} color={shade(LEATHER, -0.1)} outline />
      ))}
      <Cyl r={0.04} h={0.36} position={[0, 0.22, 0]} color="#c9ced6" />
      <Cyl r={0.3} h={0.04} position={[0, 0.03, 0]} color="#c9ced6" />
    </group>
  );
}

/**
 * One desk, with its worker or empty. Memoised: the floor re-renders on every worker event, and without this every
 * desk, person and monitor on it would re-render with it. Give it stable props (a position that isn't a new array).
 * `exec`: the CEO's desk and chair.
 */
export const Desk = memo(function Desk({ worker, accent, position, rotationY = 0, exec = false }: { worker: Worker | null; accent: string; position: [number, number, number]; rotationY?: number; exec?: boolean }) {
  const shirt = useMemo(() => (worker ? seededAppearance({ seed: worker.seed, role: worker.role }).shirt : '#ffffff'), [worker?.seed, worker?.role]);
  // E on the desk: their terminal (where a Box worker's sign-in runs too); E on them, when they've nothing to do: say hi
  const hello = useMemo(() => (worker ? greetPick(worker.id, 'for their terminal') : undefined), [worker?.id]);
  const ref = useInteractable<THREE.Group>(
    worker ? { id: `worker-${worker.id}`, label: worker.needsSignIn ? `Sign ${worker.name}'s Claude Code in, in their terminal` : `View ${worker.name}'s terminal`, action: { kind: 'terminal', workerId: worker.id } } : null,
    3.6,
    hello,
  );
  const chairRef = useRef<THREE.Group>(null);
  const mugRef = useRef<THREE.Group>(null);
  return (
    <group ref={ref} position={position} rotation={[0, rotationY, 0]}>
      {exec ? (
        <ExecDesk />
      ) : (
        <>
          <Box size={[1.9, 0.06, 0.95]} position={[0, 0.74, 0]} color={WOOD} outline />
          {[
            [-0.88, -0.42],
            [0.88, -0.42],
            [-0.88, 0.42],
            [0.88, 0.42],
          ].map(([x, z]) => (
            <Box key={`${x}${z}`} size={[0.06, 0.71, 0.06]} position={[x, 0.355, z]} color="#5c677d" />
          ))}
          <Box size={[1.76, 0.4, 0.03]} position={[0, 0.5, -0.44]} color={shade(WOOD, -0.08)} />
        </>
      )}

      {worker ? (
        <>
          <LiveMonitor worker={worker} accent={accent} />
          {worker.host === 'box' && <CloudPuff />}
          {worker.needsSignIn && <SignInNote />}
          <Keyboard />
          {/* the mug: its owner picks it up for a sip now and then */}
          <group ref={mugRef} position={[0.76, 0.82, 0.02]}>
            <DeskMug workerId={worker.id} color={shade(shirt, 0.1)} />
          </group>
        </>
      ) : (
        <VacantMonitor accent={accent} />
      )}
      {!exec && (!worker || worker.role === 'ceo') && (
        <>
          <Cyl r={0.06} rTop={0.07} h={0.09} position={[-0.76, 0.815, -0.22]} color="#e07a5f" outline />
          <Ball r={0.09} position={[-0.76, 0.92, -0.22]} color="#52b788" outline />
        </>
      )}

      {/* chair: it rolls back while they're up */}
      <group ref={chairRef} position={[0, 0, worker ? 0.8 : 0.6]}>
        {exec ? (
          <ExecChair />
        ) : (
          <>
            <Box size={[0.52, 0.08, 0.5]} position={[0, 0.44, 0]} color={accent} outline />
            <Box size={[0.48, 0.42, 0.07]} position={[0, 0.72, 0.28]} color={accent} outline />
            <Cyl r={0.035} h={0.36} position={[0, 0.22, 0]} color="#444a5c" />
            <Cyl r={0.26} h={0.04} position={[0, 0.03, 0]} color="#444a5c" />
          </>
        )}
      </group>
      {worker && (
        <>
          <group position={[0, 0, 0.8]}>
            <Character key={worker.id} worker={worker} chair={chairRef} mug={mugRef}>
              <NameTag worker={worker} color={shirt} />
            </Character>
          </group>
          <ActivityIcon worker={worker} />
        </>
      )}
    </group>
  );
});
