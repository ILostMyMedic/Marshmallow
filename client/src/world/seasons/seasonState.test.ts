import { describe, expect, it } from 'vitest';
import { officeDay } from '../../../../shared/seasons';
import { useStore } from '../../store';
import { lookFor, season } from './seasonState';

describe('the season this tab shows', () => {
  it("follows the office's date and setting, and ?season= in this tab alone", () => {
    expect(lookFor('2026-12-24', 'auto')).toMatchObject({ season: 'winter', holiday: 'christmas' });
    expect(lookFor('2026-12-24', 'summer').summer).toBe(true);
    expect(lookFor('2026-12-24', 'auto', '?season=halloween').pumpkins).toBe(true);
    expect(lookFor('2026-12-24', 'auto', '?season=2027-04-10').foliage).toBe('blossom');
    // an unknown setting is the office's date; no date from the office is this machine's
    expect(lookFor('2026-07-01', 'monsoon').season).toBe('summer');
    expect(lookFor('', 'auto').day).toBe(officeDay(Date.now()));
  });

  it("changes when the office's date or setting does", () => {
    const s = useStore.getState();
    s.apply({ type: 'world', world: { ...s.world, today: '2026-10-31' } });
    expect(season().pumpkins).toBe(true);
    useStore.getState().apply({ type: 'settings', settings: { ...useStore.getState().settings, season: 'winter' } });
    expect(season().fall?.kind).toBe('snow');
    useStore.getState().apply({ type: 'settings', settings: { ...useStore.getState().settings, season: 'auto' } });
    useStore.getState().apply({ type: 'world', world: { ...useStore.getState().world, today: '2026-07-15' } });
    expect(season()).toMatchObject({ season: 'summer', pumpkins: false });
  });
});
