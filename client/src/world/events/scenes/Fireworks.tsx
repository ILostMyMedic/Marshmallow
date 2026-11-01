// A fireworks show over the city on one side, building to a finale: the world event (New Year's nights bring it most;
// ?event=fireworks any time). The show itself is seasons/Fireworks.tsx's, shared with New Year's smaller all-night one.
import { useMemo } from 'react';
import { launchesBetween, FireworksShow, showPlan } from '../../seasons/Fireworks';
import { eyeAbove, sign, type SceneProps } from '../kit';

export default function Fireworks({ run, elevation }: SceneProps) {
  const s = sign(run.side);
  const plan = useMemo(() => showPlan(run.seed, 0, run.seconds, { side: s, burst: eyeAbove(elevation) + 24, finale: true }), [run.seed, run.seconds, s, elevation]);
  return <FireworksShow between={(a, b) => launchesBetween(plan, a, b)} clock={() => run.t} elevation={elevation} />;
}
