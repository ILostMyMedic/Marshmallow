// Adapted from cubefarm client/src/world/sky/skyLayout.ts (MIT): the stars; the clouds are cut.

// Where the night sky's stars are. Pure and seeded (the same sky every visit). Directions are relative to the viewer:
// the sky moves with the camera.

/** mulberry32: a tiny seeded random in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Star directions (unit vectors, xyz per star) with a size in pixels and a twinkle phase per star. */
export function starField(count: number, seed = 11): { positions: Float32Array; sizes: Float32Array; phases: Float32Array } {
  const rnd = seeded(seed);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // uniform on the sphere: the stars wheel round with the sun, so they fill the whole sky
    const y = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - y * y);
    positions.set([Math.cos(a) * s, y, Math.sin(a) * s], i * 3);
    const bright = rnd();
    sizes[i] = bright > 0.94 ? 4.5 : bright > 0.7 ? 3 : 2;
    phases[i] = rnd();
  }
  return { positions, sizes, phases };
}
