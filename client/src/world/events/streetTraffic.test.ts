import { afterEach, describe, expect, it } from 'vitest';
import { carPose, carRoutes, LANE, type CarRoute } from '../cityLayout';
import { bodyAt, footprint, SIDE_STREET, STREET_EVENTS, STREET_SIZE, streetRoute, type Box, type Pose } from './streetPath';
import { clearance, GAP, holdOf, holdStreet, PULL, pullFor, resetTraffic, streetHolds, trafficPose, type Hold } from './streetTraffic';

const car = (over: Partial<CarRoute> = {}): CarRoute => ({ axis: 'z', line: SIDE_STREET, dir: 1, speed: 10, start: 0, w: 1.9, h: 1.5, len: 4.2, color: 0, bus: false, ...over });
// a slow bus in the east street's southbound lane, its middle at z = 0
const bus: Hold = { minX: SIDE_STREET - LANE - 1.25, maxX: SIDE_STREET - LANE + 1.25, minZ: -5.5, maxZ: 5.5 };
const laneX = SIDE_STREET - LANE;

afterEach(resetTraffic);

describe('giving way to a street event', () => {
  it('queues a car coming up behind it in its lane at a safe distance', () => {
    const c = car();
    const at = { x: laneX, z: -9 };
    const move = clearance(c, at, { x: laneX, z: -9.3 }, bus);
    expect(move).toBeLessThan(0);
    expect(at.z + move).toBeCloseTo(bus.minZ - GAP - c.len / 2);
    // once it's waiting at the edge it stays there, however the rounding falls
    expect(clearance(c, { x: laneX, z: at.z + move + 0.1 }, { x: laneX, z: at.z + move + 0.01 }, bus)).toBeLessThan(0);
  });

  it('leaves the other lane alone, and anything well clear of it', () => {
    expect(clearance(car({ dir: -1 }), { x: SIDE_STREET + LANE, z: 0 }, { x: SIDE_STREET + LANE, z: 1 }, bus)).toBe(0);
    expect(clearance(car(), { x: laneX, z: -30 }, { x: laneX, z: -30.3 }, bus)).toBe(0);
  });

  it('stops a car crossing its path at the junction, but lets one already crossing ahead of it carry on', () => {
    const across = car({ axis: 'x', line: 32.5, dir: 1 });
    const hold: Hold = { minX: laneX - 1.25, maxX: laneX + 1.25, minZ: 25, maxZ: 40 };
    const edge = hold.minX - GAP - across.len / 2;
    const move = clearance(across, { x: edge + 0.25, z: 34.5 }, { x: edge - 0.15, z: 34.5 }, hold);
    expect(edge + 0.25 + move).toBeCloseTo(edge);
    expect(clearance(across, { x: laneX, z: 34.5 }, { x: laneX - 0.3, z: 34.5 }, hold)).toBe(0);
  });

  it('moves a car out of the way of one that appears on top of it', () => {
    const c = car();
    const move = clearance(c, { x: laneX, z: 4 }, { x: laneX, z: 3.7 }, bus, true);
    expect(4 + move).toBeCloseTo(bus.maxZ + GAP + c.len / 2);
  });

  it('pulls the cars ahead of a siren over to the kerb', () => {
    const siren = { line: SIDE_STREET, dir: 1 as const, z: 0 };
    expect(pullFor(car(), { x: laneX, z: 30 }, siren)).toBeCloseTo(PULL.by);
    expect(pullFor(car(), { x: laneX, z: 75 }, siren)).toBeGreaterThan(0);
    expect(pullFor(car(), { x: laneX, z: 150 }, siren)).toBe(0);
    expect(pullFor(car({ dir: -1 }), { x: laneX, z: 30 }, siren)).toBe(0);
    holdStreet(1, { minX: -1000, maxX: -999, minZ: 0, maxZ: 1, siren });
    const p = trafficPose(car({ start: 30 }), 0, 0, { x: 0, z: 0, yaw: 0 });
    expect(p.x).toBeCloseTo(SIDE_STREET - LANE - PULL.by);
  });

  it('holds and lets go of the ground', () => {
    holdStreet(4, bus);
    holdStreet(4, { ...bus, minZ: 0 });
    expect(streetHolds()).toEqual([expect.objectContaining({ minZ: 0 })]);
    holdStreet(4, null);
    expect(streetHolds()).toEqual([]);
  });
});

