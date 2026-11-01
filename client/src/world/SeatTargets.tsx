// The seats on the floor you're on (seats.ts), each something to aim at: E sits you down in it (Player.tsx). Not the
// one you're in, nor one someone else has: a worker sitting there, or a roof break's claim on it (roofBreaks.ts, while
// they ride up to it). An invisible box over each, from the floor to just over the seat, so the crosshair finds it
// whatever the furniture is drawn as. New in Marshmallow.
import { memo, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import type { FloorItem } from '../../../shared/types';
import type { FloorKindOf } from './floors';
import { useInteractable } from './interact';
import { bodies } from './people';
import { roofVisits } from './roof/roofBreaks';
import { seatsFor, seatTaken, sitLabel, type Seat } from './seats';
import { useView } from './view';

/** Seconds between looks at who's sitting where. */
const POLL = 0.4;
/** How far over a seat its box reaches (the cushion and the bottom of the back). */
const OVER = 0.45;

const SeatTarget = memo(function SeatTarget({ seat }: { seat: Seat }) {
  const ref = useInteractable<THREE.Mesh>({ id: `seat:${seat.id}`, label: sitLabel(seat.kind), action: { kind: 'sit', seat } }, 2.6);
  const h = seat.height + OVER;
  return (
    <mesh ref={ref} visible={false} position={[seat.x, h / 2, seat.z]} rotation={[0, seat.facing, 0]}>
      <boxGeometry args={[0.5, h, 0.5]} />
    </mesh>
  );
});

/** The seats of a floor of kind `kind` (an office floor's with what its `plan` bought), to sit in. */
export const SeatTargets = memo(function SeatTargets({ kind, plan }: { kind: FloorKindOf; plan?: readonly FloorItem[] }) {
  const seats = useMemo(() => seatsFor(kind, plan), [kind, plan]);
  const mine = useView((s) => s.seated?.id ?? null);
  const [taken, setTaken] = useState<ReadonlySet<string>>(() => new Set());
  const poll = useRef({ left: 0, key: '' });
  useFrame((_, dt) => {
    const p = poll.current;
    p.left -= dt;
    if (p.left > 0) return;
    p.left = POLL;
    const sitters: { x: number; z: number }[] = [];
    for (const b of bodies()) if (b.stage !== 'up') sitters.push({ x: b.seatX, z: b.seatZ });
    const claimed = new Set(kind === 'roof' ? roofVisits().flatMap((v) => (v.kind === 'break' ? [v.seat] : [])) : []);
    const now = seats.filter((s) => seatTaken(s, sitters, claimed)).map((s) => s.id);
    const key = now.join(',');
    if (key === p.key) return;
    p.key = key;
    setTaken(new Set(now));
  });
  return (
    <group>
      {seats.map((s) => (s.id === mine || taken.has(s.id) ? null : <SeatTarget key={s.id} seat={s} />))}
    </group>
  );
});
