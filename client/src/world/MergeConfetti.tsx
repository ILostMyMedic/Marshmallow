// Confetti over a worker's desk when their PR merges (over the whiteboard when nobody on the floor wrote it), and over
// the floor's gong when a merge strikes it (gongState.ts). One pooled InstancedMesh per floor: a few slots of flat
// paper bits, hidden and skipped entirely while no burst is flying. window.__mmConfetti bursts one by hand, for QA.
// Adapted from cubefarm client/src/world/MergeConfetti.tsx (MIT): the reduced-motion glow, holiday themes, Friday's
// pizza colours and the bloom are cut, merges come from the server's moments, and a burst pops (new).
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Moment, Worker } from '../../../shared/types';
import { useStore } from '../store';
import { confettiPop } from '../ui/sfx';
import { onGongParty } from './gongState';
import { BOARD, deskPosition, GONG, SEATS } from './layout';
import { momentsSince } from './reactions';

const SLOTS = 3; // bursts at once
const PIECES = 90; // per burst
const LIFE = 2.4; // seconds
const GRAVITY = 3.2;
const DRAG = 1.6;
const PALETTE = ['#ff5d8f', '#ffd23f', '#3bceac', '#3a86ff', '#ff8c42', '#9b5de5'];

interface Slot {
  key: string | null; // the desk (worker id), 'board' or 'gong' while flying, null when free
  age: number;
}

let controller: ((key?: string | null) => void) | null = null;

if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__mmConfetti')) {
  Object.defineProperty(window, '__mmConfetti', { value: { burst: (key?: string) => controller?.(key) }, enumerable: false });
}

export function MergeConfetti({ floorId, color, workers }: { floorId: string; color: string; workers: Worker[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const workersRef = useRef(workers);
  workersRef.current = workers;

  // Everything the frame loop touches is allocated once here.
  const sim = useMemo(() => {
    const n = SLOTS * PIECES;
    return {
      slots: Array.from({ length: SLOTS }, (): Slot => ({ key: null, age: 0 })),
      pos: new Float32Array(n * 3),
      vel: new Float32Array(n * 3),
      rot: new Float32Array(n * 3),
      spin: new Float32Array(n * 3),
      phase: new Float32Array(n),
      dummy: new THREE.Object3D(),
      colors: [...PALETTE, color].map((c) => new THREE.Color(c)),
      geometry: new THREE.PlaneGeometry(0.1, 0.06),
      material: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }),
    };
  }, [color]);

  useEffect(
    () => () => {
      sim.geometry.dispose();
      sim.material.dispose();
    },
    [sim],
  );

  // Hide every piece and create the colour attribute before the first draw, so the shader includes it.
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    sim.dummy.scale.setScalar(0);
    sim.dummy.updateMatrix();
    for (let i = 0; i < SLOTS * PIECES; i++) {
      m.setMatrixAt(i, sim.dummy.matrix);
      m.setColorAt(i, sim.colors[i % sim.colors.length]);
    }
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor!.needsUpdate = true;
    m.visible = false;
  }, [sim]);

  useEffect(() => {
    const burst = (key?: string | null) => {
      const gong = key === 'gong';
      const m = mesh.current;
      if (!m || document.hidden) return;
      const author = key ? workersRef.current.find((w) => w.id === key) : undefined;
      const slotKey = author?.id ?? (gong ? 'gong' : 'board');
      if (sim.slots.some((s) => s.key === slotKey)) return; // one per desk
      const s = sim.slots.findIndex((x) => !x.key);
      if (s < 0) return; // full: dropped, never queued
      const at = author ? { ...deskPosition(author.desk % SEATS), y: 1.5 } : gong ? { x: GONG.x, z: GONG.z + 0.3, y: GONG.h + 0.1 } : { x: 0, z: BOARD.z + 1.2, y: BOARD.y + BOARD.h * 0.6 };
      sim.slots[s] = { key: slotKey, age: 0 };
      confettiPop(at);
      for (let k = 0; k < PIECES; k++) {
        const i = s * PIECES + k;
        const a = Math.random() * Math.PI * 2;
        const out = 0.6 + Math.random() * 1.6;
        sim.pos.set([at.x + (Math.random() - 0.5) * 0.3, at.y, at.z + (Math.random() - 0.5) * 0.3], i * 3);
        // the gong stands against the north wall: its burst goes out into the room, not through the wall
        sim.vel.set([Math.cos(a) * out, 2.6 + Math.random() * 2.2, gong ? Math.abs(Math.sin(a)) * out + 0.2 : Math.sin(a) * out], i * 3);
        sim.rot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
        sim.spin.set([(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14], i * 3);
        sim.phase[i] = Math.random() * Math.PI * 2;
        m.setColorAt(i, sim.colors[Math.floor(Math.random() * sim.colors.length)]);
      }
      m.instanceColor!.needsUpdate = true;
      m.visible = true;
    };

    // Merges on this floor: over the author's desk (or the board).
    let last: Moment | null = useStore.getState().moments.at(-1) ?? null;
    const unsub = useStore.subscribe((state) => {
      if (!state.loaded) return;
      for (const m of momentsSince(state.moments, last)) if (m.type === 'merged' && m.floorId === floorId) burst(m.devWorkerId);
      last = state.moments.at(-1) ?? null;
    });
    const offGong = onGongParty((f) => {
      if (f === floorId) burst('gong');
    });
    controller = burst;
    return () => {
      unsub();
      offGong();
      if (controller === burst) controller = null;
    };
  }, [sim, floorId]);

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m || !m.visible) return;
    const dt = Math.min(delta, 0.05);
    const { slots, pos, vel, rot, spin, phase, dummy } = sim;
    let flying = 0;
    for (let s = 0; s < SLOTS; s++) {
      const slot = slots[s];
      if (!slot.key) continue;
      slot.age += dt;
      const done = slot.age >= LIFE;
      // Full size for the first 60% of the flight, then shrink away.
      const size = done ? 0 : Math.min(1, (LIFE - slot.age) / (LIFE * 0.4));
      for (let k = 0; k < PIECES; k++) {
        const i = s * PIECES + k;
        const j = i * 3;
        if (!done) {
          const drag = Math.exp(-DRAG * dt);
          vel[j] *= drag;
          vel[j + 2] *= drag;
          vel[j + 1] = Math.max(vel[j + 1] * drag - GRAVITY * dt, -0.9); // paper falls slowly
          const flutter = Math.sin(slot.age * 7 + phase[i]) * 0.5;
          pos[j] += (vel[j] + flutter) * dt;
          pos[j + 1] += vel[j + 1] * dt;
          pos[j + 2] += (vel[j + 2] + flutter * 0.6) * dt;
          rot[j] += spin[j] * dt;
          rot[j + 1] += spin[j + 1] * dt;
          rot[j + 2] += spin[j + 2] * dt;
        }
        dummy.position.set(pos[j], pos[j + 1], pos[j + 2]);
        dummy.rotation.set(rot[j], rot[j + 1], rot[j + 2]);
        dummy.scale.setScalar(size);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      }
      if (done) slot.key = null;
      else flying++;
    }
    m.instanceMatrix.needsUpdate = true;
    if (!flying) m.visible = false;
  });

  return <instancedMesh ref={mesh} args={[sim.geometry, sim.material, SLOTS * PIECES]} frustumCulled={false} />;
}
