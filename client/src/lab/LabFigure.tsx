// One design on the rig: its body as a skinned mesh (one draw call, one for its ink, one for the unlined details), the
// game's head and face on the head bone, a mug in the hand while sipping, the Zzz while asleep. Every frame it solves
// the playing animation for this design's proportions, blending from what it showed when the animation changed.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Appearance } from '../world/appearance';
import { Piece } from '../world/Batched';
import { PARTS } from '../world/characterParts';
import { blink, newFace, stepFace } from '../world/face';
import { applyFace, HeadParts } from '../world/Figure';
import { shade } from '../world/materials';
import { MugLook } from '../world/mugLook';
import { Zzz } from '../world/Zzz';
import { triangles } from './build';
import type { Design } from './designs';
import { bodyMaterial, inkGameOutlines, inkMaterial } from './ink';
import { blendSeconds, blendWeight } from './player';
import { ANIMS } from './poses';
import { BI, bindOffsets, bindPositions, BONES, blendSolved, N_BONES, newSolved, PARENT, solve, worldOf, type Proportions } from './rig';
import { labClock, useLab, type Stats } from './state';

const SUIT = '#2b2d42'; // the headphones' shell (Figure.tsx)
/** A held mug's middle sits this far in from the grip (figure space), so its handle (+X) is in the hand. */
const MUG_IN = 0.07;
/** Headphones round the neck lie tipped forward (Figure.tsx TorsoWear). */
const PHONES_TIP = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.5, 0, 0));

/** The rig's bones in their bind pose, and the skeleton that skins a body to them. */
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

function skinned(geometry: THREE.BufferGeometry, material: THREE.Material, skeleton: THREE.Skeleton, shadow: boolean) {
  const m = new THREE.SkinnedMesh(geometry, material);
  m.bind(skeleton, new THREE.Matrix4());
  m.frustumCulled = false; // the bounds are the bind pose's
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

/**
 * Draw calls (colour and shadow passes) and triangles under `root`, skipping what's hidden (but not `root` itself) and
 * props (userData.prop: the mug, the Zzz); what's under `head` (the game's head) is counted apart too.
 */
export function countDraws(root: THREE.Object3D, head: THREE.Object3D | null): Stats {
  const s: Stats = { draws: 0, shadows: 0, triangles: 0, headDraws: 0, headTriangles: 0 };
  const walk = (o: THREE.Object3D, inHead: boolean) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const tris = triangles(mesh.geometry);
      s.draws++;
      if (mesh.castShadow) s.shadows++;
      s.triangles += tris;
      if (inHead) {
        s.headDraws++;
        s.headTriangles += tris;
      }
    }
    for (const c of o.children) if (c.visible && !c.userData.prop) walk(c, inHead || c === head);
  };
  walk(root, false);
  return s;
}

