// Adapted from cubefarm client/src/world/meals.ts (MIT): lunch only (no Friday pizza).

// Lunch (Rituals.tsx turns it on and off) at the coffee table or the kitchenette. A scripted errand (errands.ts), so
// only free people go, the walker cap holds and work calls them back: they take a spot, eat standing up, chat a little
// in emoji and go back to their desk.

import type { Gesture } from './body';
import { headingFor, isFree, registerErrand, type Act, type ErrandScript, type Me } from './errands';
import type { Pt } from './nav';
import { bodyState, say, setHandFood } from './people';
import { KITCHEN_SPOTS, TABLE_SPOTS, freeSpot, lunchOf } from './ritualSchedule';
import { headingTo } from './socials';
import type { Spot } from './walkways';

/** What's on, on the floor you're on. Rituals.tsx sets it. */
export const meals = {
  lunch: false,
  /** Who has had lunch this lunchtime. */
  ate: new Set<string>(),
  /** Who stands where (spot ids). */
  spots: new Map<string, string>(),
};

const listeners = new Set<() => void>();
let version = 0;

export function subscribeMeals(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export const mealsVersion = () => version;

export function mealsChanged() {
  version++;
  for (const fn of listeners) fn();
}

/** Nothing on: the floor went away. */
export function resetMeals() {
  meals.lunch = false;
  meals.ate.clear();
  meals.spots.clear();
  mealsChanged();
}

/** Seconds someone sits at lunchtime before going, from their roll: people go in turns, not all at once. */
export const lunchWait = (roll = 0.5) => 2 + roll * 30;

const taken = () => new Set(meals.spots.values());
const picked = new Map<string, Spot>();

/** Where to eat: with whoever is already eating, else at the coffee table or the kitchenette (by their roll). */
function placeFor(id: string, spots: readonly (readonly Spot[])[], home: Pt, roll = 0.5): Spot | null {
  const used = taken();
  const busy = spots.find((venue) => venue.some((s) => used.has(s.id)) && venue.some((s) => !used.has(s.id)));
  const order = busy ? [busy] : roll < 0.5 ? spots : [...spots].reverse();
  for (const venue of order) {
    const s = freeSpot(venue, used, home);
    if (s) {
      picked.set(id, s);
      return s;
    }
  }
  return null;
}

function claimSpot(id: string): Spot | null {
  const s = picked.get(id);
  picked.delete(id);
  if (!s || taken().has(s.id)) return null;
  meals.spots.set(id, s.id);
  return s;
}

/** One beat of a meal: for `t` seconds do `gesture`, maybe saying something, facing their spot or whoever is near. */
type Beat = { t: number; gesture: Gesture; say?: string; peer?: boolean };

const LUNCH_BEATS: Beat[] = [
  { t: 1, gesture: 'none' },
  { t: 1.6, gesture: 'sip' },
  { t: 1.6, gesture: 'none', say: '😋', peer: true },
  { t: 1.5, gesture: 'sip' },
  { t: 2.6, gesture: 'talk', say: '💬', peer: true },
  { t: 1.5, gesture: 'sip' },
  { t: 2.4, gesture: 'talk', say: '😂', peer: true },
  { t: 1.4, gesture: 'sip' },
  { t: 1, gesture: 'none', peer: true },
];

/** The nearest other person eating, for a chat. */
function nearestEater(id: string, me: Pt): Pt | null {
  let best: Pt | null = null;
  let bd = 3;
  for (const other of meals.spots.keys()) {
    if (other === id) continue;
    const b = bodyState(other);
    const d = b ? Math.hypot(b.x - me.x, b.z - me.z) : Infinity;
    if (b && d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** Eats through the beats at their spot. */
class Meal implements ErrandScript {
  private act: Act = { do: 'stand', x: 0, z: 0, heading: 0, gesture: 'none' };
  private beat = -1;
  private left = 0;

  constructor(
    readonly id: string,
    readonly spot: Spot,
    private beats: Beat[],
  ) {}

  tick(me: Me): Act {
    this.left -= me.dt;
    while (this.left <= 0) {
      this.beat++;
      const b = this.beats[this.beat];
      if (!b) {
        this.act.do = 'done';
        return this.act;
      }
      this.left += b.t;
      say(this.id, b.say ?? null);
      const peer = b.peer ? nearestEater(this.id, me) : null;
      this.act.heading = peer ? headingTo(me, peer) : headingFor(this.spot.facing);
      this.act.gesture = b.gesture;
    }
    return this.act;
  }

  end() {
    meals.spots.delete(this.id);
    setHandFood(this.id, null);
    say(this.id, null);
  }
}

registerErrand({
  name: 'lunch',
  weight: 500,
  when: (w, s) => s.floor === 'office' && meals.lunch && isFree(w.status) && !meals.ate.has(w.id) && s.seatedFor >= lunchWait(s.roll),
  spot: [],
  steps: [],
  place: (w, s) => placeFor(w.id, [TABLE_SPOTS, KITCHEN_SPOTS], s.home ?? TABLE_SPOTS[0], s.roll),
  claim: (id) => {
    if (!meals.lunch || !claimSpot(id)) return false;
    meals.ate.add(id);
    setHandFood(id, lunchOf(id));
    return true;
  },
  bring: 'hold',
  script: (w) => {
    const s = meals.spots.get(w.id);
    const spot = [...TABLE_SPOTS, ...KITCHEN_SPOTS].find((x) => x.id === s);
    return spot ? new Meal(w.id, spot, LUNCH_BEATS) : null;
  },
});
