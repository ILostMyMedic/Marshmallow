// The lobby: the way in. The front desk faces you as you step out of the elevator, with Mia the guide behind it
// (TourGuide.tsx; E on the desk talks to her: ui/FrontDeskPanel.tsx); the company's name and a screen with today's
// news on the wall behind her; the floor directory by the elevator (E: the elevator's buttons); a trophy cabinet with
// a cup for each merge; a corner to sit in; rugs and plants.
// Adapted from cubefarm client/src/world/Lobby.tsx (MIT): the front desk, the directory and the trophy cabinet; the CEO's
// office (they have a floor of their own), mission control, the time-lapse screen, the kiosk, the waiting room and the
// jukebox are cut.
import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { useCanvasTexture } from './canvasTexture';
import { roundRect, SANS } from './draw';
import { kindOf, LOBBY, stops } from './floors';
import { useInteractable } from './interact';
import { DIRECTORY, HALF_D, LOBBY_COUCH, LOBBY_PLANTS, LOBBY_RUG, LOBBY_TABLE, RECEPTION, RECEPTION_CHAIR, TODAY_BOARD, TROPHIES } from './layout';
import { glow, shade, toon } from './materials';
import { INK } from './Outlines';
import { Outside } from './Outside';
import { CoffeeTable, Couch, Plant, Rug } from './Props';
import { Shell } from './Shell';
import { Ball, Box, Cyl } from './Toon';
import { todayStatus } from './tour';
import type * as THREE from 'three';

const ACCENT = '#ff8a5b';
const TILE = '#e9dfcf';
const WHITE = '#fbf8f2';

/** The front desk: a counter facing the way in, her side lower with a screen, a bell and flowers on the ledge. */
function FrontDesk() {
  const ref = useInteractable<THREE.Group>({ id: 'front-desk', label: 'Talk to Mia at the front desk', action: { kind: 'frontdesk' } }, 3.6);
  const { x, z, w, d } = RECEPTION;
  const sign = useCanvasTexture(
    768,
    160,
    (ctx) => {
      ctx.fillStyle = ACCENT;
      roundRect(ctx, 0, 0, 768, 160, 40);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 76px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('👋 Welcome!', 384, 84);
    },
    [],
  );
  return (
    <group ref={ref} position={[x, 0, z]}>
      {/* the counter's tall front (the visitors' side, +z) with a ledge on top, and the low desk behind it */}
      <Box size={[w, 1.05, 0.35]} position={[0, 0.525, d / 2 - 0.17]} color={WHITE} outline />
      <Box size={[w + 0.1, 0.06, 0.45]} position={[0, 1.08, d / 2 - 0.15]} color="#c68b59" outline />
      <Box size={[w, 0.06, 0.6]} position={[0, 0.74, -0.15]} color="#c68b59" outline />
      {[-w / 2 + 0.1, w / 2 - 0.1].map((dx) => (
        <Box key={dx} size={[0.12, 0.72, 0.6]} position={[dx, 0.36, -0.15]} color={WHITE} />
      ))}
      <mesh position={[0, 0.62, d / 2 + 0.012]}>
        <planeGeometry args={[1.9, 0.4]} />
        <meshBasicMaterial map={sign} toneMapped={false} />
      </mesh>
      {/* her screen, facing her (north side of the counter) */}
      <group position={[0.7, 0.77, 0.12]} rotation={[0, Math.PI, 0]}>
        <Box size={[0.06, 0.3, 0.05]} position={[0, 0.15, 0]} color="#3d4152" />
        <Box size={[0.75, 0.45, 0.04]} position={[0, 0.48, 0]} color="#2b2d42" outline />
        <mesh position={[0, 0.48, 0.022]} material={glow('#8ecae6')}>
          <planeGeometry args={[0.68, 0.38]} />
        </mesh>
      </group>
      {/* a bell and a vase of flowers on the ledge */}
      <group position={[-1.3, 1.11, d / 2 - 0.15]}>
        <Cyl r={0.07} h={0.015} position={[0, 0.008, 0]} color="#adb5bd" />
        <Ball r={0.06} position={[0, 0.04, 0]} scale={[1, 0.7, 1]} color="#ffd166" outline />
      </group>
      <group position={[1.6, 1.11, d / 2 - 0.15]}>
        <Cyl r={0.06} rTop={0.045} h={0.18} position={[0, 0.09, 0]} color="#bde0fe" outline />
        {['#ef476f', '#ffd166', '#f72585'].map((c, i) => (
          <Ball key={c} r={0.05} position={[(i - 1) * 0.05, 0.24 + (i % 2) * 0.04, 0]} color={c} />
        ))}
      </group>
      {/* her chair, behind the desk */}
      <group position={[RECEPTION_CHAIR.x - x, 0, RECEPTION_CHAIR.z - z]} rotation={[0, Math.PI, 0]}>
        <Box size={[0.52, 0.08, 0.5]} position={[0, 0.44, 0]} color={ACCENT} outline />
        <Box size={[0.48, 0.42, 0.07]} position={[0, 0.72, 0.28]} color={ACCENT} outline />
        <Cyl r={0.035} h={0.36} position={[0, 0.22, 0]} color="#444a5c" />
        <Cyl r={0.26} h={0.04} position={[0, 0.03, 0]} color="#444a5c" />
      </group>
    </group>
  );
}

