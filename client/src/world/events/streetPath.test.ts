import { describe, expect, it } from 'vitest';
import { CORRIDOR_HALF, LANE, theCity, type CityBox } from '../cityLayout';
import { HALF_D } from '../layout';
import { EVENTS } from '../../../../shared/worldEvents';
import { bodyAt, drive, driveAt, footprint, KERB_OFF, passing, PLAZA, routeAt, SIDE_STREET, STOP_Z, stopOf, STREET_EVENTS, STREET_SIZE, streetRoute, type DriveSample, type Pose } from './streetPath';

const pose = (): Pose => ({ x: 0, z: 0, yaw: 0, speed: 0, u: 0 });
const sample = (): DriveSample => ({ u: 0, off: 0, speed: 0, turn: 0 });
const solids: CityBox[] = (() => {
  const c = theCity();
  return [...c.buildings, ...c.boxes, ...c.cylinders, ...c.cones];
})();
const overlaps = (aMin: number, aMax: number, bMin: number, bMax: number) => aMin < bMax && bMin < aMax;

describe('a drive along a street', () => {
  const legs = [
    { to: 100, speed: 8 },
    { to: 150, speed: 3, stop: 10, off: 4 },
    { to: 300, speed: 8, off: 2 },
  ];
  const d = drive(legs, { off: 2 });

  it('gets to the end, never faster than its legs, stopping where it stops for as long as it stops', () => {
    const s = sample();
    expect(driveAt(d, 0, s).u).toBe(0);
    expect(driveAt(d, d.seconds, s).u).toBeCloseTo(300);
    let stopped = 0;
    for (let t = 0; t < d.seconds; t += d.dt) {
      driveAt(d, t, s);
      const leg = legs.find((l) => s.u <= l.to + 1e-3)!;
      expect(s.speed).toBeLessThanOrEqual(leg.speed + 1e-3);
      if (Math.abs(s.u - 150) < 1e-3 && s.speed === 0) stopped += d.dt;
    }
    expect(stopped).toBeGreaterThanOrEqual(10 - 0.1);
    // slowed for the slow leg before it began, and stood at the kerb while stopped
    expect(driveAt(d, (100 - 1) / 8, s).speed).toBeLessThan(7.5);
    const atStop = d.u.findIndex((u) => u >= 150);
    expect(d.off[atStop + 10]).toBeCloseTo(4);
  });

  it('eases across, turning towards where it goes and straight again once there', () => {
    const s = sample();
    const mid = d.u.findIndex((u) => u >= 125) * d.dt;
    expect(driveAt(d, mid, s).turn).toBeGreaterThan(0.02);
    expect(driveAt(d, mid, s).turn).toBeLessThan(0.3);
    expect(driveAt(d, d.seconds - 1, s).turn).toBeCloseTo(0, 2);
  });

  it('covers its box, turned and with ground held ahead of it', () => {
    expect(footprint({ x: 10, z: 0, yaw: 0 }, 2, 10)).toEqual({ minX: 9, maxX: 11, minZ: -5, maxZ: 5 });
    const ahead = footprint({ x: 0, z: 0, yaw: Math.PI }, 2, 10, 6);
    expect(ahead.minZ).toBeCloseTo(-11);
    expect(ahead.maxZ).toBeCloseTo(5);
    const turned = footprint({ x: 0, z: 0, yaw: Math.PI / 2 }, 2, 10);
    expect(turned.maxX).toBeCloseTo(5);
    expect(turned.maxZ).toBeCloseTo(1);
  });
});

