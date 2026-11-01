import { describe, expect, it } from 'vitest';
import { ceoRoom, onWall, pictures, picturesGeometry } from './ceoRoom';
import { HALF_D, HALF_W } from './layout';

describe("the CEO's office's furniture", () => {
  it('builds four vertex-coloured geometries, none of them empty (a mismatched part would leave one so)', () => {
    const room = ceoRoom();
    for (const [name, g] of Object.entries(room)) {
      expect(g.getAttribute('position')?.count ?? 0, name).toBeGreaterThan(100);
      expect(g.getAttribute('color'), name).toBeDefined();
      expect(g.getAttribute('normal'), name).toBeDefined();
    }
    // a lot of furniture, but not a silly amount of vertices
    expect(room.solid.getAttribute('position').count).toBeLessThan(250_000);
    for (const g of Object.values(room)) g.dispose();
  });

  it('keeps everything on the walls within the cutaway, so it goes with its wall', () => {
    const { wall } = ceoRoom();
    const pos = wall.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // within 0.15 m of a wall (cutaway.ts cuts that far in)
      const out = Math.min(HALF_W - Math.abs(x), HALF_D - Math.abs(z));
      expect(out, `vertex ${i} at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBeLessThan(0.15);
    }
  });

  it('hangs each picture facing the room, its face mapped to its own cell of the canvas', () => {
    expect(onWall('north', 3, 2, 0.1)).toEqual({ pos: [3, 2, -HALF_D + 0.1], yaw: 0 });
    expect(onWall('east', 4, 2, 0.1).pos[0]).toBeCloseTo(HALF_W - 0.1);
    const g = picturesGeometry(2, 2);
    const uv = g.getAttribute('uv');
    expect(uv.count).toBe(pictures().length * 4);
    // each picture's corners stay inside one quarter of the canvas
    for (let p = 0; p < pictures().length; p++) {
      const us = Array.from({ length: 4 }, (_, j) => uv.getX(p * 4 + j));
      const vs = Array.from({ length: 4 }, (_, j) => uv.getY(p * 4 + j));
      expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(0.5);
      expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(0.5);
      expect(Math.min(...us)).toBeCloseTo((p % 2) * 0.5);
      expect(Math.max(...vs)).toBeCloseTo(1 - Math.floor(p / 2) * 0.5);
    }
    g.dispose();
  });
});
