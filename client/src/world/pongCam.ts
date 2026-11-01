// The camera while you play ping-pong, as plain numbers (Player.tsx puts them on the three.js camera): raised behind
// your end and over your right shoulder, looking down the table past the net, so the whole table, the ball and the other
// player are in view and your body (stood left of the paddle in your right hand) is off to the lower left, out of the
// line to the ball. It follows your sidesteps and steps back with you, eased, so mouse jitter never shakes it. Where you
// stand at the table is here too. Pure, so it's tested (pongCam.test.ts). New in Marshmallow: cubefarm's view was
// pongState.ts pongCamera, straight behind and lower.

import { aimAt, angleDelta, ease } from './cameraMath';
import { fromOwn, TABLE, type End } from './pongPhysics';

/** Where you stand at your end of the table: behind your paddle, a little to its left, so it's in your right hand. */
export const BAT_STANCE = { back: 0.42, left: 0.3 };

/**
 * The camera, in the player's own frame (pongPhysics ownFrame: `back` behind the end line, `lat` to the right):
 * `back` behind the end line (and at least `behind` behind you when you step back), `y` up, `side` to the right of where
 * it follows (`follow` of the paddle's sidestep), looking at a point `lookBack` along the table (past the net), `lookLat`
 * of the paddle's sidestep across, at the table's height. `rate` is how fast it eases after you (1/s); `blend` how long
 * (s) it takes to fly in from your eyes when you pick the paddle up, and back when you put it down.
 */
export const PONG_CAM = { back: 2.05, behind: 1.25, y: 2.3, side: 0.55, follow: 0.7, lookBack: -TABLE.len * 0.62, lookLat: 0.25, rate: 6, blend: 0.45 };

/** A camera pose: where, and the yaw and pitch of an 'YXZ' rotation (yaw 0 looks north, -Z). */
export interface CamPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export const newCamPose = (): CamPose => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });

/** Where you stand at `end` with the paddle at `back` (its own frame; over the table counts as at the end line) and `lat`. */
export function stanceAt(end: End, back: number, lat: number): { x: number; z: number } {
  return fromOwn(end, Math.max(back, 0) + BAT_STANCE.back, lat - BAT_STANCE.left);
}

/** Which way you face at `end`: down the table (body.ts heading, 0 faces -Z; west looks +x). */
export const facingAt = (end: End) => (end === 'west' ? -Math.PI / 2 : Math.PI / 2);

/** What the camera eases towards: how far across it follows and how far back it stands, for a paddle at `back`, `lat`. */
export function camGoal(back: number, lat: number): { lat: number; back: number } {
  const you = Math.max(back, 0) + BAT_STANCE.back;
  return { lat: PONG_CAM.side + PONG_CAM.follow * lat, back: Math.max(PONG_CAM.back, you + PONG_CAM.behind) };
}

/** The camera at `end`, standing `back` behind the end line and `lat` across (camGoal's), looking down the table. */
export function camPose(end: End, back: number, lat: number, out: CamPose): CamPose {
  const at = fromOwn(end, back, lat);
  out.x = at.x;
  out.y = PONG_CAM.y;
  out.z = at.z;
  // how far across it looks follows where it stands: a sidestep turns it a little, keeping the table in the middle
  const look = fromOwn(end, PONG_CAM.lookBack, (lat - PONG_CAM.side) * (PONG_CAM.lookLat / PONG_CAM.follow));
  const p = { ...out, fov: 0, near: 0 };
  aimAt(p, look.x, TABLE.top, look.z);
  out.yaw = p.yaw;
  out.pitch = p.pitch;
  return out;
}

/** The camera's eased state at the table: where across it is and how far back, null until it has started. */
export interface PongCam {
  lat: number;
  back: number;
  started: boolean;
}

export const newPongCam = (): PongCam => ({ lat: 0, back: 0, started: false });

/**
 * One frame (`dt` s) at `end` with the paddle at `back`, `lat`: the camera eases towards its goal (snapping there on the
 * first frame) and its pose is written into `out`.
 */
export function stepPongCam(cam: PongCam, end: End, back: number, lat: number, dt: number, out: CamPose): CamPose {
  const goal = camGoal(back, lat);
  if (!cam.started) {
    cam.lat = goal.lat;
    cam.back = goal.back;
    cam.started = true;
  } else {
    const k = 1 - Math.exp(-Math.max(0, dt) * PONG_CAM.rate);
    cam.lat += (goal.lat - cam.lat) * k;
    cam.back += (goal.back - cam.back) * k;
  }
  return camPose(end, cam.back, cam.lat, out);
}

/** Part way (`t`, 0 to 1, eased) from pose `a` to pose `b`, the short way round in yaw: the flight in and out. */
export function blendCam(a: CamPose, b: CamPose, t: number, out: CamPose): CamPose {
  const k = ease(t);
  out.x = a.x + (b.x - a.x) * k;
  out.y = a.y + (b.y - a.y) * k;
  out.z = a.z + (b.z - a.z) * k;
  out.yaw = a.yaw + angleDelta(a.yaw, b.yaw) * k;
  out.pitch = a.pitch + (b.pitch - a.pitch) * k;
  return out;
}

export const copyCam = (a: CamPose, out: CamPose): CamPose => Object.assign(out, { x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: a.pitch });
