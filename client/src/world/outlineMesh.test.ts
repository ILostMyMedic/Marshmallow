// Adapted from cubefarm client/src/world/outlineMesh.test.ts (MIT).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { attachOutline, detachOutline, INK_NEAR, INK_PX, INK_THIN, inkFade, inkPixels } from './outlineMesh';

const disposed = (g: THREE.BufferGeometry) => {
  const seen = { n: 0 };
  g.addEventListener('dispose', () => void seen.n++);
  return seen;
};

describe('outline meshes', () => {
  it('makes a creased copy of the parent geometry, and frees only that copy', () => {
    const parent = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const group = new THREE.Group();
    parent.add(group);
    const own = disposed(parent.geometry);
    const mesh = attachOutline(group, parent, new THREE.MeshBasicMaterial(), Math.PI);
    expect(group.children).toEqual([mesh]);
    expect(mesh.geometry).not.toBe(parent.geometry);
    const copy = disposed(mesh.geometry);

    // the parent is unmounted too: the group may already be out of the scene, the copy still gets freed
    parent.remove(group);
    detachOutline(group, Math.PI);
    expect(copy.n).toBe(1);
    expect(own.n).toBe(0);
    expect(group.children).toEqual([]);
  });

  it('borrows the parent geometry at angle 0 and never frees it', () => {
    const parent = new THREE.Mesh(new THREE.SphereGeometry(1));
    const group = new THREE.Group();
    const own = disposed(parent.geometry);
    const mesh = attachOutline(group, parent, new THREE.MeshBasicMaterial(), 0);
    expect(mesh.geometry).toBe(parent.geometry);
    detachOutline(group, 0);
    expect(own.n).toBe(0);
    expect(group.children).toEqual([]);
  });

  it('does nothing for an empty group', () => {
    expect(() => detachOutline(new THREE.Group(), Math.PI)).not.toThrow();
  });
});

describe('the ink line', () => {
  it('draws the usual thickness at the usual width, scaling the rest between the thinnest and thickest', () => {
    expect(inkPixels(0.018)).toBeCloseTo(INK_PX.usual);
    expect(inkPixels(0.012)).toBeLessThan(INK_PX.usual);
    expect(inkPixels(0.012)).toBeGreaterThanOrEqual(INK_PX.min);
    expect(inkPixels(0.025)).toBeGreaterThan(INK_PX.usual);
    expect(inkPixels(0.001)).toBe(INK_PX.min); // a mug's still shows
    expect(inkPixels(0.5)).toBe(INK_PX.max);
  });

  it('keeps its width close up and thins with distance, never below INK_THIN of it', () => {
    expect(inkFade(0.3)).toBe(1);
    expect(inkFade(INK_NEAR)).toBe(1);
    expect(inkFade(INK_NEAR * 1.2)).toBeLessThan(1);
    expect(inkFade(1000)).toBe(INK_THIN);
    expect(inkFade(0)).toBe(1);
  });
});
