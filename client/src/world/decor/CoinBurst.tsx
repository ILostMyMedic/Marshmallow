// Coins a floor just earned (the server's 'earned' moment: a merge, its clean first QA pass, a fix), on the floor you're
// on: a little fountain of gold coins over the builder's desk, or by the elevator when nobody here built it, with a
// "+15" floating up and a pling. Moments are live only (never in the snapshot), so a reload never bursts. One pooled
// InstancedMesh and a sprite per burst, hidden and skipped while nothing flies. window.__mmDecor.burst bursts one by hand.
// Adapted from cubefarm client/src/world/decor/CoinBurst.tsx (MIT): moments drive it as they do MergeConfetti.tsx, and
// the floating amount is new.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Moment, Worker } from '../../../../shared/types';
import { useStore } from '../../store';
import { tone } from '../../ui/sfx';
import { SANS } from '../draw';
import { deskPosition, HALF_D, SEATS } from '../layout';
import { toon } from '../materials';
import { momentsSince } from '../reactions';

const SLOTS = 2;
const COINS = 16;
const LIFE = 1.9;
const GRAVITY = 5.5;
const DELAY_MS = 250; // after the merge's confetti has popped
/** By the elevator, for coins nobody on this floor built. */
const ENTRANCE = { x: 0, y: 2.0, z: HALF_D - 1.8 };

let burstHere: ((amount: number, workerId: string | null) => void) | null = null;

/** A coin burst on the floor you're on, by hand (the probe). */
export const burstCoins = (amount: number, workerId: string | null = null) => burstHere?.(amount, workerId);

/** A coin's pling: two bright notes. */
function pling(pos: { x: number; y: number; z: number }) {
  tone({ name: 'coins', group: 'room', pos, freq: 1975.5, type: 'triangle', dur: 0.09, peak: 0.05, attack: 0.003 });
  tone({ name: 'coins', group: 'room', pos, freq: 2637, type: 'triangle', at: 0.08, dur: 0.22, peak: 0.05, attack: 0.003 });
}

function makeLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.9, 0.45, 1);
  sprite.visible = false;
  return { canvas, texture, material, sprite };
}

function paintLabel(l: ReturnType<typeof makeLabel>, amount: number) {
  const ctx = l.canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 128);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 76px ${SANS}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#5a3d00';
  const text = `+${amount}`;
  ctx.strokeText(text, 128, 66);
  ctx.fillStyle = '#ffd43b';
  ctx.fillText(text, 128, 66);
  l.texture.needsUpdate = true;
}

