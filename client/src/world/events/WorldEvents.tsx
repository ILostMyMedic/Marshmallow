// Adapted from cubefarm client/src/world/events/WorldEvents.tsx (MIT): the elevation comes from Game.tsx.

// World events outside (the office picks them, server/db/world.ts; eventsState.ts follows what's on): each running
// event's scene, loaded lazily the first time it's needed and torn down when it ends, in a group at street level.
// Nothing is drawn while no event runs. Each frame moves the runs to the wall clock, so every tab shows the same moment
// of them. While any runs, their sounds (ui/eventSfx.ts) follow you: through the glass indoors, quiet behind a panel and
// while the elevator carries you.
import { lazy, Suspense, useEffect, type ComponentType, type LazyExoticComponent } from 'react';
import { useFrame } from '@react-three/fiber';
import { eventSoundsOff, eventSoundsOn, setEventsQuiet } from '../../ui/eventSfx';
import { useRide } from '../elevatorRide';
import { kindOf } from '../floors';
import { useView } from '../view';
import type { EventId } from '../../../../shared/worldEvents';
import { stepEvents, useEventRuns } from './eventsState';
import type { SceneProps } from './kit';

const SCENES: Record<EventId, LazyExoticComponent<ComponentType<SceneProps>>> = {
  plane: lazy(() => import('./scenes/Plane')),
  helicopter: lazy(() => import('./scenes/Helicopter')),
  birds: lazy(() => import('./scenes/Birds')),
  balloon: lazy(() => import('./scenes/Balloon')),
  blimp: lazy(() => import('./scenes/Blimp')),
  skywriting: lazy(() => import('./scenes/Skywriting')),
  ufo: lazy(() => import('./scenes/Ufo')),
  rainbow: lazy(() => import('./scenes/Rainbow')),
  duck: lazy(() => import('./scenes/Duck')),
  whale: lazy(() => import('./scenes/Whale')),
};

/** The events outside, at street level: `elevation` is how high the floor you're on stands (the city's, City.tsx). */
export function WorldEvents({ elevation }: { elevation: number }) {
  const runs = useEventRuns();
  const floor = useView((s) => s.floor);
  const panel = useView((s) => s.overlay !== null);
  const riding = useRide((s) => s.phase === 'dark');
  useFrame((_, delta) => stepEvents(Math.min(delta, 0.1)));
  useEffect(() => setEventsQuiet(panel || riding), [panel, riding]);
  const any = runs.length > 0;
  const kind = floor === null ? 'office' : kindOf(floor);
  useEffect(() => {
    if (!any) return;
    eventSoundsOn(kind);
    return eventSoundsOff;
  }, [any, kind]);
  if (!any) return null;
  return (
    <group position={[0, -elevation, 0]}>
      {runs.map((r) => {
        const Scene = SCENES[r.id];
        return (
          <Suspense key={r.key} fallback={null}>
            <Scene run={r} elevation={elevation} />
          </Suspense>
        );
      })}
    </group>
  );
}
