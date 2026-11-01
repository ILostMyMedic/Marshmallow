// The season outside as this tab shows it (shared/seasons.ts): the office's date (the snapshot's world.today, which
// the office moves on at midnight) and its setting (Settings.season), so every tab shows the same; `?season=winter`
// (or a month, or a date) shows another in this tab alone, for checks. React reads it through useSeason, which changes
// only when the day it shows does; the sounds read season() when they tick.
// QA: window.__mmSeason has the look, and set('christmas') changes the office's setting for every tab.
import { create } from 'zustand';
import { officeDay, parseOfficeDay, parseSeasonParam, parseSeasonSetting, seasonFor, seasonOf, SEASON_SETTINGS, type SeasonLook } from '../../../../shared/seasons';
import { command } from '../../api';
import { useStore } from '../../store';

const search = () => {
  try {
    return window.location.search;
  } catch {
    return '';
  }
};

/** The look for the office's date (or this machine's, before the office says) and setting, unless `?season=` names another. */
export function lookFor(today: string, setting: unknown, query = ''): SeasonLook {
  const day = parseOfficeDay(today) ? today : officeDay(Date.now());
  const forced = parseSeasonParam(query, day);
  return forced ? seasonOf(parseOfficeDay(forced)!) : seasonFor(parseSeasonSetting(setting), day);
}

const current = () => {
  const s = useStore.getState();
  return lookFor(s.world.today, s.settings.season, search());
};

const useLook = create<{ look: SeasonLook }>(() => ({ look: current() }));

/** For React: part of the season's look (re-renders only when the day it shows changes). */
export const useSeason = <T>(pick: (look: SeasonLook) => T): T => useLook((s) => pick(s.look));

/** The season's look now, outside React. */
export const season = (): SeasonLook => useLook.getState().look;

let seen = [useStore.getState().world.today, useStore.getState().settings.season];
useStore.subscribe((s) => {
  if (s.world.today === seen[0] && s.settings.season === seen[1]) return;
  seen = [s.world.today, s.settings.season];
  const look = current();
  if (look.day !== useLook.getState().look.day) useLook.setState({ look });
});

/** For QA and headless checks: the look this tab shows, and set() for the office's setting. */
export const seasonProbe = {
  get look() {
    return season();
  },
  /** The draw calls of the last frame and the frame time (ms, smoothed): Seasons.tsx keeps them. */
  frame: { calls: 0, triangles: 0, ms: 0 },
  /** Changes the office's season ('auto', 'winter', 'christmas'…) for every tab: a promise. */
  set(setting: string) {
    if (!SEASON_SETTINGS.includes(setting as never)) return Promise.resolve(null);
    return command('PATCH', '/api/settings', { season: setting });
  },
};

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__mmSeason = seasonProbe;
