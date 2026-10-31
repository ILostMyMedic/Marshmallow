// One floor of the building: its room and the building around it, a desk for every seat (each worker at the desk their
// `desk` number names, the rest vacant), the whiteboard, the lounge with its couch, the kitchenette, the water cooler,
// the clock, the ping-pong table and the plants, all where cubefarm has them. The lobby is floor 0, with the CEO's desk.
// Adapted from cubefarm client/src/world/OfficeFloor.tsx and Lobby.tsx (MIT): the elevator, signs, the gong and what
// people use on their errands come with their phases.
import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Floor, Worker } from '../../../shared/types';
import { useStore } from '../store';
import { Desk } from './Desk';
import { KanbanBoard } from './KanbanBoard';
import { CEO_DESK, CLOCK, COFFEE_TABLE, COOLER, COUCH, DESK_RUGS, deskPosition, deskRotation, KITCHEN, LOBBY_PLANTS, LOBBY_RUG, OFFICE_PLANTS, SEATS, type Rect } from './layout';
import { shade, toon } from './materials';
import { Outside } from './Outside';
import { PongTable } from './PongTable';
import { CoffeeTable, Couch, Kitchenette, Plant, WallClock, WaterCooler } from './Props';
import { Shell } from './Shell';

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

// Stable positions for every desk, so a re-render never hands a Desk a new array (it's memoised on its props).
const DESK_AT = Array.from({ length: SEATS }, (_, s) => {
  const p = deskPosition(s);
  return { position: [p.x, 0, p.z] as [number, number, number], rotation: deskRotation(s) };
});
const CEO_AT: [number, number, number] = [CEO_DESK.x, 0, CEO_DESK.z];
const at = (p: { x: number; z: number }, y = 0): [number, number, number] => [p.x, y, p.z];

/** The workers on a floor: one store read, re-rendering only when one of them changes. */
function useFloorWorkers(floorId: string) {
  return useStore(useShallow((s) => Object.values(s.workers).filter((w) => w.role === 'worker' && w.floorId === floorId)));
}

export const OfficeFloor = memo(function OfficeFloor({ floor, top }: { floor: Floor; top: number }) {
  const workers = useFloorWorkers(floor.id);
  const byDesk = useMemo(() => {
    const m = new Map<number, Worker>();
    for (const w of workers) m.set(w.desk % SEATS, w);
    return m;
  }, [workers]);
  const color = floor.color;
  return (
    <group>
      <Shell kind="office" accent={color} floorColor={FLOOR_WOOD} />
      <Outside kind="office" floor={floor.floor} top={top} />
      {DESK_RUGS.map((r, i) => (
        <Rug key={i} r={r} color={shade(color, 0.28)} />
      ))}
      {/* every desk stands, so the floor's solids and walkways never change with the team */}
      {DESK_AT.map((d, s) => (
        <Desk key={s} worker={byDesk.get(s) ?? null} accent={color} position={d.position} rotationY={d.rotation} />
      ))}
      <KanbanBoard floor={floor} />
      <Couch position={at(COUCH)} rotationY={-Math.PI / 2} color={shade(color, -0.05)} />
      <CoffeeTable position={at(COFFEE_TABLE)} rotationY={Math.PI / 2} />
      <Kitchenette position={at(KITCHEN)} />
      <WaterCooler position={at(COOLER)} />
      <WallClock position={[CLOCK.x, CLOCK.y, CLOCK.z]} />
      <PongTable />
      {OFFICE_PLANTS.map(([x, z, s]) => (
        <Plant key={`${x},${z}`} position={[x, 0, z]} scale={s} pot={x > 0 && z > 0 ? '#8338ec' : undefined} />
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
      {LOBBY_PLANTS.map(([x, z, s]) => (
        <Plant key={`${x},${z}`} position={[x, 0, z]} scale={s} />
      ))}
      {ceo && <Desk worker={ceo} accent="#2b2d42" position={CEO_AT} />}
    </group>
  );
});
