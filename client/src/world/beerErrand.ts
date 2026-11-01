// The beer fridge errands, after hours only: beerBreak.ts's actor wired to the fridge on screen (decor/machines.ts) and
// the people's hands and speech bubbles (people.ts). Someone who fancies a beer goes first ('beer'); once they're on
// their way, one more free worker comes to join them ('beer-join', the likelier pick by far), so it's a couple at a
// time. Who's having one is read off the director's live errands (people.ts errandOf), so it can't drift from what
// people are doing. Try it with ?daytime=0.9. Imported by ErrandDirector.tsx, which registers them. New in Marshmallow.
import { sipSound } from '../ui/sipSfx';
import { afterHours, BeerBreak, fanciesBeer, type BeerWorld } from './beerBreak';
import { dayTime } from './dayTime';
import { bottleClink, claimMachine, closeBeerDoor, doorOpenIn, machineSpot, openBeerDoor, releaseMachine } from './decor/machines';
import { PLACED_SPOTS, kindOf, slotSpotIds, slotSpots } from './decor/spots';
import { isFree, registerErrand, type Errand, type ErrandState } from './errands';
import { bodyState, errandOf, liveBodies, say, setHandSnack } from './people';
import { playerAt } from './rig';

const at = (who: string) => {
  const s = bodyState(who);
  return { x: s?.x ?? 0, y: 1.3, z: s?.z ?? 0 };
};

/** Whether someone is on their way to a beer, or having one (not once they've turned for home). */
const onBeer = (id: string) => {
  const e = errandOf(id);
  return !!e && e.name.startsWith('beer') && (e.phase === 'leaving' || e.phase === 'there');
};
/** Who on the floor is having one. */
const having = (s: ErrandState) => (s.others ?? []).filter((o) => onBeer(o.id)).map((o) => o.id);
const worlds = new Map<string, BeerWorld>();

function worldFor(spot: string): BeerWorld {
  let w = worlds.get(spot);
  if (w) return w;
  const front = slotSpots().find((s) => s.id === `${spot}-front`)!;
  w = {
    spots: slotSpotIds(spot),
    playerBusy: () => Math.hypot(playerAt.x - front.x, playerAt.z - front.z) < 0.9,
    claim: (who) => claimMachine('beer', spot, who),
    release: (who) => releaseMachine('beer', spot, who),
    isOpen: () => doorOpenIn(spot),
    open: () => openBeerDoor(spot),
    close: () => closeBeerDoor(spot),
    take: () => bottleClink(spot),
    hold: (who, s) => setHandSnack(who, s),
    sound: (who, cue) => sipSound(cue, at(who)),
    say: (who, text) => say(who, text, text === '🍻' ? 2.4 : 1.6),
    line: new Map(),
    seats: new Map(),
    ready: new Set(),
  };
  worlds.set(spot, w);
  return w;
}

const LINES = PLACED_SPOTS.filter((id) => kindOf(id) === 'big').flatMap((id) => slotSpotIds(id).line);
/** A beer fridge stands on the floor you're on, and it's evening or night by the office clock. */
const open = () => machineSpot('beer') !== null && afterHours(dayTime.t);

const beer = (name: string, weight: number, wants: (drinking: string[], s: ErrandState) => boolean): Errand => ({
  name,
  max: 1,
  weight,
  when: (w, s) => s.floor === 'office' && w.role !== 'ceo' && isFree(w.status) && open() && !onBeer(w.id) && wants(having(s), s),
  spot: LINES,
  where: () => {
    const spot = machineSpot('beer');
    return spot ? slotSpotIds(spot).line : [];
  },
  steps: [],
  act: (id) => new BeerBreak(id, worldFor(machineSpot('beer') ?? 'big-1')),
});

// The first: in their slice of restless moments, while nobody else is having one.
registerErrand(beer('beer', 3, (drinking, s) => drinking.length === 0 && s.seatedFor >= s.restless * 0.6 && fanciesBeer(s.restless)));
// Company: someone's having one alone.
registerErrand(beer('beer-join', 30, (drinking, s) => drinking.length === 1 && s.seatedFor >= 3));

/** Who on the floor you're on is having a beer now (decor/probe.ts reports it). */
export const beerDrinkers = () => [...liveBodies().keys()].filter(onBeer);
