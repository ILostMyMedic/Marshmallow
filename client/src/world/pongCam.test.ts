// The camera at the ping-pong table (pongCam.ts): behind your end and raised, framing the table, the net and the other
// player, clear of your own body, easing after you without overshoot.
import { describe, expect, it } from 'vitest';
import { allInView, newPose } from './cameraMath';
import { BAT_STANCE, blendCam, camGoal, camPose, facingAt, newCamPose, newPongCam, PONG_CAM, stanceAt, stepPongCam, type CamPose } from './pongCam';
import { fromOwn, TABLE, type End } from './pongPhysics';
import { FIRST_FOV } from './rig';

const ENDS: End[] = ['west', 'east'];
const LATS = [-1, -0.6, -0.3, 0, 0.3, 0.6, 1];
const BACKS = [-0.45, 0, 0.25, 0.6, 0.95];
/** The other player's head: behind the far end line, as tall as the tallest body gets. */
const FAR_STAND = 0.65;
const HEAD = { chibi: 1.35, human: 1.95 };

const pose = (c: CamPose) => ({ ...newPose(), ...c, fov: FIRST_FOV });
const goalPose = (end: End, back: number, lat: number) => {
  const g = camGoal(back, lat);
  return camPose(end, g.back, g.lat, newCamPose());
};

/** Points (x, y, z triples) in the player's own frame at `end`. */
const own = (end: End, pts: [number, number, number][]) => pts.flatMap(([back, y, lat]) => {
  const p = fromOwn(end, back, lat);
  return [p.x, y, p.z];
});

/** The shortest distance from point p to segment a–b (3D). */
function segDist(p: number[], a: number[], b: number[]) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const t = Math.max(0, Math.min(1, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}

/** The shortest distance between segments p1–p2 and q1–q2, sampled finely along the first. */
function segSeg(p1: number[], p2: number[], q1: number[], q2: number[]) {
  let best = Infinity;
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    best = Math.min(best, segDist([p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t, p1[2] + (p2[2] - p1[2]) * t], q1, q2));
  }
  return best;
}