const overlap = (a: Box, b: Box, eps = 0.05) => a.minX < b.maxX - eps && b.minX < a.maxX - eps && a.minZ < b.maxZ - eps && b.minZ < a.maxZ - eps;
const carBox = (c: CarRoute, p: { x: number; z: number }): Box =>
  c.axis === 'z' ? { minX: p.x - c.w / 2, maxX: p.x + c.w / 2, minZ: p.z - c.len / 2, maxZ: p.z + c.len / 2 } : { minX: p.x - c.len / 2, maxX: p.x + c.len / 2, minZ: p.z - c.w / 2, maxZ: p.z + c.w / 2 };

describe('the city’s cars and the street events', () => {
  it('never drive through one, on either side, in either lane, whenever they meet it', () => {
    const cars = carRoutes();
    const p: Pose = { x: 0, z: 0, yaw: 0, speed: 0, u: 0 };
    const at = { x: 0, z: 0, yaw: 0 };
    const hold: Hold = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    const plain = { x: 0, z: 0, yaw: 0 };
    let held = 0;
    for (const id of STREET_EVENTS)
      for (const side of ['west', 'east'] as const)
        for (const roll of [0, 0.99])
          for (const clock of [0, 41, 113]) {
            resetTraffic();
            const r = streetRoute(id, side, roll);
            const { w, len } = STREET_SIZE[id];
            for (let t = 0; t <= r.drive.seconds; t += 1 / 30) {
              holdStreet(7, holdOf(id, r, t, hold));
              const box = footprint(bodyAt(id, r, t, p), w, len);
              cars.forEach((c, i) => {
                trafficPose(c, i, clock + t, at);
                carPose(c, clock + t, plain);
                if (Math.abs(plain.x - at.x) + Math.abs(plain.z - at.z) > 0.01) held++;
                const hit = overlap(carBox(c, at), box);
                if (hit) throw new Error(`${id} ${side} ${roll} (clock ${clock}) at ${t.toFixed(2)}s: car ${i} at ${at.x.toFixed(1)}, ${at.z.toFixed(1)} inside ${JSON.stringify(box)}`);
              });
            }
          }
    // (and they did meet: cars were held up or pulled over for many seconds in all)
    expect(held / 30).toBeGreaterThan(60);
  });

  it('holds a car up behind the rock bus, and lets it go once the bus has gone', () => {
    // a car 30 m behind the bus in the east street's southbound lane, faster than it
    const c = car({ start: -200 });
    const r = streetRoute('rockbus', 'east', 0);
    expect(r.dir).toBe(1);
    const at = { x: 0, z: 0, yaw: 0 };
    let behind = 0;
    for (let t = 0; t <= r.drive.seconds; t += 1 / 30) {
      const rear = holdOf('rockbus', r, t).minZ;
      holdStreet(1, holdOf('rockbus', r, t));
      trafficPose(c, 0, t, at);
      expect(at.z).toBeLessThan(rear);
      if (rear - at.z < 6) behind += 1 / 30;
    }
    // it waited behind the bus all the way past the office
    expect(behind).toBeGreaterThan(40);
    holdStreet(1, null);
    // and carries on at its own speed from where it waited
    const a = trafficPose(c, 0, 200, at).z;
    const b = trafficPose(c, 0, 201, at).z;
    expect((b - a + 600) % 600).toBeCloseTo(c.speed, 1); // (it may have wrapped round its loop)
  });
});
