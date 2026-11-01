// The plaza round the building in its season (City.tsx mounts it with the plaza's trees): at Christmas, lights
// spiralling up every tree, two draw calls in all and only in December. The trees' colours and the snow are City.tsx's.
import { useMemo } from 'react';
import type { CityBox } from '../cityLayout';
import { FairyLights } from './kit';
import { useSeason } from './seasonState';

type V3 = [number, number, number];

/** Bulbs spiralling up a cone-shaped crown, from its hem to near its tip. */
function spiral(c: CityBox, turns = 3.5, per = 40): V3[] {
  return Array.from({ length: per }, (_, k) => {
    const u = (k + 0.5) / per;
    const a = u * turns * Math.PI * 2 + c.x;
    const r = (c.w / 2) * (1 - u * 0.92) + 0.05;
    return [c.x + Math.cos(a) * r, c.y + 0.15 + u * c.h * 0.85, c.z + Math.sin(a) * r];
  });
}

export function PlazaSeason({ crowns }: { crowns: CityBox[] }) {
  const christmas = useSeason((l) => l.christmas);
  const at = useMemo(() => crowns.flatMap((c) => spiral(c)), [crowns]);
  if (!christmas) return null;
  return <FairyLights at={at} size={0.07} halo={0.9} />;
}
