// Adapted from cubefarm client/src/world/toys/sip.test.ts and fridge.test.ts (MIT): without the sausage and the clunk.
import { describe, expect, it } from 'vitest';
import { SNACKS, SNACK_IDS } from './fridge';
import { GULP, SIP, SNACK_PLANS, cuesDue, eAction, lift, planFor, pose, sipLabel, snackFor } from './sip';

const mug = (sips: number) => ({ kind: 'mug', id: 'mug-1', sips });

describe('what E does', () => {
  it('sips coffee whatever the crosshair is on', () => {
    expect(eAction(mug(3), null)).toBe('sip');
    expect(eAction(mug(1), 'greet')).toBe('sip');
    expect(eAction(mug(2), 'terminal')).toBe('sip');
  });

  it('leaves the coffee machine and the mug stand to themselves', () => {
    expect(eAction(mug(2), 'coffee')).toBe('target');
    expect(eAction(mug(0), 'coffee')).toBe('target');
    expect(eAction(mug(2), 'mugs')).toBe('target');
  });

  it('acts on the target with an empty mug, and says so when there is none', () => {
    expect(eAction(mug(0), 'greet')).toBe('target');
    expect(eAction(mug(0), null)).toBe('empty');
  });

  it('is unchanged with empty hands or a paddle', () => {
    expect(eAction(null, 'greet')).toBe('target');
    expect(eAction(null, null)).toBe('target');
    expect(eAction({ kind: 'paddle' }, null)).toBe('target');
  });

  it('eats a snack wherever you look, except at the fridge, which E works with full hands', () => {
    const can = { kind: 'snack', snack: 'overclock', left: 2 };
    expect(eAction(can, null)).toBe('sip');
    expect(eAction(can, 'coffee')).toBe('sip');
    expect(eAction(can, 'fridge')).toBe('target');
    expect(eAction(mug(3), 'fridge')).toBe('target');
    expect(eAction({ kind: 'snack', left: 0 }, null)).toBe('empty');
    expect(eAction({ kind: 'snack', left: 0 }, 'greet')).toBe('target');
  });

  it('says what the sip is', () => {
    expect(sipLabel(mug(2))).toBe('Sip coffee');
    expect(sipLabel({ kind: 'snack', snack: 'coldbrew' })).toBe('Sip the cold brew');
    expect(sipLabel({ kind: 'snack', snack: 'pizza' })).toBe('Bite the cold pizza');
    expect(sipLabel({ kind: 'snack', snack: 'coldbrew', beer: true })).toBe('Sip the beer');
  });
});

describe('sip plans', () => {
  it('makes the last sip the gulp', () => {
    expect(planFor(3)).toBe(SIP);
    expect(planFor(2)).toBe(SIP);
    expect(planFor(1)).toBe(GULP);
    expect(planFor(0)).toBeNull();
    expect(planFor(NaN)).toBeNull();
  });

  it('sips in about 0.7 s and gulps for longer, tipping further', () => {
    expect(SIP.dur).toBeCloseTo(0.7);
    expect(GULP.dur).toBeGreaterThan(SIP.dur * 2);
    expect(GULP.tilt).toBeGreaterThan(SIP.tilt * 2);
    expect(SIP.head).toBe(0);
    expect(GULP.head).toBeGreaterThan(0);
  });

  for (const [name, plan] of [['sip', SIP], ['gulp', GULP]] as const) {
    it(`${name}: cues in order, within the animation, drinking while the mug is at the mouth`, () => {
      const ats = plan.cues.map((c) => c.at);
      expect([...ats].sort((a, b) => a - b)).toEqual(ats);
      expect(ats.every((at) => at > 0 && at < plan.dur)).toBe(true);
      const drink = plan.cues.find((c) => c.cue === 'drink')!;
      expect(drink.at).toBeGreaterThanOrEqual(plan.up);
      expect(drink.at).toBeLessThanOrEqual(plan.down);
      expect(plan.cues.filter((c) => c.cue === 'drink')).toHaveLength(1);
    });
  }

  it('keeps the empty mug in hand after the gulp', () => {
    for (const plan of [SIP, GULP]) expect(plan.cues.some((c) => c.cue === 'drop')).toBe(false);
  });
});

