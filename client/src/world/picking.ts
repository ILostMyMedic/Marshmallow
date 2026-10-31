// Adapted from cubefarm client/src/world/camera/picking.ts (MIT): the overview's picks (the building view's floor slices
// and hiring at an empty desk are cut).

// What a click in the overview lands on: a person's status chip (OverviewChips.tsx), or anything you could press E on
// that opens a panel. Range doesn't matter from up here; what the cutaway hides can't be clicked through.
import type * as THREE from 'three';
import { isCut } from './cutaway';
import { interactables } from './interact';
import { isPanel, type Focus } from './view';

/** Chips: objects with a `userData.pick` (a Focus) that clicks find before anything else. */
export const pickables = new Set<THREE.Object3D>();

const roots: THREE.Object3D[] = [];
const hits: THREE.Intersection[] = [];

/** What a click along `ray` would open: a chip first (they're drawn over everything), then the nearest thing with a panel. */
export function pickAt(ray: THREE.Raycaster): Focus | null {
  roots.length = 0;
  for (const o of pickables) roots.push(o);
  for (const o of interactables.keys()) roots.push(o);
  hits.length = 0;
  ray.intersectObjects(roots, true, hits);
  let found: Focus | null = null;
  for (const h of hits) {
    let o: THREE.Object3D | null = h.object;
    let shown = o.visible;
    while (o && !o.userData.pick && !interactables.has(o)) {
      o = o.parent;
      shown &&= !o || o.visible;
    }
    if (!o || !shown || !o.visible) continue;
    if (o.userData.pick) return o.userData.pick as Focus;
    if (found || isCut(h.point)) continue;
    const info = interactables.get(o)!;
    if (isPanel(info.action)) found = { id: info.id, label: info.label, action: info.action };
  }
  return found;
}
