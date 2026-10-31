import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_WORLD, EVENTS, type EventId, type WorldRun } from '../../../../shared/worldEvents';
import { useStore } from '../../store';
import { bigEvent, runningEvents, showRuns, stepEvents } from './eventsState';

const run = (key: number, id: EventId, startedAt: number): WorldRun => ({ key, id, side: 'west', seed: 7, startedAt, seconds: EVENTS[id].seconds, forced: false });
const NOW = 1_800_000_000_000;

afterEach(() => showRuns([]));

describe('the events a tab draws', () => {
  it("joins a running event at its point, leaves out one that's over, and keeps each run as the office's list changes", () => {
    showRuns([run(1, 'blimp', NOW - 30_000), run(2, 'plane', NOW - 80_000)], NOW);
    expect(runningEvents().map((r) => [r.key, r.t])).toEqual([[1, 30]]);
    const blimp = bigEvent();
    showRuns([run(1, 'blimp', NOW - 30_000), run(3, 'birds', NOW)], NOW + 1000);
    expect(bigEvent()).toBe(blimp); // the same run, so its scene carries on
    expect(runningEvents().map((r) => r.key)).toEqual([1, 3]);
    stepEvents(0.016, NOW + 10_000);
    expect(blimp?.t).toBe(40);
    // the birds' time is up: gone without waiting for the office, and not drawn again if its list still has them
    stepEvents(0.016, NOW + EVENTS.birds.seconds * 1000);
    expect(runningEvents().map((r) => r.key)).toEqual([1]);
    showRuns([run(1, 'blimp', NOW - 30_000), run(3, 'birds', NOW)], NOW + EVENTS.birds.seconds * 1000 + 500);
    expect(runningEvents().map((r) => r.key)).toEqual([1]);
    showRuns([], NOW + 30_000);
    expect(runningEvents()).toEqual([]);
  });

  it("follows the office's world in the store", () => {
    useStore.getState().apply({ type: 'world', world: { running: [run(9, 'ufo', Date.now() - 5000)], nextAt: 0 } });
    expect(runningEvents().map((r) => r.id)).toEqual(['ufo']);
    expect(runningEvents()[0].t).toBeGreaterThanOrEqual(5);
    useStore.getState().apply({ type: 'world', world: EMPTY_WORLD });
    expect(runningEvents()).toEqual([]);
  });
});
