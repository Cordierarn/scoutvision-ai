import { describe, expect, it } from 'vitest';
import type { SuggestionMatch } from '../../services/replayData';
import { candidateMatches, defaultSelection, googleSearchUrl, mapLimited, planStake, verdictClass } from './assistantLogic';

const NOW = new Date('2026-11-07T12:00:00Z');
const m = (id: string, kickoff: string, status: 'ok' | 'no_odds' = 'ok'): SuggestionMatch =>
  ({ matchId: id, competition: 'AAA', date: kickoff.slice(0, 10), home: `Club ${id}`, away: 'Club Z', status, kickoff });

describe('assistantLogic', () => {
  it('propose les matchs avec cotes non commencés, les prochaines 24 h d\'abord', () => {
    const list = [m('late', '2026-11-09T20:00:00Z'), m('soon', '2026-11-07T19:00:00Z'), m('past', '2026-11-07T10:00:00Z'), m('noodds', '2026-11-07T18:00:00Z', 'no_odds'), m('tomorrow', '2026-11-08T11:00:00Z')];
    expect(candidateMatches(list, NOW).map(x => x.matchId)).toEqual(['soon', 'tomorrow', 'late']);
    expect(defaultSelection(list, NOW)).toEqual(['soon', 'tomorrow']);
    expect(defaultSelection([m('late', '2026-11-09T20:00:00Z')], NOW)).toEqual(['late']);   // rien sous 24 h : les prochains
    expect(defaultSelection(Array.from({ length: 9 }, (_, i) => m(`x${i}`, `2026-11-07T1${i}:30:00Z`)), NOW)).toHaveLength(6);
  });

  it('exécute au plus `limit` appels à la fois et garde l\'ordre, erreurs comprises', async () => {
    let active = 0, peak = 0;
    const progress: number[] = [];
    const out = await mapLimited([1, 2, 3, 4, 5], 2, async n => {
      active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 5));
      active--;
      if (n === 3) throw new Error('échec');
      return n * 10;
    }, d => progress.push(d));
    expect(peak).toBe(2);
    expect(out.map(r => (r.status === 'fulfilled' ? r.value : 'x'))).toEqual([10, 20, 'x', 40, 50]);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
  });

  it('additionne les mises du moteur sur la bankroll et colore les avis', () => {
    expect(planStake([{ stakeFraction: 0.02 }, { stakeFraction: 0.035 }], 300)).toBe(16.5);
    expect(planStake([{ stakeFraction: 0.02 }], null)).toBe(0);
    expect(verdictClass('garder')).toBe('text-pos');
    expect(verdictClass('eviter')).toBe('text-neg');
    expect(verdictClass('prudence')).toBe('text-warn');
    expect(googleSearchUrl('Club A blessés')).toBe('https://www.google.com/search?q=Club%20A%20bless%C3%A9s');
  });
});
