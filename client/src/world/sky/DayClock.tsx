// Adapted from cubefarm client/src/world/sky/useDayTime.ts (MIT): DayClock and the QA probe; the coarse React hook,
// the time-lapse and photo mode's re-run are cut.

// Mounted once inside the Canvas: moves the office's clock (dayTime.ts) on before each frame draws, so everything
// that follows the time of day reads one `dayTime.t` that frame. window.__mmSky reads it and moves it, for QA.
import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { DAY_MODES, dayTime, nightFactor, sampleDayTime, setDayMode, type DayMode } from '../dayTime';
import { lampsOn } from './lamps';
import { outdoor } from './outdoor';

const round = (x: number) => Math.round(x * 1000) / 1000;

const probe = {
  /** The phase now: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. */
  get t() {
    return sampleDayTime();
  },
  /** The office's hour, 0-24 (what lunch and the CEO's walks go by). */
  get hour() {
    return sampleDayTime() * 24;
  },
  get mode(): DayMode {
    return dayTime.mode;
  },
  set mode(m: DayMode) {
    if (DAY_MODES.includes(m)) setDayMode(m);
  },
  /** The phase the clock is held at, or null while it runs. */
  get frozen() {
    return dayTime.frozen;
  },
  /** 0 by day, 1 at night. */
  get night() {
    return nightFactor(sampleDayTime());
  },
  /** How far the lamps are on, and the share of the city's windows lit (as the lights last moved them). */
  get lamps() {
    return lampsOn();
  },
  get cityLights() {
    return outdoor.uLights.value;
  },
  /** Jumps to phase t and holds it there (freeze(false) lets the clock run again). */
  set(t: number) {
    if (!Number.isFinite(t)) return;
    dayTime.frozen = t - Math.floor(t);
    sampleDayTime();
  },
  /** Holds the current phase (true) or lets the viewer's mode drive it again (false). */
  freeze(on: boolean) {
    dayTime.frozen = on ? sampleDayTime() : null;
    sampleDayTime();
  },
  /** Everything above at once. */
  state() {
    const t = sampleDayTime();
    return { t: round(t), hour: round(t * 24), mode: dayTime.mode, frozen: dayTime.frozen, night: round(nightFactor(t)), lamps: round(lampsOn()), cityLights: round(outdoor.uLights.value) };
  },
};

export function DayClock() {
  useFrame(() => {
    sampleDayTime();
  });
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__mmSky = probe;
    return () => {
      if (w.__mmSky === probe) delete w.__mmSky;
    };
  }, []);
  return null;
}