describe('sipping and biting a snack', () => {
  it('has a sip or a bite, the first one opening it and the last one finishing it', () => {
    for (const id of SNACK_IDS) {
      const n = SNACKS[id].portions;
      const first = snackFor(id, n)!;
      const last = snackFor(id, 1)!;
      expect(first, id).toBe(SNACK_PLANS[id].first);
      expect(last, id).toBe(SNACK_PLANS[id].last);
      expect(snackFor(id, 0)).toBeNull();
      if (SNACKS[id].open) expect(first.cues[0].cue).toBe(SNACKS[id].open);
      // every plan takes exactly one sip or bite off, and the last lets go of it
      for (const p of [first, SNACK_PLANS[id].next, last]) expect(p.cues.filter((c) => c.cue === 'drink')).toHaveLength(1);
      expect(last.cues.at(-1)?.cue).toBe('drop');
      if (SNACKS[id].done) expect(last.cues.map((c) => c.cue)).toContain(SNACKS[id].done);
      // the cues are in order and within the plan, so they all play
      for (const p of [first, SNACK_PLANS[id].next, last]) {
        expect(cuesDue(p, 0, p.dur)).toBe(p.cues.length);
        expect(p.cues.every((c) => c.at < p.dur)).toBe(true);
      }
    }
  });

  it('takes the middle plan between the first and the last', () => {
    expect(snackFor('overclock', 2)).toBe(SNACK_PLANS.overclock.next);
    expect(snackFor('overclock', 3)).toBe(SNACK_PLANS.overclock.first);
  });

  it('lets go of a finished snack only once it is nearly back down', () => {
    for (const id of SNACK_IDS) {
      const last = SNACK_PLANS[id].last;
      expect(lift(last, last.cues.at(-1)!.at), id).toBeLessThan(0.2);
    }
  });

  it('a can tips up to drink; food goes up level', () => {
    expect(SNACK_PLANS.overclock.next.tilt).toBeGreaterThan(0);
    expect(SNACK_PLANS.pizza.next.tilt).toBe(0);
  });
});

describe('cuesDue', () => {
  it('walks through the cues as time passes, each once', () => {
    let next = 0;
    const seen: string[] = [];
    for (let t = 0; t <= GULP.dur + 0.1; t += 1 / 60) {
      const to = cuesDue(GULP, next, t);
      for (let i = next; i < to; i++) seen.push(GULP.cues[i].cue);
      next = to;
    }
    expect(seen).toEqual(['gulp', 'drink', 'ahh']);
  });

  it('catches up on a long frame', () => {
    expect(cuesDue(SIP, 0, 10)).toBe(SIP.cues.length);
    expect(cuesDue(SIP, 0, 0)).toBe(0);
  });
});

describe('pose', () => {
  it('raises the mug, holds it at the mouth, then puts it back', () => {
    expect(lift(SIP, 0)).toBe(0);
    expect(lift(SIP, SIP.up / 2)).toBeGreaterThan(0);
    expect(lift(SIP, SIP.up / 2)).toBeLessThan(1);
    expect(lift(SIP, (SIP.up + SIP.down) / 2)).toBe(1);
    expect(lift(SIP, SIP.dur)).toBe(0);
    expect(lift(SIP, -1)).toBe(0);
  });

  it('tips and tilts the view in proportion', () => {
    const p = pose(GULP, (GULP.up + GULP.down) / 2);
    expect(p).toEqual({ lift: 1, tilt: GULP.tilt, head: GULP.head });
    expect(pose(SIP, 0.1).head).toBe(0);
  });
});
