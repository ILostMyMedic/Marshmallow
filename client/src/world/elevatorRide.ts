// Riding the elevator: its doors open as you (or anyone on foot) come near, you step into the cabin and choose a
// floor on its panel (ui/ElevatorPanel.tsx), the doors shut, the view goes dark for a moment, and you're in the cabin
// on that floor as its doors open. Elevator.tsx draws the doors from `doors` and steps the ride; Player.tsx lets you
// through the doorway only while they're open (elevatorShut), and starts you in the cabin on arrival (takeArrival).
// The floor picker still jumps straight to a floor.
import { create } from 'zustand';
import { elevatorDoorway, HALF_D, type Rect } from './layout';
import { useView } from './view';

/** Where a ride leaves you: inside the cabin, facing out onto the floor. */
export const CABIN_SPOT = { x: 0, z: HALF_D + 1.3, yaw: 0 };
/** Open at least this far (0 shut, 1 open), the doorway lets you through. */
const PASSABLE = 0.8;
/** Seconds the doors take to shut before the view goes dark, how long it stays dark, and the doors opening on arrival. */
export const RIDE = { closing: 0.9, dark: 0.45, opening: 1.1 };

/** How far the doors are open, 0 shut to 1 open: Elevator.tsx writes it every frame. */
export const doors = { open: 0 };

export type RidePhase = 'closing' | 'dark' | 'opening';

interface Ride {
  phase: RidePhase | null;
  /** The floor you're going to (0 is the lobby), and when this phase began (performance.now()). */
  to: number;
  at: number;
}

export const useRide = create<Ride>()(() => ({ phase: null, to: 0, at: 0 }));

let arrival: { x: number; z: number; yaw: number } | null = null;

/** Where to put you on the new floor, once (null: the usual spot in front of the elevator). */
export function takeArrival() {
  const a = arrival;
  arrival = null;
  return a;
}

/** Off to `floor`: the doors shut and away you go. False when you're already there, or riding. */
export function rideTo(floor: number): boolean {
  const ride = useRide.getState();
  if (ride.phase || useView.getState().floor === floor) return false;
  useRide.setState({ phase: 'closing', to: floor, at: performance.now() });
  return true;
}

/** The doors stay shut while the ride is under way, whoever stands at them. */
export const doorsHeldShut = () => {
  const p = useRide.getState().phase;
  return p === 'closing' || p === 'dark';
};

/** Moves a ride on (Elevator.tsx, every frame): shut, dark (the floor changes), open, done. */
export function tickRide(now = performance.now()) {
  const { phase, to, at } = useRide.getState();
  if (!phase) return;
  const s = (now - at) / 1000;
  if (phase === 'closing' && s >= RIDE.closing) useRide.setState({ phase: 'dark', at: now });
  else if (phase === 'dark' && s >= RIDE.dark) {
    arrival = CABIN_SPOT;
    useRide.setState({ phase: 'opening', at: now });
    useView.getState().setFloor(to);
  } else if (phase === 'opening' && s >= RIDE.opening) useRide.setState({ phase: null, at: now });
}

const DOORWAY = elevatorDoorway();
const shut: Rect[] = [];

/** The elevator's doorway while its doors are too shut to walk through, for collide(). The same array every call. */
export function elevatorShut(): Rect[] {
  shut.length = 0;
  if (doors.open < PASSABLE) shut.push(DOORWAY);
  return shut;
}
