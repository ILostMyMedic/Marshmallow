// window.__mmDecor: puts a floor plan into this tab's store, to see every item the shop sells without spending coins.
//   __mmDecor()                        the floor you're on (or the first) with every spot filled and both upgrades
//   __mmDecor(floorId)                 the same on that floor
//   __mmDecor(floorId, items)          your own [{ spot, item, tier? }] over the kit (list a kit spot to change its tier)
//   __mmDecor(floorId, 'kit')          back to the kit alone
//   __mmDecor.burst(amount?, worker?)  a coin burst on the floor you're on (over that worker's desk)
//   __mmDecor.machines()               the vending machines and beer fridges on screen, who's at them, who's having a beer
// What the server sends for that floor next replaces it. New in Marshmallow, after ui/desktop/probe.ts.
import type { FloorItem } from '../../../../shared/types';
import { useStore } from '../../store';
import { beerDrinkers } from '../beerErrand';
import { useView } from '../view';
import { burstCoins } from './CoinBurst';
import { machinesReport } from './machines';

const KIT: [string, string][] = [
  ['kitchen', 'coffee-machine'],
  ['kitchen-fridge', 'fridge'],
  ['lounge', 'couch'],
  ['games', 'pingpong-table'],
  ['north-wall', 'whiteboard'],
  ['gong-corner', 'gong'],
];

/** Every spot filled: each extra at least once, three different posters and the neon twice. */
const FULL: [string, string][] = [
  ['big-1', 'vending-machine'],
  ['big-2', 'sofa'],
  ['big-3', 'beer-fridge'],
  ['floor-1', 'plant'],
  ['floor-2', 'fig'],
  ['floor-3', 'beanbags'],
  ['floor-4', 'fig'],
  ['rug-1', 'rug'],
  ['rug-2', 'rug'],
  ['wall-1', 'poster'],
  ['wall-2', 'neon'],
  ['wall-3', 'poster'],
  ['wall-4', 'poster'],
  ['wall-5', 'neon'],
];

type Item = { spot: string; item: string; tier?: number };
type Probe = ((floorId?: string, items?: Item[] | 'kit') => FloorItem[] | null) & {
  burst(amount?: number, workerId?: string): void;
  machines(): unknown;
};

if (typeof window !== 'undefined') {
  const probe = ((floorId?: string, items?: Item[] | 'kit') => {
    const s = useStore.getState();
    const here = s.floors.find((f) => f.floor === useView.getState().floor);
    const floor = floorId ? s.floors.find((f) => f.id === floorId) : (here ?? s.floors[0]);
    if (!floor) return null;
    const now = Date.now();
    const plan = new Map<string, FloorItem>(KIT.map(([spot, item]) => [spot, { spot, item, tier: 1, since: now }]));
    const extra: Item[] =
      items === 'kit'
        ? []
        : (items ?? [
            ...FULL.map(([spot, item]) => ({ spot, item })),
            { spot: 'kitchen', item: 'coffee-machine', tier: 2 },
            { spot: 'games', item: 'pingpong-table', tier: 2 },
          ]);
    for (const i of extra) plan.set(i.spot, { spot: i.spot, item: i.item, tier: i.tier ?? 1, since: now });
    const list = [...plan.values()];
    useStore.setState({ floorPlans: { ...s.floorPlans, [floor.id]: list } });
    return list;
  }) as Probe;
  probe.burst = (amount = 15, workerId) => burstCoins(amount, workerId ?? null);
  probe.machines = () => ({ ...machinesReport(), drinking: beerDrinkers() });
  (window as unknown as Record<string, unknown>).__mmDecor = probe;
}
