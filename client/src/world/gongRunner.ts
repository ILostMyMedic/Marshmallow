// The gong run, live: a merge on the floor you're on (the server's `merged` moment) sends its author running to the
// gong along the walkways, where they take the mallet, strike (gongState.ts: the swing and the celebration), cheer and
// hurry back to their desk. The rules are in gongRun.ts; this moves bodies through people.ts. Gong.tsx pumps it every
// frame, and a coarse timer keeps it going while frames stop (a hidden tab), so a stalled run still ends in a strike.
// Adapted from cubefarm client/src/world/gongRunner.ts (MIT): photo mode's freeze is cut, and merges come from moments.
import type { Moment } from '../../../shared/types';
import { useStore } from '../store';
import type { BodyState, BodyTarget } from './body';
import { busy, createRuns, elsewhere, headingTo, holdsMallet, HURRY_SPEED, nextBeat, nextJob, planGong, RUN_SPEED, runOf, startRun, takenOver, timedOut, type GongJob, type GongPlan, type GongRun } from './gongRun';
import { gongState, hitGong } from './gongState';
import { GONG, GONG_SPOT } from './layout';
import type { Pt } from './nav';
import { bodyState, bodyTarget, claimBody, onErrand, seatBody, setBody } from './people';
import { momentsSince } from './reactions';
import { findPath, walkways } from './walkways';

const runs = createRuns();
const CORNER = 0.4; // m: head for the next waypoint this far short of one, so the run doesn't stop at every corner
const ARRIVED = 0.15;
const NORTH = 0; // body.ts heading facing -Z: the gong
// Where the runner strikes from: a step closer than GONG_SPOT, so the mallet reaches the disc.
const STRIKE = { x: GONG.x, z: GONG.z + 1 };
let timer: ReturnType<typeof setInterval> | null = null;

/** Who has the mallet off its hook right now, or null. Read every frame by Character.tsx and Gong.tsx. */
export const malletHolder = () => (runs.run && holdsMallet(runs.run.beat) ? runs.run.workerId : null);

/** A PR on `floorId` merged: queue its author's run to the gong, or a strike by itself. 'absent' when that floor's gong isn't on screen. */
export function gongForMerge(floorId: string, workerId: string | null): GongPlan {
  const p = planGong({ floorId, here: gongState.here, workerId, present: !!workerId && !!bodyState(workerId), covered: typeof document !== 'undefined' && document.hidden, elsewhere: !!workerId && othersMove(workerId) });
  if (p === 'absent') return p;
  runs.queue.push({ workerId: p === 'run' ? workerId : null, celebrate: true });
  pumpGongRuns(performance.now());
  if (busy(runs) && !timer) timer = setInterval(() => pumpGongRuns(performance.now()), 250);
  return p;
}

