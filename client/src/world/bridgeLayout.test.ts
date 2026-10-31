import { describe, expect, it } from 'vitest';
import { bayMesh, BRIDGE, bridgeLayout, bridgeMesh, CABLE, cableY, HEADLANDS, SEA, WATER_Y } from './bridgeLayout';
import { BAY, theCity } from './cityLayout';

const bridge = bridgeLayout();

/** Whether (x, z) is inside a convex outline, whichever way it winds. */
function inside(outline: readonly (readonly [number, number])[], x: number, z: number) {
  let sign = 0;
  for (let i = 0; i < outline.length; i++) {
    const [ax, az] = outline[i];
    const [bx, bz] = outline[(i + 1) % outline.length];
    const c = Math.sign((bx - ax) * (z - az) - (bz - az) * (x - ax));
    if (c === 0) continue;
    if (sign && c !== sign) return false;
    sign = c;
  }
  return true;
}

describe('the bridge', () => {
  it('hangs its cables from the towers: down into the anchorages and sagging to just over the middle of the deck', () => {
    const [tn, ts] = bridge.towers;
    const [an, as] = bridge.anchors;
    expect(cableY(tn)).toBeCloseTo(CABLE.top);
    expect(cableY(ts)).toBeCloseTo(CABLE.top);
    expect(cableY(BRIDGE.z)).toBeCloseTo(CABLE.low);
    expect(CABLE.low).toBeGreaterThan(BRIDGE.deckY);
    expect(cableY(an)).toBeCloseTo(CABLE.anchor);
    expect(cableY(as)).toBeCloseTo(CABLE.anchor);
    expect(cableY(an - 1)).toBeNaN();
    // no kinks where the spans meet, and the same both ways from the middle
    expect(Math.abs(cableY(tn - 0.01) - cableY(tn + 0.01))).toBeLessThan(0.1);
    for (const d of [10, 90, 170, 230]) expect(cableY(BRIDGE.z - d)).toBeCloseTo(cableY(BRIDGE.z + d));
    // under the towers' tops all the way
    for (let z = an; z <= as; z += 5) expect(cableY(z)).toBeLessThanOrEqual(BRIDGE.towerTop);
    for (const c of bridge.cables) {
      expect(c.points[0][0]).toBe(an);
      expect(c.points[c.points.length - 1][0]).toBe(as);
      for (const [z, y] of c.points) expect(y).toBeCloseTo(cableY(z));
    }
  });

  it('hangs suspenders from each cable down to the deck', () => {
    expect(bridge.hangers.length).toBeGreaterThan(40);
    for (const h of bridge.hangers) {
      const [[z0, y0], [z1, y1]] = h.points;
      expect(z0).toBe(z1);
      expect(y0).toBe(BRIDGE.deckY);
      expect(y1).toBeCloseTo(cableY(z0));
      expect(bridge.cables.map((c) => c.x)).toContain(h.x);
    }
  });

  it('stands two alike towers on piers in the water, their legs thinner towards the top', () => {
    const at = (z: number) => bridge.boxes.filter((b) => b.z === z && b.y < BRIDGE.towerTop);
    const [a, b] = bridge.towers.map(at);
    expect(a.length).toBeGreaterThan(8);
    expect(a.map(({ x, y, w, h, d }) => [x, y, w, h, d])).toEqual(b.map(({ x, y, w, h, d }) => [x, y, w, h, d]));
    const leg = a.filter((p) => p.x === BRIDGE.x - BRIDGE.width / 2).sort((p, q) => p.y - q.y);
    for (let i = 1; i < leg.length; i++) expect(leg[i].w).toBeLessThan(leg[i - 1].w);
    expect(Math.max(...leg.map((p) => p.y + p.h))).toBe(BRIDGE.towerTop);
    expect(Math.min(...a.map((p) => p.y))).toBeLessThan(WATER_Y);
    for (const z of bridge.towers) for (const h of HEADLANDS) expect(inside(h, BRIDGE.x, z)).toBe(false);
  });

  it('lands on the two headlands, out in the bay beyond the city, and within sight', () => {
    for (const h of HEADLANDS) {
      expect(bridge.anchors.filter((z) => inside(h, BRIDGE.x, z))).toHaveLength(1);
    }
    const city = theCity();
    const westmost = Math.min(...[...city.buildings, ...city.boxes].map((b) => b.x - b.w / 2));
    const { positions } = bridgeMesh(bridge);
    let near = Infinity;
    let far = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const [x, , z] = [positions[i], positions[i + 1], positions[i + 2]];
      expect(x).toBeLessThan(BAY.shore);
      expect(x).toBeLessThan(westmost);
      expect(x).toBeGreaterThan(SEA.minX);
      near = Math.min(near, Math.hypot(x, z));
      far = Math.max(far, Math.hypot(x, z));
    }
    expect(near).toBeGreaterThan(450);
    expect(far).toBeLessThan(850); // inside the camera's far plane (Game.tsx: 900), wherever the camera is
  });

  it('puts its hills on the headlands, west of the shore', () => {
    for (const h of bridge.hills) {
      expect(h.x + h.w / 2).toBeLessThan(BAY.shore);
      expect(HEADLANDS.some((o) => inside(o, h.x, h.z))).toBe(true);
    }
  });

  it('has convex headlands, as the flat fill assumes', () => {
    for (const h of HEADLANDS) {
      const turns = h.map((p, i) => {
        const a = h[(i + h.length - 1) % h.length];
        const b = h[(i + 1) % h.length];
        return Math.sign((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]));
      });
      expect(new Set(turns.filter((t) => t !== 0)).size).toBe(1);
    }
  });

  it('stays cheap: a few hundred triangles for the bridge and its hills, a handful for the bay', () => {
    expect(bridgeMesh(bridge).triangles).toBeLessThan(1000);
    expect(bayMesh().triangles).toBeLessThan(40);
    const m = bridgeMesh(bridge);
    expect(m.positions.length).toBe(m.triangles * 9);
    expect(m.normals.length).toBe(m.positions.length);
    expect(m.colors.length).toBe(m.triangles * 3);
  });

  it('winds every face towards its normal', () => {
    for (const m of [bridgeMesh(bridge), bayMesh()]) {
      const p = m.positions;
      for (let t = 0; t < m.triangles; t++) {
        const i = t * 9;
        const e1 = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]];
        const e2 = [p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]];
        const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const n = [m.normals[i], m.normals[i + 1], m.normals[i + 2]];
        expect(c[0] * n[0] + c[1] * n[1] + c[2] * n[2]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