describe('the camera at the ping-pong table', () => {
  it('stands behind your end, raised and over your right shoulder, looking down the table at both ends', () => {
    for (const end of ENDS) {
      const c = goalPose(end, 0.25, 0);
      const behind = end === 'west' ? c.x < TABLE.x - TABLE.len / 2 - 1.5 : c.x > TABLE.x + TABLE.len / 2 + 1.5;
      expect(behind, end).toBe(true);
      expect(c.y).toBeGreaterThan(TABLE.top + 1.2);
      expect(c.pitch).toBeLessThan(-0.2);
      expect(c.pitch).toBeGreaterThan(-0.6);
      // looking down the table (within a few degrees of straight), from the right of the middle
      expect(Math.abs(c.yaw - facingAt(end))).toBeLessThan(0.25);
      const right = end === 'west' ? c.z > TABLE.z : c.z < TABLE.z;
      expect(right, end).toBe(true);
    }
  });

  it('frames the whole table, the net and the other player, wherever the paddle goes, on a wide or a squarer screen', () => {
    const half = TABLE.wid / 2;
    for (const end of ENDS)
      for (const lat of LATS)
        for (const back of BACKS) {
          const pts = own(end, [
            [0, TABLE.top, -half],
            [0, TABLE.top, half],
            [-TABLE.len, TABLE.top, -half],
            [-TABLE.len, TABLE.top, half],
            [-TABLE.len / 2, TABLE.top + 0.1525, -half - 0.15],
            [-TABLE.len / 2, TABLE.top + 0.1525, half + 0.15],
            [-TABLE.len - FAR_STAND, HEAD.human, 0],
            [-TABLE.len - FAR_STAND, 0.05, 0],
          ]);
          const p = pose(goalPose(end, back, lat));
          expect(allInView(p, 16 / 9, pts, 0.02), `${end} ${lat} ${back}`).toBe(true);
          expect(allInView(p, 4 / 3, pts, 0), `${end} ${lat} ${back} 4:3`).toBe(true);
        }
  });

  it('keeps your body out of the line to the ball as it comes to your paddle, wherever the paddle is', () => {
    // your body, stood at the stance: a body's width up to the shoulders (the head isn't drawn at the table)
    const TORSO = { r: 0.22, low: 0.3, high: 1.5 };
    for (const end of ENDS)
      for (const lat of LATS)
        for (const back of [0, 0.25, 0.6, 0.95]) {
          const c = goalPose(end, back, lat);
          const eye = [c.x, c.y, c.z];
          const me = stanceAt(end, back, lat);
          const a = [me.x, TORSO.low, me.z];
          const b = [me.x, TORSO.high, me.z];
          // the ball on its way in: from over the net down to the paddle, at heights a ball comes in at, and a little
          // either side of the paddle
          for (const off of [-0.15, 0, 0.15])
            for (let i = 0; i <= 10; i++) {
              const t = i / 10;
              const ballBack = -TABLE.len / 2 + (back + TABLE.len / 2) * t;
              const ballY = TABLE.top + 0.35 - 0.15 * t;
              const ball = own(end, [[ballBack, ballY, lat + off]]);
              expect(segSeg(eye, ball, a, b), `${end} lat ${lat} back ${back} ball ${t} off ${off}`).toBeGreaterThan(TORSO.r);
            }
        }
  });

  it('stands you behind the paddle, a little to its left, at the end line when the paddle reaches over the table', () => {
    const at = stanceAt('west', 0.25, 0.4);
    expect(at).toEqual(fromOwn('west', 0.25 + BAT_STANCE.back, 0.4 - BAT_STANCE.left));
    expect(stanceAt('east', -0.3, 0)).toEqual(fromOwn('east', BAT_STANCE.back, -BAT_STANCE.left));
  });

  it('steps back with you when you step back, keeping its distance', () => {
    const near = camGoal(0.25, 0).back;
    const far = camGoal(0.95, 0).back;
    expect(near).toBe(PONG_CAM.back);
    expect(far).toBeCloseTo(0.95 + BAT_STANCE.back + PONG_CAM.behind);
  });

  it('eases after a sidestep without jumping or overshooting, and settles on the goal', () => {
    const cam = newPongCam();
    const out = newCamPose();
    stepPongCam(cam, 'west', 0.25, 0, 1 / 60, out);
    expect(cam.lat).toBeCloseTo(PONG_CAM.side); // the first frame snaps
    const goal = camGoal(0.25, 1).lat;
    let last = cam.lat;
    let biggest = 0;
    for (let i = 0; i < 120; i++) {
      stepPongCam(cam, 'west', 0.25, 1, 1 / 60, out);
      expect(cam.lat).toBeGreaterThanOrEqual(last - 1e-9); // only ever towards the goal
      expect(cam.lat).toBeLessThanOrEqual(goal + 1e-9);
      biggest = Math.max(biggest, cam.lat - last);
      last = cam.lat;
    }
    expect(biggest).toBeLessThan(0.1); // no frame jumps more than 10 cm
    expect(cam.lat).toBeCloseTo(goal, 3);
    // a long frame (a tab coming back) never overshoots either
    stepPongCam(cam, 'west', 0.25, -1, 5, out);
    expect(cam.lat).toBeCloseTo(camGoal(0.25, -1).lat);
  });

  it('flies in from your eyes and back, the short way round', () => {
    const eyes: CamPose = { x: 0, y: 1.65, z: 0, yaw: Math.PI - 0.1, pitch: 0 };
    const table: CamPose = { x: 2, y: 2.3, z: 1, yaw: -Math.PI + 0.1, pitch: -0.4 };
    const out = newCamPose();
    expect(blendCam(eyes, table, 0, out)).toMatchObject({ x: 0, y: 1.65, yaw: Math.PI - 0.1 });
    expect(blendCam(eyes, table, 1, out).x).toBeCloseTo(2);
    const mid = blendCam(eyes, table, 0.5, out);
    expect(Math.abs(Math.abs(mid.yaw) - Math.PI)).toBeLessThan(0.11); // through π, not round through 0
    expect(mid.y).toBeCloseTo((1.65 + 2.3) / 2);
  });
});
