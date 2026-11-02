import { describe, expect, it } from 'vitest';
import { bilanLine, formatEv, oddsAge, parseBankroll, stakeEuros, stakeLabel } from './suggestionsLogic';

describe('suggestionsLogic', () => {
  it('parse la bankroll saisie et rejette les valeurs invalides', () => {
    expect(parseBankroll('300')).toBe(300);
    expect(parseBankroll('1 250,5')).toBe(1250.5);
    expect(parseBankroll('0')).toBeNull();
    expect(parseBankroll('-20')).toBeNull();
    expect(parseBankroll('abc')).toBeNull();
    expect(parseBankroll('')).toBeNull();
    expect(parseBankroll('2000000')).toBeNull();
  });

  it('calcule la mise au centime à partir de la fraction publiée', () => {
    expect(stakeEuros(300, 0.05)).toBe(15);
    expect(stakeEuros(300, 0.0333)).toBe(9.99);
    expect(stakeEuros(null, 0.05)).toBe(0);
    expect(stakeEuros(300, 0)).toBe(0);
  });

  it('signale une cote de plus de deux heures comme ancienne', () => {
    const now = new Date('2026-11-07T15:00:00Z');
    expect(oddsAge('2026-11-07T13:30:00Z', now).stale).toBe(false);
    expect(oddsAge('2026-11-07T12:59:00Z', now).stale).toBe(true);
    expect(oddsAge('n importe quoi', now)).toEqual({ time: 'N/D', stale: true });
  });

  it('formate espérance et bilan en français', () => {
    expect(formatEv(0.083)).toBe('+8 %');
    expect(formatEv(-0.2)).toBe('−20 %');
    const bilan = { overall: { bets: 1, hitRate: 1, returnFlat: 0, finalBankroll: 300, maxDrawdown: 0, curve: [] }, combos: { bets: 0, hitRate: null, returnFlat: null },
      byFamily: { 'plus/moins': { bets: 40, hitRate: 0.55, returnFlat: -0.04 } }, byCompetition: {} };
    expect(bilanLine(bilan, 'plus/moins')).toBe('plus/moins cette saison : 40 paris, 55 % réussis, rendement −4 %');
    expect(bilanLine(bilan, 'résultat')).toBeNull();
    expect(bilanLine(undefined, 'résultat')).toBeNull();
    expect(stakeLabel('fixed')).toContain('mise fixe');
  });
});
