// Adapted from cubefarm client/src/world/events/WorldEvents.tsx (MIT): the event sounds cut, and the elevation comes
// from Game.tsx.

// World events outside (director.ts picks them, eventsState.ts runs them): each running event's scene, loaded lazily
// the first time it's needed and torn down when it ends, in a group at street level. Nothing is drawn while no event
// runs. Stepped in the frame loop, so the events stop with the render (a hidden tab).
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { useFrame } from '@react-three/fiber';
import type { EventId } from './director';
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
  useFrame((_, delta) => stepEvents(Math.min(delta, 0.1)));
  if (!runs.length) return null;
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
