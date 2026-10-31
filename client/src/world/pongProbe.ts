// Adapted from cubefarm client/src/world/toys/pongProbe.ts (MIT): installed by the table (PongMatch.tsx) with its
// runner instead of a registry; the invitation for two workers to play is cut.

// window.__mmPong: the ping-pong match for QA and Playwright, where pointer lock doesn't work. `state` is a fresh
// snapshot each read: the phase, who is at each end, the score and serve, the ball, the last shot and the player's
// paddle. The helpers pick up a paddle and put it down, click (serve or rematch), play the player's side on autopilot,
// feed a drill of balls at the player (each return checked), and force a long rally.

import type { Swing } from './pongPhysics';
import type { DrillBall, PongRunner } from './pongRunner';
import { autopilot, joinPong, leavePong, paddle, pongClick, pongMatch, pongView } from './pongState';

/** A spread of balls to feed: slow to quick, chopped to topspun, left, middle and right, short and deep. */
export function drillBalls(n = 12): DrillBall[] {
  const speeds = [4.4, 6, 7.8];
  const tops = [-200, 0, 260];
  const lats = [-0.5, 0, 0.5];
  return Array.from({ length: n }, (_, i) => {
    const lat = lats[i % 3];
    return { speed: speeds[Math.floor(i / 3) % 3], top: tops[(i + Math.floor(i / 3)) % 3], side: lat > 0 ? -100 : 80, lat, depth: 0.6 + (i % 4) * 0.15 };
  });
}

/** Puts window.__mmPong up for `runner`'s match; the returned function takes it down. */
export function installPongProbe(runner: PongRunner): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const autoplay = (on = true, swing: Partial<Swing> = {}) => {
    autopilot.on = on;
    autopilot.swing = { forward: swing.forward ?? 1.2, right: swing.right ?? 0 };
    return on;
  };
  const probe = {
    get state() {
      const live = runner.liveView();
      return { ...(pongView() ?? { phase: null }), ...live, paddle: { lat: paddle.lat, back: paddle.back, y: paddle.y }, autopilot: autopilot.on };
    },
    /** Pick up the paddle at `end` (as E on it does). */
    join: (end: 'west' | 'east' = 'east') => joinPong(end),
    /** Put it down (as G or Esc does). */
    leave: () => leavePong(),
    /** A click while playing: the toss for the player's serve, or a rematch after a game. */
    click: () => pongClick(),
    /** Serve now: the player's serve (toss and hit), or hurry the worker's. */
    serve: () => runner.serveNow(),
    /** Play the player's side: meet every ball with this swing (forward m/s towards the net, right m/s). */
    autoplay,
    /** Feed balls at the player one at a time (they need to be at the table) on autopilot; see state.drill. */
    feed(balls: number | DrillBall[] = 12) {
      if (!pongMatch()) return false;
      autoplay(true, autopilot.swing);
      return runner.drill(typeof balls === 'number' ? drillBalls(balls) : balls);
    },
    /** Force a rally: the autopilot plays the player's side and the worker returns the next `hits` balls cleanly. */
    rally(hits = 12) {
      autoplay(true);
      runner.forced = hits;
      return true;
    },
  };
  const w = window as unknown as Record<string, unknown>;
  w.__mmPong = probe;
  return () => {
    if (w.__mmPong === probe) delete w.__mmPong;
  };
}
