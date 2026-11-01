// A worker on a roof break toasting a marshmallow by the fire (RoofPeople.tsx puts one in some of the fire's sitters'
// hands): once they're settled on the bench, a stick held out from their lap over the flames, toasting as yours does
// (marshmallow.ts), until it's as done as they like it (workerToast: golden mostly, now and then burnt or forgotten
// till it catches); then an emoji as they eat it, a while with nothing, and another. Drawn in their seat's frame (they
// face -Z); hidden while they're up. New in Marshmallow.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { bodyState, say } from '../people';
import { toastStep, workerToast } from './marshmallow';
import { MarshmallowStick, type StickState } from './MarshmallowStick';

/** Where the stick starts (in their lap, the right hand), how it leans, how long it is; and seconds between marshmallows. */
const HOLD = { at: [0.12, 0.62, -0.3] as [number, number, number], tilt: -0.1, len: 1.5 };
/** How far out the marshmallow is from a sitter, for marshmallow.ts heatAt (the hold's reach and the stick). */
export const TOASTER_REACH = -HOLD.at[2] + HOLD.len;
const REST = { first: [1, 5] as const, then: [8, 18] as const };

const between = ([a, b]: readonly [number, number]) => a + Math.random() * (b - a);

/** Worker `id`'s stick, toasting at `heat` (0-1: how hot it is where they hold it). */
export function Toaster({ id, heat }: { id: string; heat: number }) {
  const group = useRef<THREE.Group>(null);
  const st = useMemo(() => ({ toast: 0, flame: 0, plan: workerToast(Math.random()), rest: between(REST.first) }), []);
  const live = useMemo(() => {
    const s: StickState = { toast: 0, flame: 0 };
    return () => {
      s.toast = st.toast;
      s.flame = st.flame;
      return s;
    };
  }, [st]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const b = bodyState(id);
    const seated = b?.stage === 'seated';
    if (group.current) group.current.visible = seated && st.rest <= 0;
    if (!seated) return;
    if (st.rest > 0) {
      st.rest -= dt;
      return;
    }
    const next = toastStep(st, heat, dt);
    st.toast = next.toast;
    st.flame = next.flame;
    if (st.toast < st.plan.stop || st.flame > 0) return;
    // done to their liking (or past it): eaten, and a while before the next
    say(id, st.plan.say, 2.5);
    Object.assign(st, { toast: 0, flame: 0, plan: workerToast(Math.random()), rest: between(REST.then) });
  });
  return (
    <group ref={group} position={HOLD.at} rotation={[HOLD.tilt, 0, 0]} visible={false}>
      <MarshmallowStick live={live} length={HOLD.len} />
    </group>
  );
}