/** Today in numbers, on a big screen on the wall behind the front desk, and the company's name over it. */
function TodayBoard() {
  const company = useStore((s) => s.settings.companyName) || 'Marshmallow';
  const today = useStore(useShallow((s) => todayStatus(s, Date.now())));
  const tiles: [string, string, string][] = [
    ['🎉', String(today.merged), 'merged today'],
    ['🚀', String(today.opened), 'PRs opened'],
    ['📋', String(today.filed), 'issues filed'],
    ['🔍', String(today.inQa), 'in QA'],
    ['🧑‍💻', `${today.working}/${today.team}`, 'at work'],
  ];
  const key = JSON.stringify([company, tiles]);
  const tex = useCanvasTexture(
    1280,
    440,
    (ctx) => {
      ctx.fillStyle = '#15151f';
      ctx.fillRect(0, 0, 1280, 440);
      ctx.fillStyle = '#7CFFB2';
      ctx.font = `700 54px ${SANS}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Today at ${company}`, 48, 64);
      const tw = (1280 - 48 * 2 - 24 * 4) / 5;
      tiles.forEach(([icon, n, label], i) => {
        const tx = 48 + i * (tw + 24);
        ctx.fillStyle = '#23263a';
        roundRect(ctx, tx, 128, tw, 268, 28);
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.font = `64px ${SANS}`;
        ctx.fillText(icon, tx + tw / 2, 186);
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 92px ${SANS}`;
        ctx.fillText(n, tx + tw / 2, 284);
        ctx.fillStyle = '#9aa0b8';
        ctx.font = `500 32px ${SANS}`;
        ctx.fillText(label, tx + tw / 2, 360);
        ctx.fillStyle = '#7CFFB2';
      });
    },
    [key],
  );
  const name = useCanvasTexture(
    1024,
    160,
    (ctx) => {
      ctx.fillStyle = INK;
      ctx.font = `700 110px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`✻ ${company}`, 512, 86);
    },
    [company],
  );
  const { w, h, y, z } = TODAY_BOARD;
  return (
    <group position={[0, 0, z]}>
      <Box size={[w + 0.16, h + 0.16, 0.08]} position={[0, y + h / 2, 0.02]} color="#2b2d42" outline />
      <mesh position={[0, y + h / 2, 0.065]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <mesh position={[0, y + h + 0.42, 0.02]}>
        <planeGeometry args={[4.4, 0.69]} />
        <meshBasicMaterial map={name} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

/** The floor directory by the elevator: every stop, top first, with what's there. E on it: the elevator's buttons. */
function Directory() {
  const ref = useInteractable<THREE.Group>({ id: 'directory', label: 'Choose a floor', action: { kind: 'elevator' } }, 3.2);
  const rows = useStore(
    useShallow((s) =>
      stops(s.floors).map((st) => {
        const f = s.floors.find((x) => x.floor === st.floor);
        const team = f ? Object.values(s.workers).filter((w) => w.floorId === f.id).length : 0;
        const kind = kindOf(st.floor);
        const note = kind === 'office' ? `${team} on the team` : kind === 'ceo' ? 'the CEO' : kind === 'roof' ? 'fireplace · views' : 'front desk';
        return `${st.key}|${kind === 'office' ? (st.name.split('/').pop() ?? st.name) : st.name}|${note}|${f?.color ?? (st.floor === LOBBY ? ACCENT : kind === 'ceo' ? '#9b5de5' : '#2a9d8f')}`;
      }),
    ),
  );
  const key = rows.join('\n');
  const tex = useCanvasTexture(
    512,
    560,
    (ctx) => {
      ctx.fillStyle = '#fffdf5';
      ctx.fillRect(0, 0, 512, 560);
      ctx.fillStyle = INK;
      ctx.font = `700 40px ${SANS}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('🏢 Directory', 28, 44);
      const shown = rows.slice(0, 8);
      const rh = Math.min(58, 460 / Math.max(1, shown.length));
      shown.forEach((r, i) => {
        const [k, name, note, color] = r.split('|');
        const ry = 100 + i * rh + rh / 2;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(52, ry, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 22px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.fillText(k, 52, ry + 1);
        ctx.textAlign = 'left';
        ctx.fillStyle = INK;
        ctx.font = `600 26px ${SANS}`;
        ctx.fillText(name.length > 18 ? `${name.slice(0, 17)}…` : name, 86, ry - 9);
        ctx.fillStyle = '#5c6078';
        ctx.font = `500 19px ${SANS}`;
        ctx.fillText(note, 86, ry + 15);
      });
    },
    [key],
  );
  const { x, w, h, y, z } = DIRECTORY;
  return (
    <group ref={ref} position={[x, y, z]} rotation={[0, Math.PI, 0]}>
      <Box size={[w + 0.12, h + 0.12, 0.06]} position={[0, h / 2, 0.02]} color="#c68b59" outline />
      <mesh position={[0, h / 2, 0.055]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** The trophy cabinet against the west wall: a gold cup for each merge on the floors' boards, up to eight. */
function TrophyCabinet() {
  const merged = useStore((s) => s.floors.reduce((n, f) => n + f.pulls.filter((p) => p.state === 'MERGED').length, 0));
  const { x, z, w, l, h } = TROPHIES;
  const label = useCanvasTexture(
    512,
    96,
    (ctx) => {
      ctx.fillStyle = INK;
      roundRect(ctx, 0, 0, 512, 96, 30);
      ctx.fill();
      ctx.fillStyle = '#ffd166';
      ctx.font = `700 46px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`🏆 ${merged} PR${merged === 1 ? '' : 's'} merged`, 256, 50);
    },
    [merged],
  );
  const cups = Math.min(8, merged);
  return (
    <group position={[x, 0, z]}>
      <Box size={[w, 0.12, l]} position={[0, 0.06, 0]} color={shade('#c68b59', -0.1)} outline />
      <Box size={[w, 0.06, l]} position={[0, h - 0.03, 0]} color={shade('#c68b59', -0.1)} outline />
      {[0.75, 1.4].map((sy) => (
        <Box key={sy} size={[w - 0.06, 0.03, l - 0.06]} position={[0, sy, 0]} color="#e3f2fd" shadow={false} />
      ))}
      <mesh position={[w / 2 - 0.02, h / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={toon('#cfe8ef', { transparent: true, opacity: 0.25 })}>
        <planeGeometry args={[l, h - 0.1]} />
      </mesh>
      {Array.from({ length: cups }, (_, i) => {
        const shelf = i < 4 ? 0.78 : 1.43;
        const cz = -l / 2 + 0.4 + (i % 4) * ((l - 0.8) / 3);
        return (
          <group key={i} position={[0, shelf, cz]}>
            <Cyl r={0.06} h={0.03} position={[0, 0.015, 0]} color="#7f5539" />
            <Cyl r={0.015} h={0.12} position={[0, 0.09, 0]} color="#e9c46a" />
            <Cyl r={0.05} rTop={0.09} h={0.13} position={[0, 0.21, 0]} color="#f7c548" outline />
          </group>
        );
      })}
      <mesh position={[w / 2 + 0.01, h + 0.25, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[1.5, 0.28]} />
        <meshBasicMaterial map={label} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

/** The lobby. `top` is the building's highest walled storey, for the facade above. */
export const Lobby = memo(function Lobby({ top }: { top: number }) {
  return (
    <group>
      <Shell kind="lobby" accent={ACCENT} floorColor={TILE} />
      <Outside kind="lobby" floor={0} top={top} />
      <Rug r={LOBBY_RUG} color="#f4a261" />
      <FrontDesk />
      <TodayBoard />
      <Directory />
      <TrophyCabinet />
      <Couch position={[LOBBY_COUCH.x, 0, LOBBY_COUCH.z]} rotationY={Math.PI / 2} color="#2a9d8f" />
      <CoffeeTable position={[LOBBY_TABLE.x, 0, LOBBY_TABLE.z]} rotationY={Math.PI / 2} />
      {LOBBY_PLANTS.map(([x, z, s]) => (
        <Plant key={`${x},${z}`} position={[x, 0, z]} scale={s} />
      ))}
      {/* a doormat at the elevator */}
      <mesh position={[0, 0.009, HALF_D - 0.9]} rotation={[-Math.PI / 2, 0, 0]} material={toon('#6c584c')}>
        <planeGeometry args={[2.4, 1.2]} />
      </mesh>
    </group>
  );
});
