// A person's body in the office's style (bodyStyle.ts): one of the character lab's designs (lab/designs.ts) built for
// their look and skinned to the lab's rig (lab/rig.ts). The whole body is one skinned mesh in vertex colours (a draw call,
// one for its ink shell and one for the unlined details), the game's head rides the head bone at the style's scale, and
// the Poser shows the poses bodyPoses.ts makes, crossfading the upper body when what they do changes. Bodies are built
// once per look and style and shared (a floor seen again costs nothing), freed a while after nobody wears them.
import { Fragment, useEffect, useMemo, type ReactNode } from 'react';
import { createPortal } from '@react-three/fiber';
import * as THREE from 'three';
import type { BodyStyle } from '../../../shared/types';
import { DESIGN_OF, type Built, type Role } from '../lab/designs';
import { bodyMaterial, inkMaterial } from '../lab/ink';
import { BI, bindOffsets, bindPositions, BONES, blendSolved, N_BONES, newSolved, PARENT, solve, worldOf, type Bone, type Pose, type Proportions, type Solved, type V3 } from '../lab/rig';
import type { Appearance } from './appearance';
import { useStore } from '../store';
import { parseBodyStyle } from './bodyStyle';
import { useInk } from './Outlines';

/** The office's body style, live from the settings. */
export const useBodyStyle = (): BodyStyle => useStore((s) => parseBodyStyle(s.settings.bodyStyle));

// ---------- the shared builds ----------

interface Entry {
  built: Built;
  users: number;
  /** When the last user let go (performance.now()), for freeing the oldest unused first. */
  idle: number;
}

const builds = new Map<string, Entry>();
/** Bodies kept built while nobody wears them (a floor left and come back to). */
const KEEP_UNUSED = 48;

const keyOf = (style: BodyStyle, role: Role, look: Appearance) => `${style}|${role}|${JSON.stringify(look)}`;

function take(style: BodyStyle, role: Role, look: Appearance): Entry {
  const key = keyOf(style, role, look);
  let e = builds.get(key);
  if (!e) {
    e = { built: DESIGN_OF[style].build(look, role), users: 0, idle: 0 };
    builds.set(key, e);
  }
  return e;
}

function release(e: Entry) {
  e.users = Math.max(0, e.users - 1);
  if (e.users) return;
  e.idle = performance.now();
  const unused = [...builds].filter(([, b]) => b.users === 0).sort((a, b) => a[1].idle - b[1].idle);
  for (const [key, b] of unused.slice(0, Math.max(0, unused.length - KEEP_UNUSED))) {
    b.built.body.dispose();
    b.built.detail?.dispose();
    builds.delete(key);
  }
}

// ---------- one body ----------

export interface BodyRig {
  built: Built;
  props: Proportions;
  bones: THREE.Bone[];
  root: THREE.Bone;
  meshes: THREE.Mesh[];
  /** The top of the head standing, and its middle, in figure space. */
  top: number;
  headY: number;
}

/** Every bone's offset in its parent's frame with nothing turned, and a skeleton binding a body to them. */
function makeSkeleton(p: Proportions) {
  const off = bindOffsets(p);
  const bones = BONES.map((name, i) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(...off[i]);
    return b;
  });
  bones.forEach((b, i) => PARENT[i] >= 0 && bones[PARENT[i]].add(b));
  const inverses = bindPositions(p).map(([x, y, z]) => new THREE.Matrix4().makeTranslation(-x, -y, -z));
  return { root: bones[0], bones, skeleton: new THREE.Skeleton(bones, inverses) };
}

const noRay = () => {};
const box = new THREE.Box3();
const hit = new THREE.Vector3();
const local = new THREE.Ray();
const inv = new THREE.Matrix4();

function skinnedMesh(geometry: THREE.BufferGeometry, material: THREE.Material, skeleton: THREE.Skeleton, top: number, aim: boolean) {
  const m = new THREE.SkinnedMesh(geometry, material);
  m.bind(skeleton, new THREE.Matrix4());
  m.castShadow = aim;
  // bounds that hold any pose (arms up, bent double, sat with the legs out), so culling never needs the skinned vertices
  m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, top * 0.5, -0.1), top * 0.62 + 0.35);
  m.boundingBox = new THREE.Box3(new THREE.Vector3(-0.32, 0, -0.55), new THREE.Vector3(0.32, top + 0.05, 0.3));
  // aiming at someone hits a box round them, not their skinned triangles (far too slow to test every few frames)
  m.raycast = aim
    ? (raycaster, out) => {
        inv.copy(m.matrixWorld).invert();
        local.copy(raycaster.ray).applyMatrix4(inv);
        if (!local.intersectBox(box.copy(m.boundingBox!), hit)) return;
        hit.applyMatrix4(m.matrixWorld);
        const distance = raycaster.ray.origin.distanceTo(hit);
        if (distance >= raycaster.near && distance <= raycaster.far) out.push({ distance, point: hit.clone(), object: m });
      }
    : noRay;
  return m;
}

