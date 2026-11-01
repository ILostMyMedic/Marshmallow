// The CEO's floor, the storey under the roof terrace: an executive office. The CEO's walnut desk faces the room from
// the north side, a credenza and the company's name on the wall behind it and a red runner down to the elevator; the
// library and a reading nook in the north-west, the lounge in the west, a putting green by the awards wall
// (AwardsWall.tsx), the meeting table under the company's milestones (CeoMilestones.tsx) with the week's whiteboard,
// and a coffee bar, a café table and a fish tank in the south-east (CeoFurniture.tsx draws all that furniture in a
// few merged meshes; layout.ts says where everything is). The CEO works and strolls here (the errand director), and
// now and then rides down to walk a floor (the rituals).
import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useStore } from '../store';
import { AwardsWall } from './AwardsWall';
import { useCanvasTexture } from './canvasTexture';
import { SIGN_Y } from './ceoRoom';
import { CeoFurniture } from './CeoFurniture';
import { CeoMilestones } from './CeoMilestones';
import { CeoRituals } from './CeoRituals';
import { CUT_PLANES } from './cutaway';
import { Desk } from './Desk';
import { drawSign } from './draw';
import { ErrandDirector } from './ErrandDirector';
import { storeyOf, CEO_FLOOR } from './floors';
import { EXEC_DESK, HALF_D } from './layout';
import { Outside } from './Outside';
import { Shell } from './Shell';

const ACCENT = '#9b5de5';
const FLOOR = '#9a6b4a';
const DESK_AT: [number, number, number] = [EXEC_DESK.x, 0, EXEC_DESK.z];

/** The company's name in brass letters on the walnut board behind the CEO (the board is ceoRoom.ts's), cut away with the wall. */
function CompanySign() {
  const company = useStore((s) => s.settings.companyName) || 'Marshmallow';
  const tex = useCanvasTexture(1024, 256, (ctx) => drawSign(ctx, 1024, 256, [{ text: `✻ ${company}`, size: 120, color: '#f6d365' }], '#4a2c19'), [company]);
  const face = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, clippingPlanes: CUT_PLANES.room }), []);
  face.map = tex;
  useEffect(() => () => face.dispose(), [face]);
  return (
    <mesh position={[0, SIGN_Y, -HALF_D + 0.075]} material={face}>
      <planeGeometry args={[4.2, 1.05]} />
    </mesh>
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
      <CeoFurniture />
      <Desk worker={ceo} accent={ACCENT} position={DESK_AT} rotationY={Math.PI} exec />
      <CompanySign />
      <CeoMilestones />
      <AwardsWall />
      <ErrandDirector floor="ceo" workers={workers} />
      <CeoRituals />
    </group>
  );
});
