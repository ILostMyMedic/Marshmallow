// Adapted from cubefarm shared/pong.test.ts (MIT): the scoring and serving cases.
import { describe, expect, it } from 'vitest';
import { finalScore, gamePoint, gameWinner, serverAt } from './pong';

describe('scoring', () => {
  it('a game goes to 11', () => {
    expect(gameWinner(10, 3)).toBeNull();
    expect(gameWinner(11, 3)).toBe(0);
    expect(gameWinner(4, 11)).toBe(1);
    expect(gameWinner(11, 9)).toBe(0);
  });

  it('and must be won by 2', () => {
    expect(gameWinner(11, 10)).toBeNull();
    expect(gameWinner(12, 11)).toBeNull();
    expect(gameWinner(12, 10)).toBe(0);
    expect(gameWinner(14, 16)).toBe(1);
  });

  it('knows a game point', () => {
    expect(gamePoint(10, 3)).toBe(true);
    expect(gamePoint(9, 9)).toBe(false);
    expect(gamePoint(10, 10)).toBe(false);
    expect(gamePoint(11, 10)).toBe(true);
    expect(gamePoint(3, 10)).toBe(true);
  });

  it('accepts only scores a game can really end on', () => {
    for (const [a, b] of [[11, 0], [11, 9], [9, 11], [12, 10], [13, 11], [20, 22]]) expect(finalScore(a, b), `${a}-${b}`).toBe(true);
    for (const [a, b] of [[11, 10], [10, 8], [12, 9], [13, 10], [12, 12], [-1, 11], [11.5, 3], [NaN, 11]]) expect(finalScore(a, b), `${a}-${b}`).toBe(false);
  });
});

describe('serving', () => {
  it('alternates every two points', () => {
    const order = [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1];
    order.forEach((who, n) => expect(serverAt(n, 0), `after ${n} points`).toBe(who));
    // it's the total that counts, not who won them
    expect(serverAt(1, 1)).toBe(1);
    expect(serverAt(3, 1)).toBe(0);
  });

  it('alternates every point from 10-10, carrying on the order', () => {
    expect(serverAt(9, 9)).toBe(1);
    expect(serverAt(10, 9)).toBe(1);
    expect(serverAt(10, 10)).toBe(0);
    expect(serverAt(11, 10)).toBe(1);
    expect(serverAt(11, 11)).toBe(0);
    expect(serverAt(12, 11)).toBe(1);
  });
});
