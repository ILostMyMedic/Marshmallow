// The lookouts: a coin-op binocular viewer on a post at the railing on each side of the roof (roofLayout.ts places them,
// binoculars.ts has the view through them). E on one puts your eye to it (lookout.ts: Player.tsx moves the camera to its
// eyepiece and zooms the lens): its head turns as you look round and stays pointing where you left it, and two round
// lenses frame the view. Someone on a roof break may be at one already; then it's theirs for now, and its head sweeps
// slowly across the city.
// Adapted from cubefarm client/src/world/roof/Telescope.tsx (MIT): the stand, the look through it and its remembered
// aim; the night sky, the zoom wheel and the perch are cut, and the lens mask is new.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { onAction } from '../actions';
import { angleDelta } from '../body';
import { useInteractable } from '../interact';
import { lookingThrough, lookThrough } from '../lookout';
import { glow, toon } from '../materials';
import { INK, Outlines } from '../Outlines';
import { merged } from '../shapes';
import { useView } from '../view';
import { aimLookout, LENS, lensFor, lookoutAim } from './binoculars';
import { roofVisits, visitStage, type RoofVisit } from './roofBreaks';
import { LOOKOUT, LOOKOUTS, lookoutById, lookoutSeat, type Lookout } from './roofLayout';
import { LENS_ASPECT, lensMaskTexture } from './textures';

/** Each lookout's paint, by id. */
const PAINT: Record<string, string> = { north: '#2a9d8f', east: '#e76f51', south: '#3a86ff', west: '#ffb703' };
const STEEL = '#8d99ae';
const DARK = '#2b2d42';
/** Where the head turns (y up its post) and where it tips (above that). */
const SWIVEL = 1.16;
const PIVOT = 0.2;
/** How far in front of the eye the lens mask hangs: past the camera's near plane (0.05 in first person). */
const MASK_D = 0.1;

/** Whether someone on a break has lookout `id` (stood at it, or on their way there). */
const visitorAt = (id: string, visits: readonly RoofVisit[], now: number) => visits.some((v) => v.seat === lookoutSeat(id) && visitStage(v, now) === 'up');

/** The posts on their bases, all four at once: the steel and the dark parts. */
function standsGeometry() {
  const steel: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  for (const l of LOOKOUTS) {
    const m = new THREE.Matrix4().makeRotationY(l.heading).setPosition(l.x, 0, l.z);
    dark.push(new THREE.CylinderGeometry(LOOKOUT.base / 2 - 0.04, LOOKOUT.base / 2, 0.1, 20).translate(0, 0.05, 0).applyMatrix4(m));
    steel.push(new THREE.CylinderGeometry(0.06, 0.07, SWIVEL - 0.1, 12).translate(0, 0.1 + (SWIVEL - 0.1) / 2, 0).applyMatrix4(m));
    dark.push(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 14).translate(0, SWIVEL - 0.03, 0).applyMatrix4(m));
    // the coin box, on the side you stand
    dark.push(new THREE.BoxGeometry(0.16, 0.2, 0.12).translate(0, 0.98, 0.1).applyMatrix4(m));
  }
  return { steel: merged(steel), dark: merged(dark) };
}

/** One head and its yoke, shared by all four (each is drawn in its own colour). Head space: facing -z, the pivot at 0. */
function headGeometry() {
  const yoke = merged([
    new THREE.CylinderGeometry(0.1, 0.1, 0.05, 14).translate(0, 0.025, 0),
    new THREE.BoxGeometry(0.62, 0.04, 0.12).translate(0, 0.07, 0),
    new THREE.BoxGeometry(0.04, PIVOT + 0.06, 0.12).translate(-0.29, 0.07 + (PIVOT + 0.06) / 2, 0),
    new THREE.BoxGeometry(0.04, PIVOT + 0.06, 0.12).translate(0.29, 0.07 + (PIVOT + 0.06) / 2, 0),
  ]);
  const body = new THREE.BoxGeometry(0.48, 0.24, 0.36);
  const dark = merged([
    ...[-0.12, 0.12].map((x) => new THREE.CylinderGeometry(0.1, 0.09, 0.16, 18).rotateX(Math.PI / 2).translate(x, 0, -0.24)), // the lenses' barrels
    ...[-0.065, 0.065].map((x) => new THREE.CylinderGeometry(0.045, 0.05, 0.1, 14).rotateX(Math.PI / 2).translate(x, 0.02, 0.22)), // the eyepieces
    new THREE.BoxGeometry(0.4, 0.035, 0.15).translate(0, 0.135, 0.2), // their hood
    ...[-1, 1].map((s) => new THREE.BoxGeometry(0.16, 0.045, 0.045).translate(s * 0.32, -0.04, 0.1)), // the handles
  ]);
  const lenses = merged([-0.12, 0.12].map((x) => new THREE.CircleGeometry(0.075, 18).rotateY(Math.PI).translate(x, 0, -0.322)));
  return { yoke, body, dark, lenses };
}

type Head = ReturnType<typeof headGeometry>;

