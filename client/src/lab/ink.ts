// The lab bodies' shading: the game's toon ramp (materials.ts) coloured by each body's vertex colours, and an ink shell
// that follows the skinning. drei's hull (Outlines.tsx) offsets along the unskinned normal, so on a bent limb its ink
// would drift off the silhouette; this one skins the normal too. Its thickness is in metres, like an ink shell drawn
// round the body, so it thins with distance as the rest of the drawing does.
import * as THREE from 'three';
import { toon } from '../world/materials';
import { INK } from '../world/Outlines';

/** One material for every lab body: the toon ramp with vertex colours. */
export const bodyMaterial = new THREE.MeshToonMaterial({
  color: '#ffffff',
  vertexColors: true,
  gradientMap: (toon('#ffffff') as THREE.MeshToonMaterial).gradientMap,
});

const inks = new Map<number, THREE.ShaderMaterial>();

/** The ink shell for a skinned body, `thickness` metres out along its (skinned) normals. Shared per thickness. */
export function inkMaterial(thickness: number) {
  let m = inks.get(thickness);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: { thickness: { value: thickness }, color: { value: new THREE.Color(INK) } },
      vertexShader: /* glsl */ `
        #include <common>
        #include <skinning_pars_vertex>
        uniform float thickness;
        attribute float inkScale; // each part's own weight of line (build.ts Body)
        void main() {
          #include <beginnormal_vertex>
          #include <skinbase_vertex>
          #include <skinnormal_vertex>
          #include <begin_vertex>
          #include <skinning_vertex>
          vec3 grown = transformed + normalize(objectNormal) * thickness * inkScale;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(grown, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        void main() {
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
    });
    inks.set(thickness, m);
  }
  return m;
}

type OutlineUniforms = { screenspace: { value: boolean }; thickness: { value: number } };
const base = new WeakMap<THREE.Material, { set: number; base: number }>();

/**
 * The game's own outlines (Outlines.tsx, on the head's parts) are drawn a pixel or two wide whatever the distance. In
 * the lab they're switched to drei's object-space shell, the thickness they were written for, divided by
 * `scale` so a bigger head keeps the body's line; or hidden when `on` is false.
 */
export function inkGameOutlines(root: THREE.Object3D, on: boolean, scale: number) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const mat = mesh.material as THREE.ShaderMaterial | undefined;
    const u = mat?.uniforms as OutlineUniforms | undefined;
    if (!mesh.isMesh || !u?.screenspace || !u.thickness) return;
    mesh.visible = on;
    let b = base.get(mat!);
    // the component writes its own thickness back whenever it re-renders: take that as the new base
    if (!b || u.thickness.value !== b.set) b = { set: 0, base: u.thickness.value };
    b.set = b.base / scale;
    base.set(mat!, b);
    u.screenspace.value = true;
    u.thickness.value = b.set;
  });
}
