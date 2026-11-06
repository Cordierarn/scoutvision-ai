import { describe, expect, it } from 'vitest';
import type { HistoryBet, HistoryDay } from '../../services/replayData';
import { betNet, bilanLine, formatEv, formatSignedEuros, historySummary, oddsAge, parseBankroll, stakeEuros, stakeLabel, statusClass, PROFILE_ORDER, PROFILE_LABELS, isValidatedProfile } from './suggestionsLogic';

const bet = (status: HistoryBet['status'], realised: number | null, stakeFraction = 0.02): HistoryBet =>
  ({ label: 'x', family: 'résultat', odds: 2, p: 0.5, ev: 0, stakeFraction, stakeMode: 'kelly', status, realised });
const days: HistoryDay[] = [{ date: '2026-11-07', matches: [
  { matchId: 'm1', competition: 'AAA', kickoff: '2026-11-07T15:00:00Z', home: 'Club A', away: 'Club B', score: [2, 1],
    profiles: { equilibre: [bet('won', 1), bet('lost', -1), bet('void', 0), bet('half_won', 0.5)], sur: [bet('won', 0.4)] } },
  { matchId: 'm2', competition: 'AAA', kickoff: '2026-11-07T20:00:00Z', home: 'Club C', away: 'Club D', score: null,
    profiles: { equilibre: [bet('pending', null)] } },
] }];

describe('suggestionsLogic', () => {
  it('ne propose que les profils validés (Ancien moteur et Exploratoire retirés)', () => {
    expect(PROFILE_ORDER).toEqual(['sur', 'equilibre', 'grosse_cote']);
    expect(Object.keys(PROFILE_LABELS)).toEqual(['sur', 'equilibre', 'grosse_cote']);
    expect(isValidatedProfile('equilibre')).toBe(true);
    expect(isValidatedProfile('exploratoire')).toBe(false);
    expect(isValidatedProfile('ancien')).toBe(false);
  });

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
    expect(stakeLabel('shrink_kelly')).toContain('Kelly rétréci');
  });

  it('règle le net sur la bankroll saisie et ignore les paris en attente', () => {
    expect(betNet(300, bet('won', 1))).toBe(6);         // 6 € misés, cote 2
    expect(betNet(300, bet('half_won', 0.5))).toBe(3);
    expect(betNet(300, bet('lost', -1))).toBe(-6);
    expect(betNet(300, bet('void', 0))).toBe(0);
    expect(betNet(300, bet('pending', null))).toBeNull();
    expect(betNet(null, bet('won', 1))).toBeNull();
  });

  it('résume un profil : réussite hors remboursements, mises et net des paris réglés', () => {
    const s = historySummary(days, 'equilibre', 300);
    expect(s).toEqual({ bets: 5, settled: 4, won: 2, hitRate: 2 / 3, staked: 24, net: 3, clvBets: 0, meanClv: null, clvBeatRate: null });
    expect(historySummary(days, 'grosse_cote', 300)).toEqual({ bets: 0, settled: 0, won: 0, hitRate: null, staked: 0, net: 0, clvBets: 0, meanClv: null, clvBeatRate: null });
  });

  it('formate un montant signé et colore le statut', () => {
    expect(formatSignedEuros(6.58)).toMatch(/^\+6,58\s€$/);
    expect(formatSignedEuros(-12)).toMatch(/^−12,00\s€$/);
    expect(formatSignedEuros(0.001)).toMatch(/^0,00\s€$/);
    expect(statusClass('won')).toBe('text-pos');
    expect(statusClass('half_lost')).toBe('text-neg');
    expect(statusClass('pending')).toBe('text-ink-3');
  });
});
