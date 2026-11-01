// The seasons outside the office: from the office's date (the server's, in every tab), which season it is, which
// special day, and what that brings: snow falling and lying in December and January (lighter in February), blossom in
// spring, falling leaves in autumn, pumpkins for Halloween, a Christmas tree through December, fireworks at New Year,
// hearts on Valentine's Day; and what it does to the light and the sounds outside. Pure, so every day of the year is
// tested without a browser. Settings.season shows any of them now (the console's Settings, the debug page), and
// `?season=` in the game's URL does it for one tab.

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

export const HOLIDAYS = ['valentines', 'halloween', 'christmas', 'newyear'] as const;
/** The special days: Valentine's Day, late October's Halloween, December's Christmas, New Year's Eve and Day. */
export type Holiday = (typeof HOLIDAYS)[number];

/** What a world event's weight can follow: the season, or a special day (which wins). */
export type SeasonKey = Season | Holiday;

export const SEASON_SETTINGS = ['auto', 'spring', 'summer', 'autumn', 'winter', 'halloween', 'christmas', 'newyear'] as const;
/** 'auto': the office's date; anything else shows that season (or special day) now. */
export type SeasonSetting = (typeof SEASON_SETTINGS)[number];

export const SEASON_SETTING_NAMES: Record<SeasonSetting, string> = {
  auto: "the office's date",
  spring: 'spring (blossom)',
  summer: 'summer',
  autumn: 'autumn (falling leaves)',
  winter: 'winter (snow)',
  halloween: 'Halloween',
  christmas: 'Christmas',
  newyear: "New Year's Eve",
};

/** The tree colours: blossom (spring), green (summer), turning (September), autumn (October, November), wintry (bare boughs under snow). */
export type Foliage = 'blossom' | 'green' | 'turning' | 'autumn' | 'wintry';

export type FallKind = 'snow' | 'leaves' | 'petals';

/** Everything a day brings outside. */
export interface SeasonLook {
  /** The date it's for (YYYY-MM-DD): looks for the same day are the same. */
  day: string;
  season: Season;
  holiday: Holiday | null;
  /** "Winter · Christmas", for the probe and the debug page. */
  label: string;
  /** What's falling past the windows and how much of it, 0-1; null when nothing is. */
  fall: { kind: FallKind; amount: number } | null;
  /** How much snow lies on the roofs, the ground, the trees and the roof terrace, 0-1. */
  snowCover: number;
  foliage: Foliage;
  /** A decorated tree in the lobby with presents under it, a wreath, and lights along the balconies and the roof. */
  christmas: boolean;
  /** Jack-o'-lanterns in the lobby and on the roof, glowing at night. */
  pumpkins: boolean;
  /** Fireworks over the city at night. */
  fireworks: boolean;
  /** A beach umbrella and a paddling pool on the roof. */
  summer: boolean;
  /** Heart balloons at the front desk. */
  hearts: boolean;
  /** How the outside sounds, as multipliers on its layers (ui/outsideMix.ts): snow softens the city and brings the wind. */
  sound: { wind: number; birds: number; crickets: number; city: number };
  /** The light: a little brighter in summer (exposure), warmer (warmth > 0) or cooler (< 0). */
  light: { exposure: number; warmth: number };
}

export interface OfficeDay {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The date at `ms` on the office's calendar (this machine's local time), as YYYY-MM-DD. */
export function officeDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A YYYY-MM-DD date, or null when it isn't one. */
export function parseOfficeDay(s: unknown): OfficeDay | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

const dayString = (d: OfficeDay) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;

/** The day an override stands for: the middle of its season, or the special day itself. */
const OVERRIDE_DAYS: Record<Exclude<SeasonSetting, 'auto'>, [number, number]> = {
  spring: [4, 15],
  summer: [7, 15],
  autumn: [10, 12],
  winter: [1, 15],
  halloween: [10, 31],
  christmas: [12, 24],
  newyear: [12, 31],
};

