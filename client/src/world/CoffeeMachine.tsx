// The kitchenette's coffee machine: a mug goes under the spout, the button is pressed, and it grinds and pours for a
// few seconds. The rules are in coffee.ts; this draws them. There is one machine on screen (only the current floor is
// drawn), so its state lives here and a floor change starts it afresh. Workers on a coffee break (coffeeBreak.ts) use
// it through `machine`, one brew at a time. window.__mmCoffee reports it, for QA and Playwright.
// Adapted from cubefarm client/src/world/CoffeeMachine.tsx (MIT): the player's mug and E on the machine are cut, and
// the sounds come with the sound effects.
import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BREW, EMPTY, level, placeMug, pouring, pressButton, progress, takeMug, tick, FULL_SIPS, type BrewState } from './coffee';
import type { Mug, Slot } from './coffeeBreak';
import { glow, toon } from './materials';
import { MUG_SIZE, MugLook, Steam, mugColor } from './mugLook';
import { Box, Cyl } from './Toon';

let state: BrewState = EMPTY;
let brews = 0;
// Whose mug is in the slot: a worker's id, or null (none, or one left behind for anyone).
let owner: string | null = null;
/** Workers waiting their turn at the machine, first in line first. */
export const line: string[] = [];
const listeners = new Set<() => void>();

function set(next: BrewState) {
  if (next === state) return;
  state = next;
  if (state.kind === 'empty') owner = null;
  for (const fn of listeners) fn();
}

/** The machine as a worker on a coffee break sees and uses it. Workers only ever take their own mug, or one left for anyone. */
export const machine = {
  slot(): Slot | null {
    const s = tick(state, performance.now());
    return s.kind === 'empty' ? null : { kind: s.kind, owner };
  },
  place(who: string, mug: Mug): boolean {
    const next = placeMug(state, mug);
    if (next === state) return false;
    set(next);
    owner = who;
    return true;
  },
  press(who: string): boolean {
    if (state.kind === 'empty' || (owner !== who && owner !== null)) return false;
    const r = pressButton(state, performance.now());
    if (r.result !== 'started') return false;
    owner = who;
    set(r.state);
    brews++;
    return true;
  },
  take(who: string): Mug | null {
    if (state.kind === 'empty' || (owner !== who && owner !== null)) return null;
    const r = takeMug(state, performance.now());
    if (!r) return null;
    set(r.state);
    return r.mug;
  },
  /** Called back to work: their mug stays (and any brew finishes) for anyone. */
  abandon(who: string) {
    if (owner === who) owner = null;
  },
};

if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__mmCoffee')) {
  Object.defineProperty(window, '__mmCoffee', {
    get: () => {
      const now = performance.now();
      const s = tick(state, now);
      return { state: s.kind, progress: progress(s, now), level: level(s, now), brews, owner: s.kind === 'empty' ? null : owner, line: [...line] };
    },
    enumerable: false,
    configurable: false,
  });
}

// ---------- drawing ----------

const COFFEE = '#6f4518';
// The mug sits on the drip tray in front of the machine, under the spout.
const SLOT = { x: -0.25, tray: 0.02 };
const SPOUT_Y = 0.21;
const PUFFS = [0, 1, 2, 3];
const ROT_HANDLE: [number, number, number] = [0, -Math.PI / 2, 0];

const lightOff = toon('#ced4da');
const lightBrewing = glow('#ffb703');
const lightReady = glow('#80ed99');

