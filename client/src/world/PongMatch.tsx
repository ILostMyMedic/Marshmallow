// Adapted from cubefarm client/src/world/toys/PingPong.tsx (MIT): the match only, on pongSim.ts's plain ball instead of
// a Rapier body. The table's colliders, the ends you press E at, the player's paddle, the ball's band and trail, the
// sounds, the leaderboard's report and the probe are cut.

// Ping-pong between workers at the table (PongTable.tsx draws this): the ball, and the match runner (pongRunner.ts)
// stepping it at the physics rate whatever the frame rate. While it's on screen the errands (pongErrands.ts) get the
// match's seats, so idle workers come and play; it goes with the floor, and the match with it.

import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { toon } from './materials';
import { bodyState, say } from './people';
import { setPongSeats } from './pongErrands';
import { PONG } from './pongPhysics';
import { PongRunner } from './pongRunner';
import { SimBall } from './pongSim';
import { claimSeat, leaveSeat, npcPong, readySeat, resetPong, seatOf, startNpcMatch, tableFree, wantsOpponent } from './pongState';

/** At most this many steps a frame, so a long frame (a tab coming back) doesn't stall catching up. */
const MAX_STEPS = 6;

/** The ball and the match at the table. The ball is hidden while it's out of play. */
export const PongMatch = memo(function PongMatch() {
  const look = useRef<THREE.Mesh>(null);
  const sim = useMemo(() => {
    const ball = new SimBall();
    const bodyAt = (id: string) => {
      const s = bodyState(id);
      return s ? { x: s.x, z: s.z } : null;
    };
    return { ball, runner: new PongRunner(ball, { bodyAt, say }), acc: 0 };
  }, []);

  useEffect(() => {
    setPongSeats({ seatOf, wantsOpponent, tableFree, claimSeat, startNpcMatch, readySeat, leaveSeat, npcPong });
    return () => {
      setPongSeats(null);
      sim.runner.stop();
      resetPong(); // leaving the floor: nobody plays here any more
    };
  }, [sim]);

  useFrame((_, delta) => {
    sim.acc = Math.min(sim.acc + delta, PONG.step * MAX_STEPS);
    while (sim.acc >= PONG.step) {
      sim.runner.before();
      sim.ball.step();
      sim.runner.after();
      sim.acc -= PONG.step;
    }
    const m = look.current;
    if (!m) return;
    m.visible = !sim.runner.hidden;
    m.position.set(sim.ball.p.x, sim.ball.p.y, sim.ball.p.z);
  });

  return (
    <mesh ref={look} material={toon('#ff9f1c')} visible={false} castShadow>
      <sphereGeometry args={[PONG.ball.r, 16, 12]} />
    </mesh>
  );
});