export function LabFigure({ design, look, group }: { design: Design; look: Appearance; group: (g: THREE.Group | null) => void }) {
  const built = useMemo(() => design.build(look), [design, look]);
  const props = built.props;
  const rig = useMemo(() => makeSkeleton(props), [props]);
  const meshes = useMemo(
    () => ({
      body: skinned(built.body, bodyMaterial, rig.skeleton, true),
      ink: skinned(built.body, inkMaterial(built.ink), rig.skeleton, false),
      detail: built.detail ? skinned(built.detail, bodyMaterial, rig.skeleton, false) : null,
    }),
    [built, rig],
  );
  useEffect(
    () => () => {
      built.body.dispose();
      built.detail?.dispose();
      rig.skeleton.dispose();
    },
    [built, rig],
  );
  const busy = useLab((s) => s.anim === 'type');
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const faceMesh = useRef<THREE.Mesh>(null);
  const phones = useRef<THREE.Group>(null);
  const mug = useRef<THREE.Group>(null);
  const zzz = useRef<THREE.Group>(null);
  const asleep = useRef(false);
  const st = useMemo(
    () => ({
      anim: useLab.getState().anim,
      from: -1,
      blend: 0.45,
      snap: newSolved(),
      cur: newSolved(),
      shown: newSolved(),
      pos: new Float32Array(N_BONES * 3),
      rot: new Float32Array(N_BONES * 4),
      face: newFace(),
      lids: 0,
      frames: 0,
      q: new THREE.Quaternion(),
      v: new THREE.Vector3(),
    }),
    [],
  );
  const seed = useMemo(() => Math.floor(look.height * 1000 + look.shoulders * 97) % 10007, [look]);

  useFrame((_, delta) => {
    const lab = useLab.getState();
    const t = labClock.t;
    if (lab.anim !== st.anim) {
      // blend from whatever was showing, so switching mid-blend never jumps
      st.snap.q.set(st.shown.q);
      st.snap.pelvis.set(st.shown.pelvis);
      st.from = t;
      st.blend = blendSeconds(st.anim, lab.anim);
      st.anim = lab.anim;
    }
    const f = ANIMS[st.anim](Math.max(0, t - lab.at), props);
    solve(f.pose, props, st.cur);
    const w = st.from < 0 ? 1 : blendWeight(t, st.from, st.blend);
    if (w < 1) blendSolved(st.snap, st.cur, w, st.shown);
    else {
      st.shown.q.set(st.cur.q);
      st.shown.pelvis.set(st.cur.pelvis);
    }
    const bones = rig.bones;
    for (let i = 0; i < N_BONES; i++) bones[i].quaternion.fromArray(st.shown.q, i * 4);
    bones[BI.pelvis].position.fromArray(st.shown.pelvis);
    worldOf(st.shown, props, st.pos, st.rot);

    const h = head.current;
    if (h) {
      h.position.fromArray(st.pos, BI.head * 3);
      h.quaternion.fromArray(st.rot, BI.head * 4);
    }
    const ph = phones.current;
    if (ph) {
      st.q.fromArray(st.rot, BI.chest * 4);
      ph.position.set(...built.phones.at).applyQuaternion(st.q).add(st.v.fromArray(st.pos, BI.chest * 3));
      ph.quaternion.copy(st.q).multiply(PHONES_TIP);
    }
    // the mug: upright in the hand's grip, tipped to the lips for a sip
    const mg = mug.current;
    if (mg) {
      mg.visible = f.mug > 0.5 && w > 0.5;
      if (mg.visible) {
        st.q.fromArray(st.rot, BI.handR * 4);
        mg.position.set(...built.grip).applyQuaternion(st.q).add(st.v.fromArray(st.pos, BI.handR * 3));
        mg.position.x -= MUG_IN;
        mg.rotation.set(f.tilt, 0, 0);
      }
    }
    asleep.current = f.zzz && w > 0.6;
    const z = zzz.current;
    if (z) z.position.fromArray(st.pos, BI.head * 3).add(st.v.set(0.12, 0.2, 0).multiplyScalar(built.headScale));
    // the face eases to the animation's expression (on real time, so a paused figure still settles); the lids follow a
    // blink, or stay shut asleep
    const dt = Math.min(delta, 0.1);
    stepFace(st.face, f.face, dt);
    st.lids += (f.lids * w - st.lids) * (1 - Math.exp(-dt * 6));
    applyFace(faceMesh, st.face, Math.max(st.lids, blink(t, seed)));

    meshes.ink.visible = lab.outlines;
    if (root.current && st.frames++ % 20 === 0) {
      inkGameOutlines(root.current, lab.outlines, built.headScale);
      lab.setStats(design.id, countDraws(root.current, head.current));
    }
  });

  return (
    <group
      ref={(g) => {
        root.current = g;
        group(g);
      }}
    >
      <primitive object={rig.root} />
      <primitive object={meshes.body} />
      <primitive object={meshes.ink} />
      {meshes.detail && <primitive object={meshes.detail} />}
      <group ref={head} scale={built.headScale} userData={{ labHead: true }}>
        <HeadParts look={look} busy={busy} face={faceMesh} />
      </group>
      {look.headphones && !busy && (
        <group ref={phones} scale={built.phones.scale}>
          <Piece geometry={PARTS.headphones.shell} color={SUIT} castShadow />
          <Piece geometry={PARTS.headphones.covers} color={shade(look.shirt, 0.12)} />
        </group>
      )}
      <group ref={mug} visible={false} scale={1.25} userData={{ prop: true }}>
        <MugLook color={shade(look.shirt, 0.1)} sips={2} shadow={false} />
      </group>
      <group ref={zzz} userData={{ prop: true }}>
        <Zzz on={asleep} position={[0, 0, 0]} />
      </group>
    </group>
  );
}
