import { describe, expect, it } from 'vitest';
import { officeDay, parseOfficeDay, parseSeasonParam, parseSeasonSetting, SEASON_SETTINGS, seasonDay, seasonFor, seasonOf, type OfficeDay } from './seasons.ts';

const on = (s: string) => seasonOf(parseOfficeDay(s) as OfficeDay);

/** Every day of 2026 (and its leap-year twin's 29 February). */
function* year() {
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= new Date(2026, m, 0).getDate(); d++) yield { year: 2026, month: m, day: d };
}

describe('the office date', () => {
  it('is the local calendar date, as YYYY-MM-DD', () => {
    expect(officeDay(new Date(2026, 10, 1, 9, 30).getTime())).toBe('2026-11-01');
    expect(officeDay(new Date(2026, 11, 31, 23, 59).getTime())).toBe('2026-12-31');
    expect(parseOfficeDay('2026-02-14')).toEqual({ year: 2026, month: 2, day: 14 });
    for (const bad of ['2026-13-01', '2026-1-1', 'tomorrow', '', null, 7]) expect(parseOfficeDay(bad)).toBeNull();
  });
});

describe('the seasons', () => {
  it('follows the months: winter from December, spring from March, summer from June, autumn from September', () => {
    expect(on('2026-12-01').season).toBe('winter');
    expect(on('2026-02-28').season).toBe('winter');
    expect(on('2026-03-01').season).toBe('spring');
    expect(on('2026-06-01').season).toBe('summer');
    expect(on('2026-08-31').season).toBe('summer');
    expect(on('2026-09-01').season).toBe('autumn');
    expect(on('2026-11-30').season).toBe('autumn');
  });

  it('snows every day of December and January, lighter in February, never otherwise', () => {
    for (const d of year()) {
      const look = seasonOf(d);
      const snowing = look.fall?.kind === 'snow';
      if (d.month === 12 || d.month === 1) {
        expect(snowing, `${d.month}/${d.day}`).toBe(true);
        expect(look.fall!.amount).toBeGreaterThanOrEqual(0.5);
        expect(look.snowCover).toBe(1);
      } else if (d.month === 2) {
        expect(snowing).toBe(true);
        expect(look.fall!.amount).toBeLessThan(0.5);
        expect(look.snowCover).toBeGreaterThan(0);
        expect(look.snowCover).toBeLessThan(1);
      } else {
        expect(snowing).toBe(false);
        expect(look.snowCover).toBe(0);
      }
    }
    // the same date snows the same every time, and not every day alike
    expect(on('2026-01-09').fall).toEqual(on('2027-01-09').fall);
    expect(new Set([...year()].filter((d) => d.month === 1).map((d) => seasonOf(d).fall!.amount)).size).toBeGreaterThan(10);
    expect(on('2026-12-25').fall!.amount).toBe(1);
  });

  it('drops leaves in October and November, blossom in spring, and turns the trees', () => {
    expect(on('2026-11-01')).toMatchObject({ season: 'autumn', foliage: 'autumn', fall: { kind: 'leaves', amount: 1 } });
    expect(on('2026-10-05').fall?.kind).toBe('leaves');
    expect(on('2026-11-25').fall).toEqual({ kind: 'leaves', amount: 0.5 });
    expect(on('2026-09-10')).toMatchObject({ foliage: 'turning', fall: null });
    expect(on('2026-04-15')).toMatchObject({ foliage: 'blossom', fall: { kind: 'petals' } });
    expect(on('2026-05-20')).toMatchObject({ foliage: 'green', fall: null });
    expect(on('2026-07-15')).toMatchObject({ foliage: 'green', summer: true });
    expect(on('2026-01-15').foliage).toBe('wintry');
  });

  it('knows the special days and what they bring', () => {
    expect(on('2026-10-31')).toMatchObject({ holiday: 'halloween', pumpkins: true, label: 'Autumn · Halloween' });
    expect(on('2026-10-20').pumpkins).toBe(true);
    expect(on('2026-10-19').pumpkins).toBe(false);
    expect(on('2026-11-01')).toMatchObject({ holiday: null, pumpkins: false });
    expect(on('2026-12-01')).toMatchObject({ holiday: 'christmas', christmas: true, fireworks: false });
    expect(on('2026-12-24')).toMatchObject({ holiday: 'christmas', christmas: true });
    expect(on('2026-12-31')).toMatchObject({ holiday: 'newyear', fireworks: true, christmas: true });
    expect(on('2027-01-01')).toMatchObject({ holiday: 'newyear', fireworks: true });
    expect(on('2027-01-02')).toMatchObject({ holiday: null, fireworks: false, christmas: true });
    // the tree comes down on Twelfth Night
    expect(on('2027-01-06').christmas).toBe(true);
    expect(on('2027-01-07').christmas).toBe(false);
    expect(on('2026-11-30').christmas).toBe(false);
    expect(on('2026-02-14')).toMatchObject({ holiday: 'valentines', hearts: true });
    // nothing special the rest of the year
    const special = [...year()].filter((d) => seasonOf(d).holiday).length;
    expect(special).toBe(1 + 12 + 31 + 1); // Valentine's, Halloween's 12 days, December, New Year's Day
  });

  it('softens the sounds in the snow and brightens the summer', () => {
    const winter = on('2026-01-15');
    expect(winter.sound.crickets).toBe(0);
    expect(winter.sound.birds).toBeLessThan(0.5);
    expect(winter.sound.wind).toBeGreaterThan(1);
    expect(winter.sound.city).toBeLessThan(1);
    expect(on('2026-07-15').sound.city).toBe(1);
    expect(on('2026-07-15').light.exposure).toBeGreaterThan(on('2026-04-15').light.exposure);
    expect(winter.light.warmth).toBeLessThan(0);
    // never louder crickets than the office has always had (they rang when they were)
    for (const d of year()) expect(seasonOf(d).sound.crickets).toBeLessThanOrEqual(1);
  });
});

