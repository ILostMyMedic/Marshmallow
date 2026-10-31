// Adapted from cubefarm client/src/world/Batched.tsx and batch.ts (MIT): the Part and Piece API, drawn as plain meshes.
import type { Ref } from 'react';
import * as THREE from 'three';
import type { Cut } from './cutaway';
import { glow, toon } from './materials';
import { INK, Outlines } from './Outlines';

// A part of a desk, a chair or a person: its shared geometry, its shading and its outline. cubefarm draws these as
// instances of their shape inside a floor's batches; here each one is its own mesh, behind the same API, so batching
// can be added later without touching the parts.

export type Shading = 'toon' | 'glow';

export interface Look {
  readonly key: string;
  readonly geometry: THREE.BufferGeometry;
  readonly shading: Shading;
  /** Ink outline thickness in Outlines.tsx's units; 0 for none. */
  readonly outline: number;
  /** The outline's normals smoothed across edges up to this angle (Outlines.tsx), so a box's hull has no gaps. */
  readonly crease: number;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  /** Part of the building the overview cuts away (cutaway.ts). */
  readonly cut?: Cut;
}

const looks = new Map<string, Look>();

/** The look of a shared geometry, made once per set of options. */
export function look(geometry: THREE.BufferGeometry, opts: Partial<Omit<Look, 'key' | 'geometry'>> = {}): Look {
  const l = { geometry, shading: opts.shading ?? 'toon', outline: opts.outline ?? 0, crease: opts.crease ?? 0, castShadow: opts.castShadow ?? false, receiveShadow: opts.receiveShadow ?? false, cut: opts.cut };
  const key = `${geometry.uuid}|${l.shading}|${l.outline}|${l.crease}|${+l.castShadow}${+l.receiveShadow}|${l.cut ?? ''}`;
  let found = looks.get(key);
  if (!found) {
    found = { key, ...l };
    looks.set(key, found);
  }
  return found;
}

type Vec3 = [number, number, number];
interface PartProps {
  look: Look;
  color: string;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3 | number;
  /** The mesh: for a face's morph weights. */
  ref?: Ref<THREE.Mesh>;
}

/** One part, in its colour. */
export function Part({ look: l, color, position, rotation, scale, ref }: PartProps) {
  const material = l.shading === 'toon' ? toon(color, { cut: l.cut }) : glow(color, l.cut);
  return (
    <mesh ref={ref} geometry={l.geometry} material={material} position={position} rotation={rotation} scale={scale} castShadow={l.castShadow} receiveShadow={l.receiveShadow}>
      {l.outline > 0 && <Outlines thickness={l.outline} color={INK} angle={l.crease} cut={l.cut} />}
    </mesh>
  );
}

/** A mesh of shared geometry in a flat toon colour (people's parts, characterParts.ts), with an ink outline of `outline` thickness if it has one. */
export function Piece({ geometry, color, outline = 0, castShadow = false, ...rest }: Omit<PartProps, 'look'> & { geometry: THREE.BufferGeometry; outline?: number; castShadow?: boolean }) {
  return <Part look={look(geometry, { outline, castShadow })} color={color} {...rest} />;
}
