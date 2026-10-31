// Adapted from cubefarm shared/pong.ts (MIT): the scoring, without the leaderboard.

// Ping-pong's scoring: a game to 11, won by 2, serves changing every 2 points (every point from 10-10). The umpire
// (pongRules.ts) plays matches by these rules. Pure.

/** A game goes to 11, and must be won by 2. */
export const PONG_POINTS = 11;
/** The player's id in a game (workers use their own). */
export const PONG_PLAYER = 'player';

/** The winner of a game standing at a–b: 0 (a), 1 (b), or null while it goes on. */
export function gameWinner(a: number, b: number): 0 | 1 | null {
  if (Math.max(a, b) < PONG_POINTS || Math.abs(a - b) < 2) return null;
  return a > b ? 0 : 1;
}

/** Whether a–b is how a game can really end: 11 with the other on 9 or less, or 2 clear past 10-10 (12-10, 13-11…). */
export function finalScore(a: number, b: number): boolean {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return false;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return hi === PONG_POINTS ? lo <= PONG_POINTS - 2 : hi > PONG_POINTS && hi - lo === 2;
}

/** Who serves at a–b: whoever served first (0) or the other (1). Two serves each, then one each from 10-10. */
export function serverAt(a: number, b: number): 0 | 1 {
  const n = a + b;
  return (n < 2 * (PONG_POINTS - 1) ? Math.floor(n / 2) % 2 : n % 2) as 0 | 1;
}

/** Whether the next point could win the game for someone. */
export const gamePoint = (a: number, b: number) => gameWinner(a + 1, b) !== null || gameWinner(a, b + 1) !== null;
