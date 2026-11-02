import { describe, expect, it } from 'vitest';
import { MARKET_RESULT, forbiddenWords, formatGoals, freshness, poolLabel, roundToHundred, tiebreakSignal } from './forecastLogic';

describe('forecastLogic', () => {
  it('rounds displayed probabilities to a sum of exactly 100', () => {
    expect(roundToHundred([0.435, 0.249, 0.316])).toEqual([43, 25, 32]);
    expect(roundToHundred([0.335, 0.335, 0.33])).toEqual([34, 33, 33]);
    expect(roundToHundred([0.5, 0.25, 0.25])).toEqual([50, 25, 25]);
    for (const p of [[0.211, 0.279, 0.509], [0.1, 0.1, 0.8], [0.3333, 0.3333, 0.3334]]) {
      expect(roundToHundred(p)!.reduce((s, v) => s + v, 0)).toBe(100);
    }
    expect(roundToHundred([0.5, null, 0.5])).toBeNull();
    expect(roundToHundred([Number.NaN, 0.5, 0.5])).toBeNull();
  });

  it('shows N/D for missing expected goals instead of crashing', () => {
    expect(formatGoals(1.624)).toBe('1,62');
    expect(formatGoals(null)).toBe('N/D');
    expect(formatGoals(undefined)).toBe('N/D');
    expect(formatGoals(Number.NaN)).toBe('N/D');
  });

  it('grades the approximate-tiebreak signal by the real share of simulations', () => {
    expect(tiebreakSignal(0)).toBe('none');
    expect(tiebreakSignal(0.003)).toBe('method');
    expect(tiebreakSignal(0.01)).toBe('compact');
    expect(tiebreakSignal(0.05)).toBe('compact');
    expect(tiebreakSignal(0.343)).toBe('banner');
  });

  it('keeps the market result free of betting vocabulary', () => {
    for (const text of Object.values(MARKET_RESULT)) expect(forbiddenWords(text)).toEqual([]);
    expect(forbiddenWords('Le favori a un avantage : pari recommandé')).toEqual(['favori', 'avantage', 'pari']);
    expect(poolLabel(0)).toBe('Le marché contient déjà l\'information du modèle');
    expect(poolLabel(0.1)).toBe('Information marginale');
    expect(poolLabel(0.55)).toBe('Information complémentaire mesurable');
    expect(forbiddenWords(poolLabel(0) + poolLabel(0.1) + poolLabel(0.55))).toEqual([]);
  });

  it('keeps the three freshness dates apart', () => {
    const f = freshness('2026-10-30T09:42:55Z', '2026-11-02T10:46:00+00:00', ['2024-08-16', '2026-10-20']);
    expect(f.forecasts).toBe('30 octobre 2026');
    expect(f.replays).toBe('2 novembre 2026');
    expect(f.market).toBe('16 août 2024 → 20 octobre 2026');
    expect(freshness(null, undefined, null)).toEqual({ forecasts: null, replays: null, market: null });
  });
});