describe('the street events’ routes', () => {
  const routes = STREET_EVENTS.flatMap((id) => (['west', 'east'] as const).flatMap((side) => [0, 0.99].map((roll) => ({ id, side, roll, r: streetRoute(id, side, roll) }))));

  it('keep to the street beside the office, clear of the plaza, its trees and every building', () => {
    for (const { id, side, roll, r } of routes) {
      const s = side === 'west' ? -1 : 1;
      expect(r.x).toBe(s * SIDE_STREET);
      const { w, len } = STREET_SIZE[id];
      const p = pose();
      // only what stands near the street could be in the way
      const near = solids.filter((c) => overlaps(r.x - CORRIDOR_HALF - 5, r.x + CORRIDOR_HALF + 5, c.x - c.w / 2, c.x + c.w / 2));
      for (let t = 0; t <= r.drive.seconds; t += 0.25) {
        const box = footprint(bodyAt(id, r, t, p), w, len);
        const where = `${id} ${side} ${roll} at ${t}s`;
        // on the street's road and pavements, the plaza's kerb (and the trees on it) on the office's side of it
        if (box.minX < r.x - CORRIDOR_HALF || box.maxX > r.x + CORRIDOR_HALF || Math.min(Math.abs(box.minX), Math.abs(box.maxX)) < PLAZA.x) throw new Error(`${where} leaves the street: ${JSON.stringify(box)}`);
        const hit = near.find((c) => overlaps(box.minX, box.maxX, c.x - c.w / 2, c.x + c.w / 2) && overlaps(box.minZ, box.maxZ, c.z - c.d / 2, c.z + c.d / 2));
        if (hit) throw new Error(`${where} runs into ${JSON.stringify(hit)}`);
      }
    }
  });

  it('pass right outside the office, coming from and going off down the street', () => {
    for (const { id, side, roll, r } of routes) {
      const p = pose();
      let nearest = Infinity;
      for (let t = 0; t <= r.drive.seconds; t += 0.25) nearest = Math.min(nearest, Math.abs(bodyAt(id, r, t, p).z));
      expect(nearest, `${id} ${side} ${roll}`).toBeLessThan(HALF_D);
      expect(Math.abs(bodyAt(id, r, 0, p).z), `${id} starts`).toBeGreaterThan(80);
      expect(Math.abs(bodyAt(id, r, r.drive.seconds, p).z), `${id} ends`).toBeGreaterThan(80);
      expect(Math.abs(r.x)).toBeLessThan(40);
    }
  });

  it('fit their time in the catalogue, the street clear again just before the end', () => {
    for (const { id, r } of routes) {
      expect(r.drive.seconds, id).toBeLessThanOrEqual(EVENTS[id].seconds - 1);
      expect(r.drive.seconds, id).toBeGreaterThanOrEqual(EVENTS[id].seconds - 8);
    }
  });

  it('roll slowly past the office, the fire engine racing', () => {
    const p = pose();
    for (const id of ['rockbus', 'parade'] as const) {
      const r = streetRoute(id, 'east', 0);
      for (let t = 0; t <= r.drive.seconds; t += 0.5) if (Math.abs(bodyAt(id, r, t, p).z) < 30) expect(p.speed, id).toBeLessThan(2.6);
    }
    const fire = streetRoute('firetruck', 'west', 0);
    expect(routeAt(fire, fire.drive.seconds / 2, p).speed).toBeGreaterThan(15);
  });

  it('pull the trucks over at the kerb outside, clear of the lane’s cars while they stand there', () => {
    for (const id of ['icecream', 'foodtruck'] as const)
      for (const side of ['west', 'east'] as const) {
        const r = streetRoute(id, side, 0);
        const p = pose();
        let standing = 0;
        expect(stopOf(r.drive)![1] - stopOf(r.drive)![0]).toBeCloseTo(id === 'foodtruck' ? 40 : 14, 0);
        for (let t = 0; t < r.drive.seconds - 0.5; t += 0.25) {
          routeAt(r, t, p);
          if (p.speed > 0) continue;
          standing += 0.25;
          expect(p.z).toBeCloseTo(STOP_Z[side], 1);
          // on the office's side of the street, past the lane its cars drive in (a bus is 2.5 m wide)
          const off = (p.x - r.x) * -r.dir;
          expect(off).toBeCloseTo(KERB_OFF, 1);
          expect(off - STREET_SIZE[id].w / 2).toBeGreaterThan(LANE + 1.25);
          expect(Math.abs(p.x)).toBeLessThan(SIDE_STREET);
        }
        expect(standing).toBeGreaterThan(id === 'foodtruck' ? 35 : 10);
      }
  });

  it('know when they pass the office, so people get to the windows in time', () => {
    for (const id of STREET_EVENTS) {
      const [from, until] = passing(id);
      expect(from, id).toBeGreaterThan(5);
      expect(until, id).toBeGreaterThan(from);
      expect(until, id).toBeLessThan(EVENTS[id].seconds - 5);
    }
    expect(passing('rockbus')[1] - passing('rockbus')[0]).toBeGreaterThan(20);
  });
});
