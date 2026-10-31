// People let go from the floor you're on: the store forgets them at once (their desk shows vacant), but they're still
// drawn at their old chair until the errand director has walked them out by the elevator with a box.
// Adapted from cubefarm client/src/world/Leavers.tsx (MIT).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Worker } from '../../../shared/types';
import { Character } from './Character';
import { deskPosition, deskRotation, SEATS } from './layout';
import { Ball, Box } from './Toon';

/**
 * Who left this floor's team while you were here, kept until `gone(id)`. OfficeFloor is keyed by floor, so changing
 * floors starts afresh and nobody "leaves" because you walked away.
 */
export function useLeavers(workers: Worker[]) {
  const [leavers, setLeavers] = useState<Worker[]>([]);
  const before = useRef<Map<string, Worker> | null>(null);
  useEffect(() => {
    const now = new Map(workers.map((w) => [w.id, w]));
    const left = before.current ? [...before.current.values()].filter((w) => !now.has(w.id)) : [];
    before.current = now;
    // Off the clock: no headphones, no typing.
    if (left.length) setLeavers((l) => [...l, ...left.map((w) => ({ ...w, status: 'stopped' as const, task: null, activity: null }))]);
  }, [workers]);
  const gone = useCallback((id: string) => setLeavers((l) => l.filter((w) => w.id !== id)), []);
  return { leavers, gone };
}

/** Their things in a cardboard box, held in front (Character's torso frame). */
const BOX = (
  <group position={[0, 0.2, -0.44]}>
    <Box size={[0.42, 0.24, 0.3]} color="#c99a5b" outline />
    <Ball r={0.07} position={[0.1, 0.16, 0.02]} color="#52b788" />
    <Box size={[0.06, 0.16, 0.04]} position={[-0.1, 0.16, 0]} color="#e07a5f" />
  </group>
);

/** Someone on their way out, drawn where they sat (a desk's chair is 0.8 m behind it). */
export function Leaver({ worker }: { worker: Worker }) {
  const { x, z } = deskPosition(worker.desk % SEATS);
  return (
    <group position={[x, 0, z]} rotation={[0, deskRotation(worker.desk % SEATS), 0]}>
      <group position={[0, 0, 0.8]}>
        <Character worker={worker} carrying={BOX} />
      </group>
    </group>
  );
}
