// The CEO's floor, the storey under the roof terrace: an executive office. The CEO's walnut desk faces the room from
// the north side, a credenza and the company's name on the wall behind it; a lounge with a long sofa and armchairs in
// the west half, a meeting table in the east under the company's milestones (CeoMilestones.tsx), a bar cart, a globe,
// a floor lamp and plants. The CEO works and strolls here (the errand director), and now and then rides down to walk a
// floor (the rituals).
import { memo, useMemo } from 'react';
import { useStore } from '../store';
import { useCanvasTexture } from './canvasTexture';
import { CeoMilestones } from './CeoMilestones';
import { CeoRituals } from './CeoRituals';
import { Desk } from './Desk';
import { drawSign } from './draw';
import { ErrandDirector } from './ErrandDirector';
import { storeyOf, CEO_FLOOR } from './floors';
import { EXEC_ARMCHAIRS, EXEC_BAR, EXEC_COFFEE, EXEC_CREDENZA, EXEC_DESK, EXEC_GLOBE, EXEC_MEETING, EXEC_PLANTS, EXEC_SOFA, HALF_D, HALF_W, meetingChairs, rect } from './layout';
import { shade } from './materials';
import { Outside } from './Outside';
import { CoffeeTable, Couch, Plant, Rug } from './Props';
import { Shell } from './Shell';
import { Ball, Box, Cyl } from './Toon';

const ACCENT = '#9b5de5';
const FLOOR = '#9a6b4a';
const WALNUT = '#6b4226';
const BRASS = '#d4a017';
const LEATHER = '#3b2a24';
const DESK_AT: [number, number, number] = [EXEC_DESK.x, 0, EXEC_DESK.z];
const DESK_RUG = rect(EXEC_DESK.x, EXEC_DESK.z + 0.6, 8, 6);
const LOUNGE_RUG = rect(EXEC_COFFEE.x + 0.6, EXEC_COFFEE.z, 6.2, 6);

/** The low cabinet behind the desk: books, an award and a vase on top. */
function Credenza() {
  const { x, z, w, d } = EXEC_CREDENZA;
  const books = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#264653', '#9b5de5'];
  return (
    <group position={[x, 0, z]}>
      <Box size={[w, 0.8, d]} position={[0, 0.4, 0]} color={WALNUT} outline />
      {[-1.6, -0.55, 0.55, 1.6].map((dx) => (
        <Box key={dx} size={[0.9, 0.5, 0.01]} position={[dx, 0.42, d / 2 + 0.005]} color={shade(WALNUT, -0.12)} shadow={false} />
      ))}
      {books.map((c, i) => (
        <Box key={c} size={[0.07, 0.3 + (i % 3) * 0.04, 0.22]} position={[-2.1 + i * 0.09, 0.95 + (i % 3) * 0.02, 0]} color={c} outline />
      ))}
      {/* an award: a gold star on a plinth */}
      <group position={[0.4, 0.8, 0]}>
        <Box size={[0.2, 0.08, 0.16]} position={[0, 0.04, 0]} color="#2b2d42" outline />
        <Ball r={0.09} position={[0, 0.2, 0]} scale={[1, 1, 0.4]} color={BRASS} outline />
      </group>
      <Cyl r={0.07} rTop={0.11} h={0.32} position={[1.8, 0.96, 0]} color="#e9ecef" outline />
      <Ball r={0.13} position={[1.8, 1.2, 0]} color="#ef476f" />
    </group>
  );
}