/** A body for `look` in `style` (the CEO's in a suit), its own skeleton and meshes, the build shared. */
export function useBody(look: Appearance, role: Role, style: BodyStyle): BodyRig {
  const entry = useMemo(() => take(style, role, look), [style, role, look]);
  // counted in an effect, so a render React throws away never holds a body
  useEffect(() => {
    entry.users++;
    return () => release(entry);
  }, [entry]);
  const rig = useMemo(() => {
    const { built } = entry;
    const props = built.props;
    const sk = makeSkeleton(props);
    const bind = bindPositions(props);
    const headY = bind[BI.head][1];
    const top = headY + props.headR;
    const ink = skinnedMesh(built.body, inkMaterial(built.ink), sk.skeleton, top, false);
    ink.userData.ink = true;
    const meshes = [skinnedMesh(built.body, bodyMaterial, sk.skeleton, top, true), ink];
    if (built.detail) meshes.push(skinnedMesh(built.detail, bodyMaterial, sk.skeleton, top, false));
    return { built, props, bones: sk.bones, root: sk.root, meshes, top, headY, skeleton: sk.skeleton };
  }, [entry]);
  useEffect(() => () => rig.skeleton.dispose(), [rig]);
  return rig;
}

/** The body's bones and meshes, to put in a person's group (its origin on the floor between the feet); no ink shell with the office's ink off. */
export function BodyMeshes({ body }: { body: BodyRig }) {
  const ink = useInk();
  return (
    <>
      <primitive object={body.root} />
      {body.meshes.map((m) => (ink || !m.userData.ink) && <primitive key={m.uuid} object={m} />)}
    </>
  );
}

/**
 * Things that move with a bone (the head on the head bone): in its frame, which faces the way the body does. Keyed by the
 * bone, so a new skeleton (a change of body style) mounts them afresh on it: R3F's portal, handed a new container, builds
 * its store with the callback it had for the old one and mounts into the old bone, gone from the scene (OnBone.test.tsx).
 */
export function OnBone({ body, bone, children }: { body: BodyRig; bone: Bone; children: ReactNode }) {
  const at = body.bones[BI[bone]];
  return <Fragment key={at.uuid}>{createPortal(children, at)}</Fragment>;
}

// ---------- showing poses ----------

/** The bones a change of pose crossfades: all but the legs, which follow the body's steps and seat as they are. */
const UPPER = BONES.map((_, i) => i).filter((i) => !/^(thigh|shin|foot)/.test(BONES[i]));
/** Seconds a change of pose crossfades over. */
export const CROSSFADE_S = 0.35;

/**
 * Shows a body's poses: sat (`k` 1), up (0) or blended between while they get up or sit down, the upper body eased
 * over from what showed whenever `key` (what they're doing) changes. Every bone's place in figure space after each show.
 */
export class Poser {
  private sat = newSolved();
  private up = newSolved();
  private snap = newSolved();
  private target = newSolved();
  readonly shown = newSolved();
  private key = '';
  private from = -Infinity;
  readonly pos = new Float32Array(N_BONES * 3);
  readonly rot = new Float32Array(N_BONES * 4);
  private started = false;

  constructor(readonly props: Proportions) {}

