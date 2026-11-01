// window.__mmGames: the hoops and dartboards for QA and Playwright, where pointer lock and held mouse buttons don't work.
//   __mmGames.state                    the hoops and boards on screen, who holds what, the player's scores, who's playing
//   __mmGames.invite('hoops'|'darts')  the next restless worker comes to play it
//   __mmGames.take(spot)               E at the hoop or the board in `spot` (its ball or its darts in your hands)
//   __mmGames.throw(ms)                a throw wound up for `ms` milliseconds (the mouse held that long, then let go)
//   __mmGames.aimAt(spot, out?, side?) stands you `out` m from its wall (and `side` m along it), looking at the hoop's square
//                                      or the board's treble 20
// New in Marshmallow, after decor/probe.ts.
import { useStore } from '../../store';
import { EYE_HEIGHTS, parseBodyStyle } from '../bodyStyle';
import { wallFoot } from '../decor/spots';
import { gamePlays, invited } from '../gameErrands';
import { useView } from '../view';
import { BOARD, fromBoard } from './darts';
import { boardsOnScreen, charge, courtsOnScreen, dartsTally, hoopTally, releaseCharge, startCharge, takeBall, takeDarts } from './gameState';
import { hoopSquare } from './hoopPhysics';

type Player = { place(x: number, z: number, yawDeg: number, pitchDeg: number): void };

if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  w.__mmGames = {
    get state() {
      const s = useStore.getState();
      const floorId = s.floors.find((f) => f.floor === useView.getState().floor)?.id ?? '';
      return {
        held: useView.getState().held,
        courts: courtsOnScreen().map((c) => ({ spot: c.spot, holder: c.holder, ideal: +c.ideal.toFixed(3), last: c.last })),
        boards: boardsOnScreen().map((b) => ({ spot: b.spot, holder: b.holder, turn: b.turn, flying: b.flying, last: b.last })),
        hoops: courtsOnScreen().map((c) => ({ spot: c.spot, ...hoopTally(floorId, c.spot) })),
        darts: dartsTally(),
        plays: gamePlays(),
      };
    },
    /** The next restless worker comes to shoot hoops or throw darts. */
    invite(game: 'hoops' | 'darts') {
      invited[game] = true;
      return true;
    },
    take(spot: string) {
      if (courtsOnScreen().some((c) => c.spot === spot)) takeBall(spot);
      else takeDarts(spot);
      return useView.getState().held;
    },
    throw(ms: number) {
      if (!startCharge()) return false;
      charge.at = performance.now() - ms;
      return releaseCharge();
    },
    aimAt(spot: string, out = 3.35, side = 0) {
      const foot = wallFoot(spot);
      const player = w.__mmPlayer as Player | undefined;
      if (!foot || !player) return null;
      const f = { x: Math.sin(foot.rotY), z: Math.cos(foot.rotY) };
      const r = { x: Math.cos(foot.rotY), z: -Math.sin(foot.rotY) };
      const x = foot.x + f.x * out + r.x * side;
      const z = foot.z + f.z * out + r.z * side;
      const hoop = courtsOnScreen().some((c) => c.spot === spot);
      const target = hoop ? hoopSquare(foot) : fromBoard({ ...foot, y: boardsOnScreen().find((b) => b.spot === spot)?.place.y ?? BOARD.y }, 0, 0.103);
      const eye = player && (w.__mmPlayer as { at?: { person?: string } }).at?.person === 'third' ? 1.65 : EYE_HEIGHTS[parseBodyStyle(useStore.getState().settings.bodyStyle)];
      const yaw = (Math.atan2(-(target.x - x), -(target.z - z)) * 180) / Math.PI;
      const pitch = (Math.atan2(target.y - eye, Math.hypot(target.x - x, target.z - z)) * 180) / Math.PI;
      player.place(x, z, yaw, pitch);
      return { x, z, yaw, pitch };
    },
  };
}
