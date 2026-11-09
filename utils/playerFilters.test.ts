/** Conditions numériques de la Base joueurs : une valeur absente ne correspond jamais (joueurs fictifs) */
import { describe, expect, it } from 'vitest';
import { matchesConditions } from './playerFilters';

const p = (xg: unknown) => ({ Player: 'Joueur A', 'xG per 90': xg });

describe('matchesConditions', () => {
  it('borne maximum : un joueur sans valeur n\'est pas retenu (il n\'est pas « 0 »)', () => {
    const c = [{ key: 'xG per 90', min: '' as const, max: 0.5 }];
    expect(matchesConditions(p(0.3), c)).toBe(true);
    expect(matchesConditions(p(0), c)).toBe(true);
    for (const missing of [undefined, null, '', 'abc', Number.NaN]) expect(matchesConditions(p(missing), c)).toBe(false);
  });

  it('borne minimum et intervalle', () => {
    expect(matchesConditions(p(0.6), [{ key: 'xG per 90', min: 0.5, max: '' }])).toBe(true);
    expect(matchesConditions(p(0.4), [{ key: 'xG per 90', min: 0.5, max: '' }])).toBe(false);
    expect(matchesConditions(p(0.5), [{ key: 'xG per 90', min: 0.5, max: 0.5 }])).toBe(true);
    expect(matchesConditions(p(null), [{ key: 'xG per 90', min: 0, max: '' }])).toBe(false);
  });

  it('condition sans borne : sans effet, y compris pour une valeur absente', () => {
    expect(matchesConditions(p(undefined), [{ key: 'xG per 90', min: '', max: '' }])).toBe(true);
  });

  it('toutes les conditions sont requises', () => {
    const q = { 'xG per 90': 0.6, 'xA per 90': undefined };
    expect(matchesConditions(q, [{ key: 'xG per 90', min: 0.5, max: '' }, { key: 'xA per 90', min: '', max: 1 }])).toBe(false);
    expect(matchesConditions(q, [{ key: 'xG per 90', min: 0.5, max: '' }])).toBe(true);
  });
});

describe('matchesConditions : bornes saisies', () => {
  it('accepte les bornes en texte du champ de saisie', () => {
    expect(matchesConditions(p(0.6), [{ key: 'xG per 90', min: '0.5', max: '' }])).toBe(true);
    expect(matchesConditions(p(null), [{ key: 'xG per 90', min: '0.5', max: '' }])).toBe(false);
  });
});
