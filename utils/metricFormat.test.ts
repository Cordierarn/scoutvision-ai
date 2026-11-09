/** Totaux de saison affichés sur la fiche joueur : une valeur absente s'affiche « – », jamais 0 */
import { describe, expect, it } from 'vitest';
import { formatTotal, metricValue } from './metricFormat';
import type { PlayerData } from '../types';

const p = (o: Record<string, unknown>) => ({ Player: 'Joueur A', Team: 'Club A', League: 'Ligue A 2025-26', Position: 'ST', 'Matches played': 10, 'Minutes played': 900, ...o }) as unknown as PlayerData;

describe('formatTotal', () => {
  it('valeur connue au format français, absente : « – »', () => {
    expect(formatTotal(metricValue(p({ xG: 17.43 }), 'xG'), 1)).toBe('17,4');
    expect(formatTotal(metricValue(p({ Goals: 0 }), 'Goals'), 0)).toBe('0');
    expect(formatTotal(metricValue(p({}), 'xA'), 1)).toBe('–');
    expect(formatTotal(metricValue(p({ xA: null }), 'xA'), 1)).toBe('–');
  });
});
