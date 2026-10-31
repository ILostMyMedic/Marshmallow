// A texture painted on a 2D canvas (signs, name tags, screens): repainted when its inputs change, and once the
// office's fonts have loaded. Adapted from cubefarm client/src/world/interact.ts (MIT): useCanvasTexture, without the
// distance throttle.
import { useEffect, useLayoutEffect, useMemo, useRef, type DependencyList } from 'react';
import * as THREE from 'three';

export function useCanvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void, deps: DependencyList) {
  const made = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return { ctx: canvas.getContext('2d')!, texture };
  }, [w, h]);
  const latest = useRef(paint);
  latest.current = paint;
  useLayoutEffect(() => {
    made.ctx.clearRect(0, 0, w, h);
    latest.current(made.ctx);
    made.texture.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [made, ...deps]);
  useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => {
      if (!live) return;
      made.ctx.clearRect(0, 0, w, h);
      latest.current(made.ctx);
      made.texture.needsUpdate = true;
    });
    return () => {
      live = false;
      made.texture.dispose();
    };
  }, [made, w, h]);
  return made.texture;
}
