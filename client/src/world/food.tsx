// Lunch (Rituals.tsx): a lunch box, a sandwich or noodles in a cup, in someone's hand (Character.tsx). Small toon
// shapes, and the slice of pizza the fridge's snacks share. Adapted from cubefarm client/src/world/food.tsx (MIT):
// Friday's pizza and its courier are cut.
import { toon } from './materials';
import type { Food } from './ritualSchedule';
import { Ball, Box, Cyl } from './Toon';

const CHEESE = '#f6bd60';
const CRUST = '#d08c45';
const PEPPERONI = '#c1121f';

/** A slice of pizza lying flat: its tip at the origin, its crust `r` away along +Z. */
export function Slice({ r = 0.13 }: { r?: number }) {
  return (
    <group>
      {/* an eighth of a disc (three.js measures the angle from +Z) */}
      <mesh castShadow material={toon(CHEESE)}>
        <cylinderGeometry args={[r, r, 0.014, 6, 1, false, -Math.PI / 8, Math.PI / 4]} />
      </mesh>
      <Box size={[r * 0.78, 0.022, 0.03]} position={[0, 0.002, r * 0.9]} color={CRUST} shadow={false} />
      <Ball r={0.016} position={[0.01, 0.01, r * 0.68]} scale={[1, 0.35, 1]} color={PEPPERONI} shadow={false} />
      <Ball r={0.013} position={[-0.008, 0.01, r * 0.42]} scale={[1, 0.35, 1]} color={PEPPERONI} shadow={false} />
    </group>
  );
}

/** Food at hand size, centred on where it's held. */
export function FoodLook({ kind }: { kind: Food }) {
  switch (kind) {
    case 'lunchbox':
      return (
        <group>
          <Box size={[0.17, 0.08, 0.12]} color="#4cc9f0" outline shadow={false} />
          <Box size={[0.175, 0.025, 0.125]} position={[0, 0.045, 0]} color="#ffd166" shadow={false} />
        </group>
      );
    case 'sandwich':
      return (
        <group rotation={[0.3, 0, 0]}>
          <Box size={[0.13, 0.03, 0.11]} position={[0, -0.025, 0]} color="#f4d58d" outline shadow={false} />
          <Box size={[0.14, 0.012, 0.12]} position={[0, -0.004, 0]} color="#80ed99" shadow={false} />
          <Box size={[0.12, 0.012, 0.1]} position={[0, 0.008, 0]} color="#e63946" shadow={false} />
          <Box size={[0.13, 0.03, 0.11]} position={[0, 0.03, 0]} color="#f4d58d" outline shadow={false} />
        </group>
      );
    case 'noodles':
      return (
        <group>
          <Cyl r={0.045} rTop={0.06} h={0.12} color="#f8f9fa" outline shadow={false} />
          <Cyl r={0.046} rTop={0.052} h={0.03} position={[0, -0.01, 0]} color="#e63946" shadow={false} />
          <Cyl r={0.006} h={0.2} position={[0.015, 0.1, 0]} rotation={[0, 0, 0.18]} color="#e9c46a" shadow={false} />
          <Cyl r={0.006} h={0.2} position={[-0.012, 0.1, 0.01]} rotation={[0.1, 0, 0.1]} color="#e9c46a" shadow={false} />
        </group>
      );
  }
}
