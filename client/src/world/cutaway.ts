// The overview's cutaway, adapted from cubefarm client/src/world/camera/rig.ts (MIT): CUT_PLANES and setCut. cubefarm
// cuts the whole scene; here only the building is cut (its materials carry the planes), so the city stays in view: the
// room loses its ceiling and the walls on the camera's side, and the building loses everything above your floor.
import * as THREE from 'three';
import { nearSides } from './cameraMath';
import { HALF_D, HALF_W, WALL_H } from './layout';

const OPEN = 1e6;
// In from the walls' inner faces, so the window sills (which stick 0.11 m into the room) go with their wall.
const WALL_CUT = 0.15;
const CEILING = new THREE.Plane(new THREE.Vector3(0, -1, 0), OPEN);
const SIDE_X = new THREE.Plane(new THREE.Vector3(-1, 0, 0), OPEN);
const SIDE_Z = new THREE.Plane(new THREE.Vector3(0, 0, -1), OPEN);

/** Where a building material is cut: the room (ceiling and near walls) or what's above your floor (the facade, the balconies). */
export type Cut = 'room' | 'above';

/** The planes each kind of cut uses: shared, so moving the camera never recompiles a shader. */
export const CUT_PLANES: Record<Cut, THREE.Plane[]> = { room: [CEILING, SIDE_X, SIDE_Z], above: [CEILING] };

const sides = { x: 0, z: 0 };

/** Cuts away the ceiling, what's above your floor and the walls facing a camera on bearing `yaw` (the overview). */
export function setCut(yaw: number) {
  CEILING.constant = WALL_H - 0.08;
  nearSides(yaw, sides);
  SIDE_X.constant = sides.x ? HALF_W - WALL_CUT : OPEN;
  SIDE_X.normal.set(-sides.x || -1, 0, 0);
  SIDE_Z.constant = sides.z ? HALF_D - WALL_CUT : OPEN;
  SIDE_Z.normal.set(0, 0, -sides.z || -1);
}

/** Nothing cut away: first person, where you see the ceiling and, out on a balcony, the floors above. */
export function cutOff() {
  CEILING.constant = OPEN;
  SIDE_X.constant = OPEN;
  SIDE_Z.constant = OPEN;
}

/** Whether a point (floor space) is cut away from the room right now, so the overview's clicks go through it. */
export const isCut = (p: THREE.Vector3) => CUT_PLANES.room.some((plane) => plane.distanceToPoint(p) < 0);