  show(bones: THREE.Bone[], now: number, key: string, k: number, seated: Pose | null, standing: Pose | null) {
    const p = this.props;
    if (seated && standing && k > 0 && k < 1) blendSolved(solve(standing, p, this.up), solve(seated, p, this.sat), k, this.target);
    else if (seated && (k >= 1 || !standing)) solve(seated, p, this.target);
    else if (standing) solve(standing, p, this.target);
    if (key !== this.key) {
      if (this.started) {
        this.snap.q.set(this.shown.q);
        this.from = now;
      }
      this.key = key;
    }
    this.started = true;
    const w = Math.min(1, Math.max(0, (now - this.from) / CROSSFADE_S));
    this.shown.q.set(this.target.q);
    this.shown.pelvis.set(this.target.pelvis);
    if (w < 1) {
      const e = w * w * (3 - 2 * w);
      const [o, a, b] = [this.shown.q, this.snap.q, this.target.q] as unknown as number[][];
      for (const i of UPPER) THREE.Quaternion.slerpFlat(o, i * 4, a, i * 4, b, i * 4, e);
    }
    for (let i = 0; i < N_BONES; i++) bones[i].quaternion.fromArray(this.shown.q, i * 4);
    bones[BI.pelvis].position.fromArray(this.shown.pelvis);
    worldOf(this.shown, p, this.pos, this.rot);
  }

  /** Where a point given in a bone's frame is now, in figure space. */
  at(bone: number, v: V3, out: THREE.Vector3) {
    return out.set(v[0], v[1], v[2]).applyQuaternion(q.fromArray(this.rot, bone * 4)).add(t.fromArray(this.pos, bone * 3));
  }
}

const q = new THREE.Quaternion();
const t = new THREE.Vector3();

// ---------- who's worth posing ----------

/** Past this far (m) from the camera, a body is posed every other frame. */
export const FAR = 16;
const frustum = new THREE.Frustum();
const viewProj = new THREE.Matrix4();
const ball = new THREE.Sphere();
let frustumFrame = -1;

/**
 * Whether a body (its figure group, `top` tall) is in the camera's view this frame (`frame`: the renderer's count, so
 * the view is worked out once a frame): 0 out of it, 1 in it, 2 in it but further off than FAR.
 */
export function viewOf(camera: THREE.Camera, group: THREE.Object3D, top: number, frame: number): 0 | 1 | 2 {
  if (frame !== frustumFrame) {
    frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    frustumFrame = frame;
  }
  group.getWorldPosition(ball.center);
  ball.center.y += top * 0.5;
  ball.radius = top * 0.62 + 0.35;
  if (!frustum.intersectsSphere(ball)) return 0;
  return ball.center.distanceToSquared(camera.position) > FAR * FAR ? 2 : 1;
}

/** For tests and checks: a fresh solve of one pose. */
export const solveOnce = (pose: Pose, p: Proportions): Solved => solve(pose, p, newSolved());

// ---------- the first-person arm ----------

const arms = new WeakMap<Built, THREE.BufferGeometry>();

/**
 * The right forearm and hand cut out of a built body (the triangles wholly on those bones), as a plain mesh with the
 * palm at its origin and the forearm running back along +Z: your own hand in first person, holding what you hold.
 */
export function forearmOf(built: Built): THREE.BufferGeometry {
  let g = arms.get(built);
  if (g) return g;
  const src = built.body;
  const idx = src.index!;
  const si = src.attributes.skinIndex;
  const sw = src.attributes.skinWeight;
  const keep = (v: number) => sw.getX(v) > 0.999 && (si.getX(v) === BI.forearmR || si.getX(v) === BI.handR);
  const tris: number[] = [];
  for (let i = 0; i < idx.count; i += 3) if (keep(idx.getX(i)) && keep(idx.getX(i + 1)) && keep(idx.getX(i + 2))) tris.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  const used = [...new Set(tris)];
  const remap = new Map(used.map((v, i) => [v, i]));
  g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color', 'inkScale'] as const) {
    const a = src.attributes[name];
    const out = new Float32Array(used.length * a.itemSize);
    used.forEach((v, i) => {
      for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(v, c);
    });
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  g.setIndex(tris.map((v) => remap.get(v)!));
  const wrist = bindPositions(built.props)[BI.handR];
  g.translate(-wrist[0], -wrist[1], -wrist[2]);
  g.rotateX(Math.PI / 2);
  // the palm's middle at the origin, where the old figure's round hand was
  g.translate(0, 0, built.props.hand * 0.55);
  arms.set(built, g);
  return g;
}

/** A plain (unskinned) mesh in the body's shading with its ink (unless the office's is off), for forearmOf's geometry. */
export function ArmPiece({ built }: { built: Built }) {
  const geometry = useMemo(() => forearmOf(built), [built]);
  const ink = useInk();
  return (
    <>
      <mesh geometry={geometry} material={bodyMaterial} />
      {ink && <mesh geometry={geometry} material={inkMaterial(built.ink)} />}
    </>
  );
}
