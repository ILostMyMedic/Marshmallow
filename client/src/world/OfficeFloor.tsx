// One floor of the building: its room and the building around it, a desk for every seat (each worker at the desk
// their `desk` number names, the rest vacant up to the floor's most), and rugs and plants. The lobby is floor 0, with
// the CEO's desk. Adapted from cubefarm client/src/world/OfficeFloor.tsx and Lobby.tsx (MIT), thin: the whiteboard,
// the kitchen, the elevator and everything people use on their errands come with their phases.
import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Worker } from '../../../shared/types';
import { useStore } from '../store';
import { Desk } from './Desk';
import { CEO_DESK, DESK_RUGS, deskPosition, deskRotation, HALF_D, HALF_W, LOBBY_RUG, SEATS, type Rect } from './layout';
import { shade, toon } from './materials';
import { Outside } from './Outside';
import { Shell } from './Shell';
import { Ball, Cyl } from './Toon';

const FLOOR_WOOD = '#e8c79a';
const LOBBY_TILE = '#e9dfcf';

/** A flat rug over a rect of the floor. */
function Rug({ r, color }: { r: Rect; color: string }) {
  return (
    <mesh position={[(r.minX + r.maxX) / 2, 0.008, (r.minZ + r.maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} material={toon(color)} receiveShadow>
      <planeGeometry args={[r.maxX - r.minX, r.maxZ - r.minZ]} />
    </mesh>
  );
}

/** A potted plant on the floor. */
function Plant({ x, z, s = 1 }: { x: number; z: number; s?: number }) {
  return (
    <group position={[x, 0, z]} scale={s}>
      <Cyl r={0.26} rTop={0.3} h={0.5} position={[0, 0.25, 0]} color="#e07a5f" outline />
      <Ball r={0.42} position={[0, 0.85, 0]} color="#52b788" outline />
      <Ball r={0.3} position={[0.2, 1.15, 0.1]} color="#40916c" outline />
    </group>
  );
}

const CORNERS: [number, number][] = [
  [-HALF_W + 0.9, -HALF_D + 0.9],
  [HALF_W - 0.9, -HALF_D + 0.9],
  [-HALF_W + 0.9, HALF_D - 0.9],
  [HALF_W - 0.9, HALF_D - 0.9],
];

// Stable positions for every desk, so a re-render never hands a Desk a new array (it's memoised on its props).
const DESK_AT = Array.from({ length: SEATS }, (_, s) => {
  const p = deskPosition(s);
  return { position: [p.x, 0, p.z] as [number, number, number], rotation: deskRotation(s) };
});
const CEO_AT: [number, number, number] = [CEO_DESK.x, 0, CEO_DESK.z];

/** The workers on a floor by their desk: one store read, re-rendering only when one of them changes. */
function useDeskWorkers(floorId: string) {
  return useStore(useShallow((s) => Object.values(s.workers).filter((w) => w.role === 'worker' && w.floorId === floorId)));
}

export const OfficeFloor = memo(function OfficeFloor({ floorId, floor, top, color }: { floorId: string; floor: number; top: number; color: string }) {
  const workers = useDeskWorkers(floorId);
  const most = useStore((s) => s.settings.maxWorkers);
  const byDesk = useMemo(() => {
    const m = new Map<number, Worker>();
    for (const w of workers) m.set(w.desk % SEATS, w);
    return m;
  }, [workers]);
  const seats = Math.max(Math.min(SEATS, most), ...[...byDesk.keys()].map((d) => d + 1));
  return (
    <group>
      <Shell kind="office" accent={color} floorColor={FLOOR_WOOD} />
      <Outside kind="office" floor={floor} top={top} />
      {DESK_RUGS.map((r, i) => (
        <Rug key={i} r={r} color={shade(color, 0.28)} />
      ))}
      {CORNERS.map(([x, z]) => (
        <Plant key={`${x},${z}`} x={x} z={z} />
      ))}
      {DESK_AT.slice(0, seats).map((d, s) => (
        <Desk key={s} worker={byDesk.get(s) ?? null} accent={color} position={d.position} rotationY={d.rotation} />
      ))}
    </group>
  );
});

/** The lobby: the ground floor, with the CEO at their desk if the office has one. */
export const Lobby = memo(function Lobby({ top }: { top: number }) {
  const ceo = useStore((s) => Object.values(s.workers).find((w) => w.role === 'ceo') ?? null);
  return (
    <group>
      <Shell kind="lobby" accent="#ff8a5b" floorColor={LOBBY_TILE} />
      <Outside kind="lobby" floor={0} top={top} />
      <Rug r={LOBBY_RUG} color="#f4a261" />
      {CORNERS.map(([x, z]) => (
        <Plant key={`${x},${z}`} x={x} z={z} s={1.2} />
      ))}
      {ceo && <Desk worker={ceo} accent="#2b2d42" position={CEO_AT} />}
    </group>
  );
});
