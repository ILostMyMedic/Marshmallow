import { beforeEach, describe, expect, it } from 'vitest';
import { CABIN_SPOT, doors, doorsHeldShut, elevatorShut, rideTo, RIDE, takeArrival, tickRide, useRide } from './elevatorRide';
import { useView } from './view';

describe('the elevator ride', () => {
  beforeEach(() => {
    useRide.setState({ phase: null, to: 0, at: 0 });
    useView.setState({ floor: 1 });
    takeArrival();
  });

  it('shuts the doors, goes dark, changes floor with you in the cabin, and opens again', () => {
    expect(rideTo(1)).toBe(false); // already here
    expect(rideTo(0)).toBe(true);
    const t0 = useRide.getState().at;
    expect(doorsHeldShut()).toBe(true);
    expect(rideTo(2)).toBe(false); // one ride at a time
    tickRide(t0 + RIDE.closing * 1000 + 1);
    expect(useRide.getState().phase).toBe('dark');
    expect(useView.getState().floor).toBe(1);
    tickRide(t0 + (RIDE.closing + RIDE.dark) * 1000 + 2);
    expect(useView.getState().floor).toBe(0);
    expect(useRide.getState().phase).toBe('opening');
    expect(doorsHeldShut()).toBe(false);
    expect(takeArrival()).toEqual(CABIN_SPOT);
    expect(takeArrival()).toBeNull();
    tickRide(useRide.getState().at + RIDE.opening * 1000 + 1);
    expect(useRide.getState().phase).toBeNull();
  });

  it('lets you through the doorway only while the doors are open', () => {
    doors.open = 0.3;
    expect(elevatorShut()).toHaveLength(1);
    doors.open = 1;
    expect(elevatorShut()).toHaveLength(0);
  });
});
