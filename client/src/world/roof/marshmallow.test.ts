import { describe, expect, it } from 'vitest';
import { collide } from '../layout';
import { eatLine, HEAT, heatAt, stageOf, stickTip, TOAST, TOAST_COLOURS, toastColour, toastStep, toastWord, workerToast, type Toasting } from './marshmallow';
import { FIRE, ROOF_SEATS, roofColliders } from './roofLayout';

/** How light a colour is, 0-255. */
const light = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

/** Toasts at `heat` for `seconds`, a frame at a time, counting the times it caught. */
function toastFor(seconds: number, heat = 1, from: Toasting = { toast: 0, flame: 0 }) {
  let s = from;
  let caught = 0;
  for (let t = 0; t < seconds; t += 0.05) {
    const n = toastStep(s, heat, 0.05);
    if (n.caught) caught++;
    s = { toast: n.toast, flame: n.flame };
  }
  return { ...s, caught };
}

describe('where it toasts', () => {
  it('holds it out in front of you', () => {
    const tip = stickTip(1, 2, 0, 1.5);
    expect(tip.x).toBeCloseTo(1);
    expect(tip.z).toBeCloseTo(0.5);
    expect(stickTip(0, 0, Math.PI / 2, 1).x).toBeCloseTo(-1);
  });

  it('is hottest over the flames and cold a stride back', () => {
    expect(heatAt(FIRE)).toBe(1);
    expect(heatAt({ x: FIRE.x + HEAT.full - 0.01, z: FIRE.z })).toBe(1);
    expect(heatAt({ x: FIRE.x, z: FIRE.z + HEAT.none + 0.01 })).toBe(0);
    const half = heatAt({ x: FIRE.x + (HEAT.full + HEAT.none) / 2, z: FIRE.z });
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.7);
  });

  it('toasts from every bench round the fire, facing it, and not facing away', () => {
    for (const s of ROOF_SEATS.filter((x) => x.kind === 'fire')) {
      expect(heatAt(stickTip(s.x, s.z, s.heading)), s.id).toBeGreaterThan(0.6);
      expect(heatAt(stickTip(s.x, s.z, s.heading + Math.PI)), s.id).toBe(0);
    }
  });

  it('toasts at full heat standing as close to the fire as you can get', () => {
    const rects = roofColliders();
    // from the open east side either side of the crate, and along the gaps between the fire and the north and south
    // benches: walk at the fire (dx, dz) until it stops you
    const walks: [number, number, number, number][] = [
      [FIRE.x + 3, FIRE.z + 0.6, -1, 0],
      [FIRE.x + 3, FIRE.z - 0.6, -1, 0],
      [FIRE.x, FIRE.z - 1.25, 0, 1],
      [FIRE.x, FIRE.z + 1.25, 0, -1],
    ];
    for (const [x, z, dx, dz] of walks) {
      let p = { x, z };
      for (let i = 0; i < 80; i++) p = collide(p.x + dx * 0.05, p.z + dz * 0.05, rects);
      expect(Math.hypot(p.x - FIRE.x, p.z - FIRE.z)).toBeLessThan(1.5);
      expect(heatAt(stickTip(p.x, p.z, Math.atan2(-dx, -dz)))).toBe(1);
    }
  });
});

describe('toasting', () => {
  it('goes raw, golden, toasty brown, burnt and charcoal at full heat', () => {
    expect(stageOf(0)).toBe('raw');
    expect(stageOf(TOAST.golden)).toBe('golden');
    expect(stageOf(TOAST.brown)).toBe('brown');
    expect(stageOf(TOAST.burnt)).toBe('burnt');
    expect(stageOf(TOAST.fire)).toBe('charcoal');
    expect(stageOf(toastFor(TOAST.golden + 1).toast)).toBe('golden');
    expect(stageOf(toastFor(TOAST.brown + 1).toast)).toBe('brown');
  });

  it('toasts slower further out, and not at all out of the heat', () => {
    expect(toastFor(4, 0.5).toast).toBeCloseTo(2, 1);
    expect(toastFor(10, 0).toast).toBe(0);
  });

  it('catches fire once if you keep at it, burns a moment and goes out charcoal', () => {
    const lit = toastFor(TOAST.fire + 0.5);
    expect(lit.caught).toBe(1);
    expect(lit.flame).toBeGreaterThan(0);
    // pulled out of the heat, it burns on regardless, then goes out
    const out = toastFor(TOAST.flame + 0.5, 0, lit);
    expect(out.flame).toBe(0);
    expect(out.caught).toBe(0);
    expect(stageOf(out.toast)).toBe('charcoal');
    // back over the fire, it never catches again
    expect(toastFor(10, 1, out).caught).toBe(0);
  });

  it('darkens from white through golden and brown to black', () => {
    expect(toastColour(0)).toBe(TOAST_COLOURS.raw);
    expect(toastColour(TOAST.golden)).toBe(TOAST_COLOURS.golden);
    expect(toastColour(TOAST.brown)).toBe(TOAST_COLOURS.brown);
    expect(toastColour(TOAST.fire + 5)).toBe(TOAST_COLOURS.charcoal);
    let last = 256;
    for (let t = 0; t <= TOAST.fire; t += 0.5) {
      const l = light(toastColour(t));
      expect(l).toBeLessThanOrEqual(last + 1e-9);
      last = l;
    }
  });

  it('says how it came out', () => {
    expect(eatLine(0)).toMatch(/squishy/);
    expect(eatLine(TOAST.golden + 0.5)).toBe('Perfectly golden 😋');
    expect(eatLine(TOAST.brown + 0.5)).toMatch(/gooey/);
    expect(eatLine(TOAST.burnt + 0.5)).toMatch(/burnt/);
    expect(eatLine(TOAST.fire + 3)).toBe('Charcoal… 😬');
    expect(eatLine(TOAST.fire + 1, 1)).toMatch(/🔥/);
    expect(toastWord(0)).toBe('raw');
    expect(toastWord(TOAST.golden)).toBe('golden');
    expect(toastWord(TOAST.fire, 1)).toBe('on fire!');
  });
});

describe("a worker's marshmallow", () => {
  it('is mostly golden to toasty, now and then burnt or forgotten till it caught', () => {
    const plans = Array.from({ length: 100 }, (_, i) => workerToast(i / 100));
    const stage = (p: { stop: number }) => stageOf(p.stop);
    const good = plans.filter((p) => stage(p) === 'golden' || stage(p) === 'brown');
    expect(good.length).toBeGreaterThanOrEqual(75);
    expect(plans.some((p) => stage(p) === 'burnt')).toBe(true);
    // forgotten: it toasts past catching and its flame burning out
    expect(plans.some((p) => p.stop > TOAST.fire + TOAST.flame)).toBe(true);
    for (const p of good) expect(['😋', '🤤']).toContain(p.say);
  });
});
