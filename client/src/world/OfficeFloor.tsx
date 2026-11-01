// One floor of the building: its room and the building around it, a desk for every seat (each worker at the desk their
// `desk` number names, with a lamp that comes on at night, the rest vacant), the whiteboard, the app monitor, the lounge with its couch, the kitchenette, the water cooler,
// the clock, the ping-pong table, the gong and the plants, all where cubefarm has them, and the errand director
// sending people out to them. The lobby (Lobby.tsx) and the CEO's floor (CeoFloor.tsx) are floors of their own.
// Adapted from cubefarm client/src/world/OfficeFloor.tsx (MIT): signs are cut.
import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Floor, Worker } from '../../../shared/types';
import { useStore } from '../store';
import { AppMonitor } from './AppMonitor';
import { Desk } from './Desk';
import { ErrandDirector } from './ErrandDirector';
import { Gong } from './Gong';
import { KanbanBoard } from './KanbanBoard';
import { Leaver, useLeavers } from './Leavers';
import { CLOCK, COFFEE_TABLE, COOLER, COUCH, DESK_RUGS, deskPosition, deskRotation, KITCHEN, OFFICE_PLANTS, SEATS } from './layout';
import { shade } from './materials';
import { MergeConfetti } from './MergeConfetti';
import { Outside } from './Outside';
import { PongTable } from './PongTable';
import { OfficeRituals } from './Rituals';
import { CoffeeTable, Couch, Kitchenette, Plant, Rug, WallClock, WaterCooler } from './Props';
import { Shell } from './Shell';
import { DeskLamps } from './sky/DeskLamps';

const FLOOR_WOOD = '#e8c79a';

// Stable positions for every desk, so a re-render never hands a Desk a new array (it's memoised on its props).
const DESK_AT = Array.from({ length: SEATS }, (_, s) => {
  const p = deskPosition(s);
  return { position: [p.x, 0, p.z] as [number, number, number], rotation: deskRotation(s) };
});
const at = (p: { x: number; z: number }, y = 0): [number, number, number] => [p.x, y, p.z];

/** The workers on a floor: one store read, re-rendering only when one of them changes. */
function useFloorWorkers(floorId: string) {
  return useStore(useShallow((s) => Object.values(s.workers).filter((w) => w.role === 'worker' && w.floorId === floorId)));
}

export const OfficeFloor = memo(function OfficeFloor({ floor, top }: { floor: Floor; top: number }) {
  const workers = useFloorWorkers(floor.id);
  const { leavers, gone } = useLeavers(workers);
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
      <DeskLamps workers={workers} />
      <KanbanBoard floor={floor} />
      <AppMonitor floor={floor} />
      <Couch position={at(COUCH)} rotationY={-Math.PI / 2} color={shade(color, -0.05)} />
      <CoffeeTable position={at(COFFEE_TABLE)} rotationY={Math.PI / 2} />
      <Kitchenette position={at(KITCHEN)} floor={floor.floor} />
      <WaterCooler position={at(COOLER)} />
      <WallClock position={[CLOCK.x, CLOCK.y, CLOCK.z]} />
      <PongTable />
      <Gong floorId={floor.id} />
      <MergeConfetti floorId={floor.id} color={color} workers={workers} />
      {OFFICE_PLANTS.map(([x, z, s]) => (
        <Plant key={`${x},${z}`} position={[x, 0, z]} scale={s} pot={x > 0 && z > 0 ? '#8338ec' : undefined} />
      ))}
      {leavers.map((w) => (
        <Leaver key={w.id} worker={w} />
      ))}
      <OfficeRituals floorId={floor.id} workers={workers} />
      <ErrandDirector floor="office" workers={workers} leavers={leavers} onGone={gone} floorId={floor.id} />
    </group>
  );
});
