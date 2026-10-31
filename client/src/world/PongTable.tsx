// Adapted from cubefarm client/src/world/PongTable.tsx (MIT): the table, its net, a cup of balls and the paddles hanging
// on its side, taken down while someone plays with them; the match itself is PongMatch.tsx's. The scoreboard and the
// leaderboard are cut.
import { memo, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { PONG_TABLE } from './layout';
import { toon } from './materials';
import { INK, Outlines } from './Outlines';
import { PongMatch } from './PongMatch';
import type { End } from './pongPhysics';
import { paddleTaken, subscribePong } from './pongState';
import { Box, Cyl } from './Toon';

const T = PONG_TABLE;
const TOP_T = 0.03; // the playing surface's thickness
const LINE = '#f8f9fa';
/** Regulation net (cubefarm toys/pongPhysics.ts PONG.net) and ball. */
const NET = { h: 0.1525, overhang: 0.1525 };
const BALL_R = 0.025;

/** A paddle: a red rubber face on a dark back, round, with a wooden handle below (or none, held by the arm). Faces -Z. */
export function PaddleLook({ handle = true }: { handle?: boolean }) {
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.004]} material={toon('#e63946')} castShadow>
        <cylinderGeometry args={[0.078, 0.078, 0.008, 24]} />
        <Outlines thickness={0.006} color={INK} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.004]} material={toon('#22223b')}>
        <cylinderGeometry args={[0.078, 0.078, 0.008, 24]} />
      </mesh>
      {handle && (
        <mesh position={[0, -0.115, 0]} material={toon('#d4a373')}>
          <boxGeometry args={[0.026, 0.085, 0.022]} />
        </mesh>
      )}
    </group>
  );
}

let netMat: THREE.MeshBasicMaterial | null = null;
/** A fine dark mesh with a solid white band along the top, on a transparent canvas. */
function netMaterial() {
  if (netMat) return netMat;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = 'rgba(30,30,40,0.85)';
  ctx.lineWidth = 1.2;
  for (let x = 0; x <= 256; x += 6) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 32);
    ctx.stroke();
  }
  for (let y = 4; y <= 32; y += 6) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#f8f9fa';
  ctx.fillRect(0, 0, 256, 5);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  netMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  return netMat;
}

/** A paddle on its hook on the table's south side near `end`, gone while someone plays with it. */
function HookPaddle({ end }: { end: End }) {
  const taken = useSyncExternalStore(subscribePong, () => paddleTaken(end));
  return (
    <group position={[T.x + (end === 'west' ? -1 : 1) * (T.len / 2 - 0.42), T.top - 0.16, T.z + T.wid / 2 + 0.025]} rotation={[0.08, Math.PI, 0]} visible={!taken}>
      <PaddleLook />
    </group>
  );
}

/** The ping-pong table in the play area: a blue top with white lines on a grey frame and legs, and the net. */
export const PongTable = memo(function PongTable() {
  const half = { x: T.len / 2, z: T.wid / 2 };
  const line = 0.02;
  const span = T.wid + NET.overhang * 2;
  return (
    <group>
      <group position={[T.x, 0, T.z]}>
        <mesh position={[0, T.top - TOP_T / 2, 0]} material={toon('#1d4e89')} castShadow receiveShadow>
          <boxGeometry args={[T.len, TOP_T, T.wid]} />
          <Outlines thickness={0.012} color={INK} />
        </mesh>
        {/* the white edges, and the centre line between the two halves of each side */}
        {[
          [0, half.z - line / 2, T.len, line],
          [0, -half.z + line / 2, T.len, line],
          [half.x - line / 2, 0, line, T.wid],
          [-half.x + line / 2, 0, line, T.wid],
          [0, 0, T.len, 0.006],
        ].map(([x, z, w, d], i) => (
          <mesh key={i} position={[x, T.top + 0.001, z]} material={toon(LINE)}>
            <boxGeometry args={[w, 0.002, d]} />
          </mesh>
        ))}
        {/* frame and legs */}
        <Box size={[T.len - 0.3, 0.08, T.wid - 0.3]} position={[0, T.top - TOP_T - 0.04, 0]} color="#495057" shadow={false} />
        {[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => <Box key={`${sx}${sz}`} size={[0.05, T.top - TOP_T, 0.05]} position={[sx * (half.x - 0.25), (T.top - TOP_T) / 2, sz * (half.z - 0.2)]} color="#343a40" />),
        )}
        {/* the net and its posts */}
        <mesh position={[0, T.top + NET.h / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={netMaterial()}>
          <planeGeometry args={[span, NET.h]} />
        </mesh>
        {[-1, 1].map((sz) => (
          <group key={sz}>
            <Box size={[0.03, NET.h + 0.02, 0.03]} position={[0, T.top + NET.h / 2, sz * (half.z + NET.overhang)]} color="#212529" />
            <Box size={[0.05, 0.03, 0.08]} position={[0, T.top - 0.005, sz * (half.z + 0.02)]} color="#212529" />
          </group>
        ))}
        {/* a cup of balls clipped to the table's north edge by the net */}
        <group position={[0.25, T.top - 0.03, -half.z - 0.05]}>
          <Cyl r={0.045} rTop={0.05} h={0.09} color="#adb5bd" outline />
          {[
            [-0.015, 0.05, 0.01],
            [0.017, 0.055, -0.008],
            [0, 0.075, 0.004],
          ].map(([x, y, z], i) => (
            <mesh key={i} position={[x, y, z]} material={toon('#ff9f1c')}>
              <sphereGeometry args={[BALL_R, 12, 10]} />
            </mesh>
          ))}
        </group>
      </group>
      <HookPaddle end="west" />
      <HookPaddle end="east" />
      <PongMatch />
    </group>
  );
});
