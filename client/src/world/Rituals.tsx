// The rituals on an office floor (ritualRunner.ts carries them out): the CEO coming up for a stand-up, drawn from
// inside the elevator cabin while the runner walks them, and at lunch the ones too busy to get up eating at their desk.
// `?ritual=standup` or `?ritual=lunch` forces one a moment after you arrive, for QA.
// Adapted from cubefarm client/src/world/Rituals.tsx (MIT): the lobby's runner, the pizza courier, the desk lamps and
// the time-lapse are cut.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Worker } from '../../../shared/types';
import { useStore } from '../store';
import { seededAppearance } from './appearance';
import { Character } from './Character';
import { NameTag } from './Desk';
import { FoodLook } from './food';
import { deskPosition, deskRotation, SEATS } from './layout';
import { meals, subscribeMeals } from './meals';
import { OfficeRitualRunner } from './ritualRunner';
import { lunchOf, parseRitualParam } from './ritualSchedule';
import { CABIN } from './socials';

let active: OfficeRitualRunner | null = null;

/** `?ritual=…`, read once. */
const forcedByUrl = typeof window !== 'undefined' ? parseRitualParam(window.location.search) : null;

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__mmRituals = {
    state: () => active?.state() ?? null,
    force: (kind: 'standup' | 'lunch') => active?.force(kind) ?? false,
    walk: () => active?.forceWalk() ?? false,
  };
}

export function OfficeRituals({ floorId, workers }: { floorId: string; workers: Worker[] }) {
  const run = useMemo(() => new OfficeRitualRunner(floorId, workers), [floorId]);
  run.workers = workers;
  const [cast, setCast] = useState({ ...run.cast });
  run.onCast = () => setCast({ ...run.cast });
  useEffect(() => {
    active = run;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (forcedByUrl) timer = setTimeout(() => run.force(forcedByUrl), 2500);
    return () => {
      if (timer) clearTimeout(timer);
      if (active === run) active = null;
      run.dispose();
    };
  }, [run]);
  useFrame((_, delta) => run.tick(Math.min(delta, 0.1)));
  const ceo = useStore((s) => Object.values(s.workers).find((w) => w.role === 'ceo') ?? null);
  return (
    <>
      {cast.ceo && ceo && <Visitor worker={ceo} />}
      <DeskLunch workers={workers} />
    </>
  );
}

/** Someone visiting the floor, drawn from inside the elevator cabin (their "chair") while ritualRunner.ts walks them. */
function Visitor({ worker }: { worker: Worker }) {
  const shirt = useMemo(() => seededAppearance({ seed: worker.seed, role: worker.role }).shirt, [worker.seed, worker.role]);
  return (
    <group position={[CABIN.x, 0, CABIN.z]}>
      <Character worker={worker}>
        <NameTag worker={worker} color={shirt} />
      </Character>
    </group>
  );
}

/** Where something on a desk is in the world: the desk's place and turn, then the spot on it (desk space). */
function onDesk(w: Worker, x: number, y: number, z: number) {
  const d = deskPosition(w.desk % SEATS);
  const turn = deskRotation(w.desk % SEATS);
  return { x: d.x + x * Math.cos(turn) + z * Math.sin(turn), y, z: d.z - x * Math.sin(turn) + z * Math.cos(turn), turn };
}

/** Lunchtime: the ones too busy to get up eat at their desk, beside the keyboard. */
function DeskLunch({ workers }: { workers: Worker[] }) {
  const lunch = useSyncExternalStore(subscribeMeals, () => meals.lunch);
  if (!lunch) return null;
  return (
    <>
      {workers
        .filter((w) => w.status === 'working' || w.status === 'preparing')
        .map((w) => {
          const p = onDesk(w, -0.56, 0.81, 0.2);
          return (
            <group key={w.id} position={[p.x, p.y, p.z]} rotation={[0, p.turn + 0.4, 0]}>
              <FoodLook kind={lunchOf(w.id)} />
            </group>
          );
        })}
    </>
  );
}
