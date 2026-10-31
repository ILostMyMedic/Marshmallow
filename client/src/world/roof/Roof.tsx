// The roof terrace, the elevator's top stop (roofLayout.ts has its plan and colliders): a garden along the north
// parapet, a decking lounge with deck chairs under string lights on the east half, a fire pit with benches round it on
// the west, coin-op binoculars at the railing on every side, and the hut over the elevator, all open to the sky and the
// city (Game.tsx's, lowered under it). Idle people come up for a break (RoofPeople.tsx). Mounted in place of a floor,
// only while you're up here.
// Adapted from cubefarm client/src/world/roof/Roof.tsx (MIT): the grill, the telescope, the billboards, the sounds, the
// perch and the probe are cut; the fireplace and the lookouts are new.
import { useEffect } from 'react';
import { Elevator } from '../Elevator';
import { elevationOf, ROOF } from '../floors';
import { HALF_D, WALL_T } from '../layout';
import { stepBack } from '../lookout';
import { DeckChairs } from './DeckChairs';
import { Fireplace } from './Fireplace';
import { Garden } from './Garden';
import { Lookouts } from './Lookouts';
import { RoofDeck } from './RoofDeck';
import { RoofPeople } from './RoofPeople';
import { StringLights } from './StringLights';

/** The hut's trim and the elevator's lit button. */
const ACCENT = '#ff8a5b';

/** The roof of a building whose highest repo floor is `top`. */
export function Roof({ top }: { top: number }) {
  // Leaving the roof (the floor picker can, mid-look) steps you back from the binoculars.
  useEffect(() => () => stepBack(), []);
  return (
    <group>
      <RoofDeck elevation={elevationOf(ROOF, top)} />
      {/* the doors in the hut's front wall, where every floor's south wall has them, and the cabin behind */}
      <Elevator zDoor={HALF_D + WALL_T / 2} accent={ACCENT} />
      <Garden />
      <DeckChairs />
      <StringLights />
      <Fireplace />
      <Lookouts />
      <RoofPeople />
    </group>
  );
}
