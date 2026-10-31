// Things the player can aim at and press E (or left click) on: the player raycasts against these roots.
// Adapted from cubefarm client/src/world/interact.ts (MIT): the registry and useInteractable.
import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import type { Focus } from './view';

/** A finer target inside an interactable, from where the crosshair hits it; null: the whole. */
export type Pick = (point: THREE.Vector3, root: THREE.Object3D) => Focus | null;

export const interactables = new Map<THREE.Object3D, Focus & { range: number; pick?: Pick }>();

/** Registers the object its ref lands on as something to aim at, within `range` metres; null `focus` registers nothing. */
export function useInteractable<T extends THREE.Object3D>(focus: Focus | null, range = 3.2, pick?: Pick) {
  const ref = useRef<T>(null);
  const key = focus ? `${focus.id}|${focus.label}` : '';
  useEffect(() => {
    const obj = ref.current;
    if (!obj || !focus) return;
    interactables.set(obj, { ...focus, range, pick });
    return () => {
      interactables.delete(obj);
    };
    // focus is recreated every render; key captures what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, range, pick]);
  return ref;
}
