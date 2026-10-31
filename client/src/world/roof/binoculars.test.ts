import { describe, expect, it } from 'vitest';
import { aimLookout, LENS, lensFor, lookoutAim } from './binoculars';
import { BRIDGE } from '../bridgeLayout';
import { facing, LOOKOUTS, lookoutById } from './roofLayout';

describe('the view through a lookout', () => {
  it('looks out from its eyepiece, behind the post, straight out over the railing (or at its sight) to start with', () => {
    for (const l of LOOKOUTS) {
      const v = lensFor(l);
      const out = facing(l.heading);
      expect(v.id).toBe(l.id);
      // the eye is on the deck's side of the post
      expect((v.x - l.x) * out.x + (v.z - l.z) * out.z).toBeCloseTo(-LENS.back);
      expect(v.y).toBe(LENS.eye);
      expect(v.yaw).toBeCloseTo(l.sight?.yaw ?? l.heading);
      expect(v.minYaw).toBeLessThan(v.yaw);
      expect(v.maxYaw).toBeGreaterThan(v.yaw);
      expect(v.minPitch).toBeLessThan(v.pitch);
      expect(v.maxPitch).toBeGreaterThan(v.pitch);
      expect(v.fov).toBeLessThan(30); // a zoomed view
    }
  });

  it("points the west one at the bridge's north tower, over the rooftops, until someone turns it", () => {
    const v = lensFor(lookoutById('west')!);
    expect(Math.atan2(-(BRIDGE.x - v.x), -(BRIDGE.z - BRIDGE.main / 2 - v.z))).toBeCloseTo(v.yaw, 2);
    expect(v.pitch).toBeGreaterThan(0);
  });

  it('starts where it was last aimed, kept inside its swing, whichever way round the yaw was given', () => {
    const south = lookoutById('south')!;
    // the south lookout swings either side of π: its bounds run past it rather than wrapping
    const v = lensFor(south);
    expect(v.minYaw).toBeLessThan(Math.PI);
    expect(v.maxYaw).toBeGreaterThan(Math.PI);
    const back = lensFor(south, { yaw: -Math.PI + 0.2, pitch: 0.1 });
    expect(back.pitch).toBe(0.1);
    expect(back.yaw).toBeCloseTo(Math.PI + 0.2);
    // too far round, or up or down: as far as it goes
    const east = lookoutById('east')!;
    expect(lensFor(east, { yaw: east.heading + 1.5, pitch: 3 })).toMatchObject({ yaw: east.heading + LENS.swing, pitch: LENS.up });
    expect(lensFor(east, { yaw: east.heading - 1.5, pitch: -3 })).toMatchObject({ yaw: east.heading - LENS.swing, pitch: LENS.down });
  });

  it('remembers where each one was left pointing', () => {
    expect(lookoutAim('west')).toBeNull();
    aimLookout('west', Math.PI / 2 + 0.3, -0.2);
    aimLookout('west', Math.PI / 2 + 0.4, -0.25);
    expect(lookoutAim('west')).toEqual({ yaw: Math.PI / 2 + 0.4, pitch: -0.25 });
    expect(lensFor(lookoutById('west')!, lookoutAim('west'))).toMatchObject({ yaw: Math.PI / 2 + 0.4, pitch: -0.25 });
  });
});