/** A day's own number in [0, 1), the same every year for that date: how hard it snows that day. */
function dayRoll(d: OfficeDay): number {
  let h = Math.imul(d.month * 37 + d.day * 101 + 7, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

const seasonOfMonth = (month: number): Season => (month === 12 || month <= 2 ? 'winter' : month <= 5 ? 'spring' : month <= 8 ? 'summer' : 'autumn');

function holidayOf({ month, day }: OfficeDay): Holiday | null {
  if (month === 2 && day === 14) return 'valentines';
  if (month === 10 && day >= 20) return 'halloween';
  if ((month === 12 && day === 31) || (month === 1 && day === 1)) return 'newyear';
  if (month === 12) return 'christmas';
  return null;
}

const NAMES: Record<Season | Holiday, string> = {
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
  winter: 'Winter',
  valentines: "Valentine's Day",
  halloween: 'Halloween',
  christmas: 'Christmas',
  newyear: 'New Year',
};

const SOUND: Record<Season, SeasonLook['sound']> = {
  spring: { wind: 0.95, birds: 1.25, crickets: 0.6, city: 1 },
  summer: { wind: 0.85, birds: 1, crickets: 1, city: 1 },
  autumn: { wind: 1.15, birds: 0.7, crickets: 0.45, city: 1 },
  winter: { wind: 1.3, birds: 0.35, crickets: 0, city: 1 },
};

const LIGHT: Record<Season, SeasonLook['light']> = {
  spring: { exposure: 1.02, warmth: 0 },
  summer: { exposure: 1.07, warmth: 0.35 },
  autumn: { exposure: 1, warmth: 0.3 },
  winter: { exposure: 1, warmth: -0.35 },
};

/** What the day `d` brings outside. */
export function seasonOf(d: OfficeDay): SeasonLook {
  const { month, day } = d;
  const season = seasonOfMonth(month);
  const holiday = holidayOf(d);
  const roll = dayRoll(d);

  // snow: every day of December and January, harder on some days, at its fullest round Christmas; lighter in February
  let snowfall = 0;
  let snowCover = 0;
  if (month === 12 || month === 1) {
    snowfall = month === 12 && day >= 24 && day <= 26 ? 1 : 0.5 + 0.5 * roll;
    snowCover = 1;
  } else if (month === 2) {
    snowfall = 0.25 + 0.2 * roll;
    snowCover = 0.55;
  }

  const blossom = (month === 3 && day >= 15) || month === 4;
  const foliage: Foliage = season === 'winter' ? 'wintry' : blossom ? 'blossom' : month === 9 ? 'turning' : season === 'autumn' ? 'autumn' : 'green';
  const leaves = month === 10 || month === 11;
  const fall: SeasonLook['fall'] = snowfall > 0 ? { kind: 'snow', amount: snowfall } : leaves ? { kind: 'leaves', amount: month === 11 && day > 20 ? 0.5 : 1 } : blossom ? { kind: 'petals', amount: 0.8 } : null;

  const sound = { ...SOUND[season] };
  // lying snow muffles the city
  sound.city = 1 - 0.25 * snowCover;
  return {
    day: dayString(d),
    season,
    holiday,
    label: holiday ? `${NAMES[season]} · ${NAMES[holiday]}` : NAMES[season],
    fall,
    snowCover,
    foliage,
    // the tree goes up on the first of December and comes down on Twelfth Night
    christmas: month === 12 || (month === 1 && day <= 6),
    pumpkins: holiday === 'halloween',
    fireworks: holiday === 'newyear',
    summer: season === 'summer',
    hearts: holiday === 'valentines',
    sound,
    light: { ...LIGHT[season] },
  };
}

/** The date a setting shows: the office's own for 'auto', else the day the override stands for (in the office's year). */
export function seasonDay(setting: SeasonSetting, today: string): string {
  const now = parseOfficeDay(today) ?? { year: 2026, month: 6, day: 1 };
  if (setting === 'auto') return dayString(now);
  const [month, day] = OVERRIDE_DAYS[setting] ?? [now.month, now.day];
  return dayString({ year: now.year, month, day });
}

/** The look for the office's setting on `today` (YYYY-MM-DD). */
export function seasonFor(setting: SeasonSetting, today: string): SeasonLook {
  return seasonOf(parseOfficeDay(seasonDay(setting, today))!);
}

/** The office's setting, or 'auto' when it's missing or unknown (an older office). */
export const parseSeasonSetting = (raw: unknown): SeasonSetting => (SEASON_SETTINGS.includes(raw as SeasonSetting) ? (raw as SeasonSetting) : 'auto');

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ALIASES: Record<string, SeasonSetting> = { fall: 'autumn', snow: 'winter', xmas: 'christmas', 'new-year': 'newyear', nye: 'newyear', 'new-years-eve': 'newyear', blossom: 'spring' };

/**
 * `?season=` for one tab: a setting ('winter', 'halloween'…, or 'fall', 'xmas', 'nye'), a month ('december': its
 * 15th) or a date (2026-12-24), as the date to show; null when absent or not one of those.
 */
export function parseSeasonParam(search: string, today: string): string | null {
  const raw = new URLSearchParams(search).get('season');
  if (!raw) return null;
  const k = raw.trim().toLowerCase().replace(/[_\s']+/g, '-');
  const date = parseOfficeDay(k);
  if (date) return dayString(date);
  const setting = SEASON_SETTINGS.includes(k as SeasonSetting) ? (k as SeasonSetting) : ALIASES[k];
  if (setting) return seasonDay(setting, today);
  const month = MONTHS.findIndex((m) => m === k || m.slice(0, 3) === k);
  if (month < 0) return null;
  const year = parseOfficeDay(today)?.year ?? 2026;
  return dayString({ year, month: month + 1, day: 15 });
}