/** Drops every queued and running trip, sending the runners back to their seats (the gong's floor went away). */
export function resetGongRuns() {
  if (runs.run) release(runs.run);
  for (const r of runs.home) release(r);
  runs.queue.length = 0;
  runs.home.length = 0;
  runs.run = null;
  stopTimer();
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

// ---------- whose body it is ----------

/** Whether something other than the gong run or the errand director is moving them right now (the stand-up, say). */
const othersMove = (workerId: string) => elsewhere(bodyTarget(workerId), runOf(runs, workerId)?.mine, onErrand(workerId));

/** Moves the runner, remembering the target so a takeover by someone else shows (gongRun.ts takenOver). */
function move(r: GongRun, patch: Partial<Omit<BodyTarget, 'teleport'>>) {
  setBody(r.workerId, patch);
  r.mine = bodyTarget(r.workerId);
}

/** Back to their chair, unless someone else has them now. */
function release(r: GongRun) {
  if (!takenOver(r, bodyTarget(r.workerId))) seatBody(r.workerId);
  r.mine = undefined;
}

// ---------- walking the legs ----------

/** Sends the runner towards their current waypoint: along the leg, or turning to `end` at the last one. */
function aim(r: GongRun, speed: number, end: number) {
  const p = r.legs[r.leg];
  const heading = r.leg === r.legs.length - 1 ? end : headingTo(r.legs[r.leg - 1], p);
  move(r, { mode: 'walking', x: p.x, z: p.z, speed, heading, gesture: 'none' });
}

/** Moves on to the next waypoint when they're near this one; true once they've reached the last. */
function follow(r: GongRun, s: Readonly<BodyState>, speed: number, end: number) {
  const p = r.legs[r.leg];
  const last = r.leg === r.legs.length - 1;
  if (s.stage !== 'up' || Math.hypot(p.x - s.x, p.z - s.z) > (last ? ARRIVED : CORNER)) return false;
  if (last) return true;
  r.leg++;
  aim(r, speed, end);
  return false;
}

/** A walk from `from` along the walkways: [from, ...waypoints], or null when there's no way through. */
function route(from: Pt, to: Pt): Pt[] | null {
  const path = findPath(walkways('office'), from, to);
  return path && path.length ? [from, ...path] : null;
}

// ---------- the trip ----------

function start(job: GongJob & { workerId: string }, now: number) {
  // the gong beats any errand: the director lets them go, and they set off from wherever they are
  if (onErrand(job.workerId)) claimBody(job.workerId);
  const s = othersMove(job.workerId) ? undefined : bodyState(job.workerId);
  // Seated, they get up to the spot beside their chair first; plan from there.
  const from = s && (s.stage === 'seated' || s.stage === 'rising' ? { x: s.standX, z: s.standZ } : { x: s.x, z: s.z });
  const legs = from && route(from, GONG_SPOT);
  if (!legs) {
    // they left, someone else has them now, or no way through: it strikes by itself
    runs.queue.unshift({ workerId: null, celebrate: job.celebrate });
    return;
  }
  const i = runs.home.findIndex((h) => h.workerId === job.workerId);
  if (i >= 0) runs.home.splice(i, 1); // turned round on the way back from the last one
  const r = startRun(job, now, legs);
  r.mine = bodyTarget(job.workerId);
  r.leg = 1;
  runs.run = r;
  aim(r, RUN_SPEED, NORTH);
}

function goHome(r: GongRun, s: Readonly<BodyState>, now: number) {
  r.beat = 'back';
  r.since = now;
  const legs = route({ x: s.x, z: s.z }, { x: s.standX, z: s.standZ });
  if (legs) {
    r.legs = legs;
    r.leg = 1;
    aim(r, HURRY_SPEED, s.seatHeading);
  } else {
    r.legs = [];
    r.leg = 0;
    release(r); // straight back to their chair
  }
  runs.home.push(r);
}

function step(r: GongRun, now: number) {
  const s = bodyState(r.workerId);
  const struck = r.beat === 'strike' || r.beat === 'pose';
  const taken = takenOver(r, bodyTarget(r.workerId));
  if (!s || taken || (!struck && timedOut(r, now))) {
    // gone from the floor, taken over or not there in time: the gong strikes by itself, and they head back unless
    // someone else has them now
    runs.run = null;
    if (!struck) runs.queue.unshift({ workerId: null, celebrate: r.celebrate });
    if (s && !taken) goHome(r, s, now);
    else release(r);
    return;
  }
  if (r.beat === 'run') {
    if (!follow(r, s, RUN_SPEED, NORTH)) return;
    r.beat = 'take';
    r.since = now;
    move(r, { mode: 'standing', x: STRIKE.x, z: STRIKE.z, heading: NORTH, speed: 1, gesture: 'take' });
    return;
  }
  const next = nextBeat(r, now, gongState.hitAt);
  if (!next) return;
  r.beat = next;
  r.since = now;
  if (next === 'windup') move(r, { gesture: 'windup' });
  else if (next === 'strike') {
    move(r, { gesture: 'strike' });
    hitGong({ celebrate: r.celebrate }); // the mallet lands
  } else if (next === 'pose') move(r, { gesture: 'cheer' });
  else if (next === 'back') {
    runs.run = null;
    goHome(r, s, now);
  }
}

/** Moves every trip along; Gong.tsx calls it each frame. Allocates nothing unless something changes. */
export function pumpGongRuns(now: number) {
  if (!busy(runs)) return stopTimer();
  for (let i = runs.home.length - 1; i >= 0; i--) {
    const r = runs.home[i];
    const s = bodyState(r.workerId);
    if (!s || takenOver(r, bodyTarget(r.workerId))) {
      release(r); // gone from the floor, or someone else has them now: theirs to finish
      runs.home.splice(i, 1);
    } else if (r.leg >= r.legs.length) {
      if (s.stage === 'seated') runs.home.splice(i, 1);
    } else if (follow(r, s, HURRY_SPEED, s.seatHeading)) {
      release(r); // the last step: to the spot beside the chair, and sit
      r.leg = r.legs.length;
    }
  }
  if (runs.run) step(runs.run, now);
  for (let job = nextJob(runs, now, gongState.hitAt); job; job = nextJob(runs, now, gongState.hitAt)) {
    if (job.workerId) start(job as GongJob & { workerId: string }, now);
    else hitGong({ celebrate: job.celebrate });
  }
}

// Merges as the server reports them.
let last: Moment | null = null;
if (typeof window !== 'undefined') {
  useStore.subscribe((state, prev) => {
    if (!prev.loaded) {
      last = state.moments.at(-1) ?? null; // the first snapshot: nothing just happened
      return;
    }
    if (state.moments === prev.moments) return;
    for (const m of momentsSince(state.moments, last)) if (m.type === 'merged') gongForMerge(m.floorId, m.devWorkerId);
    last = state.moments.at(-1) ?? null;
  });
  // __mmGong.run(workerId) sends someone on this floor to strike the gong (it strikes by itself when they can't go).
  const probe = (window as unknown as Record<string, Record<string, unknown> | undefined>).__mmGong;
  if (probe) Object.assign(probe, { run: (workerId: string) => gongState.here && gongForMerge(gongState.here, workerId), running: () => busy(runs) });
}