export function CoinBurst({ floorId, workers }: { floorId: string; workers: Worker[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const group = useRef<THREE.Group>(null);
  const workersRef = useRef(workers);
  workersRef.current = workers;
  const sim = useMemo(
    () => ({
      age: Array.from({ length: SLOTS }, () => -1),
      from: Array.from({ length: SLOTS }, () => new THREE.Vector3()),
      pos: new Float32Array(SLOTS * COINS * 3),
      vel: new Float32Array(SLOTS * COINS * 3),
      spin: new Float32Array(SLOTS * COINS),
      dummy: new THREE.Object3D(),
      geometry: new THREE.CylinderGeometry(0.075, 0.075, 0.016, 16).rotateX(Math.PI / 2),
      labels: Array.from({ length: SLOTS }, makeLabel),
    }),
    [],
  );
  useEffect(
    () => () => {
      sim.geometry.dispose();
      for (const l of sim.labels) {
        l.texture.dispose();
        l.material.dispose();
      }
    },
    [sim],
  );

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    sim.dummy.scale.setScalar(0);
    sim.dummy.updateMatrix();
    for (let i = 0; i < SLOTS * COINS; i++) m.setMatrixAt(i, sim.dummy.matrix);
    m.instanceMatrix.needsUpdate = true;
    m.visible = false;
    for (const l of sim.labels) group.current?.add(l.sprite);
  }, [sim]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const burst = (amount: number, workerId: string | null) => {
      const w = workerId ? workersRef.current.find((x) => x.id === workerId) : undefined;
      const desk = w ? deskPosition(w.desk % SEATS) : null;
      const at = desk ? { x: desk.x, y: 2.1, z: desk.z } : ENTRANCE;
      timers.push(
        setTimeout(() => {
          const m = mesh.current;
          if (!m || document.hidden) return;
          const s = sim.age.findIndex((x) => x < 0);
          if (s < 0) return; // full: dropped, never queued
          pling(at);
          sim.age[s] = 0;
          sim.from[s].set(at.x, at.y, at.z);
          for (let k = 0; k < COINS; k++) {
            const i = s * COINS + k;
            const ang = (k / COINS) * Math.PI * 2 + Math.random() * 0.4;
            const out = 0.5 + Math.random() * 0.9;
            sim.pos.set([at.x, at.y, at.z], i * 3);
            sim.vel.set([Math.cos(ang) * out, 2.4 + Math.random() * 1.6, Math.sin(ang) * out], i * 3);
            sim.spin[i] = 6 + Math.random() * 8;
          }
          const label = sim.labels[s];
          paintLabel(label, amount);
          label.sprite.position.set(at.x, at.y + 0.3, at.z);
          label.sprite.visible = true;
          m.visible = true;
        }, DELAY_MS),
      );
    };

    let last: Moment | null = useStore.getState().moments.at(-1) ?? null;
    const unsub = useStore.subscribe((state) => {
      if (!state.loaded) return;
      for (const m of momentsSince(state.moments, last)) if (m.type === 'earned' && m.floorId === floorId && m.amount > 0) burst(m.amount, m.workerId);
      last = state.moments.at(-1) ?? null;
    });
    burstHere = burst;
    return () => {
      unsub();
      if (burstHere === burst) burstHere = null;
      timers.forEach(clearTimeout);
    };
  }, [floorId, sim]);

  useFrame(({ camera }, delta) => {
    const m = mesh.current;
    if (!m || !m.visible) return;
    const dt = Math.min(delta, 0.05);
    let live = 0;
    for (let s = 0; s < SLOTS; s++) {
      if (sim.age[s] < 0) continue;
      sim.age[s] += dt;
      const age = sim.age[s];
      const done = age >= LIFE;
      // bigger the further away you look from (the overview), so it still reads
      const far = Math.min(3.2, Math.max(1, camera.position.distanceTo(sim.from[s]) / 9));
      const size = done ? 0 : Math.min(1, (LIFE - age) / (LIFE * 0.35)) * far;
      for (let k = 0; k < COINS; k++) {
        const i = s * COINS + k;
        const j = i * 3;
        sim.vel[j + 1] -= GRAVITY * dt;
        sim.pos[j] += sim.vel[j] * dt;
        sim.pos[j + 1] += sim.vel[j + 1] * dt;
        sim.pos[j + 2] += sim.vel[j + 2] * dt;
        const o = sim.from[s];
        sim.dummy.position.set(o.x + (sim.pos[j] - o.x) * far, o.y + (sim.pos[j + 1] - o.y) * far, o.z + (sim.pos[j + 2] - o.z) * far);
        sim.dummy.rotation.set(0, age * sim.spin[i], 0.3);
        sim.dummy.scale.setScalar(size);
        sim.dummy.updateMatrix();
        m.setMatrixAt(i, sim.dummy.matrix);
      }
      // the amount floats up and fades over a little longer than the coins fly
      const label = sim.labels[s];
      label.sprite.position.y = sim.from[s].y + (0.3 + age * 0.55) * far;
      label.sprite.scale.set(0.9 * far, 0.45 * far, 1);
      label.material.opacity = Math.max(0, Math.min(1, (LIFE - age) / (LIFE * 0.4)));
      if (done) {
        sim.age[s] = -1;
        label.sprite.visible = false;
      } else live++;
    }
    m.instanceMatrix.needsUpdate = true;
    if (!live) m.visible = false;
  });

  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[sim.geometry, toon('#ffd43b', { emissive: '#7a5a00', emissiveIntensity: 0.6 }), SLOTS * COINS]} frustumCulled={false} />
    </group>
  );
}
