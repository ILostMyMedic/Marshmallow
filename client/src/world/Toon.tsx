// Adapted from cubefarm client/src/world/Toon.tsx (MIT), as plain meshes.
import type { ReactNode } from 'react';
import { toon } from './materials';
import { INK, Outlines } from './Outlines';

// Small building blocks so furniture reads like a cartoon: flat toon shading + ink outlines.

type Vec3 = [number, number, number];

interface Common {
  position?: Vec3;
  rotation?: Vec3;
  color: string;
  outline?: boolean;
  shadow?: boolean;
  children?: ReactNode;
}

const OUTLINE = 0.018;

export function Box({ size, position, rotation, color, outline = false, shadow = true, children }: Common & { size: Vec3 }) {
  return (
    <mesh position={position} rotation={rotation} castShadow={shadow} receiveShadow material={toon(color)}>
      <boxGeometry args={size} />
      {outline && <Outlines thickness={OUTLINE} color={INK} />}
      {children}
    </mesh>
  );
}

export function Cyl({ r, rTop, h, position, rotation, color, outline = false, shadow = true, seg = 20 }: Common & { r: number; rTop?: number; h: number; seg?: number }) {
  return (
    <mesh position={position} rotation={rotation} castShadow={shadow} receiveShadow material={toon(color)}>
      <cylinderGeometry args={[rTop ?? r, r, h, seg]} />
      {outline && <Outlines thickness={OUTLINE} color={INK} />}
    </mesh>
  );
}

export function Ball({ r, position, scale, color, outline = false, shadow = true }: Common & { r: number; scale?: Vec3 }) {
  return (
    <mesh position={position} scale={scale} castShadow={shadow} material={toon(color)}>
      <sphereGeometry args={[r, 20, 14]} />
      {outline && <Outlines thickness={OUTLINE} color={INK} />}
    </mesh>
  );
}

export function Capsule({ r, len, position, rotation, color, outline = false }: Common & { r: number; len: number }) {
  return (
    <mesh position={position} rotation={rotation} castShadow material={toon(color)}>
      <capsuleGeometry args={[r, len, 6, 14]} />
      {outline && <Outlines thickness={0.015} color={INK} />}
    </mesh>
  );
}
