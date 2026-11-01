// The season outside, round whichever floor you're on (Game.tsx mounts it; seasonState.ts says which season it is, the
// same in every tab): what falls past the windows (Falling.tsx), the snow lying on the city (haze.ts, through
// sky/outdoor.ts's uSnow) and on the balconies' rails and planters, the lights along every balcony at Christmas, New
// Year's fireworks over the city all night, and the light's mood (sky/skyMood.ts). The lobby, the roof and the plaza
// have their own (LobbySeason, RoofSeason, PlazaSeason). Only what the season brings is mounted.
import { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { eventSoundsOff, eventSoundsOn } from '../../ui/eventSfx';
import { dayTime, nightFactor } from '../dayTime';
import { EYE_HEIGHT, type FloorKind } from '../layout';
import { toon } from '../materials';
import { boxesGeometry } from '../shapes';
import { outdoor } from '../sky/outdoor';
import { setSkyMood } from '../sky/skyMood';
import { Falling } from './Falling';
import { FairyLights } from './kit';
import { FireworksShow, launchesBetween, showPlan, type Launch } from './Fireworks';
import { balconyLights, balconySnow } from './seasonLayout';
import { seasonProbe, useSeason } from './seasonState';

/** Snow on the balconies' rails (every floor up to yours) and on your planters. */
function BalconySnow({ kind, storey }: { kind: FloorKind; storey: number }) {
  const geo = useMemo(() => boxesGeometry(balconySnow(kind, storey)), [kind, storey]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={toon('#f4f8ff')} receiveShadow />;
}

/** The lights along every balcony's rail up to yours. */
function BalconyLights({ storey }: { storey: number }) {
  const at = useMemo(() => balconyLights(storey), [storey]);
  return <FairyLights at={at} size={0.045} halo={0.45} />;
}

/** New Year's show: half-minute plans one after another, the same in every tab (seeded by the wall clock), at night only. */
const WINDOW_S = 30;
function newYearBetween(burst: number) {
  const plans = new Map<number, Launch[]>();
  return (from: number, to: number) => {
    const out: Launch[] = [];
    for (let w = Math.floor(from / WINDOW_S); w <= Math.floor(to / WINDOW_S); w++) {
      let plan = plans.get(w);
      if (!plan) {
        plan = showPlan(9000 + w, w * WINDOW_S, WINDOW_S, { side: 0, burst, finale: false, every: [0.6, 1.6] });
        plans.set(w, plan);
        // only the last few are kept
        for (const k of plans.keys()) if (k < w - 2) plans.delete(k);
      }
      out.push(...launchesBetween(plan, from, to));
    }
    return out;
  };
}
/** The show's clock: seconds into the hour, on the wall clock every tab shares. */
const hourClock = () => (Date.now() / 1000) % 3600;

function NewYear({ elevation, kind }: { elevation: number; kind: FloorKind | 'roof' }) {
  const between = useMemo(() => newYearBetween(elevation + EYE_HEIGHT + 30), [elevation]);
  const [night, setNight] = useState(() => nightFactor(dayTime.t) > 0.5);
  useFrame(() => {
    const n = nightFactor(dayTime.t) > 0.5;
    if (n !== night) setNight(n);
  });
  // the booms go through the world events' sounds while the show is on
  useEffect(() => {
    if (!night) return;
    eventSoundsOn(kind);
    return eventSoundsOff;
  }, [night, kind]);
  if (!night) return null;
  return (
    <group position={[0, -elevation, 0]}>
      <FireworksShow between={between} clock={hourClock} elevation={elevation} fade={() => nightFactor(dayTime.t)} />
    </group>
  );
}

/**
 * The season round floor `storey` (storeys up from the street) of kind `kind`: `elevation` is how far your floor is
 * above the street, `roof` how far the roof deck is above your floor.
 */
export function Seasons({ kind, storey, elevation, roof }: { kind: FloorKind | 'roof'; storey: number; elevation: number; roof: number }) {
  const fall = useSeason((l) => l.fall);
  const snow = useSeason((l) => l.snowCover);
  const christmas = useSeason((l) => l.christmas);
  const fireworks = useSeason((l) => l.fireworks);
  const light = useSeason((l) => l.light);

  useEffect(() => {
    outdoor.uSnow.value = snow;
    setSkyMood({ snow, exposure: light.exposure, warmth: light.warmth });
  }, [snow, light]);
  useEffect(
    () => () => {
      outdoor.uSnow.value = 0;
      setSkyMood({ snow: 0, exposure: 1, warmth: 0 });
    },
    [],
  );

  // for headless checks: the last frame's draw calls and a smoothed frame time
  useFrame(({ gl }, dt) => {
    const f = seasonProbe.frame;
    f.calls = gl.info.render.calls;
    f.triangles = gl.info.render.triangles;
    f.ms = f.ms ? f.ms * 0.95 + dt * 1000 * 0.05 : dt * 1000;
  });

  const indoors = kind !== 'roof';
  return (
    <group>
      {fall && <Falling kind={fall.kind} amount={fall.amount} elevation={elevation} roof={roof} onRoof={!indoors} />}
      {indoors && snow > 0 && <BalconySnow kind={kind} storey={storey} />}
      {indoors && christmas && <BalconyLights storey={storey} />}
      {fireworks && <NewYear elevation={elevation} kind={kind} />}
    </group>
  );
}
