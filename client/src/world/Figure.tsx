// Adapted from cubefarm client/src/world/Figure.tsx (MIT): the head, its face and what's worn on it. The body is the
// office's style (RigBody.tsx); this is the head every style wears, at its own scale.
import { useLayoutEffect, type RefObject } from 'react';
import type * as THREE from 'three';
import { ACCENTS, type Appearance } from './appearance';
import { hairUnder, PARTS } from './characterParts';
import { EYES, MORPHS, MORPH_AT, type FaceState } from './face';
import { Piece } from './Batched';
import { mix, shade } from './materials';
import { INK } from './Outlines';

// The head's parts, as Pieces of shared geometry (characterParts.ts); applyFace writes an expression into the face's
// morph targets.

// Glasses frames, picked by the same accent index as hats and stripes.
const FRAMES = ['#1f1d2b', '#7f5539', '#1f1d2b', '#c1121f', '#355070', '#1f1d2b'];
const SUIT = '#2b2d42';

/** Headphones on the head while working (resting round the neck otherwise: Character.tsx). */
const phonesOn = (look: Appearance, busy: boolean) => look.headphones && busy;

function Headphones({ look }: { look: Appearance }) {
  return (
    <>
      <Piece geometry={PARTS.headphones.shell} color={SUIT} castShadow />
      <Piece geometry={PARTS.headphones.covers} color={shade(look.shirt, 0.12)} />
    </>
  );
}

/**
 * Headphones resting round the neck (chest-bone space, where the body's design says: Built.phones), tipped forward; on the
 * head instead while they work (HeadParts).
 */
export function NeckPhones({ look, at, scale }: { look: Appearance; at: readonly [number, number, number]; scale: number }) {
  return (
    <group position={[at[0], at[1], at[2]]} rotation={[Math.PI / 2 - 0.5, 0, 0]} scale={scale}>
      <Headphones look={look} />
    </group>
  );
}

/** Writes a face's weights into its mesh, the eyelids closed at least `lid` of the way (a blink, or asleep). */
export function applyFace(face: RefObject<THREE.Mesh | null>, f: FaceState, lid: number) {
  const w = face.current?.morphTargetInfluences;
  if (!w) return;
  for (let i = 0; i < MORPHS; i++) w[i] = f.w[i];
  // a closing lid takes over from wide or happy eyes, so the eyes' weights never add up past 1
  for (let i = MORPH_AT.eyes; i < MORPH_AT.brows; i++) w[i] *= 1 - lid;
  w[MORPH_AT.eyes + EYES.closed] += lid;
}

const CLIPPED_HAIR = ['long', 'ponytail', 'bun', 'sidePart', 'curls', 'bob'];

/** Head-space (origin at the middle of the head, facing -Z): the head, hair, face, glasses, hats and headphones. */
export function HeadParts({ look, busy, face }: { look: Appearance; busy: boolean; face: RefObject<THREE.Mesh | null> }) {
  const feminine = look.look === 'feminine';
  const skin = look.skin;
  const hair = look.hair === 'buzz' ? mix(look.hairColor, look.skin, 0.35) : look.hairColor;
  const hairGeo = hairUnder(look.headwear, look.hair);
  const facialGeo = PARTS.facialHair[look.facialHair];
  const glassesGeo = PARTS.glasses[look.glasses];
  const hatGeo = PARTS.headwear[look.headwear];
  const outlinedHair = look.hair !== 'buzz' && look.hair !== 'bald';
  const clip = feminine && look.headwear === 'none' && CLIPPED_HAIR.includes(look.hair);
  const faceGeo = feminine ? PARTS.faceLashes : PARTS.face;
  // R3F sets the geometry after making the mesh, so the morph weights are set up here, once per geometry.
  useLayoutEffect(() => face.current?.updateMorphTargets(), [face, faceGeo]);
  return (
    <>
      <Piece geometry={PARTS.head} color={skin} castShadow outline={0.015} />
      {hairGeo && <Piece geometry={hairGeo} color={hair} castShadow={outlinedHair} outline={outlinedHair ? 0.012 : 0} />}
      <Piece geometry={PARTS.ears} color={skin} />
      <Piece ref={face} geometry={faceGeo} color={INK} />
      <Piece position={[0, -0.02, -0.2]} geometry={PARTS.nose} color={shade(look.skin, -0.08)} />
      {facialGeo && <Piece geometry={facialGeo} color={look.facialHair === 'stubble' ? mix(look.skin, look.hairColor, 0.3) : look.hairColor} />}
      {feminine && <Piece geometry={PARTS.cheeks} color="#ff9aa2" />}
      {clip && <Piece position={[0.15, 0.13, -0.08]} rotation={[0, 0, 0.5]} geometry={PARTS.hairClip} color={shade(look.shirt, 0.15)} />}
      {glassesGeo && <Piece geometry={glassesGeo} color={FRAMES[look.accent]} />}
      {hatGeo && <Piece geometry={hatGeo} color={look.accent === 0 ? shade(look.shirt, -0.2) : ACCENTS[look.accent]} castShadow outline={0.012} />}
      {phonesOn(look, busy) && <Headphones look={look} />}
    </>
  );
}
