// Adapted from cubefarm client/src/world/outlineMesh.ts (MIT).
import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The mesh behind an ink outline (Outlines.tsx), and how wide its line is drawn, kept apart from React so making and
// freeing it can be tested.

/**
 * The ink line in CSS pixels: the usual outline's (a thickness of 0.018 as written), and the thinnest and thickest any
 * outline is drawn. Thinner thicknesses (a mug's) and thicker ones (the roof's planters) scale from the usual between them.
 */
export const INK_PX = { usual: 1.5, min: 1, max: 2.2 };
/** The thickness as written that draws INK_PX.usual. */
const USUAL = 0.018;
/**
 * Within this far (m) of the camera a line is drawn its full width; further off it thins as the drawing does, down to
 * INK_THIN of it, so the overview's small things aren't swamped by ink.
 */
export const INK_NEAR = 8;
export const INK_THIN = 0.65;

/** An outline's width in CSS pixels close up, for its thickness as written (drei's units). */
export const inkPixels = (thickness: number) => Math.min(INK_PX.max, Math.max(INK_PX.min, (thickness / USUAL) * INK_PX.usual));

/** How much of that width a line `distance` metres from the camera keeps (the shader's own sum, Outlines.tsx). */
export const inkFade = (distance: number) => Math.min(1, Math.max(INK_THIN, INK_NEAR / Math.max(distance, 1e-6)));

/**
 * Puts the outline mesh for `parent` into `group` (detach the old one first): the parent's own geometry when `angle` is 0,
 * else a copy with normals smoothed across edges up to that angle, so a box's hull has no gaps at its corners.
 */
export function attachOutline(group: THREE.Object3D, parent: THREE.Mesh, material: THREE.Material, angle: number) {
  const mesh = new THREE.Mesh(angle ? toCreasedNormals(parent.geometry, angle) : parent.geometry, material);
  group.add(mesh);
  return mesh;
}

/** Takes the outline mesh out of `group` and frees the geometry it made (never the parent's, which it only borrows). */
export function detachOutline(group: THREE.Object3D, angle: number) {
  const mesh = group.children[0] as THREE.Mesh | undefined;
  if (!mesh) return;
  if (angle) mesh.geometry.dispose();
  group.remove(mesh);
}