describe('the setting', () => {
  it("follows the office's date on 'auto', and shows any season now otherwise", () => {
    expect(seasonFor('auto', '2026-11-01')).toMatchObject({ day: '2026-11-01', season: 'autumn' });
    expect(seasonFor('winter', '2026-11-01')).toMatchObject({ season: 'winter', fall: { kind: 'snow' }, christmas: false });
    expect(seasonFor('spring', '2026-11-01').foliage).toBe('blossom');
    expect(seasonFor('summer', '2026-11-01').summer).toBe(true);
    expect(seasonFor('autumn', '2026-11-01')).toMatchObject({ holiday: null, fall: { kind: 'leaves' } });
    expect(seasonFor('halloween', '2026-03-01').pumpkins).toBe(true);
    expect(seasonFor('christmas', '2026-07-01')).toMatchObject({ christmas: true, snowCover: 1, fall: { kind: 'snow', amount: 1 } });
    expect(seasonFor('newyear', '2026-07-01').fireworks).toBe(true);
    expect(seasonDay('christmas', '2027-05-01')).toBe('2027-12-24');
    for (const s of SEASON_SETTINGS) expect(seasonFor(s, '2026-11-01').day).toMatch(/^2026-/);
    // with no date from the office (no database), still a look
    expect(seasonFor('auto', '').season).toBeTruthy();
  });

  it('reads an unknown setting as auto', () => {
    expect(parseSeasonSetting('winter')).toBe('winter');
    expect(parseSeasonSetting('monsoon')).toBe('auto');
    expect(parseSeasonSetting(undefined)).toBe('auto');
  });

  it('reads ?season= as a setting, an alias, a month or a date', () => {
    expect(parseSeasonParam('?season=winter', '2026-11-01')).toBe('2026-01-15');
    expect(parseSeasonParam('?season=Christmas', '2026-11-01')).toBe('2026-12-24');
    expect(parseSeasonParam('?season=fall', '2026-11-01')).toBe('2026-10-12');
    expect(parseSeasonParam('?season=nye', '2026-11-01')).toBe('2026-12-31');
    expect(parseSeasonParam('?season=december', '2026-11-01')).toBe('2026-12-15');
    expect(parseSeasonParam('?season=feb', '2026-11-01')).toBe('2026-02-15');
    expect(parseSeasonParam('?season=2027-02-14', '2026-11-01')).toBe('2027-02-14');
    expect(parseSeasonParam('?season=monsoon', '2026-11-01')).toBeNull();
    expect(parseSeasonParam('?event=duck', '2026-11-01')).toBeNull();
  });
});
