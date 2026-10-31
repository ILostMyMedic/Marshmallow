// When the CEO goes for a walk round a floor: a while after you start watching, then every so often, in office hours,
// for a minute or so. One clock for the whole building (seconds of watching any floor, so it stops with the render):
// only the floor you're on is drawn, so whichever floor's rituals are running reads it. On an office floor the CEO
// steps out of the elevator and walks it (ritualRunner.ts); on their own floor they get up and ride down, and are away
// until the walk is over (CeoRituals.tsx).
// Adapted from cubefarm client/src/world/ritualSchedule.ts (MIT): CEO_WALK, walkHours and nextWalkGap; the merge streak
// that brought the CEO early is cut.

/** Seconds before the first walk, between walks, and away on one; the hours they walk in. */
export const CEO_WALK = { first: [90, 240] as const, gap: [420, 900] as const, away: [35, 75] as const, hours: [8, 21] as const };

export const ceoWalks = {
  /** Seconds of watching, on any floor. */
  watched: 0,
  /** When the next walk is due on that clock; negative until the first look. */
  at: -1,
};

const between = ([a, b]: readonly [number, number], r: number) => a + (b - a) * r;

/** Seconds until the next walk (`first`: the first since you arrived). */
export const nextWalkGap = (rand: number, first = false) => between(first ? CEO_WALK.first : CEO_WALK.gap, rand);

/** How long a walk keeps the CEO away from their desk. */
export const awayFor = (rand: number) => between(CEO_WALK.away, rand);

/** Office hours, by the local clock's hour (0-24). */
export const walkHours = (hour: number) => hour >= CEO_WALK.hours[0] && hour < CEO_WALK.hours[1];

/** Moves the shared clock on (the floor's rituals call it every frame), scheduling the first walk on the first call. */
export function tickWalkClock(dt: number, rand: () => number = Math.random) {
  if (ceoWalks.at < 0) ceoWalks.at = ceoWalks.watched + nextWalkGap(rand(), true);
  ceoWalks.watched += dt;
}

/** A walk is due now (`hour`: the local clock's). */
export const walkDue = (hour: number) => ceoWalks.at >= 0 && ceoWalks.watched >= ceoWalks.at && walkHours(hour);

/** A walk has begun: the next one after the usual gap. */
export function walkStarted(rand: () => number = Math.random) {
  ceoWalks.at = ceoWalks.watched + nextWalkGap(rand());
}