/** A lookout's swivelling head and the box you aim at for E. */
function Stand({ l, head, swivel, tip }: { l: Lookout; head: Head; swivel: (g: THREE.Group | null) => void; tip: (g: THREE.Group | null) => void }) {
  const ref = useInteractable<THREE.Group>({ id: `lookout-${l.id}`, label: 'Look through the binoculars', action: { kind: 'lookout', id: l.id } }, 2.6);
  return (
    <group ref={ref} position={[l.x, 0, l.z]} rotation={[0, l.heading, 0]}>
      <group ref={swivel} position={[0, SWIVEL, 0]}>
        <mesh geometry={head.yoke} material={toon(STEEL)} castShadow />
        <group ref={tip} position={[0, PIVOT, 0]}>
          <mesh geometry={head.body} material={toon(PAINT[l.id] ?? STEEL)} castShadow>
            <Outlines thickness={0.012} color={INK} />
          </mesh>
          <mesh geometry={head.dark} material={toon(DARK)} castShadow />
          <mesh geometry={head.lenses} material={glow('#9fd8ff')} />
        </group>
      </group>
      {/* what E aims at: the head and the post */}
      <mesh position={[0, 0.85, 0]} visible={false}>
        <boxGeometry args={[0.7, 1.7, 0.7]} />
      </mesh>
    </group>
  );
}

let maskMats: { lens: THREE.MeshBasicMaterial; sides: THREE.MeshBasicMaterial } | null = null;
/** Drawn over everything, after everything: shared, made once and kept. */
function maskMaterials() {
  const over = { transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false } as const;
  return (maskMats ??= { lens: new THREE.MeshBasicMaterial({ map: lensMaskTexture(), ...over }), sides: new THREE.MeshBasicMaterial({ color: '#000000', ...over }) });
}

/** The binoculars round the view while you look through them: two round lenses in black, hung just in front of the eye. */
function LensMask() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const group = useRef<THREE.Group>(null);
  const built = useMemo(() => {
    const side = 10; // wide enough for any window
    return {
      lens: new THREE.PlaneGeometry(LENS_ASPECT, 1),
      sides: merged([-1, 1].map((s) => new THREE.PlaneGeometry(side, 1).translate(s * (LENS_ASPECT / 2 + side / 2), 0, 0))),
      ahead: new THREE.Vector3(),
    };
  }, []);
  useEffect(() => () => [built.lens, built.sides].forEach((g) => g.dispose()), [built]);
  const m = maskMaterials();
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    g.visible = lookingThrough() !== null;
    if (!g.visible) return;
    // from the camera's own turn (its matrices only catch up at render)
    built.ahead.set(0, 0, -1).applyQuaternion(camera.quaternion);
    g.position.copy(camera.position).addScaledVector(built.ahead, MASK_D);
    g.quaternion.copy(camera.quaternion);
    g.scale.setScalar(2 * MASK_D * Math.tan((camera.fov * Math.PI) / 360));
  });
  return (
    <group ref={group} visible={false}>
      <mesh geometry={built.lens} material={m.lens} renderOrder={1000} frustumCulled={false} />
      <mesh geometry={built.sides} material={m.sides} renderOrder={1000} frustumCulled={false} />
    </group>
  );
}

export function Lookouts() {
  const camera = useThree((s) => s.camera);
  const stands = useMemo(standsGeometry, []);
  const head = useMemo(headGeometry, []);
  useEffect(() => () => [...Object.values(stands), ...Object.values(head)].forEach((g) => g.dispose()), [stands, head]);
  const swivels = useRef<(THREE.Group | null)[]>([]);
  const tips = useRef<(THREE.Group | null)[]>([]);
  const setters = useMemo(() => LOOKOUTS.map((_, i) => ({ swivel: (g: THREE.Group | null) => void (swivels.current[i] = g), tip: (g: THREE.Group | null) => void (tips.current[i] = g) })), []);
  const visits = useMemo<RoofVisit[]>(() => [], []);

  // E on a lookout: your eye to it, unless someone on a break has it.
  useEffect(
    () =>
      onAction('lookout', (a) => {
        const l = lookoutById(a.id);
        if (!l || lookingThrough()) return;
        const view = useView.getState();
        if (visitorAt(l.id, roofVisits(), Date.now())) return view.showToast('🔭 Someone is using those binoculars: try another lookout');
        lookThrough(lensFor(l, lookoutAim(l.id)));
        view.showToast('🔭 Look round with the mouse · E, G or Esc to step back');
      }),
    [],
  );

  useFrame(({ clock }) => {
    const now = Date.now();
    const lens = lookingThrough();
    roofVisits(now, visits);
    for (let i = 0; i < LOOKOUTS.length; i++) {
      const l = LOOKOUTS[i];
      const swivel = swivels.current[i];
      const tip = tips.current[i];
      if (!swivel || !tip) continue;
      const mine = lens?.id === l.id;
      // looking through it: the head turns with you (hidden: your eye is in it), and stays turned when you step back
      if (mine) aimLookout(l.id, camera.rotation.y, camera.rotation.x);
      tip.visible = !mine;
      const aim = lookoutAim(l.id) ?? l.sight;
      let yaw = aim ? angleDelta(l.heading, aim.yaw) : 0;
      let pitch = aim ? aim.pitch : LENS.rest;
      if (!mine && visitorAt(l.id, visits, now)) {
        yaw = 0.45 * Math.sin(clock.elapsedTime * 0.35 + i);
        pitch = LENS.rest + 0.05 * Math.sin(clock.elapsedTime * 0.5 + i);
      }
      swivel.rotation.y = yaw;
      tip.rotation.x = pitch;
    }
  });

  return (
    <group>
      <mesh geometry={stands.steel} material={toon(STEEL)} castShadow>
        <Outlines thickness={0.01} color={INK} />
      </mesh>
      <mesh geometry={stands.dark} material={toon(DARK)} castShadow receiveShadow />
      {LOOKOUTS.map((l, i) => (
        <Stand key={l.id} l={l} head={head} swivel={setters[i].swivel} tip={setters[i].tip} />
      ))}
      <LensMask />
    </group>
  );
}