/** The company's name in brass letters on a walnut board, on the wall behind the CEO. */
function CompanySign() {
  const company = useStore((s) => s.settings.companyName) || 'Marshmallow';
  const tex = useCanvasTexture(1024, 256, (ctx) => drawSign(ctx, 1024, 256, [{ text: `✻ ${company}`, size: 120, color: '#f6d365' }], '#4a2c19'), [company]);
  return (
    <group position={[0, 2.25, -HALF_D + 0.07]}>
      <Box size={[4.4, 1.15, 0.06]} color={WALNUT} outline />
      <mesh position={[0, 0, 0.035]}>
        <planeGeometry args={[4.2, 1.05]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** A leather armchair, its seat facing local -Z. */
function Armchair({ position, rotationY }: { position: [number, number, number]; rotationY: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[0.85, 0.4, 0.8]} position={[0, 0.22, 0]} color={LEATHER} outline />
      <Box size={[0.85, 0.55, 0.18]} position={[0, 0.65, 0.32]} color={shade(LEATHER, -0.08)} outline />
      {[-0.4, 0.4].map((dx) => (
        <Box key={dx} size={[0.14, 0.3, 0.8]} position={[dx, 0.52, 0]} color={shade(LEATHER, -0.08)} outline />
      ))}
    </group>
  );
}

/** The meeting table (an oval of glass on a dark base) and its chairs. */
function MeetingTable() {
  const { x, z, w } = EXEC_MEETING;
  const chairs = useMemo(meetingChairs, []);
  return (
    <group>
      <group position={[x, 0, z]}>
        <Cyl r={w / 2} h={0.05} position={[0, 0.75, 0]} color="#cfe8ef" outline />
        <Cyl r={0.12} h={0.72} position={[-w / 4, 0.36, 0]} color="#2b2d42" />
        <Cyl r={0.12} h={0.72} position={[w / 4, 0.36, 0]} color="#2b2d42" />
      </group>
      {chairs.map(([cx, cz, yaw]) => (
        <group key={`${cx},${cz}`} position={[cx, 0, cz]} rotation={[0, yaw, 0]}>
          <Box size={[0.48, 0.08, 0.46]} position={[0, 0.46, 0]} color="#2b2d42" outline />
          <Box size={[0.46, 0.5, 0.06]} position={[0, 0.74, 0.22]} color="#2b2d42" outline />
          <Cyl r={0.03} h={0.42} position={[0, 0.22, 0]} color="#adb5bd" />
          <Cyl r={0.22} h={0.03} position={[0, 0.02, 0]} color="#adb5bd" />
        </group>
      ))}
    </group>
  );
}

/** A brass bar cart with bottles and glasses. */
function BarCart() {
  return (
    <group position={[EXEC_BAR.x, 0, EXEC_BAR.z]}>
      {[0.32, 0.82].map((y) => (
        <Box key={y} size={[0.5, 0.04, 1.0]} position={[0, y, 0]} color="#3d405b" outline />
      ))}
      {[
        [-0.2, -0.45],
        [0.2, -0.45],
        [-0.2, 0.45],
        [0.2, 0.45],
      ].map(([dx, dz]) => (
        <Cyl key={`${dx}${dz}`} r={0.018} h={0.86} position={[dx, 0.43, dz]} color={BRASS} />
      ))}
      {['#2d6a4f', '#9d0208', '#e9c46a'].map((c, i) => (
        <group key={c} position={[0, 0.84, -0.3 + i * 0.25]}>
          <Cyl r={0.045} h={0.22} position={[0, 0.11, 0]} color={c} outline />
          <Cyl r={0.016} h={0.08} position={[0, 0.26, 0]} color={c} />
        </group>
      ))}
      <Cyl r={0.035} rTop={0.045} h={0.08} position={[0.1, 0.88, 0.38]} color="#e3f2fd" />
    </group>
  );
}

/** The globe on its wooden stand. */
function Globe() {
  return (
    <group position={[EXEC_GLOBE.x, 0, EXEC_GLOBE.z]}>
      <Cyl r={0.22} h={0.05} position={[0, 0.025, 0]} color={WALNUT} outline />
      <Cyl r={0.03} h={0.7} position={[0, 0.38, 0]} color={WALNUT} />
      <Ball r={0.3} position={[0, 0.95, 0]} color="#4ea8de" outline />
      <Ball r={0.16} position={[0.13, 1.04, 0.16]} scale={[1, 0.8, 0.5]} color="#80b918" />
      <Ball r={0.12} position={[-0.17, 0.86, 0.15]} scale={[1, 1.2, 0.5]} color="#80b918" />
    </group>
  );
}

/** A tall floor lamp by the sofa. */
function FloorLamp({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Cyl r={0.18} h={0.04} position={[0, 0.02, 0]} color="#2b2d42" outline />
      <Cyl r={0.02} h={1.6} position={[0, 0.82, 0]} color={BRASS} />
      <Cyl r={0.16} rTop={0.24} h={0.3} position={[0, 1.7, 0]} color="#fff3c4" outline />
    </group>
  );
}

/** The CEO's floor. `top` is the highest repo floor (this one is the storey above it). */
export const CeoFloor = memo(function CeoFloor({ top }: { top: number }) {
  const ceo = useStore((s) => Object.values(s.workers).find((w) => w.role === 'ceo') ?? null);
  const workers = useMemo(() => (ceo ? [ceo] : []), [ceo]);
  const storey = storeyOf(CEO_FLOOR, top);
  return (
    <group>
      <Shell kind="ceo" accent={ACCENT} floorColor={FLOOR} />
      <Outside kind="ceo" floor={storey} top={storey} />
      <Rug r={DESK_RUG} color="#7b2c3a" />
      <Rug r={LOUNGE_RUG} color="#d8c3a5" />
      <Desk worker={ceo} accent={ACCENT} position={DESK_AT} rotationY={Math.PI} exec />
      <Credenza />
      <CompanySign />
      <Couch position={[EXEC_SOFA.x, 0, EXEC_SOFA.z]} rotationY={-Math.PI / 2} color={LEATHER} />
      {EXEC_ARMCHAIRS.map(([x, z]) => (
        <Armchair key={z} position={[x, 0, z]} rotationY={Math.PI / 2} />
      ))}
      <CoffeeTable position={[EXEC_COFFEE.x, 0, EXEC_COFFEE.z]} rotationY={Math.PI / 2} />
      <FloorLamp position={[-HALF_W + 0.7, 0, 6.2]} />
      <MeetingTable />
      <CeoMilestones />
      <BarCart />
      <Globe />
      {EXEC_PLANTS.map(([x, z, s]) => (
        <Plant key={`${x},${z}`} position={[x, 0, z]} scale={s} pot="#3d405b" />
      ))}
      <ErrandDirector floor="ceo" workers={workers} />
      <CeoRituals />
    </group>
  );
});