/** The coffee machine, standing on the counter at `position` (the counter top under its middle), its front facing -x. */
export function CoffeeMachine({ position }: { position: [number, number, number] }) {
  const [view, setView] = useState(state);
  const body = useRef<THREE.Group>(null);
  const steam = useRef<THREE.Group>(null);
  const stream = useRef<THREE.Mesh>(null);
  const coffee = useRef<THREE.Mesh>(null);

  // A fresh floor gets a fresh machine.
  useEffect(() => {
    state = EMPTY;
    brews = 0;
    owner = null;
    line.length = 0;
    setView(state);
    const fn = () => setView(state);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
      state = EMPTY;
      owner = null;
    };
  }, []);

  useFrame(() => {
    const now = performance.now();
    if (state.kind === 'brewing') set(tick(state, now));
    const brewing = state.kind === 'brewing';
    const p = progress(state, now);
    const t = now / 1000;
    if (body.current) {
      const shake = brewing ? (p < BREW.grind ? 0.003 : 0.0012) : 0;
      body.current.position.set(Math.sin(t * 97) * shake, Math.abs(Math.sin(t * 61)) * shake * 0.5, Math.cos(t * 83) * shake);
    }

    const lvl = level(state, now);
    const { r, rBase, h } = MUG_SIZE;
    const coffeeY = SLOT.tray + 0.008 + 0.004 + (lvl / FULL_SIPS) * (h - 0.026);
    if (coffee.current) {
      coffee.current.visible = lvl > 0.02;
      coffee.current.position.y = coffeeY;
      coffee.current.scale.setScalar(rBase + (r - rBase) * ((coffeeY - SLOT.tray) / h) - 0.003);
    }
    if (stream.current) {
      const on = brewing && pouring(p);
      stream.current.visible = on;
      if (on) {
        const len = SPOUT_Y - coffeeY;
        stream.current.scale.y = len;
        stream.current.position.y = coffeeY + len / 2;
        stream.current.scale.x = stream.current.scale.z = 1 + Math.sin(t * 40) * 0.25;
      }
    }
    if (steam.current) {
      steam.current.visible = brewing && p > BREW.grind;
      if (steam.current.visible) {
        const puffs = steam.current.children;
        for (let i = 0; i < puffs.length; i++) {
          const c = puffs[i] as THREE.Mesh;
          const k = (t * 0.9 + i / puffs.length) % 1;
          c.position.set(Math.sin(t * 2 + i * 1.7) * 0.02, k * 0.35, Math.cos(t * 1.6 + i) * 0.02);
          c.scale.setScalar(0.6 + k * 1.4);
          (c.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k);
        }
      }
    }
  });

  return (
    <group position={position}>
      {/* rumbles while it brews */}
      <group ref={body}>
        <Box size={[0.45, 0.55, 0.4]} position={[0.05, 0.28, 0]} color="#343a40" outline />
        {/* head over the drip tray, and its spout */}
        <Box size={[0.22, 0.1, 0.28]} position={[SLOT.x + 0.01, SPOUT_Y + 0.07, 0]} color="#495057" outline />
        <Cyl r={0.018} h={0.03} position={[SLOT.x, SPOUT_Y + 0.005, 0]} color="#adb5bd" />
        {/* power light */}
        <mesh position={[-0.2, 0.39, 0.13]} rotation={[0, -Math.PI / 2, 0]} material={glow('#ff6b6b')}>
          <circleGeometry args={[0.02, 12]} />
        </mesh>
        {/* the brew button: lights up while brewing, green when the coffee is ready */}
        <group position={[-0.18, 0.42, -0.06]}>
          <Cyl r={0.045} h={0.02} rotation={[0, 0, Math.PI / 2]} color="#212529" />
          <mesh position={[-0.012, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={view.kind === 'brewing' ? lightBrewing : view.kind === 'ready' ? lightReady : lightOff}>
            <cylinderGeometry args={[0.032, 0.034, 0.018, 18]} />
          </mesh>
        </group>
        <group ref={steam} position={[0.05, 0.56, -0.08]} visible={false}>
          {PUFFS.map((i) => (
            <mesh key={i}>
              <sphereGeometry args={[0.035, 8, 6]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
            </mesh>
          ))}
        </group>
      </group>
      {/* drip tray and the mug slot */}
      <Box size={[0.2, SLOT.tray, 0.26]} position={[SLOT.x, SLOT.tray / 2, 0]} color="#6c757d" outline />
      {view.kind !== 'empty' && (
        <group position={[SLOT.x, SLOT.tray + MUG_SIZE.h / 2, 0]} rotation={ROT_HANDLE}>
          <MugLook color={mugColor(view.mug.id)} sips={0} steam={false} />
          {view.kind === 'ready' && <Steam y={MUG_SIZE.h / 2} sips={FULL_SIPS} />}
        </group>
      )}
      <mesh ref={coffee} position={[SLOT.x, SLOT.tray, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false} material={toon(COFFEE)}>
        <circleGeometry args={[1, 20]} />
      </mesh>
      <mesh ref={stream} position={[SLOT.x, 0.1, 0]} visible={false} material={toon(COFFEE)}>
        <cylinderGeometry args={[0.006, 0.006, 1, 6]} />
      </mesh>
    </group>
  );
}
