// Adapted from cubefarm client/src/world/Outlines.tsx (MIT), without the batch inks.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store';
import { CUT_PLANES, type Cut } from './cutaway';
import { attachOutline, detachOutline, INK_NEAR, INK_THIN, inkPixels } from './outlineMesh';

// Ink outlines: drei's <Outlines> (an inverted hull drawn behind its parent mesh), with the parts we use and two fixes.
// drei frees the outline's own geometry in a useEffect cleanup that reads its ref, which React 19 has already cleared
// by then, so every outline that unmounts (a floor left, someone let go) kept its GPU buffers. Here the cleanup holds
// on to what it made. And drei's pixel path (`screenspace` off) takes the thickness as pixels of the drawing buffer, so
// the thicknesses written here, in drei's world units, drew lines a fiftieth of a pixel wide that never showed: here
// they're turned into CSS pixels (outlineMesh.ts inkPixels), thinning a little with distance, so the ink reads alike
// walking the floor and in the overview, at any resolution. With the office's ink off (Settings.inkOutlines) no outline
// is made at all, which saves their draw calls.

/** The view's size in CSS pixels, shared by every outline's material; InkViewport keeps it current. */
const INK_SIZE = { value: new THREE.Vector2(typeof window === 'undefined' ? 1280 : window.innerWidth, typeof window === 'undefined' ? 800 : window.innerHeight) };

const OutlinesMaterial = shaderMaterial(
  { screenspace: false, color: new THREE.Color('black'), opacity: 1, thickness: 0.05, px: 1.5, size: new THREE.Vector2() },
  `#include <common>
   #include <morphtarget_pars_vertex>
   #include <skinning_pars_vertex>
   #include <clipping_planes_pars_vertex>
   uniform float thickness;
   uniform float px;
   uniform bool screenspace;
   uniform vec2 size;
   void main() {
     #if defined (USE_SKINNING)
       #include <beginnormal_vertex>
       #include <morphnormal_vertex>
       #include <skinbase_vertex>
       #include <skinnormal_vertex>
       #include <defaultnormal_vertex>
     #endif
     #include <begin_vertex>
     #include <morphtarget_vertex>
     #include <skinning_vertex>
     #include <project_vertex>
     #include <clipping_planes_vertex>
     vec4 tNormal = vec4(normal, 0.0);
     vec4 tPosition = vec4(transformed, 1.0);
     #ifdef USE_INSTANCING
       tNormal = instanceMatrix * tNormal;
       tPosition = instanceMatrix * tPosition;
     #endif
     if (screenspace) {
       vec3 newPosition = tPosition.xyz + tNormal.xyz * thickness;
       gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
     } else {
       vec4 clipPosition = projectionMatrix * modelViewMatrix * tPosition;
       vec4 clipNormal = projectionMatrix * modelViewMatrix * tNormal;
       // px CSS pixels out from the silhouette, thinning past ${INK_NEAR.toFixed(1)} m (outlineMesh.ts inkFade); a normal
       // pointing straight at the camera has no way out and stays put
       float len = length(clipNormal.xy);
       vec2 dir = len > 1e-6 ? clipNormal.xy / len : vec2(0.0);
       float wide = px * clamp(${INK_NEAR.toFixed(3)} / max(clipPosition.w, 1e-6), ${INK_THIN.toFixed(3)}, 1.0);
       clipPosition.xy += dir * wide / size * clipPosition.w * 2.0;
       gl_Position = clipPosition;
     }
   }`,
  `uniform vec3 color;
   uniform float opacity;
   #include <clipping_planes_pars_fragment>
   void main(){
     #include <clipping_planes_fragment>
     gl_FragColor = vec4(color, opacity);
     #include <tonemapping_fragment>
     #include <colorspace_fragment>
   }`,
);

type OutlineMaterial = THREE.ShaderMaterial & { thickness: number; px: number; color: THREE.Color; screenspace: boolean };

/** The ink colour every outline uses. */
export const INK = '#1f1d2b';

/**
 * Inside it, outlines are drawn in metres along the normals (divided by the value, the scale they're drawn at, so they
 * come out as thick as written) instead of in pixels: a person's head (RigBody.tsx), inked like their body.
 */
export const ObjectInk = createContext(0);

/** Whether the office draws ink outlines (Settings.inkOutlines; on unless it's been turned off). */
export const useInk = () => useStore((s) => s.settings.inkOutlines !== false);

/** Keeps the outlines' idea of the view's size current (in the game's canvas). */
export function InkViewport() {
  const size = useThree((s) => s.size);
  useEffect(() => void INK_SIZE.value.set(Math.max(1, size.width), Math.max(1, size.height)), [size.width, size.height]);
  return null;
}

interface InkProps {
  color?: THREE.ColorRepresentation;
  thickness?: number;
  angle?: number;
  cut?: Cut;
}

/** An ink outline round the mesh it's placed in, `thickness` in drei's units; `cut` as its mesh's (cutaway.ts). Nothing with the ink off. */
export function Outlines(props: InkProps) {
  return useInk() ? <Hull {...props} /> : null;
}

function Hull({ color = INK, thickness = 0.05, angle = Math.PI, cut }: InkProps) {
  const ref = useRef<THREE.Group>(null);
  const objectScale = useContext(ObjectInk);
  // the overview's cutaway takes the ink off what it cuts away too
  const [material] = useState(() => {
    const m = new OutlinesMaterial({ side: THREE.BackSide, clipping: !!cut, clippingPlanes: cut ? CUT_PLANES[cut] : null }) as OutlineMaterial;
    m.uniforms.size = INK_SIZE;
    return m;
  });
  const made = useRef<{ group: THREE.Group; geometry: THREE.BufferGeometry | null; angle: number } | null>(null);

  // (Re)build when the parent's geometry or the angle changes, as drei does.
  useLayoutEffect(() => {
    const group = ref.current;
    const parent = group?.parent as THREE.Mesh | null | undefined;
    if (!group || !parent?.geometry) return;
    const m = made.current;
    if (m && m.group === group && m.geometry === parent.geometry && m.angle === angle) return;
    if (m) detachOutline(m.group, m.angle);
    attachOutline(group, parent, material, angle);
    made.current = { group, geometry: parent.geometry, angle };
  });

  useLayoutEffect(() => {
    material.screenspace = objectScale > 0;
    material.thickness = objectScale > 0 ? thickness / objectScale : thickness;
    material.px = inkPixels(thickness);
    material.color.set(color);
  });

  useLayoutEffect(
    () => () => {
      const m = made.current;
      made.current = null;
      if (m) detachOutline(m.group, m.angle);
      material.dispose();
    },
    [material],
  );

  return <group ref={ref} />;
}
