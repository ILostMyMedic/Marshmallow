// Adapted from cubefarm client/src/world/outside/cityLayout.test.ts (MIT).
import { describe, expect, it } from 'vitest';
import { BAY, CAR_RANGE, carPose, carRoutes, CITY, cityLayout, CORE, CORRIDOR_HALF, DOWNTOWN, GROUND, HOME_FOOTPRINT, MAX_CARS, OUTSKIRTS, theCity, type CityBox } from './cityLayout';

const city = cityLayout();
const everything = (c = city): CityBox[] => [...c.buildings, ...c.boxes, ...c.cylinders, ...c.cones];
const overlaps = (aMin: number, aMax: number, bMin: number, bMax: number) => aMin < bMax && bMin < aMax;
const fromDowntown = (b: CityBox) => Math.hypot(b.x - DOWNTOWN.x, b.z - DOWNTOWN.z);

describe('cityLayout', () => {
  it('builds the same city from the same seed, and another from another seed', () => {
    expect(cityLayout()).toEqual(city);
    expect(theCity()).toEqual(city);
    expect(theCity()).toBe(theCity());
    expect(cityLayout(CITY.seed + 1).buildings).not.toEqual(city.buildings);
  });

  it('is a city: hundreds of buildings, a park, landmarks and roofs, on a grid of streets', () => {
    expect(city.buildings.length).toBeGreaterThan(200);
    expect(city.buildings.length).toBeLessThan(1500);
    expect(city.parks.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...city.buildings.map((b) => b.y + b.h))).toBeGreaterThan(150);
    expect(city.cones.length).toBeGreaterThan(10);
    expect(city.streetsX.length).toBe(2 * (CITY.rings + 1));
    for (const b of city.buildings) {
      expect(b.lit).toBeGreaterThanOrEqual(0);
      expect(b.lit).toBeLessThanOrEqual(1);
      expect(Number.isInteger(b.pattern) && b.pattern >= 0 && b.pattern < 16).toBe(true);
    }
  });

  it('has a skyline downtown, its spire the tallest, and stays low-rise round us', () => {
    const tops = everything().map((b) => ({ b, top: b.y + b.h }));
    const tallest = tops.reduce((a, b) => (b.top > a.top ? b : a));
    expect(tallest.top).toBeGreaterThan(180);
    expect(fromDowntown(tallest.b)).toBeLessThan(CORE.radius);
    // a cluster of skyscrapers, all of them downtown
    const towers = city.buildings.filter((b) => b.y === 0 && b.h > 90);
    expect(towers.length).toBeGreaterThanOrEqual(8);
    for (const t of towers) expect(fromDowntown(t)).toBeLessThan(CORE.radius + 30);
    // the roof terrace (about ten storeys up) looks out over the nearer rooftops
    for (const b of city.buildings) if (Math.hypot(b.x, b.z) < 120) expect(b.y + b.h, JSON.stringify(b)).toBeLessThanOrEqual(30);
  });

  it('keeps a clear gap around our building', () => {
    const hx = HOME_FOOTPRINT.halfX + CITY.gap;
    const hz = HOME_FOOTPRINT.halfZ + CITY.gap;
    for (const b of everything()) {
      const inGap = overlaps(b.x - b.w / 2, b.x + b.w / 2, -hx, hx) && overlaps(b.z - b.d / 2, b.z + b.d / 2, -hz, hz);
      expect(inGap, `${JSON.stringify(b)} is inside the gap`).toBe(false);
    }
  });

  it('puts nothing on a street or its pavements', () => {
    const ex = city.extentX + CORRIDOR_HALF;
    const ez = city.extentZ + CORRIDOR_HALF;
    for (const b of everything()) {
      const alongX = overlaps(b.x - b.w / 2, b.x + b.w / 2, -ex, ex);
      const alongZ = overlaps(b.z - b.d / 2, b.z + b.d / 2, -ez, ez);
      if (alongZ) for (const sx of city.streetsX) expect(overlaps(b.x - b.w / 2, b.x + b.w / 2, sx - CORRIDOR_HALF, sx + CORRIDOR_HALF), `x street ${sx}`).toBe(false);
      if (alongX) for (const sz of city.streetsZ) expect(overlaps(b.z - b.d / 2, b.z + b.d / 2, sz - CORRIDOR_HALF, sz + CORRIDOR_HALF), `z street ${sz}`).toBe(false);
    }
  });

  it('keeps the streets clear of our block', () => {
    expect(Math.min(...city.streetsX.map(Math.abs)) - CORRIDOR_HALF).toBeGreaterThanOrEqual(HOME_FOOTPRINT.halfX);
    expect(Math.min(...city.streetsZ.map(Math.abs)) - CORRIDOR_HALF).toBeGreaterThanOrEqual(HOME_FOOTPRINT.halfZ);
  });

  it('fills the view past the streets out to the haze, but builds nothing on the bay', () => {
    const outskirts = city.boxes.filter((b) => b.y === 0 && (Math.abs(b.x) > city.extentX || Math.abs(b.z) > city.extentZ));
    expect(outskirts.length).toBeGreaterThan(100);
    for (const b of outskirts) {
      expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(OUTSKIRTS.max);
      expect(b.h).toBeLessThan(80);
    }
    for (const b of everything()) {
      expect(b.x - b.w / 2).toBeGreaterThan(BAY.shore);
      expect(b.x + b.w / 2).toBeLessThan(GROUND.maxX);
      expect(Math.abs(b.z) + b.d / 2).toBeLessThan(GROUND.maxZ);
    }
    expect(GROUND.minX).toBe(BAY.shore);
  });
});

describe('cars', () => {
  const cars = carRoutes();
  const pose = { x: 0, z: 0, yaw: 0 };

  it('has a dozen at most, the same every visit, one per lane', () => {
    expect(cars.length).toBeLessThanOrEqual(MAX_CARS);
    expect(carRoutes()).toEqual(cars);
    const lanes = cars.map((c) => `${c.axis}${c.line}${c.dir}`);
    expect(new Set(lanes).size).toBe(lanes.length);
  });

  it('drive on the road, on their own side, and wrap around within range', () => {
    for (const car of cars) {
      expect(car.axis === 'z' ? city.streetsX : city.streetsZ).toContain(car.line);
      for (let t = 0; t < 400; t += 3.7) {
        carPose(car, t, pose);
        const across = car.axis === 'z' ? pose.x - car.line : pose.z - car.line;
        const along = car.axis === 'z' ? pose.z : pose.x;
        expect(Math.abs(across) + car.w / 2).toBeLessThan(CITY.roadHalf);
        expect(Math.sign(across)).toBe(car.axis === 'z' ? -car.dir : car.dir);
        expect(Math.abs(along)).toBeLessThanOrEqual(CAR_RANGE);
        // yaw turns +z towards the way it drives
        expect(car.axis === 'z' ? Math.cos(pose.yaw) : Math.sin(pose.yaw)).toBeCloseTo(car.dir);
      }
    }
  });

  it('turn round before the streets run out', () => {
    expect(CAR_RANGE).toBeLessThanOrEqual(Math.min(city.extentX, city.extentZ));
  });

  it('move forward over time', () => {
    const car = cars[0];
    const a = carPose(car, 0, { x: 0, z: 0, yaw: 0 });
    const b = carPose(car, 1, { x: 0, z: 0, yaw: 0 });
    expect((car.axis === 'z' ? b.z - a.z : b.x - a.x) * car.dir).toBeCloseTo(car.speed);
  });
});
